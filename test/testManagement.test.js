const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getGrade,
  buildMarkResults,
  buildTestStats,
} = require("../controllers/testController");
const { getAssignmentDisplayStatus } = require("../controllers/assignmentController");
const testRoutes = require("../routes/testRoutes");

test("regular test grades use the selected A-F percentage bands", () => {
  assert.deepEqual(
    [89.99, 90, 79.99, 80, 69.99, 70, 59.99, 60].map(getGrade),
    ["B", "A", "C", "B", "D", "C", "F", "D"]
  );
});

test("regular test results show percentages, grades, competition ranks, and no rank for ungraded marks", () => {
  const marks = [
    { student: "first", marksObtained: 9 },
    { student: "second", marksObtained: 9 },
    { student: "third", marksObtained: 8 },
    { student: "awaiting", marksObtained: null },
  ];

  assert.deepEqual(
    buildMarkResults(marks, 10).map(({ percentage, grade, rank }) => ({ percentage, grade, rank })),
    [
      { percentage: 90, grade: "A", rank: 1 },
      { percentage: 90, grade: "A", rank: 1 },
      { percentage: 80, grade: "B", rank: 3 },
      { percentage: null, grade: null, rank: null },
    ]
  );
  assert.deepEqual(buildTestStats(marks), { average: 8.67, highest: 9, lowest: 8, submitted: 3 });
});

test("late assignment status is derived only after the due date and does not change stored status", () => {
  const now = new Date("2026-11-18T12:00:00.000Z");
  assert.equal(getAssignmentDisplayStatus("Pending", "2026-11-17", now), "Late Submission");
  assert.equal(getAssignmentDisplayStatus("Pending", "2026-11-18", now), "Pending");
  assert.equal(getAssignmentDisplayStatus("Completed", "2026-11-17", now), "Completed");
});

test("regular tests expose a staff-protected edit route", () => {
  const editRoute = testRoutes.stack.find(
    (layer) => layer.route?.path === "/:id" && layer.route.methods.put
  );
  assert.ok(editRoute, "PUT /:id should be registered");
  assert.equal(editRoute.route.stack[0].handle.name, "asyncUtilWrap");
  assert.equal(editRoute.route.stack[1].handle.name, "teacherOnly");

  const studentRoute = testRoutes.stack.find(
    (layer) => layer.route?.path === "/my" && layer.route.methods.get
  );
  assert.ok(studentRoute, "GET /my should be registered");
  assert.equal(studentRoute.route.stack[0].handle.name, "asyncUtilWrap");
  assert.equal(studentRoute.route.stack[1].handle.name, "studentOnly");
});
