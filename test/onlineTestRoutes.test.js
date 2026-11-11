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
