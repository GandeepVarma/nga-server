const asyncHandler = require("express-async-handler");
const Teacher = require("../models/Teacher");
const Student = require("../models/Student");
const Test = require("../models/Test");
const Submission = require("../models/Submission");
const Assignment = require("../models/Assignment");
const Fee = require("../models/Fee");
const Attendance = require("../models/Attendance");
const OnlineTest = require("../models/OnlineTest");
const NotificationLog = require("../models/NotificationLog");
const { academyFilter, requireAcademyId } = require("../utils/tenant");
const { PASSWORD_POLICY_MESSAGE, getPasswordChangedAt, isStrongPassword } = require("../utils/passwordPolicy");

const combineTeacherScoreAggregates = (regularScores = [], onlineScores = []) => {
  const combined = new Map();
  [...regularScores, ...onlineScores].forEach((score) => {
    if (!score._id) return;
    const teacherId = String(score._id);
    const current = combined.get(teacherId) || { weightedScore: 0, gradedMarks: 0, tests: new Set() };
    const gradedMarks = score.gradedMarks || 0;
    current.weightedScore += (score.averageScorePercent || 0) * gradedMarks;
    current.gradedMarks += gradedMarks;
    (score.tests || []).forEach((testId) => current.tests.add(String(testId)));
    combined.set(teacherId, current);
  });

  return new Map(
    [...combined].map(([teacherId, score]) => [
      teacherId,
      {
        averageScorePercent: score.gradedMarks ? score.weightedScore / score.gradedMarks : null,
        gradedMarks: score.gradedMarks,
        tests: [...score.tests],
      },
    ])
  );
};

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
  if (!isStrongPassword(password)) {
    res.status(400);
    throw new Error(PASSWORD_POLICY_MESSAGE);
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

// @desc    Expected monthly fees from active students
// @route   GET /api/admin/earnings
// @access  Admin
const getMonthlyEarnings = asyncHandler(async (req, res) => {
  const classes = await Student.aggregate([
    { $match: { academyId: requireAcademyId(req), status: "Active" } },
    {
      $group: {
        _id: "$class",
        studentCount: { $sum: 1 },
        monthlyEarnings: { $sum: { $ifNull: ["$monthlyFee", 0] } },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const groupedEarnings = {
    classes8To10: { label: "Classes 8–10", studentCount: 0, monthlyEarnings: 0 },
    classes6To7: { label: "Classes 6–7", studentCount: 0, monthlyEarnings: 0 },
    ukgAndClasses1To5: { label: "UKG + Classes 1–5", studentCount: 0, monthlyEarnings: 0 },
    otherClasses: { label: "Other classes", studentCount: 0, monthlyEarnings: 0 },
  };
  const classWise = classes.map((entry) => {
    const className = String(entry._id || "Unspecified").trim() || "Unspecified";
    const normalizedClass = className.toUpperCase();
    const classNumber = Number(normalizedClass.match(/\d+/)?.[0]);
    let group = "otherClasses";

    if (normalizedClass.includes("UKG") || (classNumber >= 1 && classNumber <= 5)) {
      group = "ukgAndClasses1To5";
    } else if (classNumber >= 6 && classNumber <= 7) {
      group = "classes6To7";
    } else if (classNumber >= 8 && classNumber <= 10) {
      group = "classes8To10";
    }

    groupedEarnings[group].studentCount += entry.studentCount;
    groupedEarnings[group].monthlyEarnings += entry.monthlyEarnings;
    return {
      className,
      studentCount: entry.studentCount,
      monthlyEarnings: entry.monthlyEarnings,
    };
  });

  res.json({
    success: true,
    data: {
      activeStudentCount: classes.reduce((total, entry) => total + entry.studentCount, 0),
      monthlyEarnings: classes.reduce((total, entry) => total + entry.monthlyEarnings, 0),
      groupedEarnings,
      classWise,
    },
  });
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
  if (!isStrongPassword(newPassword)) {
    res.status(400);
    throw new Error(PASSWORD_POLICY_MESSAGE);
  }

  const teacher = await Teacher.findOne(academyFilter(req, { _id: req.params.id, role: "teacher" }));
  if (!teacher) {
    res.status(404);
    throw new Error("Teacher not found");
  }

  teacher.password = newPassword; // pre-save hook hashes it
  teacher.passwordChangedAt = getPasswordChangedAt();
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

const getStudentsAttendanceSummary = asyncHandler(async (req, res) => {
  const summaries = await Attendance.aggregate([
    { $match: { academyId: requireAcademyId(req) } },
    {
      $group: {
        _id: "$student",
        totalDays: { $sum: 1 },
        presentDays: { $sum: { $cond: [{ $eq: ["$status", "Present"] }, 1, 0] } },
        absentDays: { $sum: { $cond: [{ $eq: ["$status", "Absent"] }, 1, 0] } },
        leaveDays: { $sum: { $cond: [{ $eq: ["$status", "Leave"] }, 1, 0] } },
      },
    },
    {
      $project: {
        totalDays: 1,
        presentDays: 1,
        absentDays: 1,
        leaveDays: 1,
        attendancePercent: { $multiply: [{ $divide: ["$presentDays", "$totalDays"] }, 100] },
      },
    },
  ]);

  res.json({ success: true, data: summaries });
});

const getStudentAttendanceHistory = asyncHandler(async (req, res) => {
  const academyId = requireAcademyId(req);
  const student = await Student.findOne({ academyId, _id: req.params.studentId })
    .select("name studentId class")
    .lean();
  if (!student) {
    res.status(404);
    throw new Error("Student not found");
  }

  const records = await Attendance.find({ academyId, student: student._id })
    .select("date status")
    .sort({ date: -1 })
    .lean();
  const presentDays = records.filter((record) => record.status === "Present").length;
  const absentDays = records.filter((record) => record.status === "Absent").length;
  const leaveDays = records.filter((record) => record.status === "Leave").length;
  const totalDays = records.length;

  res.json({
    success: true,
    data: {
      student,
      summary: {
        totalDays,
        presentDays,
        absentDays,
        leaveDays,
        attendancePercent: totalDays > 0 ? Number(((presentDays / totalDays) * 100).toFixed(2)) : null,
      },
      records,
    },
  });
});

// ---------- Academy-wide dashboard (Admin only) ----------

// @desc    Full academy statistics for the Admin dashboard
// @route   GET /api/admin/dashboard
// @access  Admin
const getAdminDashboard = asyncHandler(async (req, res) => {
  const academyId = requireAcademyId(req);
  const now = new Date();
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const parseDashboardDate = (value, fallback) => {
    if (!value) return fallback;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
  };
  const requestedStart = parseDashboardDate(req.query.dateFrom, null);
  const requestedEnd = parseDashboardDate(req.query.dateTo, null);
  if (req.query.dateFrom && !requestedStart) {
    res.status(400);
    throw new Error("dateFrom must use YYYY-MM-DD format");
  }
  if (req.query.dateTo && !requestedEnd) {
    res.status(400);
    throw new Error("dateTo must use YYYY-MM-DD format");
  }
  if (requestedStart && requestedEnd && requestedStart > requestedEnd) {
    res.status(400);
    throw new Error("dateFrom cannot be after dateTo");
  }
  const dashboardStart = requestedStart || startOfDay;
  dashboardStart.setUTCHours(0, 0, 0, 0);
  const dashboardEnd = requestedEnd
    ? new Date(requestedEnd.getTime() + 24 * 60 * 60 * 1000 - 1)
    : endOfDay;
  const previousDayStart = new Date(startOfDay);
  previousDayStart.setDate(previousDayStart.getDate() - 1);
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const trendStartMonth = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const trendStartDay = new Date(now);
  trendStartDay.setDate(trendStartDay.getDate() - 59);
  trendStartDay.setHours(0, 0, 0, 0);
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const previousMonth = `${previousMonthStart.getFullYear()}-${String(previousMonthStart.getMonth() + 1).padStart(2, "0")}`;
  const firstTrendMonth = `${trendStartMonth.getFullYear()}-${String(trendStartMonth.getMonth() + 1).padStart(2, "0")}`;
  const monthKeyExpression = { $dateToString: { format: "%Y-%m", date: "$date", timezone: "UTC" } };
  const percentChange = (current, previous) => previous > 0
    ? Number((((current - previous) / previous) * 100).toFixed(1))
    : null;

  const [studentSummaryResult, teachers, attendanceResult, feeResult, testResult, onlineTeacherScores, recentTests, recentAssignments, recentAttendance, recentPayments, upcomingTests, feeDueAlerts, todaysAbsentStudents, academyNotifications] = await Promise.all([
    Student.aggregate([
      { $match: { academyId } },
      {
        $facet: {
          statusCounts: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
          monthlyAdmissions: [
            { $match: { dateOfJoining: { $lte: endOfDay } } },
            { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$dateOfJoining", timezone: "UTC" } }, count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
          ],
          dailyAdmissions: [
            { $match: { dateOfJoining: { $gte: trendStartDay, $lte: endOfDay } } },
            { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$dateOfJoining", timezone: "UTC" } }, count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
          ],
          classes: [
            { $match: { status: "Active" } },
            { $group: { _id: "$class", studentCount: { $sum: 1 } } },
          ],
          byTeacher: [
            { $match: { status: "Active" } },
            { $group: { _id: "$assignedTeacher", studentCount: { $sum: 1 } } },
          ],
          recentAdmissions: [
            { $sort: { dateOfJoining: -1 } },
            { $limit: 5 },
            { $project: { name: 1, studentId: 1, class: 1, dateOfJoining: 1, createdAt: 1 } },
          ],
        },
      },
    ]),
    Teacher.find({ academyId, role: "teacher" }).select("name createdAt").sort({ createdAt: -1 }).lean(),
    Attendance.aggregate([
      { $match: { academyId, date: { $lte: endOfDay } } },
      {
        $facet: {
          today: [
            { $match: { date: { $gte: startOfDay } } },
            { $group: { _id: "$status", count: { $sum: 1 } } },
          ],
          daily: [
            { $match: { date: { $gte: trendStartDay } } },
            {
              $group: {
                _id: { $dateToString: { format: "%Y-%m-%d", date: "$date", timezone: "UTC" } },
                present: { $sum: { $cond: [{ $eq: ["$status", "Present"] }, 1, 0] } },
                absent: { $sum: { $cond: [{ $eq: ["$status", "Absent"] }, 1, 0] } },
                leave: { $sum: { $cond: [{ $eq: ["$status", "Leave"] }, 1, 0] } },
              },
            },
            { $sort: { _id: 1 } },
          ],
          classes: [
            { $match: { date: { $gte: trendStartDay } } },
            {
              $group: {
                _id: "$class",
                markedCount: { $sum: 1 },
                presentCount: { $sum: { $cond: [{ $eq: ["$status", "Present"] }, 1, 0] } },
              },
            },
          ],
          byTeacher: [
            { $match: { date: { $gte: trendStartDay } } },
            {
              $lookup: {
                from: Student.collection.name,
                let: { studentId: "$student" },
                pipeline: [
                  { $match: { $expr: { $and: [{ $eq: ["$_id", "$$studentId"] }, { $eq: ["$academyId", academyId] }] } } },
                  { $project: { assignedTeacher: 1 } },
                ],
                as: "studentRecord",
              },
            },
            { $unwind: "$studentRecord" },
            {
              $group: {
                _id: "$studentRecord.assignedTeacher",
                markedCount: { $sum: 1 },
                presentCount: { $sum: { $cond: [{ $eq: ["$status", "Present"] }, 1, 0] } },
              },
            },
          ],
        },
      },
    ]),
    Fee.aggregate([
      { $match: { academyId } },
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                feesCollected: { $sum: "$paid" },
                pendingFees: { $sum: "$pending" },
                totalDue: { $sum: { $add: [{ $ifNull: ["$amount", 0] }, { $ifNull: ["$carryForward", 0] }] } },
                monthlyRevenue: { $sum: { $cond: [{ $eq: ["$month", currentMonth] }, "$paid", 0] } },
                previousMonthRevenue: { $sum: { $cond: [{ $eq: ["$month", previousMonth] }, "$paid", 0] } },
              },
            },
          ],
          monthly: [
            { $match: { month: { $gte: firstTrendMonth, $lte: currentMonth } } },
            {
              $group: {
                _id: "$month",
                collected: { $sum: "$paid" },
                pending: { $sum: "$pending" },
                due: { $sum: { $add: [{ $ifNull: ["$amount", 0] }, { $ifNull: ["$carryForward", 0] }] } },
              },
            },
            { $sort: { _id: 1 } },
          ],
          classes: [
            {
              $lookup: {
                from: Student.collection.name,
                let: { studentId: "$student" },
                pipeline: [
                  { $match: { $expr: { $and: [{ $eq: ["$_id", "$$studentId"] }, { $eq: ["$academyId", academyId] }] } } },
                  { $project: { class: 1 } },
                ],
                as: "studentRecord",
              },
            },
            { $unwind: "$studentRecord" },
            {
              $group: {
                _id: "$studentRecord.class",
                collected: { $sum: "$paid" },
                pending: { $sum: "$pending" },
                due: { $sum: { $add: [{ $ifNull: ["$amount", 0] }, { $ifNull: ["$carryForward", 0] }] } },
              },
            },
          ],
        },
      },
    ]),
    Test.aggregate([
      { $match: { academyId } },
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                totalTests: { $sum: 1 },
                testsConducted: { $sum: { $cond: [{ $lte: ["$date", endOfDay] }, 1, 0] } },
                testsThisMonth: { $sum: { $cond: [{ $and: [{ $gte: ["$date", currentMonthStart] }, { $lte: ["$date", endOfDay] }] }, 1, 0] } },
                testsPreviousMonth: { $sum: { $cond: [{ $and: [{ $gte: ["$date", previousMonthStart] }, { $lt: ["$date", currentMonthStart] }] }, 1, 0] } },
              },
            },
          ],
          scores: [
            { $match: { date: { $lte: endOfDay } } },
            { $unwind: "$marks" },
            { $match: { "marks.marksObtained": { $type: "number" } } },
            {
              $group: {
                _id: null,
                averageScorePercent: { $avg: { $multiply: [{ $divide: ["$marks.marksObtained", "$maxMarks"] }, 100] } },
                highestScorePercent: { $max: { $multiply: [{ $divide: ["$marks.marksObtained", "$maxMarks"] }, 100] } },
                lowestScorePercent: { $min: { $multiply: [{ $divide: ["$marks.marksObtained", "$maxMarks"] }, 100] } },
                gradedMarks: { $sum: 1 },
              },
            },
          ],
          monthlyTests: [
            { $match: { date: { $gte: trendStartMonth, $lte: endOfDay } } },
            { $group: { _id: monthKeyExpression, testCount: { $sum: 1 } } },
            { $sort: { _id: 1 } },
          ],
          monthlyScores: [
            { $match: { date: { $gte: previousMonthStart, $lte: endOfDay } } },
            { $unwind: "$marks" },
            { $match: { "marks.marksObtained": { $type: "number" } } },
            {
              $group: {
                _id: monthKeyExpression,
                averageScorePercent: { $avg: { $multiply: [{ $divide: ["$marks.marksObtained", "$maxMarks"] }, 100] } },
                gradedMarks: { $sum: 1 },
              },
            },
          ],
          classes: [
            { $match: { date: { $lte: endOfDay } } },
            { $unwind: "$marks" },
            { $match: { "marks.marksObtained": { $type: "number" } } },
            {
              $group: {
                _id: "$class",
                averageScorePercent: { $avg: { $multiply: [{ $divide: ["$marks.marksObtained", "$maxMarks"] }, 100] } },
                gradedMarks: { $sum: 1 },
                tests: { $addToSet: "$_id" },
              },
            },
          ],
          teachers: [
            { $match: { date: { $lte: endOfDay } } },
            { $unwind: "$marks" },
            { $match: { "marks.marksObtained": { $type: "number" } } },
            {
              $lookup: {
                from: Student.collection.name,
                let: { studentId: "$marks.student" },
                pipeline: [
                  { $match: { $expr: { $and: [{ $eq: ["$_id", "$$studentId"] }, { $eq: ["$academyId", academyId] }] } } },
                  { $project: { assignedTeacher: 1 } },
                ],
                as: "studentRecord",
              },
            },
            { $unwind: "$studentRecord" },
            {
              $group: {
                _id: "$studentRecord.assignedTeacher",
                averageScorePercent: { $avg: { $multiply: [{ $divide: ["$marks.marksObtained", "$maxMarks"] }, 100] } },
                gradedMarks: { $sum: 1 },
                tests: { $addToSet: "$_id" },
              },
            },
          ],
        },
      },
    ]),
    Submission.aggregate([
      { $match: { academyId, submittedAt: { $ne: null, $lte: endOfDay }, percentage: { $type: "number" } } },
      {
        $lookup: {
          from: Student.collection.name,
          let: { studentId: "$student" },
          pipeline: [
            { $match: { $expr: { $and: [{ $eq: ["$_id", "$$studentId"] }, { $eq: ["$academyId", academyId] }] } } },
            { $project: { assignedTeacher: 1 } },
          ],
          as: "studentRecord",
        },
      },
      { $unwind: "$studentRecord" },
      { $match: { "studentRecord.assignedTeacher": { $ne: null } } },
      {
        $group: {
          _id: "$studentRecord.assignedTeacher",
          averageScorePercent: { $avg: "$percentage" },
          gradedMarks: { $sum: 1 },
          tests: { $addToSet: "$test" },
        },
      },
    ]),
    Test.find({ academyId, date: { $lte: endOfDay } }).sort({ date: -1 }).limit(12).select("testName subject class maxMarks date marks createdAt").lean(),
    Assignment.find({ academyId }).sort({ createdAt: -1 }).limit(5).select("title class createdAt").lean(),
    Attendance.find({ academyId }).sort({ updatedAt: -1 }).limit(5).select("student status date updatedAt").populate("student", "name").lean(),
    Fee.find({ academyId, paymentDate: { $ne: null } }).sort({ paymentDate: -1 }).limit(5).select("student month paymentDate").populate("student", "name").lean(),
    OnlineTest.find({
      academyId,
      published: true,
      startTime: { $gte: dashboardStart, $lte: dashboardEnd },
    }).sort({ startTime: 1 }).limit(8).select("title subject class batch startTime endTime duration").lean(),
    Fee.find({
      academyId,
      pending: { $gt: 0 },
      dueDate: { $lte: dashboardEnd },
    }).populate("student", "name studentId class phone").sort({ dueDate: 1 }).limit(8).lean(),
    Attendance.find({
      academyId,
      date: { $gte: startOfDay, $lte: endOfDay },
      status: "Absent",
    }).populate("student", "name studentId class phone").sort({ updatedAt: -1 }).limit(8).lean(),
    NotificationLog.find({ academyId }).sort({ createdAt: -1 }).limit(8).select("type recipientName message status createdAt").lean(),
  ]);

  const studentSummary = studentSummaryResult[0] || {};
  const attendanceSummary = attendanceResult[0] || {};
  const feeSummary = feeResult[0] || {};
  const testSummary = testResult[0] || {};
  const statusCounts = Object.fromEntries((studentSummary.statusCounts || []).map(({ _id, count }) => [_id, count]));
  const totalStudents = statusCounts.Active || 0;
  const totalTeachers = teachers.length;
  const teacherCounts = new Map((studentSummary.byTeacher || []).map(({ _id, studentCount }) => [String(_id), studentCount]));
  const admissionByMonth = new Map((studentSummary.monthlyAdmissions || []).map(({ _id, count }) => [_id, count]));
  const admissionsByDay = new Map((studentSummary.dailyAdmissions || []).map(({ _id, count }) => [_id, count]));
  const attendanceByDay = new Map((attendanceSummary.daily || []).map((day) => [day._id, day]));
  const feeTotals = feeSummary.totals?.[0] || {};
  const testTotals = testSummary.totals?.[0] || {};
  const overallScores = testSummary.scores?.[0] || {};
  const scoreByMonth = new Map((testSummary.monthlyScores || []).map((month) => [month._id, month]));
  const scoreByClass = new Map((testSummary.classes || []).map((entry) => [entry._id, entry]));
  const scoreByTeacher = combineTeacherScoreAggregates(testSummary.teachers, onlineTeacherScores);
  const attendanceByClass = new Map((attendanceSummary.classes || []).map((entry) => [entry._id, entry]));
  const attendanceByTeacher = new Map((attendanceSummary.byTeacher || []).map((entry) => [String(entry._id), entry]));
  const feesByClass = new Map((feeSummary.classes || []).map((entry) => [entry._id, entry]));
  const admissionsTrend = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - 11 + index, 1);
    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    return { month, newAdmissions: admissionByMonth.get(month) || 0 };
  });
  const revenueByMonth = new Map((feeSummary.monthly || []).map((month) => [month._id, month]));
  const monthlyRevenueChart = admissionsTrend.map(({ month }) => {
    const values = revenueByMonth.get(month) || {};
    return { month, revenue: values.collected || 0, pending: values.pending || 0 };
  });
  let cumulativeAdmissions = (studentSummary.monthlyAdmissions || [])
    .filter((month) => month._id < firstTrendMonth)
    .reduce((sum, month) => sum + month.count, 0);
  const studentGrowthChart = admissionsTrend.map((month) => {
    cumulativeAdmissions += month.newAdmissions;
    return { ...month, cumulativeAdmissions };
  });

  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const previousDay = new Date(startOfDay);
  previousDay.setDate(previousDay.getDate() - 1);
  const previousDayKey = `${previousDay.getFullYear()}-${String(previousDay.getMonth() + 1).padStart(2, "0")}-${String(previousDay.getDate()).padStart(2, "0")}`;
  const countsForStatuses = (records = []) => records.reduce((counts, record) => ({ ...counts, [record._id]: record.count }), {});
  const todayAttendanceCounts = countsForStatuses(attendanceSummary.today);
  const todayMarked = Object.values(todayAttendanceCounts).reduce((sum, value) => sum + value, 0);
  const attendancePercentage = todayMarked > 0 ? Number(((todayAttendanceCounts.Present || 0) / todayMarked * 100).toFixed(1)) : null;
  const previousDayAttendance = attendanceByDay.get(previousDayKey);
  const previousDayMarked = previousDayAttendance ? previousDayAttendance.present + previousDayAttendance.absent + previousDayAttendance.leave : 0;
  const previousDayAttendancePercentage = previousDayMarked > 0 ? Number((previousDayAttendance.present / previousDayMarked * 100).toFixed(1)) : null;
  const currentMonthAdmissions = admissionByMonth.get(currentMonth) || 0;
  const previousMonthAdmissions = admissionByMonth.get(previousMonth) || 0;
  const currentMonthTests = scoreByMonth.get(currentMonth);
  const previousMonthTests = scoreByMonth.get(previousMonth);
  const monthAdmissionsComparison = percentChange(currentMonthAdmissions, previousMonthAdmissions);
  const monthRevenueComparison = percentChange(feeTotals.monthlyRevenue || 0, feeTotals.previousMonthRevenue || 0);
  const monthTestsComparison = percentChange(testTotals.testsThisMonth || 0, testTotals.testsPreviousMonth || 0);
  const monthScoreComparison = currentMonthTests?.averageScorePercent != null && previousMonthTests?.averageScorePercent > 0
    ? Number((currentMonthTests.averageScorePercent - previousMonthTests.averageScorePercent).toFixed(1))
    : null;

  const teacherPerformance = teachers.map((teacher) => {
    const teacherId = String(teacher._id);
    const scores = scoreByTeacher.get(teacherId);
    const attendance = attendanceByTeacher.get(teacherId);
    const marked = attendance?.markedCount || 0;
    return {
      teacherId: teacher._id,
      name: teacher.name,
      studentCount: teacherCounts.get(teacherId) || 0,
      averageScorePercent: scores ? Number(scores.averageScorePercent.toFixed(1)) : null,
      testsCount: scores?.tests?.length || 0,
      gradedMarks: scores?.gradedMarks || 0,
      attendancePercent: marked > 0 ? Number((attendance.presentCount / marked * 100).toFixed(1)) : null,
    };
  });
  const classNames = new Set([
    ...(studentSummary.classes || []).map((entry) => entry._id),
    ...scoreByClass.keys(),
    ...attendanceByClass.keys(),
    ...feesByClass.keys(),
  ]);
  const classPerformance = [...classNames].filter(Boolean).sort().map((className) => {
    const scores = scoreByClass.get(className);
    const attendance = attendanceByClass.get(className);
    const fee = feesByClass.get(className);
    return {
      className,
      studentCount: (studentSummary.classes || []).find((entry) => entry._id === className)?.studentCount || 0,
      averageScorePercent: scores ? Number(scores.averageScorePercent.toFixed(1)) : null,
      testsCount: scores?.tests?.length || 0,
      attendancePercent: attendance?.markedCount ? Number((attendance.presentCount / attendance.markedCount * 100).toFixed(1)) : null,
      feeCollectionPercent: fee?.due ? Number((fee.collected / fee.due * 100).toFixed(1)) : null,
    };
  });
  const recentAdmissions = studentSummary.recentAdmissions || [];
  const recentActivities = [
    ...recentAdmissions.map((student) => ({ id: `student-${student._id}`, type: "student", description: `New student added: ${student.name}`, detail: `${student.class} · ${student.studentId}`, date: student.createdAt || student.dateOfJoining, to: "/admin/students" })),
    ...teachers.slice(0, 5).map((teacher) => ({ id: `teacher-${teacher._id}`, type: "teacher", description: `Teacher added: ${teacher.name}`, date: teacher.createdAt, to: "/admin/teachers" })),
    ...recentTests.slice(0, 5).map((test) => ({ id: `test-${test._id}`, type: "test", description: `Test added: ${test.testName}`, detail: `${test.class} · ${test.subject}`, date: test.createdAt || test.date, to: "/admin/tests" })),
    ...recentAssignments.map((assignment) => ({ id: `assignment-${assignment._id}`, type: "assignment", description: `Assignment added: ${assignment.title}`, detail: assignment.class, date: assignment.createdAt, to: "/admin/assignments" })),
    ...recentAttendance.filter((record) => record.student).map((record) => ({ id: `attendance-${record._id}`, type: "attendance", description: `Attendance recorded for ${record.student.name}`, detail: record.status, date: record.updatedAt || record.date, to: "/admin/attendance" })),
    ...recentPayments.filter((fee) => fee.student).map((fee) => ({ id: `fee-${fee._id}`, type: "fee", description: `Fee payment recorded for ${fee.student.name}`, detail: fee.month, date: fee.paymentDate, to: "/admin/fees" })),
  ].filter((activity) => activity.date).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 12);

  const feesCollected = feeTotals.feesCollected || 0;
  const pendingFees = feeTotals.pendingFees || 0;
  const totalDue = feeTotals.totalDue || 0;
  const collectionPercentage = totalDue > 0 ? Number((feesCollected / totalDue * 100).toFixed(1)) : null;

  res.json({
    success: true,
    data: {
      totalTeachers,
      totalStudents,
      totalAdmissionsOnRecord: (studentSummary.monthlyAdmissions || []).reduce((sum, month) => sum + month.count, 0),
      todaysAttendance: {
        marked: todayMarked,
        present: todayAttendanceCounts.Present || 0,
        absent: todayAttendanceCounts.Absent || 0,
        leave: todayAttendanceCounts.Leave || 0,
        totalStudents,
        percentage: attendancePercentage,
      },
      feesCollected,
      pendingFees,
      monthlyRevenue: feeTotals.monthlyRevenue || 0,
      previousMonthRevenue: feeTotals.previousMonthRevenue || 0,
      collectionPercentage,
      totalDue,
      monthlyRevenueChart,
      studentGrowthChart,
      dailyAdmissions: studentSummary.dailyAdmissions || [],
      monthlyAdmissions: admissionsTrend,
      attendanceDaily: attendanceSummary.daily || [],
      previousDayAttendancePercentage,
      attendanceClassSummary: attendanceSummary.classes || [],
      recentAdmissions,
      teacherPerformance,
      classPerformance,
      totalTests: testTotals.totalTests || 0,
      testsConducted: testTotals.testsConducted || 0,
      testsThisMonth: testTotals.testsThisMonth || 0,
      testsPreviousMonth: testTotals.testsPreviousMonth || 0,
      averageTestScore: overallScores.averageScorePercent == null ? null : Number(overallScores.averageScorePercent.toFixed(1)),
      highestTestScore: overallScores.highestScorePercent == null ? null : Number(overallScores.highestScorePercent.toFixed(1)),
      lowestTestScore: overallScores.lowestScorePercent == null ? null : Number(overallScores.lowestScorePercent.toFixed(1)),
      gradedTestMarks: overallScores.gradedMarks || 0,
      monthlyTestCounts: testSummary.monthlyTests || [],
      monthlyTestScores: testSummary.monthlyScores || [],
      recentTests: recentTests.map((test) => {
        const scores = test.marks.map((mark) => mark.marksObtained).filter((score) => typeof score === "number");
        const averageScorePercent = scores.length > 0
          ? Number((scores.reduce((sum, score) => sum + score / test.maxMarks * 100, 0) / scores.length).toFixed(1))
          : null;
        return { _id: test._id, testName: test.testName, subject: test.subject, class: test.class, date: test.date, averageScorePercent, gradedMarks: scores.length };
      }),
      recentActivities,
      upcomingTests,
      feeDueAlerts: feeDueAlerts.map((fee) => ({
        _id: fee._id,
        month: fee.month,
        pending: fee.pending,
        dueDate: fee.dueDate,
        student: fee.student,
      })),
      todaysAbsentStudents: todaysAbsentStudents
        .filter((record) => record.student)
        .map((record) => ({
          _id: record._id,
          status: record.status,
          date: record.date,
          student: record.student,
        })),
      academyNotifications: academyNotifications.map((notification) => ({
        _id: notification._id,
        type: notification.type,
        recipientName: notification.recipientName,
        message: notification.message,
        status: notification.status,
        createdAt: notification.createdAt,
      })),
      dashboardDateRange: {
        dateFrom: requestedStart ? requestedStart.toISOString().slice(0, 10) : null,
        dateTo: req.query.dateTo || null,
      },
      comparisons: {
        admissionsPercent: monthAdmissionsComparison,
        revenuePercent: monthRevenueComparison,
        testsPercent: monthTestsComparison,
        averageScorePoints: monthScoreComparison,
        attendancePoints: attendancePercentage != null && previousDayAttendancePercentage != null
          ? Number((attendancePercentage - previousDayAttendancePercentage).toFixed(1))
          : null,
        previousDayAttendancePercent: previousDayAttendancePercentage,
        teachersAddedThisMonth: teachers.filter((teacher) => teacher.createdAt >= currentMonthStart).length,
      },
    },
  });
});

module.exports = {
  createTeacher,
  getTeachers,
  getMonthlyEarnings,
  updateTeacher,
  setTeacherStatus,
  resetTeacherPassword,
  assignStudents,
  reassignStudent,
  getStudentsAttendanceSummary,
  getStudentAttendanceHistory,
  getAdminDashboard,
  combineTeacherScoreAggregates,
};
