const mongoose = require("mongoose");

const questionSchema = new mongoose.Schema(
  {
    questionText: { type: String, required: true },
    options: {
      type: [String],
      validate: {
        validator: (arr) => arr.length === 4,
        message: "Each question must have exactly 4 options",
      },
      required: true,
    },
    correctOption: {
      type: Number, // index 0-3 into options[]
      required: true,
      min: 0,
      max: 3,
    },
    marks: { type: Number, default: 1, min: 0.5 },
    explanation: { type: String, default: "" },
  },
  { _id: true }
);

const onlineTestSchema = new mongoose.Schema(
  {
    academyId: { type: mongoose.Schema.Types.ObjectId, ref: "Academy", required: true, index: true },
    title: { type: String, required: true, trim: true },
    subject: { type: String, required: true, trim: true },
    // Legacy assignment field retained for existing tests. New tests use the
    // exact class + batch pair below.
    classes: {
      type: [String],
      default: undefined,
    },
    class: { type: String, trim: true },
    batch: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Teacher", required: true },
    duration: { type: Number, required: true, min: 1 }, // minutes
    instructions: { type: String, default: "" },
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
    negativeMarking: { type: Number, default: 0, min: 0 }, // marks deducted per wrong answer; 0 = disabled
    randomizeQuestions: { type: Boolean, default: false },
    showResults: { type: Boolean, default: true }, // show results immediately after submit
    allowReview: { type: Boolean, default: true }, // let student see correct answers after submit
    passPercentage: { type: Number, default: 40, min: 0, max: 100 },
    published: { type: Boolean, default: false },
    questions: [questionSchema],
  },
  { timestamps: true }
);

onlineTestSchema.index({ academyId: 1, class: 1, batch: 1 });

onlineTestSchema.virtual("totalMarks").get(function () {
  return this.questions.reduce((sum, q) => sum + q.marks, 0);
});
onlineTestSchema.set("toJSON", { virtuals: true });
onlineTestSchema.set("toObject", { virtuals: true });

// Strips answer key fields — used whenever sending a test to a student
// BEFORE they've submitted, so the correct answer never reaches the client.
onlineTestSchema.methods.toStudentSafeJSON = function () {
  const obj = this.toObject();
  obj.questions = obj.questions.map((q) => ({
    _id: q._id,
    questionText: q.questionText,
    options: q.options,
    marks: q.marks,
    // correctOption and explanation deliberately omitted
  }));
  return obj;
};

module.exports = mongoose.model("OnlineTest", onlineTestSchema);
