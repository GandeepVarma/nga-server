const asyncHandler = require("express-async-handler");
const Settings = require("../models/Settings");
const NotificationLog = require("../models/NotificationLog");
const Student = require("../models/Student");
const whatsapp = require("../services/whatsappService");
const { academyFilter, requireAcademyId } = require("../utils/tenant");

const notificationKeys = [
  "feeReminder",
  "attendanceAlert",
  "testAnnouncement",
  "resultNotification",
  "homeworkReminder",
];

// @desc    Get current WhatsApp settings (access token/webhook secret masked)
// @route   GET /api/whatsapp/settings
// @access  Admin
const getSettings = asyncHandler(async (req, res) => {
  const settings = await Settings.getSingleton(requireAcademyId(req), { includeSecrets: true });
  res.json({
    success: true,
    data: {
      phoneNumberId: settings.whatsapp.phoneNumberId,
      businessAccountName: settings.whatsapp.businessAccountName,
      connected: settings.whatsapp.connected,
      lastTestedAt: settings.whatsapp.lastTestedAt,
      lastTestStatus: settings.whatsapp.lastTestStatus,
      autoNotificationsEnabled: settings.whatsapp.autoNotificationsEnabled,
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
  const settings = await Settings.getSingleton(requireAcademyId(req), { includeSecrets: true });
  const {
    phoneNumberId,
    accessToken,
    webhookVerifyToken,
    businessAccountName,
    autoNotificationsEnabled,
    notificationsEnabled,
  } = req.body;
  let credentialsChanged = false;

  if (phoneNumberId !== undefined) {
    if (typeof phoneNumberId !== "string" || phoneNumberId.length > 64 || (phoneNumberId && !/^\d+$/.test(phoneNumberId))) {
      res.status(400);
      throw new Error("phoneNumberId must contain only digits and be at most 64 characters");
    }
    const normalizedPhoneNumberId = phoneNumberId.trim();
    credentialsChanged = credentialsChanged || normalizedPhoneNumberId !== settings.whatsapp.phoneNumberId;
    settings.whatsapp.phoneNumberId = normalizedPhoneNumberId;
  }
  if (businessAccountName !== undefined) {
    if (typeof businessAccountName !== "string" || businessAccountName.length > 120) {
      res.status(400);
      throw new Error("businessAccountName must be a string of at most 120 characters");
    }
    settings.whatsapp.businessAccountName = businessAccountName.trim();
  }
  if (accessToken !== undefined) {
    if (typeof accessToken !== "string" || accessToken.length > 4096 || (accessToken && accessToken.length < 16)) {
      res.status(400);
      throw new Error("accessToken must be a string between 16 and 4096 characters");
    }
    if (accessToken) {
      credentialsChanged = credentialsChanged || accessToken !== settings.whatsapp.accessToken;
      settings.whatsapp.accessToken = accessToken;
    }
  }
  if (webhookVerifyToken !== undefined) {
    if (typeof webhookVerifyToken !== "string" || webhookVerifyToken.length > 256 || (webhookVerifyToken && webhookVerifyToken.length < 16)) {
      res.status(400);
      throw new Error("webhookVerifyToken must be a string between 16 and 256 characters");
    }
    if (webhookVerifyToken) {
      credentialsChanged = credentialsChanged || webhookVerifyToken !== settings.whatsapp.webhookVerifyToken;
      settings.whatsapp.webhookVerifyToken = webhookVerifyToken;
    }
  }
  if (autoNotificationsEnabled !== undefined) {
    if (typeof autoNotificationsEnabled !== "boolean") {
      res.status(400);
      throw new Error("autoNotificationsEnabled must be a boolean");
    }
    settings.whatsapp.autoNotificationsEnabled = autoNotificationsEnabled;
  }
  if (notificationsEnabled !== undefined) {
    if (!notificationsEnabled || typeof notificationsEnabled !== "object" || Array.isArray(notificationsEnabled)) {
      res.status(400);
      throw new Error("notificationsEnabled must be an object of boolean preferences");
    }
    const invalidKeys = Object.keys(notificationsEnabled).filter((key) => !notificationKeys.includes(key));
    if (invalidKeys.length || Object.values(notificationsEnabled).some((value) => typeof value !== "boolean")) {
      res.status(400);
      throw new Error("notificationsEnabled contains an unsupported preference or non-boolean value");
    }
    Object.assign(settings.whatsapp.notificationsEnabled, notificationsEnabled);
  }
  if (credentialsChanged) settings.whatsapp.connected = false;

  await settings.save();
  res.json({ success: true, message: "WhatsApp settings saved" });
});

// @desc    Send a test message to verify the configured credentials work
// @route   POST /api/whatsapp/settings/test
// @body    { to: string }
// @access  Admin
const sendTestMessage = asyncHandler(async (req, res) => {
  const { to } = req.body;
  if (typeof to !== "string" || !/^\+?\d{8,15}$/.test(to.trim())) {
    res.status(400);
    throw new Error("A valid destination WhatsApp number is required");
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
  if (typeof message !== "string" || !message.trim() || message.length > 4096) {
    res.status(400);
    throw new Error("Message text is required and must be at most 4096 characters");
  }
  if (!["all", "class", "students", "pendingFees", "absentToday"].includes(target)) {
    res.status(400);
    throw new Error("Unsupported broadcast target");
  }

  const baseFilter = req.user.role === "admin" ? { academyId: requireAcademyId(req) } : { academyId: requireAcademyId(req), assignedTeacher: req.user._id };
  let recipients = [];

  if (
    target === "students" &&
    Array.isArray(studentIds) &&
    studentIds.length > 0 &&
    studentIds.length <= 500 &&
    studentIds.every((id) => typeof id === "string" && /^[a-f\d]{24}$/i.test(id))
  ) {
    recipients = await Student.find({ ...baseFilter, _id: { $in: studentIds } });
  } else if (target === "students") {
    res.status(400);
    throw new Error("Select between 1 and 500 students using valid student IDs");
  } else if (target === "class" && typeof classFilter === "string" && classFilter.trim() && classFilter.trim().length <= 100) {
    recipients = await Student.find({ ...baseFilter, class: classFilter.trim(), status: "Active" });
  } else if (target === "class") {
    res.status(400);
    throw new Error("A valid class is required for this broadcast");
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
    const now = new Date();
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const tomorrow = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
    const absentIds = await Attendance.find({
      academyId: requireAcademyId(req),
      status: "Absent",
      date: { $gte: startOfDay, $lt: tomorrow },
    }).distinct("student");
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

  const validTypes = ["FEE_REMINDER", "ATTENDANCE_ALERT", "TEST_ANNOUNCEMENT", "RESULT_NOTIFICATION", "HOMEWORK_REMINDER", "BROADCAST", "TEST_MESSAGE"];
  const validStatuses = ["queued", "sent", "delivered", "read", "failed"];
  if (search !== undefined && (typeof search !== "string" || search.length > 100)) {
    res.status(400);
    throw new Error("Search must be a string of at most 100 characters");
  }
  if (type && !validTypes.includes(type)) {
    res.status(400);
    throw new Error("Unsupported notification type");
  }
  if (status && !validStatuses.includes(status)) {
    res.status(400);
    throw new Error("Unsupported notification status");
  }
  if (type) query.type = type;
  if (status) query.status = status;
  if (search) {
    const normalizedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    query.$or = [
      { recipientName: { $regex: normalizedSearch, $options: "i" } },
      { recipientNumber: { $regex: normalizedSearch, $options: "i" } },
    ];
  }
  const requestedPage = Number(page);
  const requestedLimit = Number(limit);
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 1 || requestedPage > 100000) {
    res.status(400);
    throw new Error("page must be an integer between 1 and 100000");
  }
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
    res.status(400);
    throw new Error("limit must be a positive integer");
  }
  const pageNumber = requestedPage;
  const pageSize = Math.min(requestedLimit, 100);

  if (req.user.role !== "admin") {
    const myStudentIds = await Student.find({ academyId: requireAcademyId(req), assignedTeacher: req.user._id }).distinct("_id");
    query.student = { $in: myStudentIds };
  }

  const skip = (pageNumber - 1) * pageSize;
  const [logs, total] = await Promise.all([
    NotificationLog.find(query).populate("student", "name studentId").sort({ createdAt: -1 }).skip(skip).limit(pageSize),
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
    page: pageNumber,
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
  } else if (req.user.role !== "admin" && log.sentBy?.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error("Access denied");
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

module.exports = {
  getSettings,
  updateSettings,
  sendTestMessage,
  sendBroadcastMessage,
  getLogs,
  retryMessage,
  notificationKeys,
};
