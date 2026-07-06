const Notification = require("../models/Notification");

// Creates a notification for a single student.
const notifyStudent = async (studentId, type, title, message, relatedId = null) => {
  return Notification.create({
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
  return Notification.insertMany(docs);
};

module.exports = { notifyStudent, notifyStudents };
