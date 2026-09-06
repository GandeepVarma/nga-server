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
const { requireFeature } = require("../middleware/featureAccess");

router.get("/compare", protect, teacherOnly, requireFeature("tests"), compareTests);
router.get("/my", protect, studentOnly, requireFeature("tests"), getMyTests);

router.route("/").post(protect, teacherOnly, requireFeature("tests"), createTest).get(protect, teacherOnly, requireFeature("tests"), getTests);

router.route("/:id").get(protect, teacherOnly, requireFeature("tests"), getTestById).delete(protect, teacherOnly, requireFeature("tests"), deleteTest);

router.put("/:id/marks", protect, teacherOnly, requireFeature("tests"), updateMarks);
router.delete("/:id/marks/:studentId", protect, teacherOnly, requireFeature("tests"), deleteMark);

module.exports = router;
