const asyncHandler = require("express-async-handler");
const crypto = require("crypto");
const mongoose = require("mongoose");
const Fee = require("../models/Fee");
const Student = require("../models/Student");
const Academy = require("../models/Academy");
const { notifyStudent } = require("../utils/notify");
const { academyFilter, requireAcademyId } = require("../utils/tenant");

// NOTE: Every route using this controller (except getMyFees) is mounted
// behind `adminOnly` middleware — per RBAC rules, Teachers must not access
// any fee data at all, so no additional scoping logic is needed here.

const PAYMENT_METHODS = ["Cash", "UPI", "Card", "Bank Transfer", "Cheque", "Other"];
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

const toCents = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round((numeric + Number.EPSILON) * 100) : 0;
};
const fromCents = (value) => Number((value / 100).toFixed(2));
const validDateOnly = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
};

const isFeeOverdue = (fee, now = new Date()) => {
  const pendingCents = toCents(fee.pending);
  if (!fee.dueDate || pendingCents <= 0) return false;
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return fee.dueDate < today;
};

const getDisplayStatus = (fee, now = new Date()) => {
  if (isFeeOverdue(fee, now)) return "Overdue";
  return fee.status === "Partial" ? "Partially Paid" : fee.status;
};

const getRecordedPayments = (fee) => {
  if (fee.paymentHistory?.length) {
    return fee.paymentHistory.map((payment) => ({
      amount: payment.amount,
      date: payment.date,
      modeOfPayment: payment.modeOfPayment,
      receiptNumber: payment.receiptNumber || (payment.legacy ? `LEGACY-${fee._id}` : null),
      outstandingBalance: payment.outstandingBalance,
      _id: payment._id,
      legacy: Boolean(payment.legacy),
    }));
  }
  if (toCents(fee.paid) > 0) {
    return [{
      amount: fee.paid,
      date: fee.paymentDate,
      modeOfPayment: fee.modeOfPayment,
      receiptNumber: fee.receiptNumber || `LEGACY-${fee._id}`,
      outstandingBalance: fee.pending,
      _id: "legacy",
      legacy: true,
    }];
  }
  return [];
};

const createLegacyPaymentSnapshot = (fee) => {
  if (fee.paymentHistory?.length || toCents(fee.paid) <= 0) return null;
  return {
    _id: new mongoose.Types.ObjectId(),
    requestId: `legacy-${fee._id}`,
    amount: fee.paid,
    date: fee.paymentDate || null,
    modeOfPayment: fee.modeOfPayment || null,
    receiptNumber: fee.receiptNumber || null,
    legacy: true,
  };
};

const calculateFeeSummary = (fees, now = new Date()) => {
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const trendMonths = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + index, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });
  const trends = Object.fromEntries(trendMonths.map((month) => [month, {
    month,
    expected: 0,
    collected: 0,
    pending: 0,
  }]));
  const monthWise = {};
  const pendingByMonth = {};
  const classWise = {};
  let totalExpectedCents = 0;
  let totalCollectedCents = 0;
  let pendingCollectionCents = 0;
  let overdueCollectionCents = 0;
  let overdueFeeCount = 0;
  let todaysCollectionCents = 0;
  let monthlyCollectionCents = 0;

  fees.forEach((fee) => {
    const expectedCents = toCents(fee.amount) + toCents(fee.carryForward);
    const paidCents = toCents(fee.paid);
    const pendingCents = toCents(fee.pending);
    const feeMonth = fee.month;
    const className = fee.student?.class || "Unassigned";

    totalExpectedCents += expectedCents;
    totalCollectedCents += paidCents;
    pendingCollectionCents += pendingCents;

    if (!monthWise[feeMonth]) monthWise[feeMonth] = { collected: 0, pending: 0 };
    monthWise[feeMonth].collected += fromCents(paidCents);
    monthWise[feeMonth].pending += fromCents(pendingCents);
    if (pendingCents > 0) pendingByMonth[feeMonth] = (pendingByMonth[feeMonth] || 0) + pendingCents;
    if (trends[feeMonth]) {
      trends[feeMonth].expected += expectedCents;
      trends[feeMonth].pending += pendingCents;
    }

    if (!classWise[className]) classWise[className] = { className, expected: 0, collected: 0, pending: 0 };
    classWise[className].expected += expectedCents;
    classWise[className].collected += paidCents;
    classWise[className].pending += pendingCents;

    if (isFeeOverdue(fee, now)) overdueFeeCount += 1;
    if (isFeeOverdue(fee, now)) overdueCollectionCents += pendingCents;

    getRecordedPayments(fee).forEach((payment) => {
      if (payment.legacy || !payment.date) return;
      const paymentDate = new Date(payment.date);
      if (paymentDate >= todayStart && paymentDate < tomorrowStart) {
        todaysCollectionCents += toCents(payment.amount);
      }
      const paymentMonth = `${paymentDate.getUTCFullYear()}-${String(paymentDate.getUTCMonth() + 1).padStart(2, "0")}`;
      if (paymentMonth === currentMonth) monthlyCollectionCents += toCents(payment.amount);
      if (trends[paymentMonth]) trends[paymentMonth].collected += toCents(payment.amount);
    });
  });

  return {
    totalExpectedFees: fromCents(totalExpectedCents),
    totalCollection: fromCents(totalCollectedCents),
    pendingCollection: fromCents(pendingCollectionCents),
    overdueCollection: fromCents(overdueCollectionCents),
    overdueFeeCount,
    todaysCollection: fromCents(todaysCollectionCents),
    monthlyCollection: fromCents(monthlyCollectionCents),
    monthWise,
    studentWise: Object.values(fees.reduce((students, fee) => {
      const studentId = fee.student?._id?.toString();
      if (!studentId) return students;
      if (!students[studentId]) {
        students[studentId] = { student: fee.student, collected: 0, pending: 0 };
      }
      students[studentId].collected += fee.paid;
      students[studentId].pending += fee.pending;
      return students;
    }, {})),
    monthlyTrend: Object.values(trends).map((month) => ({
      month: month.month,
      expected: fromCents(month.expected),
      collected: fromCents(month.collected),
      pending: fromCents(month.pending),
    })),
    classWise: Object.values(classWise)
      .map((group) => ({
        ...group,
        expected: fromCents(group.expected),
        collected: fromCents(group.collected),
        pending: fromCents(group.pending),
      }))
      .sort((first, second) => first.className.localeCompare(second.className)),
    pendingBreakdown: Object.entries(pendingByMonth)
      .map(([month, pending]) => ({ month, pending: fromCents(pending) }))
      .sort((first, second) => second.month.localeCompare(first.month)),
  };
};

const validatePaymentRequest = (amount, modeOfPayment, requestId) => {
  if (
    typeof amount !== "number" ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !Number.isSafeInteger(Math.round(amount * 100)) ||
    Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7
  ) {
    return "Payment amount must be a positive number with no more than two decimal places";
  }
  if (!PAYMENT_METHODS.includes(modeOfPayment)) return "A valid payment method is required";
  if (typeof requestId !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(requestId)) {
    return "A valid Idempotency-Key header is required";
  }
  return null;
};

const calculatePaymentBalances = (paid, pending, amount) => {
  const paidCents = toCents(paid);
  const pendingCents = toCents(pending);
  const amountCents = toCents(amount);
  if (amountCents <= 0 || amountCents > pendingCents) return null;
  const nextPendingCents = Math.max(0, pendingCents - amountCents);
  return {
    paid: fromCents(paidCents + amountCents),
    pending: fromCents(nextPendingCents),
    status: nextPendingCents === 0 ? "Paid" : "Partial",
  };
};

const paymentMatchesRequest = (payment, amount, modeOfPayment) =>
  toCents(payment.amount) === toCents(amount) && payment.modeOfPayment === modeOfPayment;

// @desc    Generate this month's fee record for every active student
// @route   POST /api/fees/generate
// @access  Admin
const generateMonthlyFees = asyncHandler(async (req, res) => {
  const { month, dueDate } = req.body;
  if (typeof month !== "string" || !MONTH_PATTERN.test(month)) {
    res.status(400);
    throw new Error("month is required in YYYY-MM format");
  }
  const parsedDueDate = dueDate ? validDateOnly(dueDate) : null;
  if (dueDate && !parsedDueDate) {
    res.status(400);
    throw new Error("dueDate must be a valid YYYY-MM-DD date");
  }

  const academyId = requireAcademyId(req);
  const students = await Student.find({ academyId, status: "Active" });
  const created = [];

  for (const student of students) {
    const exists = await Fee.findOne({ academyId, student: student._id, month });
    if (exists) continue;

    const [year, m] = month.split("-").map(Number);
    const prevDate = new Date(Date.UTC(year, m - 2, 1));
    const prevMonth = `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, "0")}`;
    const prevFee = await Fee.findOne({ academyId, student: student._id, month: prevMonth });
    const carryForward = prevFee ? prevFee.pending : 0;

    try {
      const fee = await Fee.create({
        student: student._id,
        academyId,
        month,
        amount: student.monthlyFee,
        carryForward,
        paid: 0,
        dueDate: parsedDueDate,
      });
      created.push(fee);
    } catch (error) {
      if (error.code !== 11000) throw error;
      const concurrentFee = await Fee.findOne({ academyId, student: student._id, month });
      if (!concurrentFee) throw error;
    }
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
  const { month, student, status, search, class: className, batch } = req.query;
  const query = { academyId: requireAcademyId(req) };
  if (month) {
    if (typeof month !== "string" || !MONTH_PATTERN.test(month)) {
      res.status(400);
      throw new Error("month must be in YYYY-MM format");
    }
    query.month = month;
  }
  if (student) query.student = student;
  const studentQuery = { academyId: requireAcademyId(req) };
  if (className) studentQuery.class = className;
  if (batch !== undefined) studentQuery.batch = batch;
  if (search) {
    const escapedSearch = String(search).trim().slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (escapedSearch) {
      studentQuery.$or = [
        { name: { $regex: escapedSearch, $options: "i" } },
        { studentId: { $regex: escapedSearch, $options: "i" } },
      ];
    }
  }
  if (className || batch !== undefined || search) {
    const studentIds = await Student.find(studentQuery).distinct("_id");
    if (!studentIds.length) {
      return res.json({ success: true, count: 0, data: [] });
    }
    query.student = query.student
      ? { $in: studentIds.filter((id) => id.toString() === query.student.toString()) }
      : { $in: studentIds };
  }

  if (status === "Overdue") {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    query.pending = { $gt: 0 };
    query.dueDate = { $ne: null, $lt: today };
  } else if (status) {
    const storedStatus = status === "Partially Paid" ? "Partial" : status;
    if (!["Paid", "Partial", "Pending"].includes(storedStatus)) {
      res.status(400);
      throw new Error("status must be Paid, Partially Paid, Pending, or Overdue");
    }
    query.status = storedStatus;
  }

  const fees = await Fee.find(query)
    .populate("student", "name studentId class batch parentName phone parentWhatsapp")
    .sort({ month: -1 });
  const now = new Date();
  res.json({
    success: true,
    count: fees.length,
    data: fees.map((fee) => {
      const data = fee.toObject();
      delete data.paymentHistory;
      return {
        ...data,
        paymentCount: fee.paymentHistory.length || (toCents(fee.paid) > 0 ? 1 : 0),
        displayStatus: getDisplayStatus(fee, now),
      };
    }),
  });
});

// @desc    Get a student's own fee records
// @route   GET /api/fees/my
// @access  Student
const getMyFees = asyncHandler(async (req, res) => {
  const fees = await Fee.find(academyFilter(req, { student: req.user._id })).sort({ month: -1 });
  const now = new Date();
  res.json({
    success: true,
    data: fees.map((fee) => ({
      ...fee.toObject(),
      paymentHistory: getRecordedPayments(fee),
      displayStatus: getDisplayStatus(fee, now),
    })),
  });
});

// @desc    Record a payment against a fee record
// @route   PUT /api/fees/:id/pay
// @access  Admin
const recordPayment = asyncHandler(async (req, res) => {
  const { amount, modeOfPayment } = req.body;
  const requestId = req.get("Idempotency-Key");
  const paymentMode = modeOfPayment || "Cash";
  const validationError = validatePaymentRequest(amount, paymentMode, requestId);
  if (validationError) {
    res.status(400);
    throw new Error(validationError);
  }

  const academyId = requireAcademyId(req);
  const fee = await Fee.findOne(academyFilter(req, { _id: req.params.id }));
  if (!fee) {
    res.status(404);
    throw new Error("Fee record not found");
  }

  const studentExists = await Student.exists({ _id: fee.student, academyId });
  if (!studentExists) {
    res.status(404);
    throw new Error("The student for this fee record no longer exists. Payment cannot be recorded.");
  }

  const existingPayment = fee.paymentHistory.find((payment) => payment.requestId === requestId);
  if (existingPayment) {
    if (!paymentMatchesRequest(existingPayment, amount, paymentMode)) {
      res.status(409);
      throw new Error("This Idempotency-Key was already used for a different payment");
    }
    return res.json({ success: true, duplicate: true, data: fee, payment: existingPayment });
  }

  if (!calculatePaymentBalances(fee.paid, fee.pending, amount)) {
    res.status(400);
    throw new Error("Payment amount cannot exceed the outstanding balance");
  }

  const payment = {
    _id: new mongoose.Types.ObjectId(),
    requestId,
    amount,
    date: new Date(),
    modeOfPayment: paymentMode,
    receiptNumber: `RCPT-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
  };
  const legacyPayment = createLegacyPaymentSnapshot(fee);
  const nextPaid = { $round: [{ $add: [{ $ifNull: ["$paid", 0] }, amount] }, 2] };
  const nextPending = {
    $round: [
      { $max: [0, { $subtract: [{ $ifNull: ["$pending", 0] }, amount] }] },
      2,
    ],
  };
  let updatedFee;
  try {
    updatedFee = await Fee.findOneAndUpdate(
      {
        _id: fee._id,
        academyId,
        pending: { $gte: amount },
        "paymentHistory.requestId": { $ne: requestId },
      },
      [
        {
          $set: {
            paid: nextPaid,
            pending: nextPending,
            status: {
              $cond: [
                { $lte: [nextPending, 0] },
                "Paid",
                { $cond: [{ $gt: [nextPaid, 0] }, "Partial", "Pending"] },
              ],
            },
            paymentDate: { $literal: payment.date },
            modeOfPayment: { $literal: paymentMode },
            receiptNumber: { $literal: payment.receiptNumber },
            paymentHistory: {
              $concatArrays: [
                { $ifNull: ["$paymentHistory", []] },
                legacyPayment ? {
                  $cond: [
                    {
                      $and: [
                        { $eq: [{ $size: { $ifNull: ["$paymentHistory", []] } }, 0] },
                        { $gt: [{ $ifNull: ["$paid", 0] }, 0] },
                      ],
                    },
                    [{
                      $mergeObjects: [
                        { $literal: legacyPayment },
                        { outstandingBalance: { $ifNull: ["$pending", 0] } },
                      ],
                    }],
                    [],
                  ],
                } : [],
                [{
                  $mergeObjects: [
                    { $literal: payment },
                    { outstandingBalance: nextPending },
                  ],
                }],
              ],
            },
          },
        },
      ],
      { new: true }
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
  }

  if (!updatedFee) {
    const refreshedFee = await Fee.findOne(academyFilter(req, { _id: req.params.id }));
    const replayedPayment = refreshedFee?.paymentHistory.find((entry) => entry.requestId === requestId);
    if (replayedPayment) {
      if (!paymentMatchesRequest(replayedPayment, amount, paymentMode)) {
        res.status(409);
        throw new Error("This Idempotency-Key was already used for a different payment");
      }
      return res.json({ success: true, duplicate: true, data: refreshedFee, payment: replayedPayment });
    }
    if (!refreshedFee) {
      res.status(404);
      throw new Error("Fee record not found");
    }
    if (toCents(refreshedFee.pending) < toCents(amount)) {
      res.status(409);
      throw new Error("The outstanding balance changed. Refresh the fee record before retrying.");
    }
    res.status(409);
    throw new Error("This payment request could not be applied. Refresh the fee record and try again.");
  }

  await notifyStudent(
    updatedFee.student,
    "PAYMENT_SUCCESSFUL",
    "Payment Received",
    `Your payment of ₹${amount} for ${updatedFee.month} has been recorded. Receipt: ${payment.receiptNumber}.`,
    updatedFee._id
  );

  const recordedPayment = updatedFee.paymentHistory.find((entry) => entry.requestId === requestId);
  res.json({ success: true, data: updatedFee, payment: recordedPayment });
});

// @desc    View append-only payment history for one monthly fee record
// @route   GET /api/fees/:id/payments
// @access  Admin
const getPaymentHistory = asyncHandler(async (req, res) => {
  const fee = await Fee.findOne(academyFilter(req, { _id: req.params.id }));
  if (!fee) {
    res.status(404);
    throw new Error("Fee record not found");
  }
  res.json({ success: true, data: getRecordedPayments(fee) });
});

// @desc    Get trusted receipt details for a recorded payment
// @route   GET /api/fees/:id/receipts/:paymentId
// @access  Admin
const getPaymentReceipt = asyncHandler(async (req, res) => {
  const academyId = requireAcademyId(req);
  const fee = await Fee.findOne(academyFilter(req, { _id: req.params.id }));
  if (!fee) {
    res.status(404);
    throw new Error("Fee record not found");
  }
  const payment = getRecordedPayments(fee).find((entry) => entry._id.toString() === req.params.paymentId);
  if (!payment) {
    res.status(404);
    throw new Error("Payment receipt not found");
  }
  const [student, academy] = await Promise.all([
    Student.findOne({ _id: fee.student, academyId }).select("name studentId class batch parentName phone"),
    Academy.findById(academyId).select("academyName logo address city state country"),
  ]);
  if (!student) {
    res.status(404);
    throw new Error("The student for this receipt no longer exists");
  }
  res.json({
    success: true,
    data: {
      academy: academy ? {
        name: academy.academyName,
        logo: academy.logo,
        address: [academy.address, academy.city, academy.state, academy.country].filter(Boolean).join(", "),
      } : { name: "Academy", logo: "", address: "" },
      student: {
        name: student.name,
        studentId: student.studentId,
        class: student.class,
        batch: student.batch || "",
        parentName: student.parentName,
        phone: student.phone,
      },
      month: fee.month,
      payment,
      outstandingBalance: payment.outstandingBalance ?? fee.pending,
      legacy: Boolean(payment.legacy),
    },
  });
});

// @desc    Refuse to rewrite historical payment data
// @route   PUT /api/fees/:id/undo-payment
// @access  Admin
const undoPayment = asyncHandler(async (req, res) => {
  const fee = await Fee.findOne(academyFilter(req, { _id: req.params.id }));
  if (!fee) {
    res.status(404);
    throw new Error("Fee record not found");
  }
  if (fee.paid <= 0 && !fee.paymentHistory.length) {
    res.status(400);
    throw new Error("This fee record has no payment to undo");
  }
  res.status(409);
  throw new Error("Recorded payments are immutable. Use a separate adjustment transaction to correct this balance.");
});

// @desc    Delete one monthly fee record
// @route   DELETE /api/fees/:id
// @access  Admin
const deleteFee = asyncHandler(async (req, res) => {
  const fee = await Fee.findOne(academyFilter(req, { _id: req.params.id }));
  if (!fee) {
    res.status(404);
    throw new Error("Fee record not found");
  }
  const deletedFee = await Fee.findOneAndDelete({
    _id: fee._id,
    academyId: requireAcademyId(req),
    paid: { $lte: 0 },
    "paymentHistory.0": { $exists: false },
  });
  if (!deletedFee) {
    const latestFee = await Fee.findOne(academyFilter(req, { _id: fee._id }));
    if (!latestFee) {
      res.status(404);
      throw new Error("Fee record not found");
    }
    res.status(409);
    throw new Error("A fee record with payment history cannot be deleted");
  }

  res.json({ success: true, message: "Fee record deleted" });
});

// @desc    Fee summary for the Admin dashboard
// @route   GET /api/fees/summary
// @access  Admin
const getFeeSummary = asyncHandler(async (req, res) => {
  const fees = await Fee.find({ academyId: requireAcademyId(req) }).populate("student", "name studentId class");
  res.json({ success: true, data: calculateFeeSummary(fees) });
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

module.exports = {
  generateMonthlyFees,
  getFees,
  getMyFees,
  recordPayment,
  undoPayment,
  deleteFee,
  getPaymentHistory,
  getPaymentReceipt,
  getFeeSummary,
  sendManualReminder,
  calculateFeeSummary,
  getDisplayStatus,
  getRecordedPayments,
  createLegacyPaymentSnapshot,
  validatePaymentRequest,
  calculatePaymentBalances,
  paymentMatchesRequest,
  toCents,
};
