const express = require("express");
const router = express.Router();
const {
  createStudent,
  getStudents,
  getStudentById,
  updateStudent,
  deleteStudent,
  getStudentFullProfile,
} = require("../controllers/studentController");
const { protect, teacherOnly } = require("../middleware/auth");

// teacherOnly here means "any staff account" (admin or teacher) — the
// controller itself scopes results down to the requester's own students
// for plain teachers. Admin passes through unrestricted.
router.route("/").post(protect, teacherOnly, createStudent).get(protect, teacherOnly, getStudents);

router
  .route("/:id")
  .get(protect, teacherOnly, getStudentById)
  .put(protect, teacherOnly, updateStudent)
  .delete(protect, teacherOnly, deleteStudent);

// Also reachable by the student themself, viewing their own profile
router.get("/:id/profile", protect, getStudentFullProfile);

module.exports = router;
