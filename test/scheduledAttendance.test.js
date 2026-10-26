const test = require("node:test");
const assert = require("node:assert/strict");
const Attendance = require("../models/Attendance");
const ScheduledClass = require("../models/ScheduledClass");

test("scheduled attendance is unique per student and scheduled class", () => {
  const indexes = Attendance.schema.indexes();
  const scheduledAttendanceIndex = indexes.find(([keys, options]) =>
    options.unique && keys.scheduledClass === 1 && keys.student === 1
  );

  assert.ok(scheduledAttendanceIndex);
  assert.deepEqual(scheduledAttendanceIndex[1].partialFilterExpression, {
    scheduledClass: { $type: "objectId" },
  });
});

test("legacy attendance remains compatible with multiple daily sessions", () => {
  const legacyUniqueIndex = Attendance.schema.indexes().find(([keys, options]) =>
    options.unique && keys.student === 1 && keys.date === 1
  );

  assert.equal(legacyUniqueIndex, undefined);
});

test("scheduled class identity includes academy, class, batch, session, and date", () => {
  const scheduleIndex = ScheduledClass.schema.indexes().find(([keys, options]) =>
    options.unique &&
    keys.academyId === 1 &&
    keys.class === 1 &&
    keys.batch === 1 &&
    keys.session === 1 &&
    keys.date === 1
  );

  assert.ok(scheduleIndex);
});
