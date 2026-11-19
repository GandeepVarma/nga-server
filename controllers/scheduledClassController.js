const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Attendance = require("../models/Attendance");
const ScheduledClass = require("../models/ScheduledClass");
const Student = require("../models/Student");
const Settings = require("../models/Settings");
const whatsapp = require("../services/whatsappService");
const { requireAcademyId } = require("../utils/tenant");

const HISTORY_ATTENDANCE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const isVisibleInAttendanceHistory = (lastMarkedAt, now = new Date()) =>
  Boolean(lastMarkedAt) && lastMarkedAt.getTime() > now.getTime() - HISTORY_ATTENDANCE_RETENTION_MS;

const isVisibleInUpcomingSchedule = (attendance) => Object.keys(attendance || {}).length === 0;

const sortUpcomingClassesByAttendance = (classes) =>
  classes
    .map((scheduledClass, index) => ({ scheduledClass, index }))
    .sort((a, b) => {
      const aMarked = Object.keys(a.scheduledClass.attendance || {}).length > 0;
      const bMarked = Object.keys(b.scheduledClass.attendance || {}).length > 0;
      return Number(aMarked) - Number(bMarked) || a.index - b.index;
    })
    .map(({ scheduledClass }) => scheduledClass);

const getUnscheduledClassBatches = (classBatches, existing) => {
  const existingPairs = new Set(existing.map((item) => `${item.class}\u0000${item.batch}`));
  return classBatches.filter((pair) => !existingPairs.has(`${pair.class}\u0000${pair.batch}`));
};

const getStudentQuery = (req, className, batch) => {
  const query = { academyId: requireAcademyId(req), class: className, status: "Active" };
  query.batch = batch ? batch : { $in: ["", null] };
  if (req.user.role !== "admin") query.assignedTeacher = req.user._id;
  return query;
};

const getAccessibleSchedule = async (req, res, scheduleId) => {
  if (!mongoose.Types.ObjectId.isValid(scheduleId)) {
    res.status(400);
    throw new Error("Invalid scheduled class ID");
  }
  const scheduledClass = await ScheduledClass.findOne({
    _id: scheduleId,
    academyId: requireAcademyId(req),
  });
  if (!scheduledClass) {
    res.status(404);
    throw new Error("Scheduled class not found");
  }

  const students = await Student.find(getStudentQuery(req, scheduledClass.class, scheduledClass.batch))
    .select("_id name studentId class batch");
  if (students.length === 0) {
    res.status(403);
    throw new Error("Access denied: no students in this class are assigned to you");
  }
  return { scheduledClass, students };
};

const validateDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return date;
};

const createScheduledClass = asyncHandler(async (req, res) => {
  const { class: className, batch, session, allClasses, allBatches } = req.body;
  const date = validateDate(req.body.date);

  if (allClasses !== true && (typeof className !== "string" || !className.trim())) {
    res.status(400);
    throw new Error("A class is required");
  }
  if (allBatches !== true && typeof batch !== "string") {
    res.status(400);
    throw new Error("A batch is required");
  }
  if (!["morning", "evening"].includes(session) || !date) {
    res.status(400);
    throw new Error("A batch, valid session, and valid date are required");
  }

  const studentQuery = { academyId: requireAcademyId(req), status: "Active" };
  if (req.user.role !== "admin") studentQuery.assignedTeacher = req.user._id;
  if (!allClasses) studentQuery.class = className.trim();
  const students = await Student.find(studentQuery).select("_id class batch");
  if (students.length === 0) {
    res.status(400);
    throw new Error("No active students match the selected class and batch");
  }
  const classBatches = [...new Map(
    students
      .filter((student) => allBatches || (student.batch || "").trim() === batch.trim())
      .map((student) => {
        const pair = { class: student.class.trim(), batch: (student.batch || "").trim() };
        return [`${pair.class}\u0000${pair.batch}`, pair];
      })
  ).values()];
  if (!classBatches.length) {
    res.status(409);
    throw new Error("No active students match the selected batch");
  }

  const classNames = [...new Set(classBatches.map((pair) => pair.class))];
  const nextDate = new Date(date.getTime() + 24 * 60 * 60 * 1000);
  const existing = await ScheduledClass.find({
    academyId: requireAcademyId(req),
    class: { $in: classNames },
    date: { $gte: date, $lt: nextDate },
    session,
  }).select("class batch");
  const newClassBatches = getUnscheduledClassBatches(classBatches, existing);
  if (!newClassBatches.length) {
    res.status(409);
    throw new Error(`Already scheduled for ${req.body.date} (${session}) for all selected classes and batches`);
  }

  const scheduledClasses = await ScheduledClass.insertMany(newClassBatches.map((pair) => ({
    academyId: requireAcademyId(req),
    ...pair,
    session,
    date,
    createdBy: req.user._id,
  })));
  res.status(201).json({
    success: true,
    data: scheduledClasses,
    skippedExistingCount: classBatches.length - newClassBatches.length,
  });
});

const getScheduledClasses = asyncHandler(async (req, res) => {
  const academyId = requireAcademyId(req);
  const requestedDate = req.query.date ? validateDate(req.query.date) : null;
  if (req.query.date && !requestedDate) {
    res.status(400);
    throw new Error("date must be a valid YYYY-MM-DD date");
  }
  const today = requestedDate || new Date();
  today.setUTCHours(0, 0, 0, 0);
  const studentQuery = { academyId, status: "Active" };
  if (req.user.role !== "admin") studentQuery.assignedTeacher = req.user._id;
  const studentPairs = await Student.find(studentQuery).distinct("class");

  const query = { academyId, class: { $in: studentPairs } };
  if (req.query.period === "upcoming") query.date = { $gte: today };
  if (req.query.period === "history") query.date = { $lt: today };

  const dateSort = req.query.period === "history" ? -1 : 1;
  const scheduledClasses = await ScheduledClass.find(query).sort({ date: dateSort, session: 1 }).limit(500);
  const unmarkedPastClasses = req.query.period === "upcoming"
    ? await ScheduledClass.aggregate([
        { $match: { academyId, class: { $in: studentPairs }, date: { $lt: today } } },
        {
          $lookup: {
            from: Attendance.collection.name,
            let: { scheduleId: "$_id" },
            pipeline: [
              { $match: { $expr: { $eq: ["$scheduledClass", "$$scheduleId"] } } },
              { $match: { academyId } },
              { $limit: 1 },
            ],
            as: "attendanceRecords",
          },
        },
        { $match: { "attendanceRecords.0": { $exists: false } } },
        { $sort: { date: -1, session: 1 } },
        { $limit: 500 },
      ])
    : [];
  const scheduleCandidates = [...scheduledClasses, ...unmarkedPastClasses].sort(
    (a, b) => a.date - b.date || a.session.localeCompare(b.session)
  );
  const eligiblePairs = new Set(
    (await Student.find(studentQuery).select("class batch")).map((student) => `${student.class}\u0000${student.batch || ""}`)
  );
  const visibleClasses = scheduleCandidates.filter((item) => eligiblePairs.has(`${item.class}\u0000${item.batch}`));
  const ids = visibleClasses.map((item) => item._id);
  const attendance = ids.length
    ? await Attendance.aggregate([
        { $match: { academyId, scheduledClass: { $in: ids } } },
        {
          $group: {
            _id: { scheduledClass: "$scheduledClass", status: "$status" },
            count: { $sum: 1 },
            lastMarkedAt: { $max: "$updatedAt" },
          },
        },
      ])
    : [];
  const summaries = new Map();
  const lastMarkedAtByClass = new Map();
  attendance.forEach(({ _id, count, lastMarkedAt }) => {
    const id = _id.scheduledClass.toString();
    const summary = summaries.get(id) || {};
    summary[_id.status] = count;
    summaries.set(id, summary);
    const currentLastMarkedAt = lastMarkedAtByClass.get(id);
    if (!currentLastMarkedAt || lastMarkedAt > currentLastMarkedAt) {
      lastMarkedAtByClass.set(id, lastMarkedAt);
    }
  });
  const classesToReturn = req.query.period === "history"
    ? visibleClasses.filter((item) => isVisibleInAttendanceHistory(lastMarkedAtByClass.get(item._id.toString())))
    : req.query.period === "upcoming"
      ? visibleClasses.filter((item) =>
          isVisibleInUpcomingSchedule(summaries.get(item._id.toString()))
        )
      : visibleClasses;
  const classesWithAttendance = classesToReturn.map((item) => ({
    ...(typeof item.toObject === "function" ? item.toObject() : item),
    attendance: summaries.get(item._id.toString()) || {},
  }));
  const sortedClasses = req.query.period === "upcoming"
    ? sortUpcomingClassesByAttendance(classesWithAttendance)
    : classesWithAttendance;

  res.json({
    success: true,
    data: sortedClasses,
  });
});

const getScheduledClassRoster = asyncHandler(async (req, res) => {
  const { scheduledClass, students } = await getAccessibleSchedule(req, res, req.params.id);
  const attendance = await Attendance.find({
    academyId: requireAcademyId(req),
    scheduledClass: scheduledClass._id,
    student: { $in: students.map((student) => student._id) },
  }).select("student status");
  const statuses = new Map(attendance.map((record) => [record.student.toString(), record.status]));

  res.json({
    success: true,
    data: {
      scheduledClass,
      students: students.map((student) => ({
        ...student.toObject(),
        attendanceStatus: statuses.get(student._id.toString()) || "",
      })),
    },
  });
});

const saveScheduledAttendance = asyncHandler(async (req, res) => {
  const { scheduledClass, students } = await getAccessibleSchedule(req, res, req.params.id);
  const records = req.body.records;
  if (!Array.isArray(records) || records.length === 0) {
    res.status(400);
    throw new Error("records[] is required");
  }

  const allowedIds = new Set(students.map((student) => student._id.toString()));
  const submittedIds = new Set();
  for (const record of records) {
    if (!record || typeof record !== "object") {
      res.status(400);
      throw new Error("Each record must identify a unique assigned student and valid attendance status");
    }
    const studentId = record.studentId?.toString();
    if (
      !studentId ||
      !allowedIds.has(studentId) ||
      submittedIds.has(studentId) ||
      !["Present", "Absent", "Leave"].includes(record.status)
    ) {
      res.status(400);
      throw new Error("Each record must identify a unique assigned student and valid attendance status");
    }
    submittedIds.add(studentId);
  }

  const attendanceRecords = await Promise.all(records.map(({ studentId, status }) =>
    Attendance.findOneAndUpdate(
      {
        academyId: requireAcademyId(req),
        scheduledClass: scheduledClass._id,
        student: studentId,
      },
      {
        academyId: requireAcademyId(req),
        scheduledClass: scheduledClass._id,
        student: studentId,
        class: scheduledClass.class,
        date: scheduledClass.date,
        session: scheduledClass.session,
        status,
        markedBy: req.user._id,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    )
  ));

  Settings.getSingleton(requireAcademyId(req))
    .then(async (settings) => {
      if (!settings.whatsapp.autoNotificationsEnabled || !settings.whatsapp.notificationsEnabled.attendanceAlert) return;
      const absentIds = records.filter((record) => record.status === "Absent").map((record) => record.studentId);
      if (absentIds.length === 0) return;
      const absentStudents = await Student.find({ academyId: requireAcademyId(req), _id: { $in: absentIds } });
      await Promise.all(absentStudents.map((student) =>
        whatsapp.sendAttendanceAlert({ student, date: scheduledClass.date })
      ));
    })
    .catch((error) => console.error("[whatsapp] attendance alert failed:", error.message));

  res.json({ success: true, data: attendanceRecords });
});

const deleteScheduledClass = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    res.status(400);
    throw new Error("Invalid scheduled class ID");
  }

  const academyId = requireAcademyId(req);
  const scheduledClass = await ScheduledClass.findOne({ _id: req.params.id, academyId });
  if (!scheduledClass) {
    res.status(404);
    throw new Error("Scheduled class not found");
  }

  if (req.user.role !== "admin") {
    const assignedStudents = await Student.exists(
      getStudentQuery(req, scheduledClass.class, scheduledClass.batch)
    );
    if (!assignedStudents) {
      res.status(403);
      throw new Error("Access denied: this class is not assigned to you");
    }
  }

  const deletedAttendance = await Attendance.deleteMany({
    academyId,
    scheduledClass: scheduledClass._id,
  });
  await ScheduledClass.deleteOne({ _id: scheduledClass._id, academyId });

  res.json({
    success: true,
    message: "Scheduled class deleted",
    deletedAttendanceCount: deletedAttendance.deletedCount,
  });
});

module.exports = {
  createScheduledClass,
  getScheduledClasses,
  getScheduledClassRoster,
  saveScheduledAttendance,
  deleteScheduledClass,
  isVisibleInAttendanceHistory,
  isVisibleInUpcomingSchedule,
  sortUpcomingClassesByAttendance,
  getUnscheduledClassBatches,
  validateDate,
};
