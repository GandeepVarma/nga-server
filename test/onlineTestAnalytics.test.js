const test = require("node:test");
const assert = require("node:assert/strict");
const { buildStudentProgress } = require("../controllers/onlineTestController");

test("analytics lists student names and completed, in-progress, and not-started statuses", () => {
  const students = [
    { _id: "completed", name: "Ada", studentId: "S001", class: "10" },
    { _id: "in-progress", name: "Grace", studentId: "S002", class: "10" },
    { _id: "not-started", name: "Katherine", studentId: "S003", class: "10" },
  ];
  const submissions = [
    { student: { _id: "completed" }, submittedAt: new Date(), percentage: 90 },
    { student: { _id: "in-progress" }, submittedAt: null, percentage: null },
  ];

  assert.deepEqual(
    buildStudentProgress(students, submissions).map(({ name, status }) => ({ name, status })),
    [
      { name: "Ada", status: "Completed" },
      { name: "Grace", status: "In Progress" },
      { name: "Katherine", status: "Not Started" },
    ]
  );
});
