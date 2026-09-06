const mongoose = require("mongoose");

const academySchema = new mongoose.Schema(
  {
    academyId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    academyName: { type: String, required: true, trim: true },
    ownerName: { type: String, required: true, trim: true },
    ownerEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Please enter a valid email"],
    },
    phone: { type: String, required: true, trim: true },
    address: { type: String, default: "" },
    city: { type: String, default: "" },
    state: { type: String, default: "" },
    country: { type: String, default: "" },
    logo: { type: String, default: "" }, // URL — no upload pipeline in Phase 1, paste a link

    // Registration workflow state. Only ACTIVE academies can log in — see
    // middleware/auth.js and authController's login checks. Academies
    // created directly by Super Admin (not via public self-registration)
    // are set straight to ACTIVE, skipping the approval step, matching
    // the spec's "Create Academy" example.
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED", "ACTIVE", "SUSPENDED"],
      default: "ACTIVE",
    },

    // Active plan is stored as a normalized string so the backend can
    // enforce features from the academy's real database state and not from
    // what the frontend happens to send.
    plan: { type: String, enum: ["free", "basic", "standard", "premium"], default: "free" },
    requestedPlan: { type: mongoose.Schema.Types.ObjectId, ref: "Plan", default: null },
    approvedPlan: { type: mongoose.Schema.Types.ObjectId, ref: "Plan", default: null },
    subscriptionStatus: {
      type: String,
      enum: ["pending", "active", "rejected", "suspended", "plan_required"],
      default: "pending",
    },
    featureOverrides: {
      type: Map,
      of: Boolean,
      default: {},
    },
    billingCycle: { type: String, enum: ["monthly", "yearly"], default: "monthly" },

    // Payment is NOT processed in Phase 1 — no gateway is wired up, and
    // offline payment is just captured as a claim + optional proof link
    // for Super Admin to manually verify before approving. Real payment
    // verification, receipts, and revenue tracking are Phase 3.
    paymentMethod: { type: String, enum: ["online", "offline", null], default: null },
    paymentProofUrl: { type: String, default: "" }, // pasted link — no file upload pipeline yet

    // true for the academy that already existed before this SaaS
    // conversion (ACADEMY_001) — lets the UI/README point at it clearly.
    isFounderAcademy: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Academy", academySchema);
