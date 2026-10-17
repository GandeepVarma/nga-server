const express = require("express");
const router = express.Router();
const {
  generateMonthlyFees,
  getFees,
  getMyFees,
  recordPayment,
  undoPayment,
  deleteFee,
  getFeeSummary,
  sendManualReminder,
} = require("../controllers/feeController");
const { protect, adminOnly, studentOnly } = require("../middleware/auth");
const { requireFeature } = require("../middleware/featureAccess");

// Per RBAC rules: Teachers have NO access to fee data whatsoever.
// Every route below is Admin-only, except a student viewing their own fees.
router.post("/generate", protect, adminOnly, requireFeature("fees"), generateMonthlyFees);
router.get("/summary", protect, adminOnly, requireFeature("fees"), getFeeSummary);
router.get("/my", protect, studentOnly, requireFeature("fees"), getMyFees);
router.put("/:id/pay", protect, adminOnly, requireFeature("fees"), recordPayment);
router.put("/:id/undo-payment", protect, adminOnly, requireFeature("fees"), undoPayment);
router.post("/:id/remind", protect, adminOnly, requireFeature("fees"), sendManualReminder);
router.delete("/:id", protect, adminOnly, requireFeature("fees"), deleteFee);
router.get("/", protect, adminOnly, requireFeature("fees"), getFees);

module.exports = router;
