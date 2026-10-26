const mongoose = require("mongoose");

const attendanceSchema = new mongoose.Schema(
  {
    academyId: { type: mongoose.Schema.Types.ObjectId, ref: "Academy", required: true, index: true },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
    },
    class: {
      type: String,
      required: true,
    },
    scheduledClass: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ScheduledClass",
      index: true,
    },
    session: {
      type: String,
      enum: ["morning", "evening"],
    },
    date: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ["Present", "Absent", "Leave"],
      required: true,
    },
    markedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Teacher",
    },
  },
  { timestamps: true }
);

attendanceSchema.index({ academyId: 1, student: 1, date: 1 });
attendanceSchema.index({ academyId: 1, date: 1, student: 1 });
attendanceSchema.index(
  { scheduledClass: 1, student: 1 },
  {
    unique: true,
    partialFilterExpression: { scheduledClass: { $type: "objectId" } },
  }
);

module.exports = mongoose.model("Attendance", attendanceSchema);
