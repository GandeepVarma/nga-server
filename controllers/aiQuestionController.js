const asyncHandler = require("express-async-handler");
const axios = require("axios");

const validateQuestion = (question, defaults) => {
  const options = [question.optionA, question.optionB, question.optionC, question.optionD].map((value) => String(value || "").trim());
  const marks = Number(question.marks ?? defaults.marks ?? 1);
  const errors = [];
  if (!String(question.question || "").trim()) errors.push("Question is empty");
  if (options.some((value) => !value)) errors.push("All four options are required");
  if (new Set(options.map((value) => value.toLowerCase())).size !== 4) errors.push("Options must be unique");
  if (!["A", "B", "C", "D"].includes(question.correctAnswer)) errors.push("Correct answer must be A, B, C, or D");
  if (!Number.isFinite(marks) || marks < 0.5) errors.push("Marks must be at least 0.5");
  if (!["Easy", "Medium", "Hard"].includes(question.difficulty)) errors.push("Invalid difficulty");
  return { ...question, ...defaults, marks, options, errors };
};

const generateQuestions = asyncHandler(async (req, res) => {
  const { class: className, subject, chapter, topic, count = 5, difficulty = "Medium", questionType = "MCQ", marks = 1 } = req.body;
  if (!process.env.OPENAI_API_KEY) {
    res.status(503);
    throw new Error("AI generation is not configured. Set OPENAI_API_KEY on the server.");
  }
  const amount = Math.min(Math.max(Number(count), 1), 50);
  const prompt = `Generate exactly ${amount} ${difficulty} ${questionType} questions for class ${className || "unspecified"}, subject ${subject || "unspecified"}, chapter ${chapter || "unspecified"}, topic ${topic || "unspecified"}. Return ONLY a JSON array. Each item must have question, optionA, optionB, optionC, optionD, correctAnswer (A/B/C/D), explanation, difficulty, subject, chapter, topic, and marks. Preserve mathematical notation using KaTeX delimiters such as $\\frac{1}{2}$ and $\\sin^2\\theta$. Never include markdown fences.`;
  const response = await axios.post(process.env.OPENAI_API_URL || "https://api.openai.com/v1/chat/completions", { model: process.env.OPENAI_MODEL || "gpt-4o-mini", temperature: 0.3, messages: [{ role: "system", content: "You create careful educational MCQs. Output valid JSON only." }, { role: "user", content: prompt }] }, { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } });
  let parsed;
  try { parsed = JSON.parse(response.data.choices[0].message.content.replace(/^```json\s*|\s*```$/g, "")); } catch (error) { res.status(502); throw new Error("AI returned invalid JSON; no questions were saved"); }
  const defaults = { difficulty, subject: subject || "", chapter: chapter || "", topic: topic || "", marks: Number(marks) };
  const questions = parsed.map((question) => validateQuestion(question, defaults));
  if (questions.some((question) => question.errors.length)) { res.status(502); throw new Error("AI returned one or more invalid questions; no questions were saved"); }
  res.json({ success: true, count: questions.length, data: questions });
});

module.exports = { generateQuestions, validateQuestion };
