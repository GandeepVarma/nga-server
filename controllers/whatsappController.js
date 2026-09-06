const asyncHandler = require("express-async-handler");
const Settings = require("../models/Settings");
const NotificationLog = require("../models/NotificationLog");
const Student = require("../models/Student");
const whatsapp = require("../services/whatsappService");
const { academyFilter, requireAcademyId } = require("../utils/tenant");

// @desc    Get current WhatsApp settings (access token/webhook secret masked)
// @route   GET /api/whatsapp/settings
// @access  Admin
const getSettings = asyncHandler(async (req, res) => {
  const settings = await Settings.getSingleton(requireAcademyId(req));
  res.json({
    success: true,
    data: {
      phoneNumberId: settings.whatsapp.phoneNumberId,
      businessAccountName: settings.whatsapp.businessAccountName,
      connected: settings.whatsapp.connected,
      lastTestedAt: settings.whatsapp.lastTestedAt,
      lastTestStatus: settings.whatsapp.lastTestStatus,
      notificationsEnabled: settings.whatsapp.notificationsEnabled,
      accessTokenSet: !!settings.whatsapp.accessToken,
      webhookVerifyTokenSet: !!settings.whatsapp.webhookVerifyToken,
    },
  });
});

// @desc    Update WhatsApp settings. Secret fields only overwrite when a
//          new non-empty value is provided, so re-saving after getSettings()
//          (which returns masked values) doesn't wipe existing secrets.
// @route   PUT /api/whatsapp/settings
// @access  Admin
const updateSettings = asyncHandler(async (req, res) => {
  const settings = await Settings.getSingleton(requireAcademyId(req));
  const { phoneNumberId, accessToken, webhookVerifyToken, businessAccountName, notificationsEnabled } = req.body;

  if (phoneNumberId !== undefined) settings.whatsapp.phoneNumberId = phoneNumberId;
  if (businessAccountName !== undefined) settings.whatsapp.businessAccountName = businessAccountName;
  if (accessToken) settings.whatsapp.accessToken = accessToken;
  if (webhookVerifyToken) settings.whatsapp.webhookVerifyToken = webhookVerifyToken;
  if (notificationsEnabled) Object.assign(settings.whatsapp.notificationsEnabled, notificationsEnabled);

  await settings.save();
  res.json({ success: true, message: "WhatsApp settings saved" });
});

// @desc    Send a test message to verify the configured credentials work
// @route   POST /api/whatsapp/settings/test
// @body    { to: string }
// @access  Admin
const sendTestMessage = asyncHandler(async (req, res) => {
  const { to } = req.body;
  if (!to) {
    res.status(400);
    throw new Error("A destination WhatsApp number is required");
  }

  const log = await whatsapp.sendTextMessage({
    to,
    name: "Test Recipient",
    message: "This is a test message from DHARA's WhatsApp integration. If you received this, your setup is working correctly.",
    sentBy: req.user._id,
  });

  const settings = await Settings.getSingleton(requireAcademyId(req));
  settings.whatsapp.lastTestedAt = new Date();
  settings.whatsapp.lastTestStatus = log.status === "sent" ? "success" : "failed";
  settings.whatsapp.connected = log.status === "sent";
  await settings.save();

  res.json({ success: log.status === "sent", data: log });
});

// @desc    Broadcast a message to a resolved set of recipients
// @route   POST /api/whatsapp/broadcast
// @body    { target, classFilter?, studentIds?, message }
// @access  Staff (Admin sees all students; Teacher scoped to their own)
const sendBroadcastMessage = asyncHandler(async (req, res) => {
  const { target, classFilter, studentIds, message } = req.body;
  if (!message || !message.trim()) {
    res.status(400);
    throw new Error("Message text is required");
  }

  const baseFilter = req.user.role === "admin" ? { academyId: requireAcademyId(req) } : { academyId: requireAcademyId(req), assignedTeacher: req.user._id };
  let recipients = [];

  if (target === "students" && Array.isArray(studentIds)) {
    recipients = await Student.find({ ...baseFilter, _id: { $in: studentIds } });
  } else if (target === "class" && classFilter) {
    recipients = await Student.find({ ...baseFilter, class: classFilter, status: "Active" });
  } else if (target === "pendingFees") {
    if (req.user.role !== "admin") {
      res.status(403);
      throw new Error("Access denied: fee-based targeting is Admin only");
    }
    const Fee = require("../models/Fee");
    const pendingStudentIds = await Fee.find({ academyId: requireAcademyId(req), pending: { $gt: 0 } }).distinct("student");
    recipients = await Student.find({ academyId: requireAcademyId(req), _id: { $in: pendingStudentIds } });
  } else if (target === "absentToday") {
    const Attendance = require("../models/Attendance");
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const absentIds = await Attendance.find({ academyId: requireAcademyId(req), status: "Absent", date: { $gte: startOfDay } }).distinct("student");
    recipients = await Student.find({ ...baseFilter, _id: { $in: absentIds } });
  } else {
    recipients = await Student.find({ ...baseFilter, status: "Active" });
  }

  if (recipients.length === 0) {
    res.status(400);
    throw new Error("No matching recipients found for this broadcast");
  }

  const result = await whatsapp.sendBroadcast({ recipients, message, sentBy: req.user._id });
  res.json({ success: true, data: result });
});

// @desc    Notification logs with filters, search, pagination, and today's summary
// @route   GET /api/whatsapp/logs?type=&status=&search=&page=&limit=
// @access  Staff (Admin sees all; Teacher sees only logs tied to their own students)
const getLogs = asyncHandler(async (req, res) => {
  const { type, status, search, page = 1, limit = 20 } = req.query;
  const query = { academyId: requireAcademyId(req) };

  if (type) query.type = type;
  if (status) query.status = status;
  if (search) {
    query.$or = [
      { recipientName: { $regex: search, $options: "i" } },
      { recipientNumber: { $regex: search, $options: "i" } },
    ];
  }

  if (req.user.role !== "admin") {
    const myStudentIds = await Student.find({ academyId: requireAcademyId(req), assignedTeacher: req.user._id }).distinct("_id");
    query.student = { $in: myStudentIds };
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [logs, total] = await Promise.all([
    NotificationLog.find(query).populate("student", "name studentId").sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    NotificationLog.countDocuments(query),
  ]);

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const todayQuery = { ...query, createdAt: { $gte: startOfDay } };
  const [sentToday, deliveredToday, readToday, failedToday, pendingToday] = await Promise.all([
    NotificationLog.countDocuments({ ...todayQuery, status: "sent" }),
    NotificationLog.countDocuments({ ...todayQuery, status: "delivered" }),
    NotificationLog.countDocuments({ ...todayQuery, status: "read" }),
    NotificationLog.countDocuments({ ...todayQuery, status: "failed" }),
    NotificationLog.countDocuments({ ...todayQuery, status: "queued" }),
  ]);

  res.json({
    success: true,
    count: logs.length,
    total,
    page: Number(page),
    summary: { sentToday, deliveredToday, readToday, failedToday, pendingToday },
    data: logs,
  });
});

// @desc    Retry a failed message
// @route   POST /api/whatsapp/logs/:id/retry
// @access  Staff (Admin or the teacher whose student it was sent to)
const retryMessage = asyncHandler(async (req, res) => {
  const log = await NotificationLog.findOne(academyFilter(req, { _id: req.params.id }));
  if (!log) {
    res.status(404);
    throw new Error("Log entry not found");
  }
  if (log.status !== "failed") {
    res.status(400);
    throw new Error("Only failed messages can be retried");
  }

  if (req.user.role !== "admin" && log.student) {
    const student = await Student.findOne({ academyId: requireAcademyId(req), _id: log.student, assignedTeacher: req.user._id });
    if (!student) {
      res.status(403);
      throw new Error("Access denied");
    }
  }

  const retryLog = await whatsapp.sendTextMessage({
    to: log.recipientNumber,
    name: log.recipientName,
    message: log.message,
    studentId: log.student,
    sentBy: req.user._id,
  });

  res.json({ success: retryLog.status === "sent", data: retryLog });
});

module.exports = { getSettings, updateSettings, sendTestMessage, sendBroadcastMessage, getLogs, retryMessage };
