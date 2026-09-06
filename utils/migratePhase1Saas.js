// One-time Phase 1 SaaS-conversion migration:
//   1. Creates ACADEMY_001 representing the academy that already existed
//      before this conversion — no data is deleted or rebuilt.
//   2. Assigns every existing Teacher (role "admin" or "teacher") that
//      doesn't already have an academyId to ACADEMY_001. Since Students
//      derive their academy transitively through assignedTeacher, this
//      single step also brings every existing student under ACADEMY_001
//      without needing to touch the Student collection at all.
  //   3. Seeds four default pricing plans (Free/Basic/Standard/Premium) if none
//      exist yet, so the public Pricing page has something to show.
//
// Safe to re-run: it skips anything that's already been migrated/seeded.
//
// Run with: npm run migrate-phase1-saas
require("dotenv").config();
const mongoose = require("mongoose");
const readline = require("readline");
const connectDB = require("../config/db");
const Academy = require("../models/Academy");
const Teacher = require("../models/Teacher");
const Plan = require("../models/Plan");

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

  // ---------- Step 1: create ACADEMY_001 if it doesn't exist ----------
  let founderAcademy = await Academy.findOne({ isFounderAcademy: true });

  if (!founderAcademy) {
    console.log("No founder academy found yet — let's create ACADEMY_001 for your existing academy.\n");

    const existingAdmin = await Teacher.findOne({ role: "admin", academyId: null });
    if (!existingAdmin) {
      console.log(
        "Could not find an existing Academy Admin account with no academyId set.\n" +
        "This usually means the migration already ran, or there's no pre-existing admin account.\n" +
        "Nothing to do — exiting."
      );
      await mongoose.connection.close();
      process.exit(0);
    }

    console.log(`Found existing admin: ${existingAdmin.name} <${existingAdmin.email}>`);
    const academyName = (await ask('Academy name for this existing academy [default: "NextGen Learning Academy"]: ')) || "NextGen Learning Academy";
    const phone = (await ask(`Phone for this academy [default: uses admin's phone if set]: `)) || existingAdmin.phone || "";

    const confirm = await ask(
      `\nThis will create academy "${academyName}" as ACADEMY_001 and assign ${existingAdmin.email} (and every other existing teacher account with no academy) to it.\nType "YES" to confirm: `
    );
    if (confirm !== "YES") {
      console.log("Aborted. No changes made.");
      await mongoose.connection.close();
      process.exit(0);
    }

    founderAcademy = await Academy.create({
      academyId: "ACADEMY_001",
      academyName,
      ownerName: existingAdmin.name,
      ownerEmail: existingAdmin.email,
      phone,
      status: "ACTIVE",
      isFounderAcademy: true,
    });

    console.log(`\nCreated academy: ${founderAcademy.academyName} (${founderAcademy.academyId})`);
  } else {
    console.log(`Founder academy already exists: ${founderAcademy.academyName} (${founderAcademy.academyId}) — skipping creation.`);
  }

  // ---------- Step 2: assign every un-migrated staff account to it ----------
  const result = await Teacher.updateMany(
    { role: { $in: ["admin", "teacher"] }, academyId: null },
    { $set: { academyId: founderAcademy._id } }
  );
  console.log(`Assigned ${result.modifiedCount} existing staff account(s) to ${founderAcademy.academyId}.`);
  console.log("(Every student assigned to those teachers now belongs to this academy transitively — no Student records were changed.)");

  // ---------- Step 3: safe default for academies missing a plan ----------
  const academyPlanDefaults = await Academy.updateMany(
    { $or: [{ plan: { $exists: false } }, { plan: null }, { plan: "" }] },
    { $set: { plan: "free", subscriptionStatus: "plan_required" } }
  );
  console.log(`Set ${academyPlanDefaults.modifiedCount} academy record(s) without a plan to the safe default: Free / plan_required.`);

  // ---------- Step 4: seed default plans if none exist ----------
  const planCount = await Plan.countDocuments();
  if (planCount === 0) {
    await Plan.insertMany([
      {
        name: "Free", priceMonthly: 0, priceYearly: 0,
        studentLimit: 25, teacherLimit: 2,
        features: ["Student Management"],
        sortOrder: 0,
      },
      {
        name: "Basic", priceMonthly: 999, priceYearly: 9999,
        studentLimit: 100, teacherLimit: 5,
        features: ["Student Management", "Teacher Management", "Attendance", "Fees"],
        sortOrder: 1,
      },
      {
        name: "Standard", priceMonthly: 1999, priceYearly: 19999,
        studentLimit: 500, teacherLimit: 20,
        features: ["Everything in Basic", "Assignments", "MCQ Tests", "WhatsApp Notifications"],
        sortOrder: 2,
      },
      {
        name: "Premium", priceMonthly: 3999, priceYearly: 39999,
        studentLimit: null, teacherLimit: null,
        features: ["Everything in Standard", "Unlimited Students & Teachers", "Priority Support"],
        sortOrder: 3,
      },
    ]);
    console.log("Seeded 4 default pricing plans (Free, Basic, Standard, Premium).");
  } else {
    console.log(`${planCount} plan(s) already exist — skipping plan seeding.`);
  }

  console.log("\nPhase 1 SaaS migration complete.");
  await mongoose.connection.close();
  process.exit(0);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
