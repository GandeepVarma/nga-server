const asyncHandler = require("express-async-handler");
const OnlineTest = require("../models/OnlineTest");
const Submission = require("../models/Submission");
const Student = require("../models/Student");
const whatsapp = require("../services/whatsappService");
const Settings = require("../models/Settings");
const { academyFilter, requireAcademyId } = require("../utils/tenant");

const assignmentFilter = (req, test = {}) => ({
  ...test,
  academyId: requireAcademyId(req),
  class: req.user.class,
  batch: req.user.batch,
});

const assertAssignmentExists = async (req, className, batch) => {
  const filter = { academyId: requireAcademyId(req), class: className, batch };
  if (req.user.role !== "admin") filter.assignedTeacher = req.user._id;
  const student = await Student.exists(filter);
  if (!student) {
    const err = new Error("The selected batch does not belong to this academy and class");
    err.status = 400;
    throw err;
  }
};

// Staff assignment options are derived from tenant-scoped student records.
const getAssignmentOptions = asyncHandler(async (req, res) => {
  const filter = { academyId: requireAcademyId(req) };
  if (req.user.role !== "admin") filter.assignedTeacher = req.user._id;
  const classes = await Student.find(filter).distinct("class");
  const batches = req.query.class
    ? await Student.find({ ...filter, class: req.query.class }).distinct("batch")
    : [];
  res.json({ success: true, data: { classes: classes.filter(Boolean).sort(), batches: batches.filter(Boolean).sort() } });
});

// A teacher may only build tests for classes where they actually have
// assigned students — prevents a teacher from silently reaching students
// that aren't theirs by just typing a class name into the form.
const assertClassesOwnedByTeacher = async (req, classes) => {
  if (req.user.role === "admin") return;
  const ownedClasses = await Student.find({ academyId: requireAcademyId(req), assignedTeacher: req.user._id }).distinct("class");
  const invalid = classes.filter((c) => !ownedClasses.includes(c));
  if (invalid.length > 0) {
    const err = new Error(`Access denied: you have no assigned students in: ${invalid.join(", ")}`);
    err.status = 403;
    throw err;
  }
};

// Ownership check used by update/delete/publish/analytics/submissions/duplicate
const findOwnedTest = async (req, id) => {
  const test = await OnlineTest.findOne(academyFilter(req, { _id: id }));
  if (!test) {
    const err = new Error("Test not found");
    err.status = 404;
    throw err;
  }
  if (req.user.role !== "admin" && test.createdBy.toString() !== req.user._id.toString()) {
    const err = new Error("Access denied: you can only manage tests you created");
    err.status = 403;
    throw err;
  }
  return test;
};

// @desc    Create a new MCQ test (with its questions in one payload)
// @route   POST /api/online-tests
// @access  Staff (Admin or Teacher)
const createTest = asyncHandler(async (req, res) => {
  const {
    title, subject, class: className, batch, duration, instructions, startTime, endTime,
    negativeMarking, randomizeQuestions, showResults, allowReview, passPercentage, questions,
  } = req.body;

  if (!title || !subject || !className || !batch || !duration || !startTime || !endTime) {
    res.status(400);
    throw new Error("title, subject, class, batch, duration, startTime and endTime are required");
  }
  if (new Date(endTime) <= new Date(startTime)) {
    res.status(400);
    throw new Error("endTime must be after startTime");
  }

  try {
    await assertAssignmentExists(req, className, batch);
  } catch (err) {
    res.status(err.status || 403);
    throw err;
  }

  const test = await OnlineTest.create({
    title, subject, class: className, batch, duration, instructions,
    startTime, endTime,
    negativeMarking: negativeMarking || 0,
    randomizeQuestions: !!randomizeQuestions,
    showResults: showResults !== false,
    allowReview: allowReview !== false,
    passPercentage: passPercentage || 40,
    questions: questions || [],
    createdBy: req.user._id,
    academyId: requireAcademyId(req),
  });

  res.status(201).json({ success: true, data: test });
});

// @desc    List tests. Admin sees all; Teacher sees only tests they created.
// @route   GET /api/online-tests?search=&subject=&published=&page=&limit=
// @access  Staff (Admin or Teacher)
const getTests = asyncHandler(async (req, res) => {
  const { search, subject, published, page = 1, limit = 10 } = req.query;
  const query = req.user.role === "admin" ? { academyId: requireAcademyId(req) } : { academyId: requireAcademyId(req), createdBy: req.user._id };

  if (subject) query.subject = subject;
  if (published !== undefined) query.published = published === "true";
  if (search) query.title = { $regex: search, $options: "i" };

  const skip = (Number(page) - 1) * Number(limit);
  const [tests, total] = await Promise.all([
    OnlineTest.find(query).populate("createdBy", "name").sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    OnlineTest.countDocuments(query),
  ]);

  res.json({ success: true, count: tests.length, total, page: Number(page), data: tests });
});

// @desc    Get a single test with full answer key (owner/admin view)
// @route   GET /api/online-tests/:id
// @access  Staff (Admin or owning Teacher)
const getTestById = asyncHandler(async (req, res) => {
  try {
    const test = await findOwnedTest(req, req.params.id);
    res.json({ success: true, data: test });
  } catch (err) {
    res.status(err.status || 500);
    throw err;
  }
});

// @desc    Update a test (only while unpublished — once live, structure is locked
//          to keep already-started attempts consistent; admin can override)
// @route   PUT /api/online-tests/:id
// @access  Staff (Admin or owning Teacher)
const updateTest = asyncHandler(async (req, res) => {
  const test = await findOwnedTest(req, req.params.id).catch((err) => {
    res.status(err.status || 500);
    throw err;
  });

  if (test.published && req.user.role !== "admin") {
    res.status(400);
    throw new Error("This test is published — unpublish it before editing, or ask an Admin to edit it directly");
  }

  if (req.body.class || req.body.batch) {
    try {
      await assertAssignmentExists(req, req.body.class || test.class, req.body.batch || test.batch);
    } catch (err) {
      res.status(err.status || 403);
      throw err;
    }
  }

  const fields = [
    "title", "subject", "class", "batch", "duration", "instructions", "startTime", "endTime",
    "negativeMarking", "randomizeQuestions", "showResults", "allowReview", "passPercentage", "questions",
  ];
  fields.forEach((f) => { if (req.body[f] !== undefined) test[f] = req.body[f]; });

  await test.save();
  res.json({ success: true, data: test });
});

// @desc    Publish/unpublish a test
// @route   POST /api/online-tests/:id/publish   (body: { publish: boolean })
// @access  Staff (Admin or owning Teacher)
const setPublishStatus = asyncHandler(async (req, res) => {
  const test = await findOwnedTest(req, req.params.id).catch((err) => {
    res.status(err.status || 500);
    throw err;
  });

  if (req.body.publish && test.questions.length === 0) {
    res.status(400);
    throw new Error("Add at least one question before publishing");
  }

  test.published = !!req.body.publish;
  await test.save();

  if (test.published) {
    Settings.getSingleton(requireAcademyId(req))
      .then(async (settings) => {
        if (!settings.whatsapp.autoNotificationsEnabled || !settings.whatsapp.notificationsEnabled.testAnnouncement) return;
        const students = await Student.find({ academyId: requireAcademyId(req), class: test.class, batch: test.batch, status: "Active" });
        await Promise.all(students.map((s) => whatsapp.sendTestAnnouncement({ student: s, test })));
      })
      .catch((err) => console.error("[whatsapp] test announcement failed:", err.message));
  }

  res.json({ success: true, data: test });
});

// @desc    Duplicate an existing test (copy is created unpublished)
// @route   POST /api/online-tests/:id/duplicate
// @access  Staff (Admin or owning Teacher)
const duplicateTest = asyncHandler(async (req, res) => {
  const test = await findOwnedTest(req, req.params.id).catch((err) => {
    res.status(err.status || 500);
    throw err;
  });

  const className = req.body.class || test.class;
  const batch = req.body.batch || test.batch;
  await assertAssignmentExists(req, className, batch);
  const copy = await OnlineTest.create({
    title: `${test.title} (Copy)`,
    subject: test.subject,
    class: className,
    batch,
    duration: test.duration,
    instructions: test.instructions,
    startTime: test.startTime,
    endTime: test.endTime,
    negativeMarking: test.negativeMarking,
    randomizeQuestions: test.randomizeQuestions,
    showResults: test.showResults,
    allowReview: test.allowReview,
    passPercentage: test.passPercentage,
    questions: test.questions,
    createdBy: req.user._id,
    academyId: requireAcademyId(req),
    published: false,
  });

  res.status(201).json({ success: true, data: copy });
});

// @desc    Delete a test and all its submissions
// @route   DELETE /api/online-tests/:id
// @access  Staff (Admin or owning Teacher)
const deleteTest = asyncHandler(async (req, res) => {
  const test = await findOwnedTest(req, req.params.id).catch((err) => {
    res.status(err.status || 500);
    throw err;
  });

  await Submission.deleteMany({ academyId: requireAcademyId(req), test: test._id });
  await test.deleteOne();
  res.json({ success: true, message: "Test and its submissions deleted" });
});

// @desc    Analytics summary for a test: attempt counts, score stats, charts
// @route   GET /api/online-tests/:id/analytics
// @access  Staff (Admin or owning Teacher)
const getAnalytics = asyncHandler(async (req, res) => {
  const test = await findOwnedTest(req, req.params.id).catch((err) => {
    res.status(err.status || 500);
    throw err;
  });

  const [assignedCount, submissions] = await Promise.all([
    Student.countDocuments({ academyId: requireAcademyId(req), class: test.class, batch: test.batch, status: "Active" }),
    Submission.find({ academyId: requireAcademyId(req), test: test._id, submittedAt: { $ne: null } }).populate("student", "name studentId"),
  ]);

  const attempted = submissions.length;
  const notAttempted = Math.max(assignedCount - attempted, 0);
  const scores = submissions.map((s) => s.percentage);
  const average = scores.length ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)) : 0;
  const highest = scores.length ? Math.max(...scores) : 0;
  const lowest = scores.length ? Math.min(...scores) : 0;
  const passCount = submissions.filter((s) => s.percentage >= test.passPercentage).length;
  const passPercentageActual = attempted > 0 ? Number(((passCount / attempted) * 100).toFixed(1)) : 0;

  // Score distribution buckets for a chart: 0-20, 21-40, 41-60, 61-80, 81-100
  const buckets = [0, 0, 0, 0, 0];
  scores.forEach((p) => {
    const idx = Math.min(Math.floor(p / 20), 4);
    buckets[idx] += 1;
  });

  // Question-wise accuracy
  const questionAccuracy = test.questions.map((q) => {
    let correct = 0;
    submissions.forEach((s) => {
      const ans = s.answers.find((a) => a.questionId.toString() === q._id.toString());
      if (ans && ans.selectedOption === q.correctOption) correct += 1;
    });
    return {
      questionId: q._id,
      questionText: q.questionText,
      accuracyPercent: attempted > 0 ? Number(((correct / attempted) * 100).toFixed(1)) : 0,
    };
  });

  const topPerformers = [...submissions]
    .sort((a, b) => b.percentage - a.percentage)
    .slice(0, 5)
    .map((s) => ({ student: s.student, score: s.score, percentage: s.percentage, timeTakenSeconds: s.timeTakenSeconds }));

  res.json({
    success: true,
    data: {
      assignedCount, attempted, notAttempted, average, highest, lowest,
      passPercentageActual,
      scoreDistribution: { labels: ["0-20", "21-40", "41-60", "61-80", "81-100"], counts: buckets },
      questionAccuracy,
      topPerformers,
    },
  });
});

// @desc    Paginated list of a test's submissions
// @route   GET /api/online-tests/:id/submissions?page=&limit=
// @access  Staff (Admin or owning Teacher)
const getSubmissions = asyncHandler(async (req, res) => {
  const test = await findOwnedTest(req, req.params.id).catch((err) => {
    res.status(err.status || 500);
    throw err;
  });

  const { page = 1, limit = 20 } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const [submissions, total] = await Promise.all([
    Submission.find({ academyId: requireAcademyId(req), test: test._id })
      .populate("student", "name studentId class")
      .sort({ submittedAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    Submission.countDocuments({ academyId: requireAcademyId(req), test: test._id }),
  ]);

  res.json({ success: true, count: submissions.length, total, page: Number(page), data: submissions });
});

// @desc    Export a test's submissions as CSV
// @route   GET /api/online-tests/:id/export
// @access  Staff (Admin or owning Teacher)
const exportSubmissionsCSV = asyncHandler(async (req, res) => {
  const test = await findOwnedTest(req, req.params.id).catch((err) => {
    res.status(err.status || 500);
    throw err;
  });

  const submissions = await Submission.find({ academyId: requireAcademyId(req), test: test._id }).populate("student", "name studentId class");

  const header = "Student ID,Name,Class,Score,Percentage,Correct,Wrong,Unanswered,Time Taken (s),Auto Submitted,Tab Switches,Status\n";
  const rows = submissions.map((s) => {
    const status = s.submittedAt ? (s.percentage >= test.passPercentage ? "Pass" : "Fail") : "In Progress";
    return [
      s.student?.studentId, s.student?.name, s.student?.class,
      s.score ?? "", s.percentage ?? "", s.correctCount, s.wrongCount, s.unansweredCount,
      s.timeTakenSeconds ?? "", s.autoSubmitted, s.tabSwitchCount, status,
    ].join(",");
  });

  const csv = header + rows.join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${test.title.replace(/\s+/g, "_")}_results.csv"`);
  res.send(csv);
});

module.exports = {
  createTest, getTests, getTestById, updateTest, setPublishStatus,
  duplicateTest, deleteTest, getAnalytics, getSubmissions, exportSubmissionsCSV, getAssignmentOptions,
};
