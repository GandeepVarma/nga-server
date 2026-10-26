const mongoose = require("mongoose");
const Attendance = require("../models/Attendance");
require("../models/ScheduledClass");

const migrateAttendanceIndexes = async () => {
  const collectionName = Attendance.collection.name;
  const collectionExists = await mongoose.connection.db
    .listCollections({ name: collectionName }, { nameOnly: true })
    .hasNext();

  if (collectionExists) {
    const indexes = await Attendance.collection.indexes();
    const legacyDailyUniqueIndex = indexes.find((index) =>
      index.unique &&
      Object.keys(index.key).length === 2 &&
      index.key.student === 1 &&
      index.key.date === 1
    );
    if (legacyDailyUniqueIndex) {
      try {
        await Attendance.collection.dropIndex(legacyDailyUniqueIndex.name);
      } catch (error) {
        if (error.code !== 27) throw error;
      }
      console.log("Removed legacy daily attendance uniqueness index; existing attendance records were preserved.");
    }
  }

  await Attendance.createIndexes();
  await mongoose.model("ScheduledClass").createIndexes();
};

// Connects to MongoDB using the URI from environment variables.
// Exits the process if the connection fails, since the API is useless without a DB.
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    await migrateAttendanceIndexes();
    console.log(`MongoDB connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`MongoDB connection error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
