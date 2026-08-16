const asyncHandler = require("express-async-handler");
const Attendance = require("../models/Attendance");
const Student = require("../models/Student");
const whatsapp = require("../services/whatsappService");
const Settings = require("../models/Settings");

const allowedStudentIds = async (req) => {
  const filter = req.user.role === "admin" ? {} : { assignedTeacher: req.user._id };
  const students = await Student.find(filter).select("_id");
  return students.map((s) => s._id.toString());
};

// @desc    Mark attendance for one or more students on a given date.
//          Teachers can only mark attendance for their own assigned students.
// @route   POST /api/attendance
// @body    { date, class, records: [{ studentId, status }] }
// @access  Staff (Admin or Teacher)
const markAttendance = asyncHandler(async (req, res) => {
  const { date, class: className, records } = req.body;

  if (!date || !className || !Array.isArray(records)) {
    res.status(400);
    throw new Error("date, class and records[] are required");
  }

  if (req.user.role !== "admin") {
    const allowedIds = await allowedStudentIds(req);
    const invalid = records.filter((r) => !allowedIds.includes(r.studentId.toString()));
    if (invalid.length > 0) {
      res.status(403);
      throw new Error("Access denied: one or more students are not assigned to you");
    }
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

  // Fire WhatsApp absent alerts in the background — never blocks the
  // response, and a failure here must never break attendance marking itself.
  Settings.getSingleton()
    .then(async (settings) => {
      if (!settings.whatsapp.notificationsEnabled.attendanceAlert) return;
      const absentIds = records.filter((r) => r.status === "Absent").map((r) => r.studentId);
      if (absentIds.length === 0) return;
      const absentStudents = await Student.find({ _id: { $in: absentIds } });
      await Promise.all(absentStudents.map((s) => whatsapp.sendAttendanceAlert({ student: s, date })));
    })
    .catch((err) => console.error("[whatsapp] attendance alert failed:", err.message));

  res.status(201).json({ success: true, data: results });
});

// @desc    Get attendance records, scoped to the requester's own students
// @route   GET /api/attendance?class=&date=&student=
// @access  Staff (Admin or Teacher)
const getAttendance = asyncHandler(async (req, res) => {
  const { class: className, date, student } = req.query;
  const query = {};
  if (className) query.class = className;
  if (date) query.date = new Date(date);
  if (student) query.student = student;

  if (req.user.role !== "admin") {
    const allowedIds = await allowedStudentIds(req);
    query.student = query.student
      ? (allowedIds.includes(query.student.toString()) ? query.student : null)
      : { $in: allowedIds };
    if (query.student === null) {
      res.status(403);
      throw new Error("Access denied: this student is not assigned to you");
    }
  }

  const records = await Attendance.find(query).populate("student", "name studentId").sort({ date: -1 });
  res.json({ success: true, count: records.length, data: records });
});

// @desc    Today's attendance count (dashboard stat card), scoped by role
// @route   GET /api/attendance/today-summary
// @access  Staff (Admin or Teacher)
const getTodaySummary = asyncHandler(async (req, res) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const allowedIds = req.user.role === "admin" ? null : await allowedStudentIds(req);
  const query = { date: { $gte: startOfDay, $lte: endOfDay } };
  if (allowedIds) query.student = { $in: allowedIds };

  const records = await Attendance.find(query);
  const totalStudents =
    req.user.role === "admin"
      ? await Student.countDocuments({ status: "Active" })
      : await Student.countDocuments({ status: "Active", assignedTeacher: req.user._id });

  const present = records.filter((r) => r.status === "Present").length;
  const absent = records.filter((r) => r.status === "Absent").length;
  const leave = records.filter((r) => r.status === "Leave").length;

  res.json({ success: true, data: { totalStudents, marked: records.length, present, absent, leave } });
});

// @desc    A single student's attendance percentage (scoped)
// @route   GET /api/attendance/percentage/:studentId
// @access  Staff (Admin or Teacher) or the student themself
const getAttendancePercentage = asyncHandler(async (req, res) => {
  if (req.userType === "staff" && req.user.role !== "admin") {
    const allowedIds = await allowedStudentIds(req);
    if (!allowedIds.includes(req.params.studentId)) {
      res.status(403);
      throw new Error("Access denied: this student is not assigned to you");
    }
  }

  const records = await Attendance.find({ student: req.params.studentId });
  const total = records.length;
  const present = records.filter((r) => r.status === "Present").length;
  const percentage = total > 0 ? Number(((present / total) * 100).toFixed(1)) : 0;

  res.json({ success: true, data: { total, present, percentage } });
});

module.exports = { markAttendance, getAttendance, getTodaySummary, getAttendancePercentage };
