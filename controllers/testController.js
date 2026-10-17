const asyncHandler = require("express-async-handler");
const Test = require("../models/Test");
const Student = require("../models/Student");
const { notifyStudents } = require("../utils/notify");
const whatsapp = require("../services/whatsappService");
const Settings = require("../models/Settings");
const { academyFilter, requireAcademyId } = require("../utils/tenant");

// Returns the set of student _ids (as strings) a staff member is allowed to
// touch: all active students for Admin, or only their own for a Teacher.
const allowedStudentIds = async (req) => {
  const filter = req.user.role === "admin" ? { academyId: requireAcademyId(req) } : { academyId: requireAcademyId(req), assignedTeacher: req.user._id };
  const students = await Student.find(filter).select("_id");
  return students.map((s) => s._id.toString());
};

// @desc    Create a new test for a class or a specific set of students.
//          Teachers may only assign the test to their own students, even if
//          other teachers' students share the same class name.
// @route   POST /api/tests
// @access  Staff (Admin or Teacher)
const createTest = asyncHandler(async (req, res) => {
  const { testName, subject, class: className, maxMarks, date, studentIds } = req.body;

  if (!testName || !subject || !className || !maxMarks || !date) {
    res.status(400);
    throw new Error("Please fill in all required test fields");
  }

  const allowedIds = await allowedStudentIds(req);

  let students;
  if (studentIds && studentIds.length > 0) {
    // Reject any student ID the requester isn't allowed to touch
    const invalid = studentIds.filter((id) => !allowedIds.includes(id.toString()));
    if (invalid.length > 0) {
      res.status(403);
      throw new Error("Access denied: one or more students are not assigned to you");
    }
    students = studentIds;
  } else {
    const filter =
      req.user.role === "admin"
        ? { academyId: requireAcademyId(req), class: className, status: "Active" }
        : { academyId: requireAcademyId(req), class: className, status: "Active", assignedTeacher: req.user._id };
    const classStudents = await Student.find(filter).select("_id");
    students = classStudents.map((s) => s._id);
  }

  const test = await Test.create({
    testName,
    subject,
    class: className,
    maxMarks,
    date,
    marks: students.map((studentId) => ({ student: studentId, marksObtained: null })),
    createdBy: req.user._id,
    academyId: requireAcademyId(req),
  });

  await notifyStudents(
    students,
    "TEST_SCHEDULED",
    `New Test Scheduled: ${testName}`,
    `${subject} test scheduled on ${new Date(date).toDateString()}. Maximum marks: ${maxMarks}.`,
    test._id
  );

  res.status(201).json({ success: true, data: test });
});

// @desc    Get tests. Admin sees every test in full. A Teacher only sees
//          tests that include at least one of their own students, and the
//          `marks` array is trimmed to just their own students' entries so
//          no other teacher's student data leaks through.
// @route   GET /api/tests?class=
// @access  Staff (Admin or Teacher)
const getTests = asyncHandler(async (req, res) => {
  const query = { academyId: requireAcademyId(req) };
  if (req.query.class) query.class = req.query.class;

  const tests = await Test.find(query)
    .populate("marks.student", "name studentId")
    .sort({ date: -1 });

  if (req.user.role === "admin") {
    const withStats = tests.map((t) => ({ ...t.toObject(), stats: t.getStats() }));
    return res.json({ success: true, count: withStats.length, data: withStats });
  }

  const allowedIds = await allowedStudentIds(req);
  const scoped = tests
    .map((t) => {
      const marks = t.marks.filter((m) => allowedIds.includes(m.student._id.toString()));
      if (marks.length === 0) return null;
      const scopedTest = { ...t.toObject(), marks };
      return { ...scopedTest, stats: t.getStats() };
    })
    .filter(Boolean);

  res.json({ success: true, count: scoped.length, data: scoped });
});

// @desc    Get single test — Teacher only sees their own students' marks
// @route   GET /api/tests/:id
// @access  Staff (Admin or Teacher)
const getTestById = asyncHandler(async (req, res) => {
  const test = await Test.findOne(academyFilter(req, { _id: req.params.id })).populate("marks.student", "name studentId class");
  if (!test) {
    res.status(404);
    throw new Error("Test not found");
  }

  if (req.user.role === "admin") {
    return res.json({ success: true, data: { ...test.toObject(), stats: test.getStats() } });
  }

  const allowedIds = await allowedStudentIds(req);
  const marks = test.marks.filter((m) => allowedIds.includes(m.student._id.toString()));
  if (marks.length === 0) {
    res.status(403);
    throw new Error("Access denied: none of these students are assigned to you");
  }

  res.json({ success: true, data: { ...test.toObject(), marks, stats: test.getStats() } });
});

// @desc    Enter or update marks. Teacher can only submit marks for
//          students assigned to them — every ID is checked server-side.
// @route   PUT /api/tests/:id/marks
// @access  Staff (Admin or Teacher)
const updateMarks = asyncHandler(async (req, res) => {
  const test = await Test.findOne(academyFilter(req, { _id: req.params.id }));
  if (!test) {
    res.status(404);
    throw new Error("Test not found");
  }

  const { marks } = req.body;
  if (!Array.isArray(marks)) {
    res.status(400);
    throw new Error("marks must be an array of { studentId, marksObtained }");
  }

  const allowedIds = await allowedStudentIds(req);
  const invalid = marks.filter((m) => !allowedIds.includes(m.studentId.toString()));
  if (invalid.length > 0) {
    res.status(403);
    throw new Error("Access denied: one or more students are not assigned to you");
  }

  marks.forEach(({ studentId, marksObtained }) => {
    const entry = test.marks.find((m) => m.student.toString() === studentId);
    if (entry) entry.marksObtained = marksObtained === "" ? null : marksObtained;
    else test.marks.push({ student: studentId, marksObtained });
  });

  await test.save();

  const studentIds = marks.map((m) => m.studentId);
  await notifyStudents(
    studentIds,
    "MARKS_UPLOADED",
    `Marks Uploaded: ${test.testName}`,
    `Your marks for ${test.subject} (${test.testName}) have been uploaded.`,
    test._id
  );

  // Fire WhatsApp result notifications in the background — only for marks
  // that were actually entered (not cleared to null) in this call.
  Settings.getSingleton(requireAcademyId(req))
    .then(async (settings) => {
      if (!settings.whatsapp.autoNotificationsEnabled || !settings.whatsapp.notificationsEnabled.resultNotification) return;
      const graded = marks.filter((m) => m.marksObtained !== "" && m.marksObtained !== null);
      if (graded.length === 0) return;
      const studentDocs = await Student.find({ academyId: requireAcademyId(req), _id: { $in: graded.map((m) => m.studentId) } });
      await Promise.all(
        graded.map((m) => {
          const student = studentDocs.find((s) => s._id.toString() === m.studentId.toString());
          if (!student) return null;
          const percentage = Number(((m.marksObtained / test.maxMarks) * 100).toFixed(1));
          return whatsapp.sendResultNotification({
            student, subject: test.subject, score: m.marksObtained, maxMarks: test.maxMarks, percentage,
          });
        })
      );
    })
    .catch((err) => console.error("[whatsapp] result notification failed:", err.message));

  res.json({ success: true, data: { ...test.toObject(), stats: test.getStats() } });
});

// @desc    Clear a single student's mark entry (scoped)
// @route   DELETE /api/tests/:id/marks/:studentId
// @access  Staff (Admin or Teacher)
const deleteMark = asyncHandler(async (req, res) => {
  const allowedIds = await allowedStudentIds(req);
  if (!allowedIds.includes(req.params.studentId)) {
    res.status(403);
    throw new Error("Access denied: this student is not assigned to you");
  }

  const test = await Test.findOne(academyFilter(req, { _id: req.params.id }));
  if (!test) {
    res.status(404);
    throw new Error("Test not found");
  }

  const entry = test.marks.find((m) => m.student.toString() === req.params.studentId);
  if (!entry) {
    res.status(404);
    throw new Error("Mark entry not found for this student");
  }
  entry.marksObtained = null;
  await test.save();

  res.json({ success: true, message: "Mark entry cleared" });
});

// @desc    Delete a whole test. Only Admin, or the Teacher who created it.
// @route   DELETE /api/tests/:id
// @access  Staff (Admin or Teacher — creator only)
const deleteTest = asyncHandler(async (req, res) => {
  const test = await Test.findOne(academyFilter(req, { _id: req.params.id }));
  if (!test) {
    res.status(404);
    throw new Error("Test not found");
  }

  if (req.user.role !== "admin" && test.createdBy?.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error("Access denied: you can only delete tests you created");
  }

  await test.deleteOne();
  res.json({ success: true, message: "Test deleted successfully" });
});

// @desc    Compare two tests. Results are scoped to the requester's own
//          students unless they're Admin.
// @route   GET /api/tests/compare?testA=&testB=
// @access  Staff (Admin or Teacher)
const compareTests = asyncHandler(async (req, res) => {
  const { testA, testB } = req.query;
  if (!testA || !testB) {
    res.status(400);
    throw new Error("Provide testA and testB query params (test IDs)");
  }

  const [a, b] = await Promise.all([
    Test.findOne(academyFilter(req, { _id: testA })).populate("marks.student", "name studentId"),
    Test.findOne(academyFilter(req, { _id: testB })).populate("marks.student", "name studentId"),
  ]);

  if (!a || !b) {
    res.status(404);
    throw new Error("One or both tests not found");
  }

  const allowedIds = req.user.role === "admin" ? null : await allowedStudentIds(req);
  const inScope = (studentId) => !allowedIds || allowedIds.includes(studentId.toString());

  const improvement = b.marks
    .filter((entryB) => inScope(entryB.student._id))
    .map((entryB) => {
      const entryA = a.marks.find((m) => m.student._id.toString() === entryB.student._id.toString());
      const scoreA = entryA ? entryA.marksObtained : null;
      const scoreB = entryB.marksObtained;
      const change = scoreA !== null && scoreB !== null ? Number((scoreB - scoreA).toFixed(2)) : null;
      return { student: entryB.student, previousMarks: scoreA, currentMarks: scoreB, change };
    });

  res.json({
    success: true,
    data: {
      testA: { ...a.toObject(), stats: a.getStats() },
      testB: { ...b.toObject(), stats: b.getStats() },
      improvement,
    },
  });
});

// @desc    Student's own tests, with only their own marks visible
// @route   GET /api/tests/my
// @access  Student
const getMyTests = asyncHandler(async (req, res) => {
  const tests = await Test.find(academyFilter(req, { "marks.student": req.user._id })).sort({ date: -1 });

  const data = tests.map((t) => {
    const entry = t.marks.find((m) => m.student.toString() === req.user._id.toString());
    return {
      _id: t._id,
      testName: t.testName,
      subject: t.subject,
      class: t.class,
      maxMarks: t.maxMarks,
      date: t.date,
      marksObtained: entry ? entry.marksObtained : null,
    };
  });

  res.json({ success: true, data });
});

module.exports = {
  createTest,
  getTests,
  getTestById,
  updateMarks,
  deleteMark,
  deleteTest,
  compareTests,
  getMyTests,
};
