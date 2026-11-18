const asyncHandler = require("express-async-handler");
const Assignment = require("../models/Assignment");
const Student = require("../models/Student");
const { notifyStudents } = require("../utils/notify");
const whatsapp = require("../services/whatsappService");
const Settings = require("../models/Settings");
const { academyFilter, requireAcademyId } = require("../utils/tenant");

const getAssignmentDisplayStatus = (status, submissionDate, now = new Date()) => {
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dueDate = new Date(submissionDate);
  if (status === "Pending" && !Number.isNaN(dueDate.getTime()) && dueDate.getTime() < todayStart) {
    return "Late Submission";
  }
  return status;
};

const withDisplayStatuses = (assignment) => {
  const data = typeof assignment.toObject === "function" ? assignment.toObject() : { ...assignment };
  data.assignedStudents = data.assignedStudents.map((entry) => ({
    ...entry,
    status: getAssignmentDisplayStatus(entry.status, data.submissionDate),
  }));
  return data;
};

const allowedStudentIds = async (req) => {
  const filter = req.user.role === "admin" ? { academyId: requireAcademyId(req) } : { academyId: requireAcademyId(req), assignedTeacher: req.user._id };
  const students = await Student.find(filter).select("_id");
  return students.map((s) => s._id.toString());
};

// @desc    Create an assignment, optionally with uploaded PDF/image files.
//          Teachers may only assign to their own students.
// @route   POST /api/assignments
// @access  Staff (Admin or Teacher)
const createAssignment = asyncHandler(async (req, res) => {
  const { title, description, class: className, submissionDate, studentIds } = req.body;

  if (!title || !description || !className || !submissionDate) {
    res.status(400);
    throw new Error("Please fill in all required assignment fields");
  }

  const allowedIds = await allowedStudentIds(req);

  let students = studentIds;
  if (students !== undefined && students !== null && typeof students !== "string" && !Array.isArray(students)) {
    res.status(400);
    throw new Error("studentIds must be an array of student IDs");
  }
  if (students && typeof students === "string") {
    try {
      students = JSON.parse(students);
    } catch {
      res.status(400);
      throw new Error("studentIds must be a JSON array");
    }
    if (!Array.isArray(students)) {
      res.status(400);
      throw new Error("studentIds must be a JSON array");
    }
  }

  if (students && students.length > 0) {
    if (!Array.isArray(students) || new Set(students.map((id) => id.toString())).size !== students.length) {
      res.status(400);
      throw new Error("studentIds must be an array of unique student IDs");
    }
    const invalid = students.filter((id) => !allowedIds.includes(id.toString()));
    if (invalid.length > 0) {
      res.status(403);
      throw new Error("Access denied: one or more students are not assigned to you");
    }
    const activeClassFilter = {
      academyId: requireAcademyId(req),
      class: className,
      status: "Active",
      _id: { $in: students },
    };
    if (req.user.role !== "admin") activeClassFilter.assignedTeacher = req.user._id;
    const validCount = await Student.countDocuments(activeClassFilter);
    if (validCount !== students.length) {
      res.status(400);
      throw new Error("Selected students must be active students in the chosen class");
    }
  } else {
    const filter =
      req.user.role === "admin"
        ? { academyId: requireAcademyId(req), class: className, status: "Active" }
        : { academyId: requireAcademyId(req), class: className, status: "Active", assignedTeacher: req.user._id };
    const classStudents = await Student.find(filter).select("_id");
    students = classStudents.map((s) => s._id);
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
    academyId: requireAcademyId(req),
  });

  await notifyStudents(
    students,
    "ASSIGNMENT_UPLOADED",
    `New Assignment: ${title}`,
    `A new assignment has been posted. Due: ${new Date(submissionDate).toDateString()}.`,
    assignment._id
  );

  // Fire immediate WhatsApp homework alerts in the background (a separate
  // 1-day-before reminder is also sent by the scheduled job for anyone
  // still Pending — dedupeKey prevents that from double-sending this one).
  Settings.getSingleton(requireAcademyId(req))
    .then(async (settings) => {
      if (!settings.whatsapp.autoNotificationsEnabled || !settings.whatsapp.notificationsEnabled.homeworkReminder) return;
      const studentDocs = await Student.find({ academyId: requireAcademyId(req), _id: { $in: students } });
      await Promise.all(studentDocs.map((s) => whatsapp.sendHomeworkReminder({ student: s, assignment })));
    })
    .catch((err) => console.error("[whatsapp] homework reminder failed:", err.message));

  res.status(201).json({ success: true, data: assignment });
});

// @desc    Get assignments. Teacher only sees assignments touching their own
//          students, trimmed to just their own students' entries.
// @route   GET /api/assignments?class=
// @access  Staff (Admin or Teacher)
const getAssignments = asyncHandler(async (req, res) => {
  const query = { academyId: requireAcademyId(req) };
  if (req.query.class) query.class = req.query.class;

  const assignments = await Assignment.find(query)
    .populate("assignedStudents.student", "name studentId")
    .sort({ submissionDate: -1 });

  if (req.user.role === "admin") {
    const data = assignments.map(withDisplayStatuses);
    return res.json({ success: true, count: data.length, data });
  }

  const allowedIds = await allowedStudentIds(req);
  const scoped = assignments
    .map((a) => {
      const assignedStudents = a.assignedStudents.filter((s) =>
        allowedIds.includes(s.student._id.toString())
      );
      if (assignedStudents.length === 0) return null;
      return withDisplayStatuses({ ...a.toObject(), assignedStudents });
    })
    .filter(Boolean);

  res.json({ success: true, count: scoped.length, data: scoped });
});

// @desc    Get a single assignment, scoped for teachers
// @route   GET /api/assignments/:id
// @access  Staff (Admin or Teacher) or assigned student
const getAssignmentById = asyncHandler(async (req, res) => {
  const assignment = await Assignment.findOne(academyFilter(req, { _id: req.params.id })).populate(
    "assignedStudents.student",
    "name studentId"
  );
  if (!assignment) {
    res.status(404);
    throw new Error("Assignment not found");
  }

  if (req.userType === "staff" && req.user.role !== "admin") {
    const allowedIds = await allowedStudentIds(req);
    const assignedStudents = assignment.assignedStudents.filter((s) =>
      allowedIds.includes(s.student._id.toString())
    );
    if (assignedStudents.length === 0) {
      res.status(403);
      throw new Error("Access denied: none of these students are assigned to you");
    }
    return res.json({ success: true, data: withDisplayStatuses({ ...assignment.toObject(), assignedStudents }) });
  }

  res.json({ success: true, data: withDisplayStatuses(assignment) });
});

// @desc    Update a student's submission status (scoped for teachers)
// @route   PUT /api/assignments/:id/status/:studentId
// @access  Staff (Admin or Teacher)
const updateSubmissionStatus = asyncHandler(async (req, res) => {
  if (req.user.role !== "admin") {
    const allowedIds = await allowedStudentIds(req);
    if (!allowedIds.includes(req.params.studentId)) {
      res.status(403);
      throw new Error("Access denied: this student is not assigned to you");
    }
  }

  const assignment = await Assignment.findOne(academyFilter(req, { _id: req.params.id }));
  if (!assignment) {
    res.status(404);
    throw new Error("Assignment not found");
  }

  const entry = assignment.assignedStudents.find((s) => s.student.toString() === req.params.studentId);
  if (!entry) {
    res.status(404);
    throw new Error("This student is not assigned to this assignment");
  }

  if (req.body.status && !["Pending", "Completed", "Late Submission"].includes(req.body.status)) {
    res.status(400);
    throw new Error("Status must be Pending, Completed, or Late Submission");
  }
  if (req.body.status) entry.status = req.body.status;
  if (req.body.teacherRemarks !== undefined) entry.teacherRemarks = req.body.teacherRemarks;
  if (req.body.status === "Completed" || req.body.status === "Late Submission") {
    entry.submittedAt = new Date();
  } else if (req.body.status === "Pending") {
    entry.submittedAt = null;
  }

  await assignment.save();
  res.json({ success: true, data: assignment });
});

// @desc    Delete an assignment. Admin, or the teacher who created it.
// @route   DELETE /api/assignments/:id
// @access  Staff (Admin or Teacher — creator only)
const deleteAssignment = asyncHandler(async (req, res) => {
  const assignment = await Assignment.findOne(academyFilter(req, { _id: req.params.id }));
  if (!assignment) {
    res.status(404);
    throw new Error("Assignment not found");
  }

  if (req.user.role !== "admin" && assignment.createdBy?.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error("Access denied: you can only delete assignments you created");
  }

  await assignment.deleteOne();
  res.json({ success: true, message: "Assignment deleted successfully" });
});

// @desc    Student's own assignments, with only their own status visible
// @route   GET /api/assignments/my
// @access  Student
const getMyAssignments = asyncHandler(async (req, res) => {
  const assignments = await Assignment.find(academyFilter(req, { "assignedStudents.student": req.user._id })).sort({
    submissionDate: -1,
  });

  const data = assignments.map((a) => {
    const entry = a.assignedStudents.find((s) => s.student.toString() === req.user._id.toString());
    return {
      _id: a._id,
      title: a.title,
      description: a.description,
      class: a.class,
      files: a.files,
      submissionDate: a.submissionDate,
      status: getAssignmentDisplayStatus(entry ? entry.status : "Pending", a.submissionDate),
      submittedAt: entry?.submittedAt || null,
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
  getAssignmentDisplayStatus,
  withDisplayStatuses,
};
