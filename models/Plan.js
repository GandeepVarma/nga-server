const mongoose = require("mongoose");

const planSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true }, // e.g. "Basic", "Standard", "Premium"
    priceMonthly: { type: Number, required: true, min: 0 },
    priceYearly: { type: Number, required: true, min: 0 },
    studentLimit: { type: Number, default: null }, // null = unlimited
    teacherLimit: { type: Number, default: null },
    features: { type: [String], default: [] },
    // Whether the plan is currently offered on the public Pricing page.
    // Retiring a plan sets this false rather than deleting it, so
    // academies already on it keep their historical reference intact.
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 }, // controls left-to-right order on the Pricing page
  },
  { timestamps: true }
);

module.exports = mongoose.model("Plan", planSchema);
