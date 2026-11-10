const asyncHandler = require("express-async-handler");
const Student = require("../models/Student");
const Test = require("../models/Test");
const OnlineTestSubmission = require("../models/Submission");
const Assignment = require("../models/Assignment");
const Attendance = require("../models/Attendance");
const ScheduledClass = require("../models/ScheduledClass");
const { academyFilter, requireAcademyId } = require("../utils/tenant");

const buildProgressGraph = (recentTests, onlineTestSubmissions, studentId) => {
  const legacyProgress = recentTests.map((test) => {
    const entry = test.marks.find((mark) => mark.student.toString() === studentId.toString());
    return {
      testName: test.testName,
      subject: test.subject,
      date: test.date,
      percentage:
        entry && entry.marksObtained !== null
          ? Number(((entry.marksObtained / test.maxMarks) * 100).toFixed(1))
          : null,
    };
  });
  const onlineProgress = onlineTestSubmissions
    .filter((submission) => submission.test && submission.percentage !== null)
    .map((submission) => ({
      testName: submission.test.title,
      subject: submission.test.subject,
      date: submission.submittedAt,
      percentage: submission.percentage,
    }));

  return [...legacyProgress, ...onlineProgress]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 10)
    .reverse();
};

// @desc    Teacher's own dashboard: only their assigned students' data.
//          Deliberately contains NO fee/revenue information — per RBAC
//          rules, teachers never see academy financial data.
// @route   GET /api/dashboard/teacher
// @access  Teacher (not Admin — Admin uses /api/admin/dashboard)
const getTeacherDashboard = asyncHandler(async (req, res) => {
  const myStudentIds = await Student.find({
    academyId: requireAcademyId(req), assignedTeacher: req.user._id,
    status: "Active",
  }).distinct("_id");

  const totalStudents = myStudentIds.length;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const todaysAttendanceRecords = await Attendance.find({
    academyId: requireAcademyId(req), student: { $in: myStudentIds },
    date: { $gte: startOfDay, $lte: endOfDay },
  });
  const todaysAttendance = {
    marked: todaysAttendanceRecords.length,
    present: todaysAttendanceRecords.filter((r) => r.status === "Present").length,
    totalStudents,
  };

  const now = new Date();
  const upcomingTests = await Test.countDocuments({
    academyId: requireAcademyId(req), "marks.student": { $in: myStudentIds },
    date: { $gte: now },
  });

  const assignments = await Assignment.find({ academyId: requireAcademyId(req), "assignedStudents.student": { $in: myStudentIds } });
  let assignmentsPending = 0;
  assignments.forEach((a) => {
    assignmentsPending += a.assignedStudents.filter(
      (s) => s.status === "Pending" && myStudentIds.some((id) => id.toString() === s.student.toString())
    ).length;
  });

  // Recent test entries across my students
  const recentTests = await Test.find({ academyId: requireAcademyId(req), "marks.student": { $in: myStudentIds } })
    .sort({ date: -1 })
    .limit(5)
    .select("testName subject date maxMarks");

  res.json({
    success: true,
    data: {
      totalStudents,
      todaysAttendance,
      upcomingTests,
      assignmentsPending,
      recentTests,
    },
  });
});

// @desc    Student dashboard data, including the student's recent session attendance
// @route   GET /api/dashboard/student
// @access  Student
const getStudentDashboard = asyncHandler(async (req, res) => {
  const student = req.user;

  const Fee = require("../models/Fee");
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const attendanceExpiry = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const [attendanceRecords, upcomingTests, assignments, fees, recentTests, onlineTestSubmissions, upcomingClasses] = await Promise.all([
    Attendance.find(academyFilter(req, { student: student._id })),
    Test.find(academyFilter(req, { "marks.student": student._id, date: { $gte: new Date() } })).sort({ date: 1 }).limit(5),
    Assignment.find(academyFilter(req, { "assignedStudents.student": student._id })).sort({ submissionDate: 1 }),
    Fee.find(academyFilter(req, { student: student._id })).sort({ month: -1 }),
    Test.find(academyFilter(req, { "marks.student": student._id, date: { $lt: new Date() } })).sort({ date: -1 }).limit(10),
    OnlineTestSubmission.find(academyFilter(req, { student: student._id, submittedAt: { $ne: null } }))
      .populate("test", "title subject")
      .sort({ submittedAt: -1 })
      .limit(10),
    (async () => {
      const recentScheduledClassIds = await Attendance.distinct("scheduledClass", {
        ...academyFilter(req, { student: student._id }),
        scheduledClass: { $exists: true },
        updatedAt: { $gt: attendanceExpiry },
      });
      const scheduleFilter = {
        academyId: requireAcademyId(req),
        class: student.class,
        batch: student.batch?.trim() ? student.batch.trim() : { $in: ["", null] },
      };
      const [futureClasses, recentlyMarkedClasses] = await Promise.all([
        ScheduledClass.find({ ...scheduleFilter, date: { $gte: today } })
          .sort({ date: 1, session: 1 }).limit(10).select("class batch session date"),
        recentScheduledClassIds.length
          ? ScheduledClass.find({ ...scheduleFilter, _id: { $in: recentScheduledClassIds } })
              .sort({ date: 1, session: 1 }).select("class batch session date")
          : [],
      ]);
      return [...new Map(
        [...futureClasses, ...recentlyMarkedClasses].map((scheduledClass) => [
          scheduledClass._id.toString(),
          scheduledClass,
        ])
      ).values()].sort((a, b) => a.date - b.date || a.session.localeCompare(b.session));
    })(),
  ]);

  const attendanceByScheduledClass = new Map(
    attendanceRecords
      .filter((record) => record.scheduledClass)
      .map((record) => [record.scheduledClass.toString(), record])
  );
  const classesWithAttendance = upcomingClasses
    .map((scheduledClass) => {
      const attendance = attendanceByScheduledClass.get(scheduledClass._id.toString());
      return {
        ...scheduledClass.toObject(),
        attendanceStatus: attendance?.status || null,
      };
    })
    .filter((scheduledClass) => {
      if (scheduledClass.date >= today) return true;
      const attendance = attendanceByScheduledClass.get(scheduledClass._id.toString());
      return attendance?.updatedAt && attendance.updatedAt > attendanceExpiry;
    });

  const totalDays = attendanceRecords.length;
  const presentDays = attendanceRecords.filter((a) => a.status === "Present").length;
  const attendancePercentage = totalDays > 0 ? Number(((presentDays / totalDays) * 100).toFixed(1)) : 0;

  const pendingAssignments = assignments.filter((a) => {
    const entry = a.assignedStudents.find((s) => s.student.toString() === student._id.toString());
    return entry && entry.status === "Pending";
  });

  const currentFee = fees[0] || null;

  const progressGraph = buildProgressGraph(recentTests, onlineTestSubmissions, student._id);

  res.json({
    success: true,
    data: {
      welcome: { name: student.name, class: student.class, profilePhoto: student.profilePhoto },
      attendancePercentage,
      upcomingClasses: classesWithAttendance,
      upcomingTests,
      pendingAssignmentsCount: pendingAssignments.length,
      pendingAssignments,
      feeStatus: currentFee,
      progressGraph,
    },
  });
});

module.exports = { getTeacherDashboard, getStudentDashboard, buildProgressGraph };
