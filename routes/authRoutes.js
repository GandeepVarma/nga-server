const express = require("express");
const router = express.Router();
const {
  registerTeacher,
  loginTeacher,
  loginStudent,
  getMe,
} = require("../controllers/authController");
const { protect } = require("../middleware/auth");

router.post("/teacher/register", registerTeacher);
router.post("/teacher/login", loginTeacher);
router.post("/student/login", loginStudent);
router.get("/me", protect, getMe);

module.exports = router;
