const express = require("express");
const router = express.Router();
const {
  generateMonthlyFees,
  getFees,
  getMyFees,
  recordPayment,
  getFeeSummary,
  sendManualReminder,
} = require("../controllers/feeController");
const { protect, adminOnly, studentOnly } = require("../middleware/auth");

// Per RBAC rules: Teachers have NO access to fee data whatsoever.
// Every route below is Admin-only, except a student viewing their own fees.
router.post("/generate", protect, adminOnly, generateMonthlyFees);
router.get("/summary", protect, adminOnly, getFeeSummary);
router.get("/my", protect, studentOnly, getMyFees);
router.put("/:id/pay", protect, adminOnly, recordPayment);
router.post("/:id/remind", protect, adminOnly, sendManualReminder);
router.get("/", protect, adminOnly, getFees);

module.exports = router;
