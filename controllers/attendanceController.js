const asyncHandler = require("express-async-handler");
const Attendance = require("../models/Attendance");
const Student = require("../models/Student");

// @desc    Mark attendance for one or more students on a given date
// @route   POST /api/attendance
// @body    { date, class, records: [{ studentId, status }] }
// @access  Teacher
const markAttendance = asyncHandler(async (req, res) => {
  const { date, class: className, records } = req.body;

  if (!date || !className || !Array.isArray(records)) {
    res.status(400);
    throw new Error("date, class and records[] are required");
  }

  const results = [];
  for (const { studentId, status } of records) {
    const record = await Attendance.findOneAndUpdate(
      { student: studentId, date: new Date(date) },
      { student: studentId, date: new Date(date), class: className, status, markedBy: req.user._id },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    results.push(record);
  }

  res.status(201).json({ success: true, data: results });
});

// @desc    Get attendance records (filter by class/date/student)
// @route   GET /api/attendance?class=&date=&student=
// @access  Teacher
const getAttendance = asyncHandler(async (req, res) => {
  const { class: className, date, student } = req.query;
  const query = {};
  if (className) query.class = className;
  if (date) query.date = new Date(date);
  if (student) query.student = student;

  const records = await Attendance.find(query)
    .populate("student", "name studentId")
    .sort({ date: -1 });

  res.json({ success: true, count: records.length, data: records });
});

// @desc    Get today's attendance count (for dashboard stat card)
// @route   GET /api/attendance/today-summary
// @access  Teacher
const getTodaySummary = asyncHandler(async (req, res) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const records = await Attendance.find({ date: { $gte: startOfDay, $lte: endOfDay } });
  const totalStudents = await Student.countDocuments({ status: "Active" });

  const present = records.filter((r) => r.status === "Present").length;
  const absent = records.filter((r) => r.status === "Absent").length;
  const leave = records.filter((r) => r.status === "Leave").length;

  res.json({
    success: true,
    data: { totalStudents, marked: records.length, present, absent, leave },
  });
});

// @desc    Get a single student's attendance percentage
// @route   GET /api/attendance/percentage/:studentId
// @access  Teacher or the student themself
const getAttendancePercentage = asyncHandler(async (req, res) => {
  const records = await Attendance.find({ student: req.params.studentId });
  const total = records.length;
  const present = records.filter((r) => r.status === "Present").length;
  const percentage = total > 0 ? Number(((present / total) * 100).toFixed(1)) : 0;

  res.json({ success: true, data: { total, present, percentage } });
});

module.exports = {
  markAttendance,
  getAttendance,
  getTodaySummary,
  getAttendancePercentage,
};
