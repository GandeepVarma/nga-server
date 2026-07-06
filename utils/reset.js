// Wipes ALL student-related data: students, tests, assignments, fees,
// attendance, and notifications. Teacher accounts are NOT touched.
// This brings every dashboard stat back to zero.
//
// Run with: npm run reset
//
// WARNING: this permanently deletes data. There is no undo.
require("dotenv").config();
const mongoose = require("mongoose");
const readline = require("readline");
const connectDB = require("../config/db");

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
      'This will PERMANENTLY delete ALL students, tests, assignments, fees, attendance, and notifications.\nType "RESET" to confirm: ',
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

  const [students, tests, assignments, fees, attendance, notifications] = await Promise.all([
    Student.deleteMany({}),
    Test.deleteMany({}),
    Assignment.deleteMany({}),
    Fee.deleteMany({}),
    Attendance.deleteMany({}),
    Notification.deleteMany({}),
  ]);

  console.log("Reset complete:");
  console.log(`  Students deleted:      ${students.deletedCount}`);
  console.log(`  Tests deleted:         ${tests.deletedCount}`);
  console.log(`  Assignments deleted:   ${assignments.deletedCount}`);
  console.log(`  Fee records deleted:   ${fees.deletedCount}`);
  console.log(`  Attendance deleted:    ${attendance.deletedCount}`);
  console.log(`  Notifications deleted: ${notifications.deletedCount}`);
  console.log("\nTeacher accounts were left untouched. Dashboard stats will now show zero.");

  await mongoose.connection.close();
  process.exit(0);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
