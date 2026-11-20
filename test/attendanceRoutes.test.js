const test = require("node:test");
const assert = require("node:assert/strict");
const attendanceRoutes = require("../routes/attendanceRoutes");

test("student attendance history is student-protected and feature-gated", () => {
  const historyRoute = attendanceRoutes.stack.find(
    (layer) => layer.route?.path === "/my" && layer.route.methods.get
  );

  assert.ok(historyRoute, "student history route should be registered");
  assert.equal(historyRoute.route.stack[0].handle.name, "asyncUtilWrap");
  assert.equal(historyRoute.route.stack[1].handle.name, "studentOnly");
  assert.equal(historyRoute.route.stack.length, 4);
});
