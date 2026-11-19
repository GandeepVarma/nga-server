const test = require("node:test");
const assert = require("node:assert/strict");
const Attendance = require("../models/Attendance");
const ScheduledClass = require("../models/ScheduledClass");
const {
  isVisibleInAttendanceHistory,
  isVisibleInUpcomingSchedule,
  sortUpcomingClassesByAttendance,
  getUnscheduledClassBatches,
  validateDate,
} = require("../controllers/scheduledClassController");

test("date-only attendance values are validated and represented at UTC midnight", () => {
  assert.equal(validateDate("2026-03-08").toISOString(), "2026-03-08T00:00:00.000Z");
  assert.equal(validateDate("2026-02-30"), null);
});

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

test("bulk scheduling skips existing batches without blocking missing batches", () => {
  const classBatches = [
    { class: "Class 1", batch: "Batch A" },
    { class: "Class 1", batch: "Batch B" },
  ];

  assert.deepEqual(
    getUnscheduledClassBatches(classBatches, [{ class: "Class 1", batch: "Batch A" }]),
    [{ class: "Class 1", batch: "Batch B" }]
  );
  assert.deepEqual(
    getUnscheduledClassBatches(classBatches, [
      { class: "Class 1", batch: "Batch A" },
      { class: "Class 1", batch: "Batch B" },
    ]),
    []
  );
});

test("only marked sessions remain in staff history for seven days", () => {
  const now = new Date("2026-10-26T00:00:00.000Z");
  const sevenDays = 7 * 24 * 60 * 60 * 1000;

  assert.equal(isVisibleInAttendanceHistory(null, now), false);
  assert.equal(isVisibleInAttendanceHistory(undefined, now), false);
  assert.equal(isVisibleInAttendanceHistory(new Date(now.getTime() - sevenDays + 1), now), true);
  assert.equal(isVisibleInAttendanceHistory(new Date(now.getTime() - sevenDays), now), false);
  assert.equal(isVisibleInAttendanceHistory(new Date(now.getTime() - sevenDays - 1), now), false);
});

test("upcoming schedule only includes sessions with no attendance records", () => {
  assert.equal(isVisibleInUpcomingSchedule({}), true);
  assert.equal(isVisibleInUpcomingSchedule(undefined), true);
  assert.equal(isVisibleInUpcomingSchedule({ Present: 2 }), false);
  assert.equal(isVisibleInUpcomingSchedule({ Absent: 1 }), false);
});

test("upcoming sessions with attendance are ordered after unmarked sessions", () => {
  const sessions = [
    { _id: "unmarked-first", date: "2026-10-26", attendance: {} },
    { _id: "marked-first", date: "2026-10-27", attendance: { Present: 2 } },
    { _id: "unmarked-later", date: "2026-10-28", attendance: {} },
    { _id: "marked-second", date: "2026-10-29", attendance: { Absent: 1 } },
  ];

  assert.deepEqual(
    sortUpcomingClassesByAttendance(sessions).map((scheduledClass) => scheduledClass._id),
    ["unmarked-first", "unmarked-later", "marked-first", "marked-second"]
  );
});
