const express = require("express");
const router = express.Router();
const {
  markAttendance,
  getAttendance,
  getTodaySummary,
  getAttendancePercentage,
  getLowAttendanceStudents,
} = require("../controllers/attendanceController");
const { protect, teacherOnly } = require("../middleware/auth");
const { requireFeature } = require("../middleware/featureAccess");

router.post("/", protect, teacherOnly, requireFeature("attendance"), markAttendance);
router.get("/today-summary", protect, teacherOnly, requireFeature("attendance"), getTodaySummary);
router.get("/low-attendance", protect, teacherOnly, requireFeature("attendance"), getLowAttendanceStudents);
router.get("/percentage/:studentId", protect, requireFeature("attendance"), getAttendancePercentage);
router.get("/", protect, teacherOnly, requireFeature("attendance"), getAttendance);

module.exports = router;
