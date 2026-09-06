const mongoose = require("mongoose");

const submissionSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
    },
    status: {
      type: String,
      enum: ["Pending", "Completed", "Late Submission"],
      default: "Pending",
    },
    teacherRemarks: {
      type: String,
      default: "",
    },
    submittedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false }
);

const assignmentSchema = new mongoose.Schema(
  {
    academyId: { type: mongoose.Schema.Types.ObjectId, ref: "Academy", required: true, index: true },
    title: {
      type: String,
      required: [true, "Assignment title is required"],
      trim: true,
    },
    description: {
      type: String,
      required: [true, "Description is required"],
    },
    class: {
      type: String,
      required: true,
      trim: true,
    },
    files: [
      {
        url: String,
        publicId: String,
        originalName: String,
        fileType: { type: String, enum: ["pdf", "image", "other"] },
      },
    ],
    submissionDate: {
      type: Date,
      required: [true, "Submission date is required"],
    },
    assignedStudents: [submissionSchema],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Teacher",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Assignment", assignmentSchema);
