const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const studentSchema = new mongoose.Schema(
  {
    studentId: {
      type: String,
      required: [true, "Student ID is required"],
      unique: true,
      trim: true,
      uppercase: true,
    },
    name: {
      type: String,
      required: [true, "Student name is required"],
      trim: true,
    },
    parentName: {
      type: String,
      required: [true, "Parent name is required"],
      trim: true,
    },
    phone: {
      type: String,
      required: [true, "Phone number is required"],
      trim: true,
    },
    parentWhatsapp: {
      type: String,
      trim: true,
      default: "", // defaults to `phone` at send-time if left blank
    },
    studentWhatsapp: {
      type: String,
      trim: true,
      default: "",
    },
    preferredLanguage: {
      type: String,
      enum: ["English", "Telugu"],
      default: "English",
    },
    dateOfJoining: {
      type: Date,
      required: true,
      default: Date.now,
    },
    class: {
      type: String,
      required: [true, "Class is required"],
      trim: true,
    },
    batch: {
      type: String,
      trim: true,
      default: "",
    },
    // Every student belongs to exactly one teacher. Admin can reassign.
    assignedTeacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Teacher",
      required: [true, "Every student must be assigned to a teacher"],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: 6,
      select: false,
    },
    passwordChangedAt: {
      type: Date,
      select: false,
    },
    monthlyFee: {
      type: Number,
      required: true,
      default: 0,
    },
    admissionFee: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["Active", "Inactive"],
      default: "Active",
    },
    profilePhoto: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

studentSchema.index({ name: "text", studentId: "text", phone: "text" });

studentSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

studentSchema.methods.matchPassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model("Student", studentSchema);
