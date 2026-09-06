const mongoose = require("mongoose");

// Deliberately a single-document collection (findOne / upsert pattern) —
// there's only ever one academy-wide WhatsApp configuration.
//
// SECURITY NOTE: the access token is stored in the database, not just
// .env, so it can be edited from the Settings UI without redeploying.
// It's marked `select: false` so it's never returned in normal queries —
// only the dedicated settings-read endpoint (admin-only) fetches it
// explicitly, and only the backend ever sends it in an API call. For a
// production SaaS handling many academies, this should additionally be
// encrypted at rest (e.g. via a KMS-backed field encryption library) —
// that's flagged in the README as a follow-up rather than implemented here.
const settingsSchema = new mongoose.Schema(
  {
    academyId: { type: mongoose.Schema.Types.ObjectId, ref: "Academy", required: true, unique: true, index: true },
    whatsapp: {
      phoneNumberId: { type: String, default: "" },
      accessToken: { type: String, default: "", select: false },
      webhookVerifyToken: { type: String, default: "", select: false },
      businessAccountName: { type: String, default: "" },
      connected: { type: Boolean, default: false },
      lastTestedAt: { type: Date, default: null },
      lastTestStatus: { type: String, enum: ["success", "failed", null], default: null },
      // Per-notification-type on/off switches
      notificationsEnabled: {
        feeReminder: { type: Boolean, default: true },
        attendanceAlert: { type: Boolean, default: true },
        testAnnouncement: { type: Boolean, default: true },
        resultNotification: { type: Boolean, default: true },
        homeworkReminder: { type: Boolean, default: true },
      },
    },
  },
  { timestamps: true }
);

// Always returns the single settings document, creating it on first use.
settingsSchema.statics.getSingleton = async function (academyId) {
  if (!academyId) throw new Error("academyId is required for settings");
  let doc = await this.findOne({ academyId }).select("+whatsapp.accessToken +whatsapp.webhookVerifyToken");
  if (!doc) doc = await this.create({ academyId });
  return doc;
};

module.exports = mongoose.model("Settings", settingsSchema);
