const asyncHandler = require("express-async-handler");
const Assignment = require("../models/Assignment");
const Student = require("../models/Student");
const { notifyStudents } = require("../utils/notify");

// @desc    Create an assignment, optionally with uploaded PDF/image files
// @route   POST /api/assignments
// @access  Teacher
const createAssignment = asyncHandler(async (req, res) => {
  const { title, description, class: className, submissionDate, studentIds } = req.body;

  if (!title || !description || !className || !submissionDate) {
    res.status(400);
    throw new Error("Please fill in all required assignment fields");
  }

  let students = studentIds;
  if (!students || students.length === 0) {
    const classStudents = await Student.find({ class: className, status: "Active" }).select("_id");
    students = classStudents.map((s) => s._id);
  } else if (typeof students === "string") {
    students = JSON.parse(students);
  }

  const files = (req.files || []).map((file) => ({
    url: file.path,
    publicId: file.filename,
    originalName: file.originalname,
    fileType: file.mimetype === "application/pdf" ? "pdf" : "image",
  }));

  const assignment = await Assignment.create({
    title,
    description,
    class: className,
    submissionDate,
    files,
    assignedStudents: students.map((studentId) => ({ student: studentId })),
    createdBy: req.user._id,
  });

  await notifyStudents(
    students,
    "ASSIGNMENT_UPLOADED",
    `New Assignment: ${title}`,
    `A new assignment has been posted. Due: ${new Date(submissionDate).toDateString()}.`,
    assignment._id
  );

  res.status(201).json({ success: true, data: assignment });
});

// @desc    Get all assignments (optionally filtered by class)
// @route   GET /api/assignments?class=
// @access  Teacher
const getAssignments = asyncHandler(async (req, res) => {
  const query = {};
  if (req.query.class) query.class = req.query.class;

  const assignments = await Assignment.find(query)
    .populate("assignedStudents.student", "name studentId")
    .sort({ submissionDate: -1 });

  res.json({ success: true, count: assignments.length, data: assignments });
});

// @desc    Get a single assignment
// @route   GET /api/assignments/:id
// @access  Teacher or assigned student
const getAssignmentById = asyncHandler(async (req, res) => {
  const assignment = await Assignment.findById(req.params.id).populate(
    "assignedStudents.student",
    "name studentId"
  );
  if (!assignment) {
    res.status(404);
    throw new Error("Assignment not found");
  }
  res.json({ success: true, data: assignment });
});

// @desc    Update a student's submission status for an assignment
// @route   PUT /api/assignments/:id/status/:studentId
// @body    { status: "Completed" | "Pending" | "Late Submission", teacherRemarks }
// @access  Teacher
const updateSubmissionStatus = asyncHandler(async (req, res) => {
  const assignment = await Assignment.findById(req.params.id);
  if (!assignment) {
    res.status(404);
    throw new Error("Assignment not found");
  }

  const entry = assignment.assignedStudents.find(
    (s) => s.student.toString() === req.params.studentId
  );
  if (!entry) {
    res.status(404);
    throw new Error("This student is not assigned to this assignment");
  }

  if (req.body.status) entry.status = req.body.status;
  if (req.body.teacherRemarks !== undefined) entry.teacherRemarks = req.body.teacherRemarks;
  if (req.body.status === "Completed" || req.body.status === "Late Submission") {
    entry.submittedAt = new Date();
  }

  await assignment.save();
  res.json({ success: true, data: assignment });
});

// @desc    Delete an assignment
// @route   DELETE /api/assignments/:id
// @access  Teacher
const deleteAssignment = asyncHandler(async (req, res) => {
  const assignment = await Assignment.findById(req.params.id);
  if (!assignment) {
    res.status(404);
    throw new Error("Assignment not found");
  }
  await assignment.deleteOne();
  res.json({ success: true, message: "Assignment deleted successfully" });
});

// @desc    Get the logged-in student's own assignments, with only their own status visible
// @route   GET /api/assignments/my
// @access  Student
const getMyAssignments = asyncHandler(async (req, res) => {
  const assignments = await Assignment.find({
    "assignedStudents.student": req.user._id,
  }).sort({ submissionDate: -1 });

  const data = assignments.map((a) => {
    const entry = a.assignedStudents.find(
      (s) => s.student.toString() === req.user._id.toString()
    );
    return {
      _id: a._id,
      title: a.title,
      description: a.description,
      class: a.class,
      files: a.files,
      submissionDate: a.submissionDate,
      status: entry ? entry.status : "Pending",
      teacherRemarks: entry ? entry.teacherRemarks : "",
    };
  });

  res.json({ success: true, data });
});

module.exports = {
  createAssignment,
  getAssignments,
  getAssignmentById,
  updateSubmissionStatus,
  deleteAssignment,
  getMyAssignments,
};
