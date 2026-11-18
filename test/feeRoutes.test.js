const test = require("node:test");
const assert = require("node:assert/strict");
const feeRoutes = require("../routes/feeRoutes");
const { protect, adminOnly } = require("../middleware/auth");

const findRoute = (path, method) => feeRoutes.stack
  .filter((layer) => layer.route)
  .find((layer) => layer.route.path === path && layer.route.methods[method]);

test("payment, history, and receipt routes require authenticated admin access", () => {
  [
    ["/:id/pay", "put"],
    ["/:id/payments", "get"],
    ["/:id/receipts/:paymentId", "get"],
  ].forEach(([path, method]) => {
    const route = findRoute(path, method);
    assert.ok(route, `${method.toUpperCase()} ${path} should be registered`);
    const handlers = route.route.stack.map((layer) => layer.handle);
    assert.ok(handlers.includes(protect), `${path} should require authentication`);
    assert.ok(handlers.includes(adminOnly), `${path} should require admin role`);
    assert.ok(handlers.length >= 3, `${path} should also enforce the fees feature`);
  });
});
