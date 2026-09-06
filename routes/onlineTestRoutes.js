const express = require("express");
const router = express.Router();
const {
  createTest, getTests, getTestById, updateTest, setPublishStatus,
  duplicateTest, deleteTest, getAnalytics, getSubmissions, exportSubmissionsCSV,
  getAssignmentOptions,
} = require("../controllers/onlineTestController");
const {
  getMyTests, getTestForStudent, startTest, saveProgress, submitTest, getResult,
} = require("../controllers/studentOnlineTestController");
const { protect, teacherOnly, studentOnly } = require("../middleware/auth");
const { requireFeature } = require("../middleware/featureAccess");

// ---------- Student routes (must come before /:id to avoid route collision) ----------
router.get("/student", protect, studentOnly, requireFeature("tests"), getMyTests);
router.get("/student/:id", protect, studentOnly, requireFeature("tests"), getTestForStudent);
router.post("/student/:id/start", protect, studentOnly, requireFeature("tests"), startTest);
router.post("/student/:id/save", protect, studentOnly, requireFeature("tests"), saveProgress);
router.post("/student/:id/submit", protect, studentOnly, requireFeature("tests"), submitTest);
router.get("/student/:id/result", protect, studentOnly, requireFeature("tests"), getResult);

router.get("/assignment-options", protect, teacherOnly, requireFeature("assignments"), getAssignmentOptions);

// ---------- Staff routes (Admin sees/manages all; Teacher scoped to own tests) ----------
router.route("/").post(protect, teacherOnly, requireFeature("tests"), createTest).get(protect, teacherOnly, requireFeature("tests"), getTests);

router
  .route("/:id")
  .get(protect, teacherOnly, requireFeature("tests"), getTestById)
  .put(protect, teacherOnly, requireFeature("tests"), updateTest)
  .delete(protect, teacherOnly, requireFeature("tests"), deleteTest);

router.post("/:id/publish", protect, teacherOnly, requireFeature("tests"), setPublishStatus);
router.post("/:id/duplicate", protect, teacherOnly, requireFeature("tests"), duplicateTest);
router.get("/:id/analytics", protect, teacherOnly, requireFeature("analytics"), getAnalytics);
router.get("/:id/submissions", protect, teacherOnly, requireFeature("tests"), getSubmissions);
router.get("/:id/export", protect, teacherOnly, requireFeature("tests"), exportSubmissionsCSV);

module.exports = router;
