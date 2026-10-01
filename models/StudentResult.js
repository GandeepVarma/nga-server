const mongoose = require("mongoose");

const studentResultSchema = new mongoose.Schema(
  {
    academyId: { type: mongoose.Schema.Types.ObjectId, ref: "Academy", required: true, index: true },
    studentName: { type: String, default: "", trim: true },
    programName: { type: String, required: true, trim: true },
    marksBefore: { type: String, required: true, trim: true },
    marksAfter: { type: String, required: true, trim: true },
    beforePhotoUrl: { type: String, default: "" },
    afterPhotoUrl: { type: String, default: "" },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

studentResultSchema.index({ academyId: 1, sortOrder: 1, createdAt: -1 });

module.exports = mongoose.model("StudentResult", studentResultSchema);