const asyncHandler = require("express-async-handler");
const Student = require("../models/Student");
const Test = require("../models/Test");
const Assignment = require("../models/Assignment");
const Attendance = require("../models/Attendance");
const Fee = require("../models/Fee");

// @desc    Get all six teacher dashboard stat cards in a single call
// @route   GET /api/dashboard/teacher
// @access  Teacher
const getTeacherDashboard = asyncHandler(async (req, res) => {
  const totalStudents = await Student.countDocuments({ status: "Active" });

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const todaysAttendanceRecords = await Attendance.find({
    date: { $gte: startOfDay, $lte: endOfDay },
  });
  const todaysAttendance = {
    marked: todaysAttendanceRecords.length,
    present: todaysAttendanceRecords.filter((r) => r.status === "Present").length,
    totalStudents,
  };

  const fees = await Fee.find();
  const pendingFees = fees.reduce((sum, f) => sum + f.pending, 0);

  const now = new Date();
  const upcomingTests = await Test.countDocuments({ date: { $gte: now } });

  const assignments = await Assignment.find();
  let assignmentsPending = 0;
  assignments.forEach((a) => {
    assignmentsPending += a.assignedStudents.filter((s) => s.status === "Pending").length;
  });

  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthlyCollection = fees
    .filter((f) => f.month === currentMonth)
    .reduce((sum, f) => sum + f.paid, 0);

  res.json({
    success: true,
    data: {
      totalStudents,
      todaysAttendance,
      pendingFees,
      upcomingTests,
      assignmentsPending,
      monthlyCollection,
    },
  });
});

// @desc    Get all data the student dashboard needs in a single call
// @route   GET /api/dashboard/student
// @access  Student
const getStudentDashboard = asyncHandler(async (req, res) => {
  const student = req.user;

  const [attendanceRecords, upcomingTests, assignments, fees, recentTests] = await Promise.all([
    Attendance.find({ student: student._id }),
    Test.find({ "marks.student": student._id, date: { $gte: new Date() } })
      .sort({ date: 1 })
      .limit(5),
    Assignment.find({ "assignedStudents.student": student._id }).sort({ submissionDate: 1 }),
    Fee.find({ student: student._id }).sort({ month: -1 }),
    Test.find({ "marks.student": student._id, date: { $lt: new Date() } })
      .sort({ date: -1 })
      .limit(10),
  ]);

  const totalDays = attendanceRecords.length;
  const presentDays = attendanceRecords.filter((a) => a.status === "Present").length;
  const attendancePercentage = totalDays > 0 ? Number(((presentDays / totalDays) * 100).toFixed(1)) : 0;

  const pendingAssignments = assignments.filter((a) => {
    const entry = a.assignedStudents.find((s) => s.student.toString() === student._id.toString());
    return entry && entry.status === "Pending";
  });

  const currentFee = fees[0] || null;

  const progressGraph = recentTests
    .map((t) => {
      const entry = t.marks.find((m) => m.student.toString() === student._id.toString());
      return {
        testName: t.testName,
        subject: t.subject,
        date: t.date,
        percentage:
          entry && entry.marksObtained !== null
            ? Number(((entry.marksObtained / t.maxMarks) * 100).toFixed(1))
            : null,
      };
    })
    .reverse();

  res.json({
    success: true,
    data: {
      welcome: {
        name: student.name,
        class: student.class,
        profilePhoto: student.profilePhoto,
      },
      attendancePercentage,
      upcomingTests,
      pendingAssignmentsCount: pendingAssignments.length,
      pendingAssignments,
      feeStatus: currentFee,
      progressGraph,
    },
  });
});

module.exports = { getTeacherDashboard, getStudentDashboard };
