const test = require("node:test");
const assert = require("node:assert/strict");
const { PLAN_FEATURES, getFeatureAccessForPlan, hasPlanFeature } = require("../config/planFeatures");

test("plan features are centrally defined and restricted by plan", () => {
  assert.ok(PLAN_FEATURES.free);
  assert.equal(PLAN_FEATURES.free.dashboard, true);
  assert.equal(PLAN_FEATURES.basic.tests, true);
  assert.equal(PLAN_FEATURES.basic.assignments, false);
  assert.equal(PLAN_FEATURES.premium.aiInsights, true);

  assert.equal(getFeatureAccessForPlan("basic").fees, true);
  assert.equal(getFeatureAccessForPlan("basic").assignments, false);
  assert.equal(hasPlanFeature("basic", "fees"), true);
  assert.equal(hasPlanFeature("basic", "assignments"), false);
  assert.equal(hasPlanFeature("premium", "aiInsights"), true);
});
