const mongoose = require("mongoose");

const questionBankSchema = new mongoose.Schema(
  {
    academyId: { type: mongoose.Schema.Types.ObjectId, ref: "Academy", required: true, index: true },
    question: { type: String, required: true, trim: true },
    optionA: { type: String, required: true, trim: true },
    optionB: { type: String, required: true, trim: true },
    optionC: { type: String, required: true, trim: true },
    optionD: { type: String, required: true, trim: true },
    correctAnswer: { type: String, enum: ["A", "B", "C", "D"], required: true },
    marks: { type: Number, min: 0.5, default: 1 },
    subject: { type: String, trim: true, default: "" },
    class: { type: String, trim: true, default: "" },
    chapter: { type: String, trim: true, default: "" },
    topic: { type: String, trim: true, default: "" },
    difficulty: { type: String, enum: ["Easy", "Medium", "Hard"], default: "Medium" },
    questionType: { type: String, enum: ["MCQ"], default: "MCQ" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Teacher", required: true },
  },
  { timestamps: true }
);

questionBankSchema.index({ academyId: 1, subject: 1, class: 1, chapter: 1, difficulty: 1 });

module.exports = mongoose.model("QuestionBank", questionBankSchema);
