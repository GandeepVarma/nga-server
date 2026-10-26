const express = require("express");
const router = express.Router();
const {
  markAttendance,
  getAttendance,
  getTodaySummary,
  getAttendancePercentage,
  getLowAttendanceStudents,
} = require("../controllers/attendanceController");
const {
  createScheduledClass,
  getScheduledClasses,
  getScheduledClassRoster,
  saveScheduledAttendance,
} = require("../controllers/scheduledClassController");
const { protect, teacherOnly } = require("../middleware/auth");
const { requireFeature } = require("../middleware/featureAccess");

router.post("/", protect, teacherOnly, requireFeature("attendance"), markAttendance);
router.get("/today-summary", protect, teacherOnly, requireFeature("attendance"), getTodaySummary);
router.get("/low-attendance", protect, teacherOnly, requireFeature("attendance"), getLowAttendanceStudents);
router.get("/percentage/:studentId", protect, requireFeature("attendance"), getAttendancePercentage);
router.post("/sessions", protect, teacherOnly, requireFeature("attendance"), createScheduledClass);
router.get("/sessions", protect, teacherOnly, requireFeature("attendance"), getScheduledClasses);
router.get("/sessions/:id", protect, teacherOnly, requireFeature("attendance"), getScheduledClassRoster);
router.put("/sessions/:id/attendance", protect, teacherOnly, requireFeature("attendance"), saveScheduledAttendance);
router.get("/", protect, teacherOnly, requireFeature("attendance"), getAttendance);

module.exports = router;
