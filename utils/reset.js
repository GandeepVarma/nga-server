// Wipes ALL data: teachers (admin + regular), students, tests, assignments,
// fees, attendance, and notifications. This is a full factory reset.
// After running this, use `npm run seed` again to recreate the Main Admin.
//
// Run with: npm run reset
require("dotenv").config();
const mongoose = require("mongoose");
const readline = require("readline");
const connectDB = require("../config/db");

const Teacher = require("../models/Teacher");
const Student = require("../models/Student");
const Test = require("../models/Test");
const Assignment = require("../models/Assignment");
const Fee = require("../models/Fee");
const Attendance = require("../models/Attendance");
const Notification = require("../models/Notification");

const confirm = () =>
  new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(
      'This will PERMANENTLY delete ALL teachers (including the admin), students, tests, assignments, fees, attendance, and notifications.\nType "RESET" to confirm: ',
      (answer) => {
        rl.close();
        resolve(answer.trim() === "RESET");
      }
    );
  });

const run = async () => {
  const confirmed = await confirm();
  if (!confirmed) {
    console.log("Aborted. No data was deleted.");
    process.exit(0);
  }

  await connectDB();

  const [teachers, students, tests, assignments, fees, attendance, notifications] = await Promise.all([
    Teacher.deleteMany({}),
    Student.deleteMany({}),
    Test.deleteMany({}),
    Assignment.deleteMany({}),
    Fee.deleteMany({}),
    Attendance.deleteMany({}),
    Notification.deleteMany({}),
  ]);

  console.log("Reset complete:");
  console.log(`  Teachers deleted:      ${teachers.deletedCount}`);
  console.log(`  Students deleted:      ${students.deletedCount}`);
  console.log(`  Tests deleted:         ${tests.deletedCount}`);
  console.log(`  Assignments deleted:   ${assignments.deletedCount}`);
  console.log(`  Fee records deleted:   ${fees.deletedCount}`);
  console.log(`  Attendance deleted:    ${attendance.deletedCount}`);
  console.log(`  Notifications deleted: ${notifications.deletedCount}`);
  console.log("\nRun `npm run seed` to recreate the Main Admin account.");

  await mongoose.connection.close();
  process.exit(0);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
