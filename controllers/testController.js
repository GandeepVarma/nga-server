const asyncHandler = require("express-async-handler");
const Test = require("../models/Test");
const Student = require("../models/Student");
const { notifyStudents } = require("../utils/notify");

// @desc    Create a new test for a class or a specific set of students
// @route   POST /api/tests
// @access  Teacher
const createTest = asyncHandler(async (req, res) => {
  const { testName, subject, class: className, maxMarks, date, studentIds } = req.body;

  if (!testName || !subject || !className || !maxMarks || !date) {
    res.status(400);
    throw new Error("Please fill in all required test fields");
  }

  // If no specific students given, assign to the whole class
  let students = studentIds;
  if (!students || students.length === 0) {
    const classStudents = await Student.find({ class: className, status: "Active" }).select("_id");
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

// @desc    Get all tests (optionally filtered by class)
// @route   GET /api/tests?class=
// @access  Teacher
const getTests = asyncHandler(async (req, res) => {
  const query = {};
  if (req.query.class) query.class = req.query.class;

  const tests = await Test.find(query)
    .populate("marks.student", "name studentId")
    .sort({ date: -1 });

  const withStats = tests.map((t) => ({
    ...t.toObject(),
    stats: t.getStats(),
  }));

  res.json({ success: true, count: tests.length, data: withStats });
});

// @desc    Get single test with full details
// @route   GET /api/tests/:id
// @access  Teacher
const getTestById = asyncHandler(async (req, res) => {
  const test = await Test.findById(req.params.id).populate(
    "marks.student",
    "name studentId class"
  );
  if (!test) {
    res.status(404);
    throw new Error("Test not found");
  }
  res.json({ success: true, data: { ...test.toObject(), stats: test.getStats() } });
});

// @desc    Enter or update marks for one or more students in a test
// @route   PUT /api/tests/:id/marks
// @body    { marks: [{ studentId, marksObtained }] }
// @access  Teacher
const updateMarks = asyncHandler(async (req, res) => {
  const test = await Test.findById(req.params.id);
  if (!test) {
    res.status(404);
    throw new Error("Test not found");
  }

  const { marks } = req.body;
  if (!Array.isArray(marks)) {
    res.status(400);
    throw new Error("marks must be an array of { studentId, marksObtained }");
  }

  marks.forEach(({ studentId, marksObtained }) => {
    const entry = test.marks.find((m) => m.student.toString() === studentId);
    if (entry) {
      entry.marksObtained = marksObtained === "" ? null : marksObtained;
    } else {
      test.marks.push({ student: studentId, marksObtained });
    }
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

  res.json({ success: true, data: { ...test.toObject(), stats: test.getStats() } });
});

// @desc    Delete a single student's mark entry (reset to not-entered)
// @route   DELETE /api/tests/:id/marks/:studentId
// @access  Teacher
const deleteMark = asyncHandler(async (req, res) => {
  const test = await Test.findById(req.params.id);
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

// @desc    Delete a whole test
// @route   DELETE /api/tests/:id
// @access  Teacher
const deleteTest = asyncHandler(async (req, res) => {
  const test = await Test.findById(req.params.id);
  if (!test) {
    res.status(404);
    throw new Error("Test not found");
  }
  await test.deleteOne();
  res.json({ success: true, message: "Test deleted successfully" });
});

// @desc    Compare two tests (e.g. previous vs current) for a class or student
// @route   GET /api/tests/compare?testA=&testB=
// @access  Teacher
const compareTests = asyncHandler(async (req, res) => {
  const { testA, testB } = req.query;
  if (!testA || !testB) {
    res.status(400);
    throw new Error("Provide testA and testB query params (test IDs)");
  }

  const [a, b] = await Promise.all([
    Test.findById(testA).populate("marks.student", "name studentId"),
    Test.findById(testB).populate("marks.student", "name studentId"),
  ]);

  if (!a || !b) {
    res.status(404);
    throw new Error("One or both tests not found");
  }

  const improvement = b.marks.map((entryB) => {
    const entryA = a.marks.find(
      (m) => m.student._id.toString() === entryB.student._id.toString()
    );
    const scoreA = entryA ? entryA.marksObtained : null;
    const scoreB = entryB.marksObtained;
    const change =
      scoreA !== null && scoreB !== null ? Number((scoreB - scoreA).toFixed(2)) : null;
    return {
      student: entryB.student,
      previousMarks: scoreA,
      currentMarks: scoreB,
      change,
    };
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

// @desc    Get the logged-in student's own tests, with only their own marks visible
// @route   GET /api/tests/my
// @access  Student
const getMyTests = asyncHandler(async (req, res) => {
  const tests = await Test.find({ "marks.student": req.user._id }).sort({ date: -1 });

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
