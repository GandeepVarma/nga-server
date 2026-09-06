const asyncHandler = require("express-async-handler");
const Teacher = require("../models/Teacher");
const Student = require("../models/Student");
const Test = require("../models/Test");
const Assignment = require("../models/Assignment");
const Fee = require("../models/Fee");
const Attendance = require("../models/Attendance");
const { academyFilter, requireAcademyId } = require("../utils/tenant");

// ---------- Teacher management (Admin only) ----------

// @desc    Create a new teacher account
// @route   POST /api/admin/teachers
// @access  Admin
const createTeacher = asyncHandler(async (req, res) => {
  const { name, email, password, phone } = req.body;

  if (!name || !email || !password) {
    res.status(400);
    throw new Error("Name, email and password are required");
  }

  const academyId = requireAcademyId(req);
  const exists = await Teacher.findOne({ academyId, email });
  if (exists) {
    res.status(400);
    throw new Error("A staff account with this email already exists");
  }

  const teacher = await Teacher.create({
    name,
    email,
    password,
    phone,
    role: "teacher",
    academyId,
  });

  res.status(201).json({
    success: true,
    data: { ...teacher.toObject(), password: undefined },
  });
});

// @desc    List all teachers (with each teacher's assigned student count)
// @route   GET /api/admin/teachers
// @access  Admin
const getTeachers = asyncHandler(async (req, res) => {
  const academyId = requireAcademyId(req);
  const teachers = await Teacher.find({ academyId, role: "teacher" }).sort({ createdAt: -1 });

  const withCounts = await Promise.all(
    teachers.map(async (t) => {
      const studentCount = await Student.countDocuments({ academyId, assignedTeacher: t._id });
      return { ...t.toObject(), studentCount };
    })
  );

  res.json({ success: true, count: withCounts.length, data: withCounts });
});

// @desc    Update a teacher's details
// @route   PUT /api/admin/teachers/:id
// @access  Admin
const updateTeacher = asyncHandler(async (req, res) => {
  const teacher = await Teacher.findOne(academyFilter(req, { _id: req.params.id, role: "teacher" }));
  if (!teacher) {
    res.status(404);
    throw new Error("Teacher not found");
  }

  ["name", "phone", "profilePhoto"].forEach((field) => {
    if (req.body[field] !== undefined) teacher[field] = req.body[field];
  });

  await teacher.save();
  res.json({ success: true, data: { ...teacher.toObject(), password: undefined } });
});

// @desc    Activate/deactivate a teacher account (soft delete — preserves their history)
// @route   PUT /api/admin/teachers/:id/status
// @body    { isActive: boolean }
// @access  Admin
const setTeacherStatus = asyncHandler(async (req, res) => {
  const teacher = await Teacher.findOne(academyFilter(req, { _id: req.params.id, role: "teacher" }));
  if (!teacher) {
    res.status(404);
    throw new Error("Teacher not found");
  }

  teacher.isActive = req.body.isActive;
  await teacher.save();

  res.json({
    success: true,
    message: `Teacher ${teacher.isActive ? "activated" : "deactivated"}`,
    data: { ...teacher.toObject(), password: undefined },
  });
});

// @desc    Reset a teacher's password
// @route   PUT /api/admin/teachers/:id/reset-password
// @body    { newPassword }
// @access  Admin
const resetTeacherPassword = asyncHandler(async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    res.status(400);
    throw new Error("newPassword is required and must be at least 6 characters");
  }

  const teacher = await Teacher.findOne(academyFilter(req, { _id: req.params.id, role: "teacher" }));
  if (!teacher) {
    res.status(404);
    throw new Error("Teacher not found");
  }

  teacher.password = newPassword; // pre-save hook hashes it
  await teacher.save();

  res.json({ success: true, message: "Password reset successfully" });
});

// Admin cannot delete a teacher outright (per RBAC spec: preserve student history).
// Deactivation (setTeacherStatus) is the supported way to remove access.

// ---------- Student assignment (Admin only) ----------

// @desc    Assign one or more unassigned/existing students to a teacher
// @route   PUT /api/admin/students/assign
// @body    { studentIds: [...], teacherId }
// @access  Admin
const assignStudents = asyncHandler(async (req, res) => {
  const { studentIds, teacherId } = req.body;

  if (!Array.isArray(studentIds) || studentIds.length === 0 || !teacherId) {
    res.status(400);
    throw new Error("studentIds[] and teacherId are required");
  }

  const teacher = await Teacher.findOne(academyFilter(req, { _id: teacherId, role: "teacher" }));
  if (!teacher) {
    res.status(404);
    throw new Error("Target teacher not found");
  }

  const result = await Student.updateMany(
    { academyId: requireAcademyId(req), _id: { $in: studentIds } },
    { $set: { assignedTeacher: teacherId, academyId: requireAcademyId(req) } }
  );

  res.json({
    success: true,
    message: `${result.modifiedCount} student(s) assigned to ${teacher.name}`,
  });
});

// @desc    Reassign a single student from one teacher to another
// @route   PUT /api/admin/students/:id/reassign
// @body    { teacherId }
// @access  Admin
const reassignStudent = asyncHandler(async (req, res) => {
  const { teacherId } = req.body;
  const teacher = await Teacher.findOne(academyFilter(req, { _id: teacherId, role: "teacher" }));
  if (!teacher) {
    res.status(404);
    throw new Error("Target teacher not found");
  }

  const student = await Student.findOne(academyFilter(req, { _id: req.params.id }));
  if (!student) {
    res.status(404);
    throw new Error("Student not found");
  }

  student.assignedTeacher = teacherId;
  await student.save();

  res.json({ success: true, message: `${student.name} reassigned to ${teacher.name}` });
});

// ---------- Academy-wide dashboard (Admin only) ----------

// @desc    Full academy statistics for the Admin dashboard
// @route   GET /api/admin/dashboard
// @access  Admin
const getAdminDashboard = asyncHandler(async (req, res) => {
  const [totalTeachers, totalStudents] = await Promise.all([
    Teacher.countDocuments({ academyId: requireAcademyId(req), role: "teacher" }),
    Student.countDocuments({ academyId: requireAcademyId(req), status: "Active" }),
  ]);

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);
  const academyId = requireAcademyId(req);
  const todaysAttendanceRecords = await Attendance.find({ academyId, date: { $gte: startOfDay, $lte: endOfDay } });
  const todaysAttendance = {
    marked: todaysAttendanceRecords.length,
    present: todaysAttendanceRecords.filter((r) => r.status === "Present").length,
    totalStudents,
  };

  const fees = await Fee.find({ academyId });
  const feesCollected = fees.reduce((sum, f) => sum + f.paid, 0);
  const pendingFees = fees.reduce((sum, f) => sum + f.pending, 0);

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthlyRevenue = fees
    .filter((f) => f.month === currentMonth)
    .reduce((sum, f) => sum + f.paid, 0);

  // Last 6 months revenue trend, for the chart
  const revenueByMonth = {};
  fees.forEach((f) => {
    revenueByMonth[f.month] = (revenueByMonth[f.month] || 0) + f.paid;
  });
  const monthlyRevenueChart = Object.entries(revenueByMonth)
    .sort(([a], [b]) => (a > b ? 1 : -1))
    .slice(-6)
    .map(([month, revenue]) => ({ month, revenue }));

  const recentAdmissions = await Student.find({ academyId })
    .sort({ dateOfJoining: -1 })
    .limit(5)
    .select("name studentId class dateOfJoining");

  // Teacher performance: student count + average test score across their students
  const teachers = await Teacher.find({ academyId, role: "teacher" });
  const teacherPerformance = await Promise.all(
    teachers.map(async (t) => {
      const studentIds = await Student.find({ academyId, assignedTeacher: t._id }).distinct("_id");
      const tests = await Test.find({ academyId, "marks.student": { $in: studentIds } });
      let totalScore = 0;
      let count = 0;
      tests.forEach((test) => {
        test.marks.forEach((m) => {
          if (studentIds.some((id) => id.toString() === m.student.toString()) && m.marksObtained !== null) {
            totalScore += (m.marksObtained / test.maxMarks) * 100;
            count += 1;
          }
        });
      });
      return {
        teacherId: t._id,
        name: t.name,
        studentCount: studentIds.length,
        averageScorePercent: count > 0 ? Number((totalScore / count).toFixed(1)) : null,
      };
    })
  );

  res.json({
    success: true,
    data: {
      totalTeachers,
      totalStudents,
      todaysAttendance,
      feesCollected,
      pendingFees,
      monthlyRevenue,
      monthlyRevenueChart,
      recentAdmissions,
      teacherPerformance,
    },
  });
});

module.exports = {
  createTeacher,
  getTeachers,
  updateTeacher,
  setTeacherStatus,
  resetTeacherPassword,
  assignStudents,
  reassignStudent,
  getAdminDashboard,
};
