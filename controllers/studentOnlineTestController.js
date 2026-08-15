const asyncHandler = require("express-async-handler");
const OnlineTest = require("../models/OnlineTest");
const Submission = require("../models/Submission");

// @desc    List tests available to the logged-in student: published, in their
//          class, within the availability window (or recently closed so they
//          can still see past results). Includes their own attempt status.
// @route   GET /api/online-tests/student
// @access  Student
const getMyTests = asyncHandler(async (req, res) => {
  const now = new Date();
  const tests = await OnlineTest.find({
    published: true,
    classes: req.user.class,
    endTime: { $gte: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000) },
  }).sort({ startTime: 1 });

  const mySubmissions = await Submission.find({
    student: req.user._id,
    test: { $in: tests.map((t) => t._id) },
  });

  const data = tests.map((t) => {
    const sub = mySubmissions.find((s) => s.test.toString() === t._id.toString());
    let status = "Not Started";
    if (sub && sub.submittedAt) status = "Completed";
    else if (sub && !sub.submittedAt) status = "In Progress";
    else if (now < t.startTime) status = "Upcoming";
    else if (now > t.endTime) status = "Closed";

    return {
      _id: t._id,
      title: t.title,
      subject: t.subject,
      duration: t.duration,
      totalMarks: t.totalMarks,
      questionCount: t.questions.length,
      startTime: t.startTime,
      endTime: t.endTime,
      status,
    };
  });

  res.json({ success: true, data });
});

// @desc    Get test details for the student (no answer key), plus their
//          in-progress submission if one exists, so a page refresh resumes cleanly.
// @route   GET /api/online-tests/student/:id
// @access  Student
const getTestForStudent = asyncHandler(async (req, res) => {
  const test = await OnlineTest.findOne({ _id: req.params.id, published: true, classes: req.user.class });
  if (!test) {
    res.status(404);
    throw new Error("Test not found or not available to your class");
  }

  const submission = await Submission.findOne({ test: test._id, student: req.user._id });

  res.json({
    success: true,
    data: {
      test: test.toStudentSafeJSON(),
      submission: submission || null,
    },
  });
});

// @desc    Start a test attempt. Creates the Submission record with the
//          server's own startedAt timestamp — the timer is calculated from
//          this server time, never from the client's clock, so refreshing
//          the page or manipulating the browser clock can't extend it.
// @route   POST /api/online-tests/student/:id/start
// @access  Student
const startTest = asyncHandler(async (req, res) => {
  const test = await OnlineTest.findOne({ _id: req.params.id, published: true, classes: req.user.class });
  if (!test) {
    res.status(404);
    throw new Error("Test not found or not available to your class");
  }

  const now = new Date();
  if (now < test.startTime) {
    res.status(400);
    throw new Error("This test has not opened yet");
  }
  if (now > test.endTime) {
    res.status(400);
    throw new Error("This test's window has closed");
  }

  let submission = await Submission.findOne({ test: test._id, student: req.user._id });
  if (submission) {
    if (submission.submittedAt) {
      res.status(400);
      throw new Error("You have already submitted this test");
    }
  } else {
    submission = await Submission.create({
      test: test._id,
      student: req.user._id,
      startedAt: now,
      answers: test.questions.map((q) => ({ questionId: q._id, selectedOption: null, markedForReview: false })),
    });
  }

  const elapsedSeconds = Math.floor((now - submission.startedAt) / 1000);
  const remainingSeconds = Math.max(test.duration * 60 - elapsedSeconds, 0);

  res.json({
    success: true,
    data: { test: test.toStudentSafeJSON(), submission, remainingSeconds },
  });
});

// @desc    Autosave progress without finalizing the attempt.
// @route   POST /api/online-tests/student/:id/save
// @access  Student
const saveProgress = asyncHandler(async (req, res) => {
  const submission = await Submission.findOne({ test: req.params.id, student: req.user._id });
  if (!submission) {
    res.status(404);
    throw new Error("No active attempt found — start the test first");
  }
  if (submission.submittedAt) {
    res.status(400);
    throw new Error("This test has already been submitted");
  }

  const { answers, tabSwitchCount } = req.body;
  if (Array.isArray(answers)) {
    answers.forEach(({ questionId, selectedOption, markedForReview }) => {
      const entry = submission.answers.find((a) => a.questionId.toString() === questionId);
      if (entry) {
        if (selectedOption !== undefined) entry.selectedOption = selectedOption;
        if (markedForReview !== undefined) entry.markedForReview = markedForReview;
      }
    });
  }
  if (typeof tabSwitchCount === "number") {
    submission.tabSwitchCount = Math.max(submission.tabSwitchCount, tabSwitchCount);
  }

  await submission.save();
  res.json({ success: true, message: "Progress saved" });
});

// Shared scoring logic used by both manual and auto-submit.
// Score is ALWAYS computed here, server-side, from the stored answer key —
// the client never sends a score and any score field it did send is ignored.
const scoreSubmission = (test, submission) => {
  let score = 0;
  let correctCount = 0;
  let wrongCount = 0;
  let unansweredCount = 0;

  test.questions.forEach((q) => {
    const ans = submission.answers.find((a) => a.questionId.toString() === q._id.toString());
    if (!ans || ans.selectedOption === null || ans.selectedOption === undefined) {
      unansweredCount += 1;
    } else if (ans.selectedOption === q.correctOption) {
      correctCount += 1;
      score += q.marks;
    } else {
      wrongCount += 1;
      score -= test.negativeMarking || 0;
    }
  });

  score = Math.max(score, 0);
  const totalMarks = test.questions.reduce((sum, q) => sum + q.marks, 0);
  const percentage = totalMarks > 0 ? Number(((score / totalMarks) * 100).toFixed(1)) : 0;

  return { score: Number(score.toFixed(2)), percentage, correctCount, wrongCount, unansweredCount };
};

// @desc    Submit the test (manual submit or auto-submit on timeout/violations)
// @route   POST /api/online-tests/student/:id/submit
// @body    { autoSubmitted?: boolean, answers?: [...] }
// @access  Student
const submitTest = asyncHandler(async (req, res) => {
  const test = await OnlineTest.findById(req.params.id);
  if (!test) {
    res.status(404);
    throw new Error("Test not found");
  }

  const submission = await Submission.findOne({ test: test._id, student: req.user._id });
  if (!submission) {
    res.status(404);
    throw new Error("No active attempt found — start the test first");
  }
  if (submission.submittedAt) {
    res.status(400);
    throw new Error("This test has already been submitted");
  }

  if (Array.isArray(req.body.answers)) {
    req.body.answers.forEach(({ questionId, selectedOption }) => {
      const entry = submission.answers.find((a) => a.questionId.toString() === questionId);
      if (entry && selectedOption !== undefined) entry.selectedOption = selectedOption;
    });
  }

  const now = new Date();
  const { score, percentage, correctCount, wrongCount, unansweredCount } = scoreSubmission(test, submission);

  submission.score = score;
  submission.percentage = percentage;
  submission.correctCount = correctCount;
  submission.wrongCount = wrongCount;
  submission.unansweredCount = unansweredCount;
  submission.submittedAt = now;
  submission.timeTakenSeconds = Math.floor((now - submission.startedAt) / 1000);
  submission.autoSubmitted = !!req.body.autoSubmitted;

  await submission.save();

  res.json({ success: true, data: submission });
});

// @desc    Get the result for a completed attempt (respects showResults/allowReview)
// @route   GET /api/online-tests/student/:id/result
// @access  Student
const getResult = asyncHandler(async (req, res) => {
  const test = await OnlineTest.findById(req.params.id);
  if (!test) {
    res.status(404);
    throw new Error("Test not found");
  }

  const submission = await Submission.findOne({ test: test._id, student: req.user._id });
  if (!submission || !submission.submittedAt) {
    res.status(404);
    throw new Error("No completed attempt found for this test");
  }

  const now = new Date();
  const resultsVisible = test.showResults || now > test.endTime;
  if (!resultsVisible) {
    res.status(403);
    throw new Error("Results for this test are not available yet");
  }

  let review = null;
  if (test.allowReview) {
    review = test.questions.map((q) => {
      const ans = submission.answers.find((a) => a.questionId.toString() === q._id.toString());
      return {
        questionText: q.questionText,
        options: q.options,
        correctOption: q.correctOption,
        selectedOption: ans ? ans.selectedOption : null,
        explanation: q.explanation,
        marks: q.marks,
      };
    });
  }

  res.json({
    success: true,
    data: {
      score: submission.score,
      totalMarks: test.totalMarks,
      percentage: submission.percentage,
      correctCount: submission.correctCount,
      wrongCount: submission.wrongCount,
      unansweredCount: submission.unansweredCount,
      timeTakenSeconds: submission.timeTakenSeconds,
      passed: submission.percentage >= test.passPercentage,
      passPercentage: test.passPercentage,
      autoSubmitted: submission.autoSubmitted,
      review,
    },
  });
});

module.exports = { getMyTests, getTestForStudent, startTest, saveProgress, submitTest, getResult };
