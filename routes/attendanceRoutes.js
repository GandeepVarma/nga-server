const express = require("express");
const router = express.Router();
const {
  markAttendance,
  getAttendance,
  getTodaySummary,
  getAttendancePercentage,
} = require("../controllers/attendanceController");
const { protect, teacherOnly } = require("../middleware/auth");

router.post("/", protect, teacherOnly, markAttendance);
router.get("/today-summary", protect, teacherOnly, getTodaySummary);
router.get("/percentage/:studentId", protect, getAttendancePercentage);
router.get("/", protect, teacherOnly, getAttendance);

module.exports = router;
