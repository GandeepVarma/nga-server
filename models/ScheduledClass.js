const mongoose = require("mongoose");

const scheduledClassSchema = new mongoose.Schema(
  {
    academyId: { type: mongoose.Schema.Types.ObjectId, ref: "Academy", required: true, index: true },
    class: { type: String, required: true, trim: true },
    batch: { type: String, required: true, trim: true, default: "" },
    session: { type: String, enum: ["morning", "evening"], required: true },
    date: { type: Date, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Teacher", required: true },
  },
  { timestamps: true }
);

scheduledClassSchema.index(
  { academyId: 1, class: 1, batch: 1, session: 1, date: 1 },
  { unique: true }
);

module.exports = mongoose.model("ScheduledClass", scheduledClassSchema);
