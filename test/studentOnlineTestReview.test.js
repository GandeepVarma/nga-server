const test = require("node:test");
const assert = require("node:assert/strict");
const { buildAnswerReview } = require("../controllers/studentOnlineTestController");

test("answer review is returned for completed tests regardless of the legacy review flag", () => {
  const questions = [
    {
      _id: "question-1",
      questionText: "Which number is negative?",
      options: ["5", "0", "-8", "12"],
      correctOption: 2,
      explanation: "Negative numbers are less than zero.",
      marks: 1,
    },
  ];
  const review = buildAnswerReview(
    { allowReview: false, questions },
    { answers: [{ questionId: "question-1", selectedOption: 1 }] }
  );

  assert.equal(review.length, 1);
  assert.equal(review[0].correctOption, 2);
  assert.equal(review[0].selectedOption, 1);
  assert.equal(review[0].explanation, "Negative numbers are less than zero.");
});
