const express = require("express");
const router = express.Router();
const {
  createTest, getTests, getTestById, updateTest, setPublishStatus,
  duplicateTest, deleteTest, getAnalytics, getSubmissions, exportSubmissionsCSV,
} = require("../controllers/onlineTestController");
const {
  getMyTests, getTestForStudent, startTest, saveProgress, submitTest, getResult,
} = require("../controllers/studentOnlineTestController");
const { protect, teacherOnly, studentOnly } = require("../middleware/auth");

// ---------- Student routes (must come before /:id to avoid route collision) ----------
router.get("/student", protect, studentOnly, getMyTests);
router.get("/student/:id", protect, studentOnly, getTestForStudent);
router.post("/student/:id/start", protect, studentOnly, startTest);
router.post("/student/:id/save", protect, studentOnly, saveProgress);
router.post("/student/:id/submit", protect, studentOnly, submitTest);
router.get("/student/:id/result", protect, studentOnly, getResult);

// ---------- Staff routes (Admin sees/manages all; Teacher scoped to own tests) ----------
router.route("/").post(protect, teacherOnly, createTest).get(protect, teacherOnly, getTests);

router
  .route("/:id")
  .get(protect, teacherOnly, getTestById)
  .put(protect, teacherOnly, updateTest)
  .delete(protect, teacherOnly, deleteTest);

router.post("/:id/publish", protect, teacherOnly, setPublishStatus);
router.post("/:id/duplicate", protect, teacherOnly, duplicateTest);
router.get("/:id/analytics", protect, teacherOnly, getAnalytics);
router.get("/:id/submissions", protect, teacherOnly, getSubmissions);
router.get("/:id/export", protect, teacherOnly, exportSubmissionsCSV);

module.exports = router;
