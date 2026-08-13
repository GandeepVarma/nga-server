const express = require("express");
const router = express.Router();
const { getTeacherDashboard, getStudentDashboard } = require("../controllers/dashboardController");
const { protect, authorizeRoles, studentOnly } = require("../middleware/auth");

// Admin has its own richer dashboard at /api/admin/dashboard.
// This teacher dashboard is scoped to "teacher" role specifically.
router.get("/teacher", protect, authorizeRoles("teacher"), getTeacherDashboard);
router.get("/student", protect, studentOnly, getStudentDashboard);

module.exports = router;
