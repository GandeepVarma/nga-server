const express = require("express");
const router = express.Router();
const { protect, teacherOnly } = require("../middleware/auth");
const { generateQuestions } = require("../controllers/aiQuestionController");

router.post("/generate", protect, teacherOnly, generateQuestions);
module.exports = router;
