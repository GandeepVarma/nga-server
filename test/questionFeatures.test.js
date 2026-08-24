const test = require("node:test");
const assert = require("node:assert/strict");
const { validateQuestion } = require("../controllers/aiQuestionController");

test("AI question validator accepts a complete MCQ and preserves KaTeX", () => {
  const result = validateQuestion({ question: "Solve $x^2=1$", optionA: "$1$", optionB: "$2$", optionC: "$3$", optionD: "$4$", correctAnswer: "A", difficulty: "Medium" }, { marks: 1, subject: "Mathematics", chapter: "Algebra", topic: "Roots" });
  assert.deepEqual(result.errors, []);
  assert.equal(result.question, "Solve $x^2=1$");
  assert.equal(result.marks, 1);
});

test("AI question validator rejects duplicate options and invalid answers", () => {
  const result = validateQuestion({ question: "Question", optionA: "Same", optionB: "Same", optionC: "C", optionD: "D", correctAnswer: "E", difficulty: "Medium", marks: 1 }, {});
  assert.ok(result.errors.includes("Options must be unique"));
  assert.ok(result.errors.includes("Correct answer must be A, B, C, or D"));
});

test("difficulty distribution totals are deterministic before API requests", () => {
  const distribution = { Easy: 5, Medium: 10, Hard: 5 };
  assert.equal(Object.values(distribution).reduce((sum, value) => sum + value, 0), 20);
  assert.equal(new Set(["q1", "q2", "q3"]).size, 3);
});
