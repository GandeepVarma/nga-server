const express = require("express");
const router = express.Router();
const { loginTeacher, loginSuperAdmin, loginStudent, getMe, getFeatureAccess, changePassword } = require("../controllers/authController");
const { protect } = require("../middleware/auth");
const { requireFeature } = require("../middleware/featureAccess");

// NOTE: no public teacher/register route — only Admin can create teachers,
// and only Super Admin can create Academy Admins (see /api/admin/teachers
// and /api/super-admin/academies, both role-protected).
router.post("/teacher/login", loginTeacher);
router.post("/super-admin/login", loginSuperAdmin); // deliberately separate from teacher/login
router.post("/student/login", loginStudent);
router.get("/me", protect, getMe);
router.get("/feature-access", protect, getFeatureAccess);
router.get("/feature-access/:feature", protect, requireFeature("dashboard"), getFeatureAccess);
router.put("/change-password", protect, changePassword);

module.exports = router;
