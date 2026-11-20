const express = require("express");
const router = express.Router();
const {
  markAttendance,
  getAttendance,
  getMyAttendance,
  getTodaySummary,
  getAttendancePercentage,
  getLowAttendanceStudents,
} = require("../controllers/attendanceController");
const {
  createScheduledClass,
  getScheduledClasses,
  getScheduledClassRoster,
  saveScheduledAttendance,
  deleteScheduledClass,
} = require("../controllers/scheduledClassController");
const { protect, teacherOnly, studentOnly } = require("../middleware/auth");
const { requireFeature } = require("../middleware/featureAccess");

router.post("/", protect, teacherOnly, requireFeature("attendance"), markAttendance);
router.get("/my", protect, studentOnly, requireFeature("attendance"), getMyAttendance);
router.get("/today-summary", protect, teacherOnly, requireFeature("attendance"), getTodaySummary);
router.get("/low-attendance", protect, teacherOnly, requireFeature("attendance"), getLowAttendanceStudents);
router.get("/percentage/:studentId", protect, requireFeature("attendance"), getAttendancePercentage);
router.post("/sessions", protect, teacherOnly, requireFeature("attendance"), createScheduledClass);
router.get("/sessions", protect, teacherOnly, requireFeature("attendance"), getScheduledClasses);
router.get("/sessions/:id", protect, teacherOnly, requireFeature("attendance"), getScheduledClassRoster);
router.put("/sessions/:id/attendance", protect, teacherOnly, requireFeature("attendance"), saveScheduledAttendance);
router.delete("/sessions/:id", protect, teacherOnly, requireFeature("attendance"), deleteScheduledClass);
router.get("/", protect, teacherOnly, requireFeature("attendance"), getAttendance);

module.exports = router;
