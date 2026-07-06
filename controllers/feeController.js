const asyncHandler = require("express-async-handler");
const Fee = require("../models/Fee");
const Student = require("../models/Student");
const { notifyStudent } = require("../utils/notify");

// @desc    Generate this month's fee record for every active student
//          (carries forward any pending balance from the previous month)
// @route   POST /api/fees/generate
// @body    { month: "2026-07" }
// @access  Teacher
const generateMonthlyFees = asyncHandler(async (req, res) => {
  const { month } = req.body;
  if (!month) {
    res.status(400);
    throw new Error("month is required, format YYYY-MM");
  }

  const students = await Student.find({ status: "Active" });
  const created = [];

  for (const student of students) {
    const exists = await Fee.findOne({ student: student._id, month });
    if (exists) continue;

    // Find previous month's pending balance to carry forward
    const [year, m] = month.split("-").map(Number);
    const prevDate = new Date(year, m - 2, 1);
    const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;
    const prevFee = await Fee.findOne({ student: student._id, month: prevMonth });
    const carryForward = prevFee ? prevFee.pending : 0;

    const fee = await Fee.create({
      student: student._id,
      month,
      amount: student.monthlyFee,
      carryForward,
      paid: 0,
    });
    created.push(fee);
  }

  res.status(201).json({
    success: true,
    message: `Generated ${created.length} fee record(s) for ${month}`,
    data: created,
  });
});

// @desc    Get all fee records (optionally filtered by month/student/status)
// @route   GET /api/fees?month=&student=&status=
// @access  Teacher
const getFees = asyncHandler(async (req, res) => {
  const { month, student, status } = req.query;
  const query = {};
  if (month) query.month = month;
  if (student) query.student = student;
  if (status) query.status = status;

  const fees = await Fee.find(query)
    .populate("student", "name studentId class")
    .sort({ month: -1 });

  res.json({ success: true, count: fees.length, data: fees });
});

// @desc    Get a student's own fee records
// @route   GET /api/fees/my
// @access  Student
const getMyFees = asyncHandler(async (req, res) => {
  const fees = await Fee.find({ student: req.user._id }).sort({ month: -1 });
  res.json({ success: true, data: fees });
});

// @desc    Record a payment (full or partial) against a fee record
// @route   PUT /api/fees/:id/pay
// @body    { amount, modeOfPayment }
// @access  Teacher
const recordPayment = asyncHandler(async (req, res) => {
  const { amount, modeOfPayment } = req.body;
  if (!amount || amount <= 0) {
    res.status(400);
    throw new Error("A positive payment amount is required");
  }

  const fee = await Fee.findById(req.params.id);
  if (!fee) {
    res.status(404);
    throw new Error("Fee record not found");
  }

  fee.paid += Number(amount);
  fee.paymentDate = new Date();
  fee.modeOfPayment = modeOfPayment || "Cash";
  fee.receiptNumber = fee.receiptNumber || `RCPT-${Date.now()}`;
  await fee.save();

  await notifyStudent(
    fee.student,
    "PAYMENT_SUCCESSFUL",
    "Payment Received",
    `Your payment of ₹${amount} for ${fee.month} has been recorded. Receipt: ${fee.receiptNumber}.`,
    fee._id
  );

  res.json({ success: true, data: fee });
});

// @desc    Dashboard-style fee summary: total/pending/today's/month-wise/student-wise
// @route   GET /api/fees/summary
// @access  Teacher
const getFeeSummary = asyncHandler(async (req, res) => {
  const fees = await Fee.find().populate("student", "name studentId class");

  const totalCollection = fees.reduce((sum, f) => sum + f.paid, 0);
  const pendingCollection = fees.reduce((sum, f) => sum + f.pending, 0);

  const todayStr = new Date().toDateString();
  const todaysCollection = fees
    .filter((f) => f.paymentDate && new Date(f.paymentDate).toDateString() === todayStr)
    .reduce((sum, f) => sum + f.paid, 0);

  const monthWise = {};
  fees.forEach((f) => {
    if (!monthWise[f.month]) monthWise[f.month] = { collected: 0, pending: 0 };
    monthWise[f.month].collected += f.paid;
    monthWise[f.month].pending += f.pending;
  });

  const studentWise = {};
  fees.forEach((f) => {
    const key = f.student?._id?.toString();
    if (!key) return;
    if (!studentWise[key]) {
      studentWise[key] = {
        student: f.student,
        collected: 0,
        pending: 0,
      };
    }
    studentWise[key].collected += f.paid;
    studentWise[key].pending += f.pending;
  });

  res.json({
    success: true,
    data: {
      totalCollection,
      pendingCollection,
      todaysCollection,
      monthWise,
      studentWise: Object.values(studentWise),
    },
  });
});

module.exports = {
  generateMonthlyFees,
  getFees,
  getMyFees,
  recordPayment,
  getFeeSummary,
};
