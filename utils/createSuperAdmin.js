// One-time bootstrap script: creates the first SUPER_ADMIN account.
// Run with: npm run create-super-admin
require("dotenv").config();
const mongoose = require("mongoose");
const readline = require("readline");
const connectDB = require("../config/db");
const Teacher = require("../models/Teacher");

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

  const existing = await Teacher.countDocuments({ role: "super_admin" });
  if (existing > 0) {
    console.log(
      `A Super Admin already exists (${existing} account${existing > 1 ? "s" : ""} found).\n` +
      "This script only bootstraps the very first one. To add another, do it manually in the database or extend this script."
    );
    await mongoose.connection.close();
    process.exit(0);
  }

  const name = await ask("Super Admin name: ");
  const email = await ask("Super Admin email: ");
  const password = await ask("Super Admin password (min 6 characters): ");

  if (!name || !email || password.length < 6) {
    console.log("Aborted: name, email, and a password of at least 6 characters are required.");
    await mongoose.connection.close();
    process.exit(1);
  }

  const emailTaken = await Teacher.findOne({ email: email.toLowerCase().trim() });
  if (emailTaken) {
    console.log("Aborted: that email is already in use by another staff account.");
    await mongoose.connection.close();
    process.exit(1);
  }

  await Teacher.create({ name, email, password, role: "super_admin" });

  console.log(`\nSuper Admin created: ${email}`);
  console.log("Log in from the Admin / Teacher tab on the login page — you'll be redirected to /super-admin/dashboard.");

  await mongoose.connection.close();
  process.exit(0);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
