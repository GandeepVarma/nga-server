const express = require("express");
const router = express.Router();
const {
  generateMonthlyFees,
  getFees,
  getMyFees,
  recordPayment,
  getFeeSummary,
} = require("../controllers/feeController");
const { protect, teacherOnly, studentOnly } = require("../middleware/auth");

router.post("/generate", protect, teacherOnly, generateMonthlyFees);
router.get("/summary", protect, teacherOnly, getFeeSummary);
router.get("/my", protect, studentOnly, getMyFees);
router.put("/:id/pay", protect, teacherOnly, recordPayment);
router.get("/", protect, teacherOnly, getFees);

module.exports = router;
