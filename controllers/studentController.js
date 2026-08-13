const asyncHandler = require("express-async-handler");
const Student = require("../models/Student");
const Test = require("../models/Test");
const Assignment = require("../models/Assignment");
const Attendance = require("../models/Attendance");
const Fee = require("../models/Fee");

// Small helper: builds the base filter every student query must start from.
// Admin -> no restriction. Teacher -> only their own assigned students.
// This is the single source of truth for the access rule, used everywhere
// below so no endpoint can accidentally leak another teacher's students.
const scopeToRole = (req, extra = {}) => {
  if (req.user.role === "admin") return extra;
  return { ...extra, assignedTeacher: req.user._id };
};

// @desc    Create a new student
//          Teachers can only create students assigned to themselves.
//          Admin must specify which teacher the student is assigned to.
// @route   POST /api/students
// @access  Staff (Admin or Teacher)
const createStudent = asyncHandler(async (req, res) => {
  const {
    studentId,
    name,
    parentName,
    phone,
    dateOfJoining,
    class: className,
    batch,
    password,
    monthlyFee,
    admissionFee,
    assignedTeacher,
  } = req.body;

  if (!studentId || !name || !parentName || !phone || !className || !password) {
    res.status(400);
    throw new Error("Please fill in all required student fields");
  }

  // Teachers can only ever assign to themselves; admins choose explicitly.
  let finalAssignedTeacher;
  if (req.user.role === "admin") {
    if (!assignedTeacher) {
      res.status(400);
      throw new Error("assignedTeacher is required when creating a student as Admin");
    }
    finalAssignedTeacher = assignedTeacher;
  } else {
    finalAssignedTeacher = req.user._id;
  }

  const exists = await Student.findOne({ studentId: studentId.toUpperCase() });
  if (exists) {
    res.status(400);
    throw new Error("A student with this Student ID already exists");
  }

  const student = await Student.create({
    studentId,
    name,
    parentName,
    phone,
    dateOfJoining,
    class: className,
    batch,
    password,
    monthlyFee,
    admissionFee,
    assignedTeacher: finalAssignedTeacher,
  });

  res.status(201).json({
    success: true,
    data: { ...student.toObject(), password: undefined },
  });
});

// @desc    Get students (search + class filter). Admin sees all; teachers
//          only ever see their own assigned students — enforced server-side.
// @route   GET /api/students?search=&class=
// @access  Staff (Admin or Teacher)
const getStudents = asyncHandler(async (req, res) => {
  const { search, class: className } = req.query;
  const query = scopeToRole(req);

  if (className) query.class = className;
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { studentId: { $regex: search, $options: "i" } },
      { phone: { $regex: search, $options: "i" } },
    ];
  }

  const students = await Student.find(query)
    .populate("assignedTeacher", "name email")
    .sort({ createdAt: -1 });

  res.json({ success: true, count: students.length, data: students });
});

// @desc    Get a single student. A teacher requesting a student NOT assigned
//          to them is denied with 403, even if they know/guess the ID.
// @route   GET /api/students/:id
// @access  Staff (Admin or Teacher) — scoped; or the student themself
const getStudentById = asyncHandler(async (req, res) => {
  const student = await Student.findOne(scopeToRole(req, { _id: req.params.id })).populate(
    "assignedTeacher",
    "name email"
  );
  if (!student) {
    res.status(404);
    throw new Error("Student not found or access denied");
  }
  res.json({ success: true, data: student });
});

// @desc    Update a student. Teachers can only update their own students and
//          cannot reassign a student to another teacher (Admin-only action).
// @route   PUT /api/students/:id
// @access  Staff (Admin or Teacher) — scoped
const updateStudent = asyncHandler(async (req, res) => {
  const student = await Student.findOne(scopeToRole(req, { _id: req.params.id }));
  if (!student) {
    res.status(404);
    throw new Error("Student not found or access denied");
  }

  const fields = [
    "name",
    "parentName",
    "phone",
    "dateOfJoining",
    "class",
    "batch",
    "monthlyFee",
    "admissionFee",
    "status",
    "profilePhoto",
  ];
  fields.forEach((field) => {
    if (req.body[field] !== undefined) student[field] = req.body[field];
  });

  // Only Admin may reassign a student to a different teacher via this route
  if (req.user.role === "admin" && req.body.assignedTeacher) {
    student.assignedTeacher = req.body.assignedTeacher;
  }

  if (req.body.password) student.password = req.body.password;

  await student.save();
  res.json({ success: true, data: { ...student.toObject(), password: undefined } });
});

// @desc    Delete a student (scoped — teachers can only delete their own)
// @route   DELETE /api/students/:id
// @access  Staff (Admin or Teacher) — scoped
const deleteStudent = asyncHandler(async (req, res) => {
  const student = await Student.findOne(scopeToRole(req, { _id: req.params.id }));
  if (!student) {
    res.status(404);
    throw new Error("Student not found or access denied");
  }
  await student.deleteOne();
  res.json({ success: true, message: "Student deleted successfully" });
});

// @desc    Full student profile: personal info + fees + tests + assignments
//          + attendance. Scoped — a teacher cannot view another teacher's
//          student's profile even with a direct ID.
//          Fee details are stripped out entirely for non-admin staff.
// @route   GET /api/students/:id/profile
// @access  Admin (full) or the assigned Teacher (no fee details) or the student themself
const getStudentFullProfile = asyncHandler(async (req, res) => {
  // req.user is either staff (scoped) or the student themself (checked below)
  let student;
  if (req.userType === "student") {
    if (req.params.id !== req.user._id.toString()) {
      res.status(403);
      throw new Error("Access denied");
    }
    student = await Student.findById(req.params.id);
  } else {
    student = await Student.findOne(scopeToRole(req, { _id: req.params.id }));
  }

  if (!student) {
    res.status(404);
    throw new Error("Student not found or access denied");
  }

  const [tests, assignments, attendanceRecords, fees] = await Promise.all([
    Test.find({ "marks.student": student._id }).sort({ date: -1 }),
    Assignment.find({ "assignedStudents.student": student._id }).sort({ submissionDate: -1 }),
    Attendance.find({ student: student._id }).sort({ date: -1 }),
    // Fee records are only fetched (and returned) for Admin or the student themself
    req.userType === "student" || req.user.role === "admin"
      ? Fee.find({ student: student._id }).sort({ month: -1 })
      : Promise.resolve(null),
  ]);

  const testHistory = tests.map((t) => {
    const entry = t.marks.find((m) => m.student.toString() === student._id.toString());
    return {
      _id: t._id,
      testName: t.testName,
      subject: t.subject,
      date: t.date,
      maxMarks: t.maxMarks,
      marksObtained: entry ? entry.marksObtained : null,
    };
  });

  const assignmentHistory = assignments.map((a) => {
    const entry = a.assignedStudents.find((s) => s.student.toString() === student._id.toString());
    return {
      _id: a._id,
      title: a.title,
      submissionDate: a.submissionDate,
      status: entry ? entry.status : "Pending",
      teacherRemarks: entry ? entry.teacherRemarks : "",
    };
  });

  const totalDays = attendanceRecords.length;
  const presentDays = attendanceRecords.filter((a) => a.status === "Present").length;
  const attendancePercentage = totalDays > 0 ? Number(((presentDays / totalDays) * 100).toFixed(1)) : 0;

  res.json({
    success: true,
    data: {
      personalDetails: student,
      feeDetails: fees, // null for teachers — per RBAC rule, they never see fee data
      performance: testHistory,
      attendance: { percentage: attendancePercentage, records: attendanceRecords },
      assignments: assignmentHistory,
      testHistory,
    },
  });
});

module.exports = {
  createStudent,
  getStudents,
  getStudentById,
  updateStudent,
  deleteStudent,
  getStudentFullProfile,
  scopeToRole,
};
