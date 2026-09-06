const mongoose = require("mongoose");

// Marks are stored as a sub-document array so each student's result
// can be entered, updated, or deleted independently.
const markEntrySchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
    },
    marksObtained: {
      type: Number,
      default: null, // null = not entered yet
      min: 0,
    },
  },
  { _id: false }
);

const testSchema = new mongoose.Schema(
  {
    academyId: { type: mongoose.Schema.Types.ObjectId, ref: "Academy", required: true, index: true },
    testName: {
      type: String,
      required: [true, "Test name is required"],
      trim: true,
    },
    subject: {
      type: String,
      required: [true, "Subject is required"],
      trim: true,
    },
    class: {
      type: String,
      required: [true, "Class is required"],
      trim: true,
    },
    maxMarks: {
      type: Number,
      required: [true, "Maximum marks is required"],
      min: 1,
    },
    date: {
      type: Date,
      required: [true, "Test date is required"],
    },
    marks: [markEntrySchema],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Teacher",
    },
  },
  { timestamps: true }
);

// Virtual helpers used by the dashboard/report endpoints
testSchema.methods.getStats = function () {
  const entered = this.marks.filter((m) => m.marksObtained !== null);
  if (entered.length === 0) {
    return { average: 0, highest: 0, lowest: 0, submitted: 0 };
  }
  const values = entered.map((m) => m.marksObtained);
  const average = values.reduce((a, b) => a + b, 0) / values.length;
  return {
    average: Number(average.toFixed(2)),
    highest: Math.max(...values),
    lowest: Math.min(...values),
    submitted: entered.length,
  };
};

module.exports = mongoose.model("Test", testSchema);
