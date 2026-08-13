const asyncHandler = require("express-async-handler");
const Teacher = require("../models/Teacher");
const Student = require("../models/Student");
const generateToken = require("../utils/generateToken");

// NOTE: There is deliberately NO public "register" endpoint for staff accounts.
// Per RBAC rules, only the Main Admin can create teacher accounts (see
// adminController.createTeacher). The very first Admin account is created via
// the `npm run seed` script, not through the API.

// @desc    Staff login (Admin or Teacher) with email + password
// @route   POST /api/auth/teacher/login
// @access  Public
const loginTeacher = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400);
    throw new Error("Email and password are required");
  }

  const teacher = await Teacher.findOne({ email }).select("+password");

  if (!teacher || !(await teacher.matchPassword(password))) {
    res.status(401);
    throw new Error("Invalid email or password");
  }

  if (!teacher.isActive) {
    res.status(403);
    throw new Error("This account has been deactivated. Contact the academy admin.");
  }

  res.json({
    success: true,
    data: {
      _id: teacher._id,
      name: teacher.name,
      email: teacher.email,
      role: teacher.role, // "admin" | "teacher"
      profilePhoto: teacher.profilePhoto,
      token: generateToken(teacher._id, "teacher"),
    },
  });
});

// @desc    Student login with Student ID + password
// @route   POST /api/auth/student/login
// @access  Public
const loginStudent = asyncHandler(async (req, res) => {
  const { studentId, password } = req.body;

  if (!studentId || !password) {
    res.status(400);
    throw new Error("Student ID and password are required");
  }

  const student = await Student.findOne({
    studentId: studentId.toUpperCase().trim(),
  }).select("+password");

  if (!student || !(await student.matchPassword(password))) {
    res.status(401);
    throw new Error("Invalid Student ID or password");
  }

  if (student.status === "Inactive") {
    res.status(403);
    throw new Error("This account has been deactivated. Contact your teacher.");
  }

  res.json({
    success: true,
    data: {
      _id: student._id,
      studentId: student.studentId,
      name: student.name,
      class: student.class,
      profilePhoto: student.profilePhoto,
      token: generateToken(student._id, "student"),
    },
  });
});

// @desc    Get the currently logged-in user's own profile
// @route   GET /api/auth/me
// @access  Private
const getMe = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    userType: req.userType, // "staff" | "student"
    role: req.userType === "staff" ? req.user.role : "student", // "admin" | "teacher" | "student"
    data: req.user,
  });
});

module.exports = { loginTeacher, loginStudent, getMe };
