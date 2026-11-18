const mongoose = require("mongoose");

const paymentTransactionSchema = new mongoose.Schema(
  {
    requestId: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0.01 },
    date: { type: Date, default: null },
    modeOfPayment: {
      type: String,
      enum: ["Cash", "UPI", "Card", "Bank Transfer", "Cheque", "Other", null],
      default: null,
    },
    receiptNumber: { type: String, default: null, trim: true },
    outstandingBalance: { type: Number, required: true, min: 0 },
    legacy: { type: Boolean, default: false },
  },
  { _id: true, timestamps: false }
);

const feeSchema = new mongoose.Schema(
  {
    academyId: { type: mongoose.Schema.Types.ObjectId, ref: "Academy", required: true, index: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: "Student", required: true },
    month: { type: String, required: true },
    dueDate: { type: Date, default: null }, // optional — powers WhatsApp fee reminder scheduling
    amount: { type: Number, required: true, default: 0 },
    paid: { type: Number, default: 0 },
    pending: { type: Number, default: 0 },
    carryForward: { type: Number, default: 0 },
    paymentDate: { type: Date, default: null },
    modeOfPayment: {
      type: String,
      enum: ["Cash", "UPI", "Card", "Bank Transfer", "Cheque", "Other", null],
      default: null,
    },
    status: { type: String, enum: ["Paid", "Partial", "Pending"], default: "Pending" },
    receiptNumber: { type: String, default: null },
    // New installments are append-only; older aggregate payments are snapshotted on the next payment.
    paymentHistory: { type: [paymentTransactionSchema], default: [] },
  },
  { timestamps: true }
);

feeSchema.index({ student: 1, month: 1 }, { unique: true });
feeSchema.index({ academyId: 1, student: 1, month: 1 });
feeSchema.index({ "paymentHistory.requestId": 1 }, { unique: true, sparse: true });

feeSchema.pre("save", function (next) {
  const totalDue = this.amount + this.carryForward;
  this.pending = Math.max(totalDue - this.paid, 0);
  if (this.paid <= 0) this.status = "Pending";
  else if (this.pending > 0) this.status = "Partial";
  else this.status = "Paid";
  next();
});

module.exports = mongoose.model("Fee", feeSchema);
