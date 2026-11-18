const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PASSWORD_POLICY_MESSAGE,
  getPasswordChangedAt,
  isStrongPassword,
  isTokenIssuedBeforePasswordChange,
} = require("../utils/passwordPolicy");

test("password policy requires eight characters with upper, lower, and numeric characters", () => {
  assert.equal(isStrongPassword("Strong123"), true);
  assert.equal(isStrongPassword("short1A"), false);
  assert.equal(isStrongPassword("lowercase123"), false);
  assert.equal(isStrongPassword("UPPERCASE123"), false);
  assert.equal(isStrongPassword("NoDigitsHere"), false);
  assert.equal(isStrongPassword(null), false);
  assert.match(PASSWORD_POLICY_MESSAGE, /8 characters/);
});

test("password changes invalidate earlier JWT seconds but preserve same-second logins", () => {
  const before = Date.now();
  const changedAt = getPasswordChangedAt();
  const after = Date.now();
  assert.ok(changedAt instanceof Date);
  assert.ok(changedAt.getTime() >= Math.floor(before / 1000) * 1000);
  assert.ok(changedAt.getTime() <= after);
  const changedAtSecond = Math.floor(changedAt.getTime() / 1000);
  assert.equal(isTokenIssuedBeforePasswordChange(changedAtSecond - 1, changedAt), true);
  assert.equal(isTokenIssuedBeforePasswordChange(changedAtSecond, changedAt), false);
});
