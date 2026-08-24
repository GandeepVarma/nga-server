const express = require("express");
const router = express.Router();
const { protect, teacherOnly } = require("../middleware/auth");
const { getQuestionBank, createQuestion, updateQuestion, deleteQuestion, getRandomQuestions } = require("../controllers/questionBankController");

router.use(protect, teacherOnly);
router.get("/random", getRandomQuestions);
router.route("/").get(getQuestionBank).post(createQuestion);
router.route("/:id").put(updateQuestion).delete(deleteQuestion);

module.exports = router;
