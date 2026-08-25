const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    academyId: { type: mongoose.Schema.Types.ObjectId, ref: "Academy", required: true, index: true },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
    },
    type: {
      type: String,
      enum: [
        "MARKS_UPLOADED",
        "TEST_SCHEDULED",
        "ASSIGNMENT_UPLOADED",
        "FEE_DUE_REMINDER",
        "PAYMENT_SUCCESSFUL",
        "GENERAL",
      ],
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    relatedId: {
      // Optional reference to the Test/Assignment/Fee document that triggered this
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Notification", notificationSchema);
