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
const upload = require("../middleware/upload");

router.get("/my", protect, studentOnly, getMyAssignments);

router
  .route("/")
  .post(protect, teacherOnly, upload.array("files", 5), createAssignment)
  .get(protect, getAssignments);

router
  .route("/:id")
  .get(protect, getAssignmentById)
  .delete(protect, teacherOnly, deleteAssignment);

router.put("/:id/status/:studentId", protect, teacherOnly, updateSubmissionStatus);

module.exports = router;
