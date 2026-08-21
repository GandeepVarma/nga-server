const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

// Teacher collection holds both "admin" and "teacher" role accounts.
// role === "admin"   -> Main Admin, full academy access
// role === "teacher" -> regular teacher, restricted to assigned students
const teacherSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Please enter a valid email"],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: 6,
      select: false,
    },
    role: {
      type: String,
      // "admin" here means Academy Admin (per-academy). "super_admin" sits
      // above every academy and is not tied to one. Kept as "admin" rather
      // than renaming to ACADEMY_ADMIN to avoid a breaking rename of an
      // already-deployed field — see README for the mapping.
      enum: ["teacher", "admin", "super_admin"],
      default: "teacher",
    },
    // Which Academy this staff member belongs to. Null for super_admin
    // (they aren't scoped to one academy) and null for any account created
    // before this field existed — those keep working exactly as before,
    // since Phase 1 deliberately does not enforce per-query tenant
    // isolation yet (that's Phase 2). Set automatically when an Academy
    // Admin is created via Super Admin > Create Academy.
    academyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Academy",
      default: null,
    },
    phone: {
      type: String,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    profilePhoto: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

teacherSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

teacherSchema.methods.matchPassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model("Teacher", teacherSchema);
