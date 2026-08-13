const express = require("express");
const router = express.Router();
const { loginTeacher, loginStudent, getMe } = require("../controllers/authController");
const { protect } = require("../middleware/auth");

// NOTE: no public teacher/register route — only Admin can create teachers
// (see /api/admin/teachers, protected by adminOnly).
router.post("/teacher/login", loginTeacher);
router.post("/student/login", loginStudent);
router.get("/me", protect, getMe);

module.exports = router;
