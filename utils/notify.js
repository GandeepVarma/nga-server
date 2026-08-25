const Notification = require("../models/Notification");
const Student = require("../models/Student");

// Creates a notification for a single student.
const notifyStudent = async (studentId, type, title, message, relatedId = null) => {
  const student = await Student.findById(studentId).select("academyId");
  return Notification.create({
    academyId: student.academyId,
    student: studentId,
    type,
    title,
    message,
    relatedId,
  });
};

// Creates the same notification for a list of students (e.g. a whole class).
const notifyStudents = async (studentIds, type, title, message, relatedId = null) => {
  const docs = studentIds.map((studentId) => ({
    student: studentId,
    type,
    title,
    message,
    relatedId,
  }));
  const students = await Student.find({ _id: { $in: studentIds } }).select("_id academyId");
  const academyByStudent = new Map(students.map((student) => [student._id.toString(), student.academyId]));
  return Notification.insertMany(docs.map((doc) => ({
    ...doc,
    academyId: academyByStudent.get(doc.student.toString()),
  })));
};

module.exports = { notifyStudent, notifyStudents };
