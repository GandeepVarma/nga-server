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

router
  .route("/")
  .post(protect, teacherOnly, createStudent)
  .get(protect, teacherOnly, getStudents);

router
  .route("/:id")
  .get(protect, getStudentById)
  .put(protect, teacherOnly, updateStudent)
  .delete(protect, teacherOnly, deleteStudent);

router.get("/:id/profile", protect, getStudentFullProfile);

module.exports = router;
