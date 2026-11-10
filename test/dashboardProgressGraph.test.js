const test = require("node:test");
const assert = require("node:assert/strict");
const { buildProgressGraph } = require("../controllers/dashboardController");

test("student progress graph combines legacy and completed online test results chronologically", () => {
  const studentId = "student-1";
  const graph = buildProgressGraph(
    [{
      testName: "Class Test",
      subject: "Math",
      date: new Date("2026-01-02T00:00:00Z"),
      maxMarks: 20,
      marks: [{ student: studentId, marksObtained: 15 }],
    }],
    [{
      test: { title: "Online Quiz", subject: "Science" },
      submittedAt: new Date("2026-01-03T00:00:00Z"),
      percentage: 80,
    }],
    studentId
  );

  assert.deepEqual(
    graph.map(({ testName, percentage }) => ({ testName, percentage })),
    [
      { testName: "Class Test", percentage: 75 },
      { testName: "Online Quiz", percentage: 80 },
    ]
  );
});
