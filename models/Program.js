const mongoose = require("mongoose");

const programSchema = new mongoose.Schema(
  {
    academyId: { type: mongoose.Schema.Types.ObjectId, ref: "Academy", required: true, index: true },
    name: { type: String, required: true, trim: true },
    level: { type: String, default: "", trim: true },
    badge: { type: String, default: "Program", trim: true },
    description: { type: String, required: true, trim: true },
    features: { type: [String], default: [] },
    imageUrl: { type: String, default: "" },
    monthlyFee: { type: Number, default: null },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

programSchema.index({ academyId: 1, sortOrder: 1, createdAt: 1 });

module.exports = mongoose.model("Program", programSchema);
