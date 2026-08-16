const cron = require("node-cron");
const Fee = require("../models/Fee");
const Student = require("../models/Student");
const Assignment = require("../models/Assignment");
const OnlineTest = require("../models/OnlineTest");
const Settings = require("../models/Settings");
const whatsapp = require("../services/whatsappService");

// Days offsets (relative to Fee.dueDate) at which reminders are sent, and
// the label used in each reminder's dedupe key so it's only ever sent once.
const FEE_REMINDER_OFFSETS = [
  { days: -3, label: "-3d" },
  { days: -1, label: "-1d" },
  { days: 0, label: "0d" },
  { days: 3, label: "+3d" },
  { days: 7, label: "+7d" },
];

const isSameDay = (a, b) => a.toDateString() === b.toDateString();

// ---------- Fee reminders: runs once a day ----------
const runFeeReminders = async () => {
  const settings = await Settings.getSingleton();
  if (!settings.whatsapp.notificationsEnabled.feeReminder) return;

  const fees = await Fee.find({ dueDate: { $ne: null }, pending: { $gt: 0 } }).populate("student");
  const now = new Date();

  for (const fee of fees) {
    if (!fee.student) continue;
    for (const offset of FEE_REMINDER_OFFSETS) {
      const target = new Date(fee.dueDate);
      target.setDate(target.getDate() + offset.days);
      if (isSameDay(target, now)) {
        await whatsapp.sendFeeReminder({ fee, student: fee.student, offsetLabel: offset.label });
      }
    }
  }
};

// ---------- Homework deadline reminders: 1 day before submissionDate ----------
const runHomeworkReminders = async () => {
  const settings = await Settings.getSingleton();
  if (!settings.whatsapp.notificationsEnabled.homeworkReminder) return;

  const now = new Date();
  const assignments = await Assignment.find({}).populate("assignedStudents.student");

  for (const assignment of assignments) {
    const dueTomorrow = new Date(assignment.submissionDate);
    dueTomorrow.setDate(dueTomorrow.getDate() - 1);
    if (!isSameDay(dueTomorrow, now)) continue;

    for (const entry of assignment.assignedStudents) {
      if (!entry.student || entry.status !== "Pending") continue;
      await whatsapp.sendHomeworkReminder({ student: entry.student, assignment, stage: "reminder" });
    }
  }
};

// ---------- Online test start reminders: 1 hour and 10 minutes before startTime ----------
// Runs every 5 minutes to catch both windows without spamming.
const runTestReminders = async () => {
  const settings = await Settings.getSingleton();
  if (!settings.whatsapp.notificationsEnabled.testAnnouncement) return;

  const now = new Date();
  const windows = [
    { minutesBefore: 60, label: "1h" },
    { minutesBefore: 10, label: "10m" },
  ];

  const tests = await OnlineTest.find({ published: true });

  for (const test of tests) {
    for (const w of windows) {
      const windowStart = new Date(test.startTime.getTime() - (w.minutesBefore + 2.5) * 60000);
      const windowEnd = new Date(test.startTime.getTime() - (w.minutesBefore - 2.5) * 60000);
      if (now < windowStart || now > windowEnd) continue;

      const students = await Student.find({ class: { $in: test.classes }, status: "Active" });
      for (const student of students) {
        await whatsapp.sendTestAnnouncement({ student, test });
      }
    }
  }
};

// Registers all cron jobs. Called once from server.js on startup.
const startScheduledJobs = () => {
  // Every day at 8:00 AM server time
  cron.schedule("0 8 * * *", () => {
    runFeeReminders().catch((err) => console.error("[scheduler] fee reminders failed:", err.message));
    runHomeworkReminders().catch((err) => console.error("[scheduler] homework reminders failed:", err.message));
  });

  // Every 5 minutes, for time-sensitive test start reminders
  cron.schedule("*/5 * * * *", () => {
    runTestReminders().catch((err) => console.error("[scheduler] test reminders failed:", err.message));
  });

  console.log("WhatsApp notification scheduler started (fee/homework daily @ 8am, test reminders every 5min)");
};

module.exports = { startScheduledJobs, runFeeReminders, runHomeworkReminders, runTestReminders };
