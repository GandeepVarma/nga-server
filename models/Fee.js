const mongoose = require("mongoose");

// One Fee document represents a single student's fee record for a single month.
const feeSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
    },
    month: {
      // Stored as "YYYY-MM" for easy sorting/filtering, e.g. "2026-07"
      type: String,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      default: 0,
    },
    paid: {
      type: Number,
      default: 0,
    },
    pending: {
      type: Number,
      default: 0,
    },
    carryForward: {
      type: Number,
      default: 0, // unpaid balance rolled over from the previous month
    },
    paymentDate: {
      type: Date,
      default: null,
    },
    modeOfPayment: {
      type: String,
      enum: ["Cash", "UPI", "Card", "Bank Transfer", "Cheque", "Other", null],
      default: null,
    },
    status: {
      type: String,
      enum: ["Paid", "Partial", "Pending"],
      default: "Pending",
    },
    receiptNumber: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

feeSchema.index({ student: 1, month: 1 }, { unique: true });

// Keeps pending/status in sync whenever amount, paid, or carryForward changes
feeSchema.pre("save", function (next) {
  const totalDue = this.amount + this.carryForward;
  this.pending = Math.max(totalDue - this.paid, 0);
  if (this.paid <= 0) this.status = "Pending";
  else if (this.pending > 0) this.status = "Partial";
  else this.status = "Paid";
  next();
});

module.exports = mongoose.model("Fee", feeSchema);
