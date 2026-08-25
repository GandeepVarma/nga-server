require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Academy = require("../models/Academy");
const Teacher = require("../models/Teacher");
const Student = require("../models/Student");
const Attendance = require("../models/Attendance");
const Fee = require("../models/Fee");
const Test = require("../models/Test");
const Assignment = require("../models/Assignment");
const OnlineTest = require("../models/OnlineTest");
const Submission = require("../models/Submission");
const Notification = require("../models/Notification");
const NotificationLog = require("../models/NotificationLog");
const QuestionBank = require("../models/QuestionBank");
const Settings = require("../models/Settings");

const run = async () => {
  await connectDB();
  const staff = await Teacher.find({ academyId: { $ne: null } }).select("_id academyId");
  const staffAcademies = new Map(staff.map((teacher) => [teacher._id.toString(), teacher.academyId]));
  const students = await Student.find({ $or: [{ academyId: { $exists: false } }, { academyId: null }] }).select("_id assignedTeacher");
  let studentsAssigned = 0;
  for (const student of students) {
    const academyId = staffAcademies.get(student.assignedTeacher?.toString());
    if (academyId) {
      await Student.updateOne({ _id: student._id }, { $set: { academyId } });
      studentsAssigned += 1;
    }
  }

  const models = { Attendance, Fee, Test, Assignment, OnlineTest, Submission, Notification, NotificationLog, QuestionBank, Settings };
  const unresolved = {};
  for (const [name, Model] of Object.entries(models)) {
    unresolved[name] = await Model.countDocuments({ $or: [{ academyId: { $exists: false } }, { academyId: null }] });
  }
  const legacyStudents = await Student.countDocuments({ $or: [{ academyId: { $exists: false } }, { academyId: null }] });
  const legacyTeachers = await Teacher.countDocuments({ role: { $ne: "super_admin" }, $or: [{ academyId: { $exists: false } }, { academyId: null }] });
  const academyCount = await Academy.countDocuments();

  console.log(JSON.stringify({ academyCount, studentsAssigned, unresolved, legacyStudents, legacyTeachers }, null, 2));
  console.log("Any remaining unresolved records require manual mapping; none were assigned randomly.");
  await mongoose.connection.close();
};

run().catch(async (error) => {
  console.error(error);
  await mongoose.connection.close();
  process.exitCode = 1;
});
