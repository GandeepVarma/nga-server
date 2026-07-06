// One-time seed script: creates the founding teacher account and a couple of
// sample students so you can log in and explore the app immediately.
// Run with: npm run seed
require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Teacher = require("../models/Teacher");
const Student = require("../models/Student");

const run = async () => {
  await connectDB();

  const teacherEmail = "gandeep@nextgenacademy.com";
  const existingTeacher = await Teacher.findOne({ email: teacherEmail });
  if (!existingTeacher) {
    await Teacher.create({
      name: "Gandeep Varma Ganaraju",
      email: teacherEmail,
      password: "ChangeMe123!",
      role: "admin",
    });
    console.log(`Teacher account created -> ${teacherEmail} / ChangeMe123!`);
  } else {
    console.log("Teacher account already exists, skipping.");
  }

  const sampleStudents = [
    {
      studentId: "NGA001",
      name: "Aarav Sharma",
      parentName: "Rohit Sharma",
      phone: "9876543210",
      class: "Class 10",
      password: "Student123!",
      monthlyFee: 2000,
      admissionFee: 5000,
    },
    {
      studentId: "NGA002",
      name: "Diya Patel",
      parentName: "Kunal Patel",
      phone: "9876543211",
      class: "Class 10",
      password: "Student123!",
      monthlyFee: 2000,
      admissionFee: 5000,
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
