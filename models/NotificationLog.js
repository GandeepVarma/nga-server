const mongoose = require("mongoose");

const notificationLogSchema = new mongoose.Schema(
  {
    recipientNumber: { type: String, required: true },
    recipientName: { type: String, default: "" },
    student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", default: null },
    type: {
      type: String,
      enum: [
        "FEE_REMINDER",
        "ATTENDANCE_ALERT",
        "TEST_ANNOUNCEMENT",
        "RESULT_NOTIFICATION",
        "HOMEWORK_REMINDER",
        "BROADCAST",
        "TEST_MESSAGE",
      ],
      required: true,
    },
    message: { type: String, required: true },
    status: {
      type: String,
      enum: ["queued", "sent", "delivered", "read", "failed"],
      default: "queued",
    },
    providerMessageId: { type: String, default: null },
    errorMessage: { type: String, default: null },
    // Used to prevent duplicate reminders — e.g. "FEE_REMINDER:<feeId>:-3d"
    dedupeKey: { type: String, default: null, index: true },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: "Teacher", default: null }, // null = automated job
    sentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

notificationLogSchema.index({ type: 1, createdAt: -1 });

module.exports = mongoose.model("NotificationLog", notificationLogSchema);
