const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Attendance = require("../models/Attendance");
const ScheduledClass = require("../models/ScheduledClass");
const Student = require("../models/Student");
const Settings = require("../models/Settings");
const whatsapp = require("../services/whatsappService");
const { requireAcademyId } = require("../utils/tenant");

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

const localDateString = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const createScheduledClass = asyncHandler(async (req, res) => {
  const { class: className, batch, session, allClasses, allBatches } = req.body;
  const date = validateDate(req.body.date);
  const today = localDateString(new Date());

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
  if (req.body.date < today) {
    res.status(400);
    throw new Error("Classes cannot be scheduled for a past date");
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
  const existing = await ScheduledClass.find({
    academyId: requireAcademyId(req),
    class: { $in: classNames },
    date,
    session,
  }).select("class batch");
  const existingPairs = new Set(existing.map((item) => `${item.class}\u0000${item.batch}`));
  const conflicts = classBatches.filter((pair) => existingPairs.has(`${pair.class}\u0000${pair.batch}`));
  if (conflicts.length) {
    res.status(409);
    throw new Error(`Already scheduled for ${conflicts.map((pair) => `${pair.class} · ${pair.batch || "No batch"}`).join(", ")}`);
  }

  const scheduledClasses = await ScheduledClass.insertMany(classBatches.map((pair) => ({
    academyId: requireAcademyId(req),
    ...pair,
    session,
    date,
    createdBy: req.user._id,
  })));
  res.status(201).json({ success: true, data: scheduledClasses });
});

const getScheduledClasses = asyncHandler(async (req, res) => {
  const academyId = requireAcademyId(req);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const studentQuery = { academyId, status: "Active" };
  if (req.user.role !== "admin") studentQuery.assignedTeacher = req.user._id;
  const studentPairs = await Student.find(studentQuery).distinct("class");

  const query = { academyId, class: { $in: studentPairs } };
  if (req.query.period === "upcoming") query.date = { $gte: today };
  if (req.query.period === "history") query.date = { $lt: today };

  const dateSort = req.query.period === "history" ? -1 : 1;
  const scheduledClasses = await ScheduledClass.find(query).sort({ date: dateSort, session: 1 }).limit(500);
  const eligiblePairs = new Set(
    (await Student.find(studentQuery).select("class batch")).map((student) => `${student.class}\u0000${student.batch || ""}`)
  );
  const visibleClasses = scheduledClasses.filter((item) => eligiblePairs.has(`${item.class}\u0000${item.batch}`));
  const ids = visibleClasses.map((item) => item._id);
  const attendance = ids.length
    ? await Attendance.aggregate([
        { $match: { academyId, scheduledClass: { $in: ids } } },
        { $group: { _id: { scheduledClass: "$scheduledClass", status: "$status" }, count: { $sum: 1 } } },
      ])
    : [];
  const summaries = new Map();
  attendance.forEach(({ _id, count }) => {
    if (!summaries.has(_id.scheduledClass.toString())) summaries.set(_id.scheduledClass.toString(), {});
    summaries.get(_id.scheduledClass.toString())[_id.status] = count;
  });

  res.json({
    success: true,
    data: visibleClasses.map((item) => ({
      ...item.toObject(),
      attendance: summaries.get(item._id.toString()) || {},
    })),
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

module.exports = {
  createScheduledClass,
  getScheduledClasses,
  getScheduledClassRoster,
  saveScheduledAttendance,
};
