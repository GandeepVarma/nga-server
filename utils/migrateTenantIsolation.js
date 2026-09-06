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
  const academies = await Academy.find({}).select("_id academyName");
  let recordsAssigned = 0;
  if (academies.length === 1) {
    for (const [name, Model] of Object.entries(models)) {
      if (name === "Settings") {
        const scopedSettings = await Settings.findOne({ academyId: academies[0]._id }).select("_id");
        if (scopedSettings) continue;
      }
      const result = await Model.updateMany(
        { $or: [{ academyId: { $exists: false } }, { academyId: null }] },
        { $set: { academyId: academies[0]._id } }
      );
      recordsAssigned += result.modifiedCount;
    }
  }
  for (const [name, Model] of Object.entries(models)) {
    unresolved[name] = await Model.countDocuments({ $or: [{ academyId: { $exists: false } }, { academyId: null }] });
  }
  const legacyStudents = await Student.countDocuments({ $or: [{ academyId: { $exists: false } }, { academyId: null }] });
  const legacyTeachers = await Teacher.countDocuments({ role: { $ne: "super_admin" }, $or: [{ academyId: { $exists: false } }, { academyId: null }] });
  const academyCount = academies.length;

  console.log(JSON.stringify({ academyCount, studentsAssigned, recordsAssigned, unresolved, legacyStudents, legacyTeachers }, null, 2));
  console.log(academies.length === 1
    ? `Assigned legacy tenant records to the only academy: ${academies[0].academyName}.`
    : "Ambiguous legacy records were not assigned; manual mapping is required.");
  await mongoose.connection.close();
};

run().catch(async (error) => {
  console.error(error);
  await mongoose.connection.close();
  process.exitCode = 1;
});
