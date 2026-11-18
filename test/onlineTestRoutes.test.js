const test = require("node:test");
const assert = require("node:assert/strict");
const onlineTestRoutes = require("../routes/onlineTestRoutes");

test("staff answer-review route is registered before generic test-id routes", () => {
  const routes = onlineTestRoutes.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: layer.route.path,
      methods: layer.route.methods,
    }));

  const reviewRouteIndex = routes.findIndex(
    ({ path, methods }) =>
      path === "/:id/submissions/:studentId/review" && methods.get
  );
  const genericTestRouteIndex = routes.findIndex(
    ({ path, methods }) => path === "/:id" && methods.get
  );

  assert.notEqual(reviewRouteIndex, -1, "review route should be registered");
  assert.notEqual(genericTestRouteIndex, -1, "test detail route should be registered");
  assert.ok(
    reviewRouteIndex < genericTestRouteIndex,
    "specific review route should precede the generic test-id route"
  );
});

test("online-test student workflow remains student-protected and staff creation remains staff-protected", () => {
  const studentStart = onlineTestRoutes.stack.find(
    (layer) => layer.route?.path === "/student/:id/start" && layer.route.methods.post
  );
  const staffCreate = onlineTestRoutes.stack.find(
    (layer) => layer.route?.path === "/" && layer.route.methods.post
  );

  assert.ok(studentStart);
  assert.equal(studentStart.route.stack[0].handle.name, "asyncUtilWrap");
  assert.equal(studentStart.route.stack[1].handle.name, "studentOnly");
  assert.ok(staffCreate);
  assert.equal(staffCreate.route.stack[0].handle.name, "asyncUtilWrap");
  assert.equal(staffCreate.route.stack[1].handle.name, "teacherOnly");
});
