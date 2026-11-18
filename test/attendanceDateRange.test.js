const test = require("node:test");
const assert = require("node:assert/strict");
const { parseAttendanceDateRange } = require("../controllers/attendanceController");

test("attendance date ranges use inclusive UTC calendar dates", () => {
  assert.deepEqual(
    parseAttendanceDateRange("2026-03-08", "2026-03-08"),
    {
      $gte: new Date("2026-03-08T00:00:00.000Z"),
      $lt: new Date("2026-03-09T00:00:00.000Z"),
    }
  );
});

test("attendance date ranges reject incomplete, invalid, and reversed dates", () => {
  assert.equal(parseAttendanceDateRange("2026-03-08", undefined), null);
  assert.equal(parseAttendanceDateRange("2026-02-30", "2026-03-01"), null);
  assert.equal(parseAttendanceDateRange("2026-03-09", "2026-03-08"), null);
});
