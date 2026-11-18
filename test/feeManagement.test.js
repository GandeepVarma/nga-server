const test = require("node:test");
const assert = require("node:assert/strict");
const Fee = require("../models/Fee");
const {
  calculateFeeSummary,
  calculatePaymentBalances,
  createLegacyPaymentSnapshot,
  getDisplayStatus,
  getRecordedPayments,
  paymentMatchesRequest,
  validatePaymentRequest,
} = require("../controllers/feeController");

const now = new Date("2026-11-18T11:30:00.000Z");

test("fee summary calculates expected, collected, pending, overdue, and date-based collections", () => {
  const fees = [
    {
      month: "2026-11",
      amount: 100,
      carryForward: 25,
      paid: 50,
      pending: 75,
      status: "Partial",
      dueDate: new Date("2026-11-17T00:00:00.000Z"),
      student: { _id: "student-a", class: "Class 1" },
      paymentHistory: [
        { amount: 20, date: new Date("2026-11-18T08:00:00.000Z") },
        { amount: 30, date: new Date("2026-11-18T10:00:00.000Z") },
      ],
    },
    {
      month: "2026-11",
      amount: 100,
      carryForward: 0,
      paid: 0,
      pending: 100,
      status: "Pending",
      dueDate: new Date("2026-11-18T00:00:00.000Z"),
      student: { _id: "student-b", class: "Class 2" },
      paymentHistory: [],
    },
  ];

  const summary = calculateFeeSummary(fees, now);
  assert.equal(summary.totalExpectedFees, 225);
  assert.equal(summary.totalCollection, 50);
  assert.equal(summary.pendingCollection, 175);
  assert.equal(summary.overdueCollection, 75);
  assert.equal(summary.overdueFeeCount, 1);
  assert.equal(summary.todaysCollection, 50);
  assert.equal(summary.monthlyCollection, 50);
  assert.deepEqual(summary.classWise.map(({ className, expected }) => [className, expected]), [
    ["Class 1", 125],
    ["Class 2", 100],
  ]);
  assert.equal(fees[0].paymentHistory.length, 2);
});

test("legacy aggregate payments remain visible without rewriting history", () => {
  const fee = {
    amount: 100,
    carryForward: 0,
    paid: 40,
    pending: 60,
    paymentDate: new Date("2026-11-18T09:00:00.000Z"),
    modeOfPayment: "Cash",
    receiptNumber: "LEGACY-1",
    paymentHistory: [],
  };
  const payments = getRecordedPayments(fee);

  assert.equal(payments.length, 1);
  assert.equal(payments[0].amount, 40);
  assert.equal(payments[0].legacy, true);
  assert.equal(fee.paymentHistory.length, 0);
});

test("legacy payment snapshots are appended with their original details before newer payments", () => {
  const fee = {
    _id: "507f1f77bcf86cd799439011",
    paid: 40,
    pending: 60,
    paymentDate: new Date("2026-11-18T09:00:00.000Z"),
    modeOfPayment: "UPI",
    receiptNumber: "OLD-RECEIPT",
    paymentHistory: [],
  };
  const snapshot = createLegacyPaymentSnapshot(fee);

  assert.equal(snapshot.amount, 40);
  assert.equal(snapshot.date, fee.paymentDate);
  assert.equal(snapshot.modeOfPayment, "UPI");
  assert.equal(snapshot.receiptNumber, "OLD-RECEIPT");
  assert.equal(snapshot.legacy, true);
  assert.equal(fee.paid, 40);
  assert.equal(fee.paymentHistory.length, 0);
});

test("legacy aggregate payments contribute to lifetime totals, not date-specific collection", () => {
  const summary = calculateFeeSummary([{
    month: "2026-11",
    amount: 100,
    carryForward: 0,
    paid: 40,
    pending: 60,
    dueDate: null,
    paymentDate: new Date("2026-11-18T09:00:00.000Z"),
    paymentHistory: [],
  }], now);

  assert.equal(summary.totalCollection, 40);
  assert.equal(summary.todaysCollection, 0);
  assert.equal(summary.monthlyCollection, 0);
});

test("overdue display status is derived from the due date and outstanding balance", () => {
  assert.equal(getDisplayStatus({
    dueDate: new Date("2026-11-17T00:00:00.000Z"),
    pending: 1,
    status: "Partial",
  }, now), "Overdue");
  assert.equal(getDisplayStatus({
    dueDate: new Date("2026-11-18T00:00:00.000Z"),
    pending: 1,
    status: "Pending",
  }, now), "Pending");
  assert.equal(getDisplayStatus({
    dueDate: new Date("2026-11-17T00:00:00.000Z"),
    pending: 0,
    status: "Paid",
  }, now), "Paid");
});

test("payment requests require a valid positive currency amount, method, and idempotency key", () => {
  assert.equal(validatePaymentRequest(20.5, "UPI", "request-123456"), null);
  assert.match(validatePaymentRequest(0, "Cash", "request-123456"), /positive number/);
  assert.match(validatePaymentRequest(20.555, "Cash", "request-123456"), /two decimal places/);
  assert.match(validatePaymentRequest(20, "Unknown", "request-123456"), /payment method/);
  assert.match(validatePaymentRequest(20, "Cash", "short"), /Idempotency-Key/);
});

test("partial and full payments update balances in cents and reject overpayment", () => {
  assert.deepEqual(calculatePaymentBalances(0, 100, 25.5), {
    paid: 25.5,
    pending: 74.5,
    status: "Partial",
  });
  assert.deepEqual(calculatePaymentBalances(25.5, 74.5, 74.5), {
    paid: 100,
    pending: 0,
    status: "Paid",
  });
  assert.equal(calculatePaymentBalances(0, 100, 100.01), null);
});

test("payment retries only match their original amount and payment method", () => {
  const payment = { amount: 25, modeOfPayment: "UPI" };

  assert.equal(paymentMatchesRequest(payment, 25, "UPI"), true);
  assert.equal(paymentMatchesRequest(payment, 25.01, "UPI"), false);
  assert.equal(paymentMatchesRequest(payment, 25, "Cash"), false);
});

test("payment history stores append-only transaction details and unique request keys", () => {
  const historyPath = Fee.schema.path("paymentHistory");
  const requestIdIndex = Fee.schema.indexes().find(([keys, options]) =>
    keys["paymentHistory.requestId"] === 1 && options.unique && options.sparse
  );

  assert.ok(historyPath);
  assert.ok(requestIdIndex);
  assert.ok(historyPath.schema.path("amount"));
  assert.ok(historyPath.schema.path("date"));
  assert.ok(historyPath.schema.path("outstandingBalance"));
});
