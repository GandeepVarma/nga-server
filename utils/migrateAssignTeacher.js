// One-time migration for existing databases created BEFORE the RBAC upgrade.
// Existing students don't have the new required `assignedTeacher` field.
// This script finds any student missing that field and assigns them all to
// a teacher you choose, WITHOUT deleting or altering any other data.
//
// Run with: npm run migrate-assign-teacher
require("dotenv").config();
const mongoose = require("mongoose");
const readline = require("readline");
const connectDB = require("../config/db");
const Teacher = require("../models/Teacher");
const Student = require("../models/Student");

const ask = (question) =>
  new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });

const run = async () => {
  await connectDB();

  // Students missing assignedTeacher entirely (i.e. created before this field existed)
  const unassigned = await Student.find({ assignedTeacher: { $exists: false } });

  if (unassigned.length === 0) {
    console.log("No unassigned students found — nothing to migrate. Every student already has a teacher.");
    await mongoose.connection.close();
    process.exit(0);
  }

  console.log(`Found ${unassigned.length} student(s) with no assigned teacher:`);
  unassigned.forEach((s) => console.log(`  - ${s.studentId}  ${s.name}  (${s.class})`));

  const teachers = await Teacher.find({ role: "teacher" });
  if (teachers.length === 0) {
    console.log(
      "\nNo teacher accounts exist yet. Log in as Admin, go to Teacher Management, " +
      "create at least one teacher account, then run this script again."
    );
    await mongoose.connection.close();
    process.exit(0);
  }

  console.log("\nAvailable teachers:");
  teachers.forEach((t, i) => console.log(`  ${i + 1}. ${t.name}  <${t.email}>`));

  const choice = await ask("\nEnter the number of the teacher to assign ALL of the above students to: ");
  const index = parseInt(choice, 10) - 1;
  const chosenTeacher = teachers[index];

  if (!chosenTeacher) {
    console.log("Invalid selection. No changes made.");
    await mongoose.connection.close();
    process.exit(0);
  }

  const confirm = await ask(
    `Assign ${unassigned.length} student(s) to ${chosenTeacher.name}? Type "YES" to confirm: `
  );
  if (confirm !== "YES") {
    console.log("Aborted. No changes made.");
    await mongoose.connection.close();
    process.exit(0);
  }

  const result = await Student.updateMany(
    { assignedTeacher: { $exists: false } },
    { $set: { assignedTeacher: chosenTeacher._id } }
  );

  console.log(`\nDone. ${result.modifiedCount} student(s) assigned to ${chosenTeacher.name}.`);
  console.log("You can reassign individual students later from Admin > Assign Students.");

  await mongoose.connection.close();
  process.exit(0);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
