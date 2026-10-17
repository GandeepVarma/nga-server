const express = require("express");
const router = express.Router();
const {
  createTeacher,
  getTeachers,
  getMonthlyEarnings,
  updateTeacher,
  setTeacherStatus,
  resetTeacherPassword,
  assignStudents,
  reassignStudent,
  getStudentsAttendanceSummary,
  getStudentAttendanceHistory,
  getAdminDashboard,
} = require("../controllers/adminController");
const { protect, adminOnly } = require("../middleware/auth");

// Every route in this file requires an authenticated Admin.
router.use(protect, adminOnly);

router.get("/dashboard", getAdminDashboard);
router.get("/earnings", getMonthlyEarnings);
router.get("/students/attendance-summary", getStudentsAttendanceSummary);
router.get("/students/:studentId/attendance", getStudentAttendanceHistory);

router.route("/teachers").post(createTeacher).get(getTeachers);
router.put("/teachers/:id", updateTeacher);
router.put("/teachers/:id/status", setTeacherStatus);
router.put("/teachers/:id/reset-password", resetTeacherPassword);

router.put("/students/assign", assignStudents);
router.put("/students/:id/reassign", reassignStudent);

module.exports = router;
