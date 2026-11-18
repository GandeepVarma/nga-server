const asyncHandler = require("express-async-handler");
const QuestionBank = require("../models/QuestionBank");

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const academyFilter = (req) => {
  if (!req.user.academyId) {
    const error = new Error("This account is not assigned to an academy");
    error.status = 403;
    throw error;
  }
  const filter = { academyId: req.user.academyId };
  if (req.user.role !== "admin") filter.createdBy = req.user._id;
  return filter;
};

const getQuestionBank = asyncHandler(async (req, res) => {
  const query = academyFilter(req);
  ["class", "subject", "chapter", "topic", "difficulty"].forEach((field) => {
    if (req.query[field]) query[field] = req.query[field];
  });
  if (req.query.search) {
    const search = escapeRegex(String(req.query.search));
    query.$or = [
      { question: { $regex: search, $options: "i" } },
      { subject: { $regex: search, $options: "i" } },
      { chapter: { $regex: search, $options: "i" } },
      { topic: { $regex: search, $options: "i" } },
    ];
  }
  const questions = await QuestionBank.find(query).populate("createdBy", "name").sort({ createdAt: -1 });
  res.json({ success: true, count: questions.length, data: questions });
});

const createQuestion = asyncHandler(async (req, res) => {
  const question = await QuestionBank.create({ ...req.body, academyId: academyFilter(req).academyId, createdBy: req.user._id });
  res.status(201).json({ success: true, data: question });
});

const findQuestion = async (req) => {
  const question = await QuestionBank.findOne({ _id: req.params.id, ...academyFilter(req) });
  if (!question) {
    const error = new Error("Question not found");
    error.status = 404;
    throw error;
  }
  return question;
};

const updateQuestion = asyncHandler(async (req, res) => {
  const question = await findQuestion(req);
  Object.keys(req.body).filter((field) => field !== "academyId" && field !== "createdBy").forEach((field) => { question[field] = req.body[field]; });
  await question.save();
  res.json({ success: true, data: question });
});

const deleteQuestion = asyncHandler(async (req, res) => {
  const question = await findQuestion(req);
  await question.deleteOne();
  res.json({ success: true, message: "Question deleted" });
});

const getRandomQuestions = asyncHandler(async (req, res) => {
  const query = academyFilter(req);
  ["class", "subject", "chapter", "topic", "difficulty"].forEach((field) => {
    if (req.query[field] && req.query[field] !== "All") query[field] = req.query[field];
  });
  const count = Math.max(1, Number(req.query.count || 1));
  const questions = await QuestionBank.aggregate([{ $match: query }, { $sample: { size: count } }]);
  if (questions.length < count) {
    res.status(400);
    throw new Error(`Only ${questions.length} matching questions are available. You requested ${count}. Please reduce the number or change the filters.`);
  }
  res.json({ success: true, count: questions.length, data: questions });
});

module.exports = { getQuestionBank, createQuestion, updateQuestion, deleteQuestion, getRandomQuestions };
