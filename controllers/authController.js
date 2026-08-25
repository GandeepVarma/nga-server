const asyncHandler = require("express-async-handler");
const Teacher = require("../models/Teacher");
const Student = require("../models/Student");
const Academy = require("../models/Academy");
const generateToken = require("../utils/generateToken");

// NOTE: There is deliberately NO public "register" endpoint for staff
// accounts directly. Academy Admin accounts are created two ways: by
// Super Admin (Create Academy) or via public self-registration
// (POST /api/public/register-academy) — both go through
// superAdminController/publicController, never a raw "create teacher" endpoint.

// Shared helper: verifies `academy.status === "ACTIVE"`. Called from every
// login path so a PENDING/REJECTED/SUSPENDED academy's staff or students
// can't log in even if their password is correct.
const assertAcademyActive = async (academyId) => {
  if (!academyId) return; // no academy attached (e.g. super_admin, or pre-SaaS legacy accounts) — nothing to check
  const academy = await Academy.findById(academyId).select("status");
  if (academy && academy.status !== "ACTIVE") {
    const err = new Error(`This academy is currently ${academy.status.toLowerCase()}. Please contact support.`);
    err.status = 403;
    throw err;
  }
};

const getAcademyName = async (academyId) => {
  if (!academyId) return null;
  const academy = await Academy.findById(academyId).select("academyName");
  return academy?.academyName || null;
};

const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    res.status(400);
    throw new Error("Current password and new password are required");
  }

  if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(newPassword)) {
    res.status(400);
    throw new Error("New password must be at least 8 characters and include uppercase, lowercase, and a number");
  }

  const UserModel = req.userType === "student" ? Student : Teacher;
  const user = await UserModel.findById(req.user._id).select("+password");

  if (!user || !(await user.matchPassword(currentPassword))) {
    res.status(401);
    throw new Error("Current password is incorrect");
  }

  if (await user.matchPassword(newPassword)) {
    res.status(400);
    throw new Error("New password must be different from the current password");
  }

  user.password = newPassword;
  user.passwordChangedAt = new Date();
  await user.save();

  res.json({ success: true, message: "Password changed successfully" });
});

// @desc    Staff login (Academy Admin or Teacher — NOT Super Admin, see
//          loginSuperAdmin below for that separate flow). Accepts an
//          optional `academyId` — when provided (i.e. login came from the
//          academy-login dropdown flow), the authenticated account's own
//          academyId is verified to match it server-side. The academyId in
//          the request is NEVER trusted on its own; it's only ever compared
//          against the value already stored on the account in the database.
// @route   POST /api/auth/teacher/login
// @access  Public
const loginTeacher = asyncHandler(async (req, res) => {
  const { email, password, academyId } = req.body;

  if (!email || !password) {
    res.status(400);
    throw new Error("Email and password are required");
  }

  const teacher = await Teacher.findOne({ email }).select("+password");

  if (!teacher || !(await teacher.matchPassword(password))) {
    res.status(401);
    throw new Error("Invalid email or password");
  }

  if (teacher.role === "super_admin") {
    res.status(403);
    throw new Error("Super Admin accounts must use the Super Admin login page.");
  }

  if (!teacher.isActive) {
    res.status(403);
    throw new Error("This account has been deactivated. Contact the academy admin.");
  }

  if (academyId && teacher.academyId?.toString() !== academyId) {
    res.status(403);
    throw new Error("This account does not belong to the selected academy.");
  }

  try {
    await assertAcademyActive(teacher.academyId);
  } catch (err) {
    res.status(err.status || 403);
    throw err;
  }

  res.json({
    success: true,
    data: {
      _id: teacher._id,
      name: teacher.name,
      email: teacher.email,
      role: teacher.role, // "teacher" | "admin"
      academyId: teacher.academyId,
      academyName: await getAcademyName(teacher.academyId),
      profilePhoto: teacher.profilePhoto,
      token: generateToken(teacher._id, "teacher", teacher.academyId),
    },
  });
});

// @desc    Super Admin login — deliberately a separate endpoint from staff
//          login, not just a role check on the same one, so it can never
//          be reached from the academy-branded login pages by accident.
// @route   POST /api/auth/super-admin/login
// @access  Public
const loginSuperAdmin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400);
    throw new Error("Email and password are required");
  }

  const account = await Teacher.findOne({ email, role: "super_admin" }).select("+password");

  if (!account || !(await account.matchPassword(password))) {
    res.status(401);
    throw new Error("Invalid Super Admin email or password");
  }

  res.json({
    success: true,
    data: {
      _id: account._id,
      name: account.name,
      email: account.email,
      role: "super_admin",
      token: generateToken(account._id, "teacher"),
    },
  });
});

// @desc    Student login with Student ID + password. Accepts an optional
//          `academyId` (from the academy-login dropdown flow) — verified
//          server-side by tracing the student's assignedTeacher's own
//          academyId, since Student doesn't carry academyId directly yet
//          (full per-collection tenant tagging is Phase 2). The frontend's
//          academyId is never trusted on its own.
// @route   POST /api/auth/student/login
// @access  Public
const loginStudent = asyncHandler(async (req, res) => {
  const { studentId, password, academyId } = req.body;

  if (!studentId || !password) {
    res.status(400);
    throw new Error("Student ID and password are required");
  }

  const student = await Student.findOne({
    studentId: studentId.toUpperCase().trim(),
  }).select("+password").populate("assignedTeacher", "academyId");

  if (!student || !(await student.matchPassword(password))) {
    res.status(401);
    throw new Error("Invalid Student ID or password");
  }

  if (student.status === "Inactive") {
    res.status(403);
    throw new Error("This account has been deactivated. Contact your teacher.");
  }

  const studentAcademyId = student.assignedTeacher?.academyId?.toString() || null;

  if (academyId && studentAcademyId !== academyId) {
    res.status(403);
    throw new Error("This account does not belong to the selected academy.");
  }

  try {
    await assertAcademyActive(studentAcademyId);
  } catch (err) {
    res.status(err.status || 403);
    throw err;
  }

  res.json({
    success: true,
    data: {
      _id: student._id,
      studentId: student.studentId,
      name: student.name,
      class: student.class,
      academyId: studentAcademyId,
      academyName: await getAcademyName(studentAcademyId),
      profilePhoto: student.profilePhoto,
      token: generateToken(student._id, "student", studentAcademyId),
    },
  });
});

// @desc    Get the currently logged-in user's own profile
// @route   GET /api/auth/me
// @access  Private
const getMe = asyncHandler(async (req, res) => {
  const data = req.user.toObject();
  if (req.userType === "staff") data.academyName = await getAcademyName(req.user.academyId);
  if (req.userType === "student") {
    const student = await Student.findById(req.user._id).populate("assignedTeacher", "academyId");
    const studentAcademyId = student?.assignedTeacher?.academyId || null;
    data.academyName = await getAcademyName(studentAcademyId);
  }
  res.json({
    success: true,
    userType: req.userType, // "staff" | "student"
    role: req.userType === "staff" ? req.user.role : "student",
    data,
  });
});

module.exports = { loginTeacher, loginSuperAdmin, loginStudent, getMe, changePassword };
