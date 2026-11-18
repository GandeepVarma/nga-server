const axios = require("axios");
const Settings = require("../models/Settings");
const NotificationLog = require("../models/NotificationLog");
const Student = require("../models/Student");
const Teacher = require("../models/Teacher");

// ---------------------------------------------------------------------------
// Low-level Meta WhatsApp Cloud API caller.
// Architecture note: this is the ONLY function that actually talks to Meta.
// Every message builder below goes through `dispatch()`, which itself calls
// this. To add a second provider (e.g. Twilio) later, you'd add a
// `sendViaTwilio()` sibling function and branch on a `provider` setting —
// the rest of the module (message builders, logging, dedupe) doesn't change.
// ---------------------------------------------------------------------------
const sendViaMetaCloudAPI = async ({ phoneNumberId, accessToken, to, body }) => {
  const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;
  const res = await axios.post(
    url,
    { messaging_product: "whatsapp", to, type: "text", text: { body } },
    { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } }
  );
  return res.data?.messages?.[0]?.id || null;
};

// Basic validation — WhatsApp Cloud API expects E.164-ish digits, no symbols.
// Normalizes a bare 10-digit Indian number by adding country code 91, to
// match this project's existing student phone field convention.
const normalizePhone = (raw) => {
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
};

// Core dispatch: validates the number, calls Meta, and ALWAYS writes a
// NotificationLog row (sent or failed) so nothing goes unrecorded.
// `dedupeKey`, when provided, skips sending if a log entry with the same
// key already exists — this is what prevents duplicate fee/homework/test
// reminders if a scheduled job or a page action runs more than once.
const dispatch = async ({ to, name, message, type, studentId = null, sentBy = null, dedupeKey = null }) => {
  const student = studentId ? await Student.findById(studentId).select("academyId") : null;
  const sender = sentBy ? await Teacher.findById(sentBy).select("academyId") : null;
  const academyId = student?.academyId || sender?.academyId;
  if (!academyId) throw new Error("Cannot send a tenant notification without academy context");
  if (dedupeKey) {
    const existing = await NotificationLog.findOne({ academyId, dedupeKey });
    if (existing) return existing;
  }

  const normalized = normalizePhone(to);
  if (!normalized) {
    return NotificationLog.create({
      recipientNumber: to || "(missing)",
      academyId,
      recipientName: name,
      student: studentId,
      type,
      message,
      status: "failed",
      errorMessage: "Invalid or missing WhatsApp number",
      dedupeKey,
      sentBy,
    });
  }

  const settings = await Settings.getSingleton(academyId, { includeSecrets: true });
  const { phoneNumberId, accessToken } = settings.whatsapp;

  if (!phoneNumberId || !accessToken) {
    return NotificationLog.create({
      recipientNumber: normalized,
      academyId,
      recipientName: name,
      student: studentId,
      type,
      message,
      status: "failed",
      errorMessage: "WhatsApp is not configured yet — set credentials in Admin > WhatsApp Settings",
      dedupeKey,
      sentBy,
    });
  }

  try {
    const providerMessageId = await sendViaMetaCloudAPI({ phoneNumberId, accessToken, to: normalized, body: message });
    return NotificationLog.create({
      recipientNumber: normalized,
      academyId,
      recipientName: name,
      student: studentId,
      type,
      message,
      status: "sent",
      providerMessageId,
      dedupeKey,
      sentBy,
      sentAt: new Date(),
    });
  } catch (err) {
    const errorMessage = err.response?.data?.error?.message || err.message || "Unknown error sending WhatsApp message";
    return NotificationLog.create({
      recipientNumber: normalized,
      academyId,
      recipientName: name,
      student: studentId,
      type,
      message,
      status: "failed",
      errorMessage,
      dedupeKey,
      sentBy,
    });
  }
};

// ---------------------------------------------------------------------------
// Public API — one function per notification type from the spec.
// ---------------------------------------------------------------------------

const sendTextMessage = ({ to, name, message, studentId = null, sentBy = null }) =>
  dispatch({ to, name, message, type: "TEST_MESSAGE", studentId, sentBy });

// Meta's Cloud API distinguishes free-form "session" messages (only allowed
// within 24h of the user last messaging you) from pre-approved "template"
// messages (allowed anytime, but must be created/approved in Meta Business
// Manager first). This module sends everything as a session-style text
// message for simplicity; swapping to real approved templates later is a
// change inside sendViaMetaCloudAPI once templates exist in Meta's dashboard.
const sendTemplateMessage = sendTextMessage;

const sendFeeReminder = ({ fee, student, offsetLabel }) => {
  const to = student.parentWhatsapp || student.phone;
  const message =
    `Hello ${student.parentName},\n\n` +
    `This is a reminder from *DHARA*.\n\n` +
    `Student: ${student.name}\n` +
    `Class: ${student.class}\n` +
    `Pending Fee: ₹${fee.pending}\n` +
    `Due Date: ${fee.dueDate ? new Date(fee.dueDate).toDateString() : "N/A"}\n\n` +
    `Please make the payment at your earliest convenience.`;

  return dispatch({
    to, name: student.parentName, message, type: "FEE_REMINDER", studentId: student._id,
    dedupeKey: offsetLabel ? `FEE_REMINDER:${fee._id}:${offsetLabel}` : null,
  });
};

const sendAttendanceAlert = ({ student, date }) => {
  const to = student.parentWhatsapp || student.phone;
  const message =
    `Your child *${student.name} (${student.class})* was marked *ABSENT* today (${new Date(date).toDateString()}).\n\n` +
    `If this is unexpected, please contact the class teacher.`;

  return dispatch({
    to, name: student.parentName, message, type: "ATTENDANCE_ALERT", studentId: student._id,
    dedupeKey: `ATTENDANCE_ALERT:${student._id}:${new Date(date).toDateString()}`,
  });
};

const sendTestAnnouncement = ({ student, test }) => {
  const to = student.parentWhatsapp || student.phone;
  const message =
    `A new *${test.subject} ${test.title}* has been assigned.\n\n` +
    `Date: ${new Date(test.startTime).toDateString()}\n` +
    `Time: ${new Date(test.startTime).toLocaleTimeString()}\n` +
    `Duration: ${test.duration} minutes\n\n` +
    `Please complete the test before the deadline.`;

  return dispatch({
    to, name: student.parentName, message, type: "TEST_ANNOUNCEMENT", studentId: student._id,
    dedupeKey: `TEST_ANNOUNCEMENT:${test._id}:${student._id}`,
  });
};

const sendResultNotification = ({ student, subject, score, maxMarks, percentage }) => {
  const to = student.parentWhatsapp || student.phone;
  const message =
    `Test Result\n\n` +
    `Student: ${student.name}\n` +
    `Subject: ${subject}\n` +
    `Score: ${score}/${maxMarks}\n` +
    `Percentage: ${percentage}%\n\n` +
    `Great work. Keep practicing consistently.`;

  return dispatch({ to, name: student.parentName, message, type: "RESULT_NOTIFICATION", studentId: student._id });
};

const sendHomeworkReminder = ({ student, assignment, stage = "assigned" }) => {
  const to = student.parentWhatsapp || student.phone;
  const message =
    `Homework Assigned\n\n` +
    `Subject: ${assignment.title}\n` +
    `Details: ${assignment.description}\n` +
    `Due Date: ${new Date(assignment.submissionDate).toDateString()}\n\n` +
    `Please submit the homework before the deadline.`;

  return dispatch({
    to, name: student.parentName, message, type: "HOMEWORK_REMINDER", studentId: student._id,
    dedupeKey: `HOMEWORK_REMINDER:${assignment._id}:${student._id}:${stage}`,
  });
};

// Broadcast: fires one dispatch() per recipient and returns aggregate counts.
const sendBroadcast = async ({ recipients, message, sentBy }) => {
  const results = await Promise.all(
    recipients.map((student) =>
      dispatch({
        to: student.parentWhatsapp || student.phone,
        name: student.parentName,
        message,
        type: "BROADCAST",
        studentId: student._id,
        sentBy,
      })
    )
  );
  const sent = results.filter((r) => r.status === "sent").length;
  const failed = results.filter((r) => r.status === "failed").length;
  return { total: results.length, sent, failed };
};

module.exports = {
  sendTextMessage,
  sendTemplateMessage,
  sendFeeReminder,
  sendAttendanceAlert,
  sendTestAnnouncement,
  sendResultNotification,
  sendHomeworkReminder,
  sendBroadcast,
  normalizePhone,
};
