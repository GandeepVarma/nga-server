const asyncHandler = require("express-async-handler");
const Student = require("../models/Student");
const Test = require("../models/Test");
const Assignment = require("../models/Assignment");
const Attendance = require("../models/Attendance");
const Fee = require("../models/Fee");

// @desc    Create a new student
// @route   POST /api/students
// @access  Teacher
const createStudent = asyncHandler(async (req, res) => {
  const {
    studentId,
    name,
    parentName,
    phone,
    dateOfJoining,
    class: className,
    password,
    monthlyFee,
    admissionFee,
  } = req.body;

  if (!studentId || !name || !parentName || !phone || !className || !password) {
    res.status(400);
    throw new Error("Please fill in all required student fields");
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
    password,
    monthlyFee,
    admissionFee,
  });

  res.status(201).json({
    success: true,
    data: { ...student.toObject(), password: undefined },
  });
});

// @desc    Get all students (with optional search + class filter)
// @route   GET /api/students?search=&class=
// @access  Teacher
const getStudents = asyncHandler(async (req, res) => {
  const { search, class: className } = req.query;
  const query = {};

  if (className) query.class = className;

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { studentId: { $regex: search, $options: "i" } },
      { phone: { $regex: search, $options: "i" } },
    ];
  }

  const students = await Student.find(query).sort({ createdAt: -1 });

  res.json({ success: true, count: students.length, data: students });
});

// @desc    Get single student by ID
// @route   GET /api/students/:id
// @access  Teacher or the student themself
const getStudentById = asyncHandler(async (req, res) => {
  const student = await Student.findById(req.params.id);
  if (!student) {
    res.status(404);
    throw new Error("Student not found");
  }
  res.json({ success: true, data: student });
});

// @desc    Update a student
// @route   PUT /api/students/:id
// @access  Teacher
const updateStudent = asyncHandler(async (req, res) => {
  const student = await Student.findById(req.params.id);
  if (!student) {
    res.status(404);
    throw new Error("Student not found");
  }

  const fields = [
    "name",
    "parentName",
    "phone",
    "dateOfJoining",
    "class",
    "monthlyFee",
    "admissionFee",
    "status",
    "profilePhoto",
  ];
  fields.forEach((field) => {
    if (req.body[field] !== undefined) student[field] = req.body[field];
  });

  // Password only updates if explicitly provided
  if (req.body.password) student.password = req.body.password;

  await student.save();
  res.json({ success: true, data: { ...student.toObject(), password: undefined } });
});

// @desc    Delete a student
// @route   DELETE /api/students/:id
// @access  Teacher
const deleteStudent = asyncHandler(async (req, res) => {
  const student = await Student.findById(req.params.id);
  if (!student) {
    res.status(404);
    throw new Error("Student not found");
  }
  await student.deleteOne();
  res.json({ success: true, message: "Student deleted successfully" });
});

// @desc    Get a full student profile: personal info + fees + tests + assignments + attendance
// @route   GET /api/students/:id/profile
// @access  Teacher or the student themself
const getStudentFullProfile = asyncHandler(async (req, res) => {
  const student = await Student.findById(req.params.id);
  if (!student) {
    res.status(404);
    throw new Error("Student not found");
  }

  const [tests, assignments, attendanceRecords, fees] = await Promise.all([
    Test.find({ "marks.student": student._id }).sort({ date: -1 }),
    Assignment.find({ "assignedStudents.student": student._id }).sort({
      submissionDate: -1,
    }),
    Attendance.find({ student: student._id }).sort({ date: -1 }),
    Fee.find({ student: student._id }).sort({ month: -1 }),
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
    const entry = a.assignedStudents.find(
      (s) => s.student.toString() === student._id.toString()
    );
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
      feeDetails: fees,
      performance: testHistory,
      attendance: {
        percentage: attendancePercentage,
        records: attendanceRecords,
      },
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
};
