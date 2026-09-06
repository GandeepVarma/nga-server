const express = require("express");
const router = express.Router();
const {
  createAssignment,
  getAssignments,
  getAssignmentById,
  updateSubmissionStatus,
  deleteAssignment,
  getMyAssignments,
} = require("../controllers/assignmentController");
const { protect, teacherOnly, studentOnly } = require("../middleware/auth");
const { requireFeature } = require("../middleware/featureAccess");
const upload = require("../middleware/upload");

router.get("/my", protect, studentOnly, requireFeature("assignments"), getMyAssignments);

router
  .route("/")
  .post(protect, teacherOnly, requireFeature("assignments"), upload.array("files", 5), createAssignment)
  .get(protect, teacherOnly, requireFeature("assignments"), getAssignments);

router
  .route("/:id")
  .get(protect, teacherOnly, requireFeature("assignments"), getAssignmentById)
  .delete(protect, teacherOnly, requireFeature("assignments"), deleteAssignment);

router.put("/:id/status/:studentId", protect, teacherOnly, requireFeature("assignments"), updateSubmissionStatus);

module.exports = router;
