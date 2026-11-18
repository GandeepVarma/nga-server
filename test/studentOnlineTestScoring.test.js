const test = require("node:test");
const assert = require("node:assert/strict");
const { scoreSubmission } = require("../controllers/studentOnlineTestController");

test("student online-test submissions are scored server-side with configured negative marking", () => {
  const testDefinition = {
    negativeMarking: 0.5,
    questions: [
      { _id: "q1", correctOption: 1, marks: 2 },
      { _id: "q2", correctOption: 0, marks: 1 },
      { _id: "q3", correctOption: 3, marks: 1 },
    ],
  };
  const submission = {
    answers: [
      { questionId: "q1", selectedOption: 1 },
      { questionId: "q2", selectedOption: 2 },
      { questionId: "q3", selectedOption: null },
    ],
  };

  assert.deepEqual(scoreSubmission(testDefinition, submission), {
    score: 1.5,
    percentage: 37.5,
    correctCount: 1,
    wrongCount: 1,
    unansweredCount: 1,
  });
});

test("negative online-test scores are floored at zero", () => {
  const testDefinition = {
    negativeMarking: 2,
    questions: [{ _id: "q1", correctOption: 0, marks: 1 }],
  };
  const submission = { answers: [{ questionId: "q1", selectedOption: 1 }] };

  assert.equal(scoreSubmission(testDefinition, submission).score, 0);
});
