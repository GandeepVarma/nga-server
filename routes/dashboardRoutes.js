const express = require("express");
const router = express.Router();
const { getTeacherDashboard, getStudentDashboard } = require("../controllers/dashboardController");
const { protect, teacherOnly, studentOnly } = require("../middleware/auth");

router.get("/teacher", protect, teacherOnly, getTeacherDashboard);
router.get("/student", protect, studentOnly, getStudentDashboard);

module.exports = router;
