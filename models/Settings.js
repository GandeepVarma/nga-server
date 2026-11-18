const mongoose = require("mongoose");

// Deliberately a single-document collection (findOne / upsert pattern) —
// there's only ever one academy-wide WhatsApp configuration.
//
// SECURITY NOTE: the access token is stored in the database, not just
// .env, so it can be edited from the Settings UI without redeploying.
// It's marked `select: false` so it's never returned in normal queries —
// only the dedicated settings-read endpoint (admin-only) fetches it
// explicitly by settings administration and the WhatsApp sender; it is never
// included in API responses. For a
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
      autoNotificationsEnabled: { type: Boolean, default: true },
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
settingsSchema.statics.getSingleton = async function (academyId, { includeSecrets = false } = {}) {
  if (!academyId) throw new Error("academyId is required for settings");
  let query = this.findOne({ academyId });
  if (includeSecrets) {
    query = query.select("+whatsapp.accessToken +whatsapp.webhookVerifyToken");
  }
  let doc = await query;
  if (!doc) doc = await this.create({ academyId });
  return doc;
};

module.exports = mongoose.model("Settings", settingsSchema);
