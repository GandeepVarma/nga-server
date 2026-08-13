const express = require("express");
const router = express.Router();
const {
  createTest,
  getTests,
  getTestById,
  updateMarks,
  deleteMark,
  deleteTest,
  compareTests,
  getMyTests,
} = require("../controllers/testController");
const { protect, teacherOnly, studentOnly } = require("../middleware/auth");

router.get("/compare", protect, teacherOnly, compareTests);
router.get("/my", protect, studentOnly, getMyTests);

router.route("/").post(protect, teacherOnly, createTest).get(protect, teacherOnly, getTests);

router.route("/:id").get(protect, teacherOnly, getTestById).delete(protect, teacherOnly, deleteTest);

router.put("/:id/marks", protect, teacherOnly, updateMarks);
router.delete("/:id/marks/:studentId", protect, teacherOnly, deleteMark);

module.exports = router;
