const asyncHandler = require("express-async-handler");
const Attendance = require("../models/Attendance");
const Student = require("../models/Student");
const whatsapp = require("../services/whatsappService");
const Settings = require("../models/Settings");
const { academyFilter, requireAcademyId } = require("../utils/tenant");

const allowedStudentIds = async (req) => {
  const filter = req.user.role === "admin" ? { academyId: requireAcademyId(req) } : { academyId: requireAcademyId(req), assignedTeacher: req.user._id };
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

  if (!date || !Array.isArray(records) || records.length === 0) {
    res.status(400);
    throw new Error("date and records[] are required");
  }

  const recordsWithClasses = records.map((record) => ({
    ...record,
    class: record.class || className,
  }));
  if (recordsWithClasses.some((record) => !record.studentId || !record.class || !["Present", "Absent", "Leave"].includes(record.status))) {
    res.status(400);
    throw new Error("Each record requires a studentId, class and valid status");
  }

  if (req.user.role !== "admin") {
    const allowedIds = await allowedStudentIds(req);
    const invalid = recordsWithClasses.filter((r) => !allowedIds.includes(r.studentId.toString()));
    if (invalid.length > 0) {
      res.status(403);
      throw new Error("Access denied: one or more students are not assigned to you");
    }
  }

  const results = await Promise.all(recordsWithClasses.map(({ studentId, status, class: recordClass }) =>
    Attendance.findOneAndUpdate(
      academyFilter(req, { student: studentId, date: new Date(date) }),
      { academyId: requireAcademyId(req), student: studentId, date: new Date(date), class: recordClass, status, markedBy: req.user._id },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    )
  ));

  // Fire WhatsApp absent alerts in the background — never blocks the
  // response, and a failure here must never break attendance marking itself.
  Settings.getSingleton(requireAcademyId(req))
    .then(async (settings) => {
      if (!settings.whatsapp.autoNotificationsEnabled || !settings.whatsapp.notificationsEnabled.attendanceAlert) return;
      const absentIds = recordsWithClasses.filter((r) => r.status === "Absent").map((r) => r.studentId);
      if (absentIds.length === 0) return;
      const absentStudents = await Student.find({ academyId: requireAcademyId(req), _id: { $in: absentIds } });
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
  const query = { academyId: requireAcademyId(req) };
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
  const query = { academyId: requireAcademyId(req), date: { $gte: startOfDay, $lte: endOfDay } };
  if (allowedIds) query.student = { $in: allowedIds };

  const records = await Attendance.find(query);
  const totalStudents =
    req.user.role === "admin"
      ? await Student.countDocuments({ academyId: requireAcademyId(req), status: "Active" })
      : await Student.countDocuments({ academyId: requireAcademyId(req), status: "Active", assignedTeacher: req.user._id });

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

  const records = await Attendance.find(academyFilter(req, { student: req.params.studentId }));
  const total = records.length;
  const present = records.filter((r) => r.status === "Present").length;
  const percentage = total > 0 ? Number(((present / total) * 100).toFixed(1)) : 0;

  res.json({ success: true, data: { total, present, percentage } });
});

// @desc    Students with attendance below the threshold for a selected period
// @route   GET /api/attendance/low-attendance?period=month|quarter|year&year=&month=&quarter=
// @access  Staff (Admin or Teacher)
const getLowAttendanceStudents = asyncHandler(async (req, res) => {
  const { period, year: yearValue, month: monthValue, quarter: quarterValue } = req.query;
  const year = Number(yearValue);

  if (!["month", "quarter", "year"].includes(period)) {
    res.status(400);
    throw new Error("period must be month, quarter, or year");
  }
  if (!Number.isInteger(year) || year < 1900 || year > 9999) {
    res.status(400);
    throw new Error("A valid year is required");
  }

  let startDate;
  let endDate;
  if (period === "month") {
    const month = Number(monthValue);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      res.status(400);
      throw new Error("A valid month is required");
    }
    startDate = new Date(Date.UTC(year, month - 1, 1));
    endDate = new Date(Date.UTC(year, month, 1));
  } else if (period === "quarter") {
    const quarter = Number(quarterValue);
    if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) {
      res.status(400);
      throw new Error("A valid quarter is required");
    }
    const firstMonth = (quarter - 1) * 3;
    startDate = new Date(Date.UTC(year, firstMonth, 1));
    endDate = new Date(Date.UTC(year, firstMonth + 3, 1));
  } else {
    startDate = new Date(Date.UTC(year, 0, 1));
    endDate = new Date(Date.UTC(year + 1, 0, 1));
  }

  const studentScope = { "student.academyId": requireAcademyId(req) };
  if (req.user.role !== "admin") studentScope["student.assignedTeacher"] = req.user._id;

  const students = await Attendance.aggregate([
    {
      $match: {
        academyId: requireAcademyId(req),
        date: { $gte: startDate, $lt: endDate },
      },
    },
    {
      $group: {
        _id: "$student",
        totalDays: { $sum: 1 },
        presentDays: { $sum: { $cond: [{ $eq: ["$status", "Present"] }, 1, 0] } },
      },
    },
    {
      $lookup: {
        from: Student.collection.name,
        localField: "_id",
        foreignField: "_id",
        as: "student",
      },
    },
    { $unwind: "$student" },
    { $match: studentScope },
    {
      $addFields: {
        attendancePercent: { $multiply: [{ $divide: ["$presentDays", "$totalDays"] }, 100] },
      },
    },
    { $match: { attendancePercent: { $lt: 75 } } },
    { $sort: { "student.class": 1, "student.name": 1 } },
    {
      $project: {
        _id: "$student._id",
        studentId: "$student.studentId",
        name: "$student.name",
        class: "$student.class",
        presentDays: 1,
        totalDays: 1,
        attendancePercent: 1,
      },
    },
  ]);

  res.json({ success: true, count: students.length, data: students });
});

module.exports = { markAttendance, getAttendance, getTodaySummary, getAttendancePercentage, getLowAttendanceStudents };
