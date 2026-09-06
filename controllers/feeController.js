const asyncHandler = require("express-async-handler");
const Fee = require("../models/Fee");
const Student = require("../models/Student");
const { notifyStudent } = require("../utils/notify");
const { academyFilter, requireAcademyId } = require("../utils/tenant");

// NOTE: Every route using this controller (except getMyFees) is mounted
// behind `adminOnly` middleware — per RBAC rules, Teachers must not access
// any fee data at all, so no additional scoping logic is needed here.

// @desc    Generate this month's fee record for every active student
// @route   POST /api/fees/generate
// @access  Admin
const generateMonthlyFees = asyncHandler(async (req, res) => {
  const { month, dueDate } = req.body;
  if (!month) {
    res.status(400);
    throw new Error("month is required, format YYYY-MM");
  }

  const academyId = requireAcademyId(req);
  const students = await Student.find({ academyId, status: "Active" });
  const created = [];

  for (const student of students) {
    const exists = await Fee.findOne({ academyId, student: student._id, month });
    if (exists) continue;

    const [year, m] = month.split("-").map(Number);
    const prevDate = new Date(year, m - 2, 1);
    const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;
    const prevFee = await Fee.findOne({ academyId, student: student._id, month: prevMonth });
    const carryForward = prevFee ? prevFee.pending : 0;

    const fee = await Fee.create({
      student: student._id,
      academyId,
      month,
      amount: student.monthlyFee,
      carryForward,
      paid: 0,
      dueDate: dueDate || null, // powers the WhatsApp fee reminder scheduler, if set
    });
    created.push(fee);
  }

  res.status(201).json({
    success: true,
    message: `Generated ${created.length} fee record(s) for ${month}`,
    data: created,
  });
});

// @desc    Get all fee records (optionally filtered)
// @route   GET /api/fees?month=&student=&status=
// @access  Admin
const getFees = asyncHandler(async (req, res) => {
  const { month, student, status } = req.query;
  const query = { academyId: requireAcademyId(req) };
  if (month) query.month = month;
  if (student) query.student = student;
  if (status) query.status = status;

  const fees = await Fee.find(query).populate("student", "name studentId class").sort({ month: -1 });
  res.json({ success: true, count: fees.length, data: fees });
});

// @desc    Get a student's own fee records
// @route   GET /api/fees/my
// @access  Student
const getMyFees = asyncHandler(async (req, res) => {
  const fees = await Fee.find(academyFilter(req, { student: req.user._id })).sort({ month: -1 });
  res.json({ success: true, data: fees });
});

// @desc    Record a payment against a fee record
// @route   PUT /api/fees/:id/pay
// @access  Admin
const recordPayment = asyncHandler(async (req, res) => {
  const { amount, modeOfPayment } = req.body;
  if (!amount || amount <= 0) {
    res.status(400);
    throw new Error("A positive payment amount is required");
  }

  const fee = await Fee.findOne(academyFilter(req, { _id: req.params.id }));
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

// @desc    Fee summary for the Admin dashboard
// @route   GET /api/fees/summary
// @access  Admin
const getFeeSummary = asyncHandler(async (req, res) => {
  const fees = await Fee.find({ academyId: requireAcademyId(req) }).populate("student", "name studentId class");

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
    if (!studentWise[key]) studentWise[key] = { student: f.student, collected: 0, pending: 0 };
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

// @desc    Manually send a WhatsApp fee reminder for a single record
//          (in addition to the automated scheduled reminders)
// @route   POST /api/fees/:id/remind
// @access  Admin
const sendManualReminder = asyncHandler(async (req, res) => {
  const fee = await Fee.findOne(academyFilter(req, { _id: req.params.id })).populate("student");
  if (!fee) {
    res.status(404);
    throw new Error("Fee record not found");
  }
  if (!fee.student) {
    res.status(404);
    throw new Error("This fee record has no linked student");
  }

  const whatsapp = require("../services/whatsappService");
  // Manual sends use a unique dedupeKey each time (no offsetLabel) so they
  // never collide with the scheduler's automated -3d/-1d/0d/+3d/+7d reminders.
  const log = await whatsapp.sendFeeReminder({ fee, student: fee.student, offsetLabel: null });

  res.json({ success: log.status === "sent", data: log });
});

module.exports = { generateMonthlyFees, getFees, getMyFees, recordPayment, getFeeSummary, sendManualReminder };
