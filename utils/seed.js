// One-time seed script: creates the Main Admin account, a sample teacher
// account, and a couple of sample students assigned to that teacher.
// Run with: npm run seed
require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Teacher = require("../models/Teacher");
const Student = require("../models/Student");

const run = async () => {
  await connectDB();

  // 1. Main Admin
  const adminEmail = "gandeep@nextgenacademy.com";
  let admin = await Teacher.findOne({ email: adminEmail });
  if (!admin) {
    admin = await Teacher.create({
      name: "Gandeep Varma Ganaraju",
      email: adminEmail,
      password: "ChangeMe123!",
      role: "admin",
    });
    console.log(`Main Admin created -> ${adminEmail} / ChangeMe123!`);
  } else {
    console.log("Main Admin already exists, skipping.");
  }

  // 2. Sample teacher (created by admin, per RBAC rules)
  const teacherEmail = "teacher1@nextgenacademy.com";
  let teacher = await Teacher.findOne({ email: teacherEmail });
  if (!teacher) {
    teacher = await Teacher.create({
      name: "Priya Sharma",
      email: teacherEmail,
      password: "Teacher123!",
      role: "teacher",
    });
    console.log(`Sample teacher created -> ${teacherEmail} / Teacher123!`);
  } else {
    console.log("Sample teacher already exists, skipping.");
  }

  // 3. Sample students, assigned to the sample teacher
  const sampleStudents = [
    {
      studentId: "NGA001",
      name: "Aarav Sharma",
      parentName: "Rohit Sharma",
      phone: "9876543210",
      class: "Class 10",
      batch: "Morning Batch",
      password: "Student123!",
      monthlyFee: 2000,
      admissionFee: 5000,
      assignedTeacher: teacher._id,
    },
    {
      studentId: "NGA002",
      name: "Diya Patel",
      parentName: "Kunal Patel",
      phone: "9876543211",
      class: "Class 10",
      batch: "Morning Batch",
      password: "Student123!",
      monthlyFee: 2000,
      admissionFee: 5000,
      assignedTeacher: teacher._id,
    },
  ];

  for (const s of sampleStudents) {
    const exists = await Student.findOne({ studentId: s.studentId });
    if (!exists) {
      await Student.create(s);
      console.log(`Sample student created -> ${s.studentId} / Student123!`);
    }
  }

  console.log("Seeding complete.");
  await mongoose.connection.close();
  process.exit(0);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
