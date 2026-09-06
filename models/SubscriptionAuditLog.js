const mongoose = require("mongoose");

const subscriptionAuditLogSchema = new mongoose.Schema(
  {
    academyId: { type: mongoose.Schema.Types.ObjectId, ref: "Academy", required: true },
    previousPlan: { type: mongoose.Schema.Types.ObjectId, ref: "Plan", default: null },
    newPlan: { type: mongoose.Schema.Types.ObjectId, ref: "Plan", default: null },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Teacher", required: true },
    reason: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SubscriptionAuditLog", subscriptionAuditLogSchema);