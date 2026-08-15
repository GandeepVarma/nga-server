const mongoose = require("mongoose");

const answerSchema = new mongoose.Schema(
  {
    questionId: { type: mongoose.Schema.Types.ObjectId, required: true },
    selectedOption: { type: Number, default: null, min: 0, max: 3 }, // null = unanswered
    markedForReview: { type: Boolean, default: false },
  },
  { _id: false }
);

const submissionSchema = new mongoose.Schema(
  {
    test: { type: mongoose.Schema.Types.ObjectId, ref: "OnlineTest", required: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    answers: [answerSchema],
    score: { type: Number, default: null }, // set only on submit, computed server-side
    percentage: { type: Number, default: null },
    correctCount: { type: Number, default: 0 },
    wrongCount: { type: Number, default: 0 },
    unansweredCount: { type: Number, default: 0 },
    startedAt: { type: Date, required: true },
    submittedAt: { type: Date, default: null },
    timeTakenSeconds: { type: Number, default: null },
    autoSubmitted: { type: Boolean, default: false },
    tabSwitchCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// A student can only have ONE submission per test — enforces "start only once"
submissionSchema.index({ test: 1, student: 1 }, { unique: true });

module.exports = mongoose.model("Submission", submissionSchema);
