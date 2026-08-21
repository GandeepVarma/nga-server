const asyncHandler = require("express-async-handler");
const Plan = require("../models/Plan");
const Academy = require("../models/Academy");
const Teacher = require("../models/Teacher");

// @desc    Active pricing plans for the public Pricing page
// @route   GET /api/public/plans
// @access  Public
const getPublicPlans = asyncHandler(async (req, res) => {
  const plans = await Plan.find({ isActive: true }).sort({ sortOrder: 1, priceMonthly: 1 });
  res.json({ success: true, data: plans });
});

// @desc    ACTIVE academies only — populates the dropdown on /academy-login.
//          Returns only id + name + logo, nothing sensitive, no auth needed.
// @route   GET /api/public/academies
// @access  Public
const getPublicAcademies = asyncHandler(async (req, res) => {
  const academies = await Academy.find({ status: "ACTIVE" })
    .select("academyId academyName logo")
    .sort({ academyName: 1 });
  res.json({ success: true, data: academies });
});

// @desc    New academy self-registration. Creates the Academy (status
//          PENDING) and its Academy Admin account together, but the admin
//          CANNOT log in until Super Admin approves and status becomes
//          ACTIVE. If offline payment is chosen, approval implies the
//          payment was manually verified by Super Admin — there's no
//          gateway in Phase 1 to verify anything automatically.
// @route   POST /api/public/register-academy
// @access  Public
const registerAcademy = asyncHandler(async (req, res) => {
  const {
    academyName, ownerName, ownerEmail, phone, address, city, state, country,
    plan, billingCycle, paymentMethod, paymentProofUrl, password,
  } = req.body;

  if (!academyName || !ownerName || !ownerEmail || !phone || !password) {
    res.status(400);
    throw new Error("academyName, ownerName, ownerEmail, phone and password are required");
  }
  if (password.length < 6) {
    res.status(400);
    throw new Error("Password must be at least 6 characters");
  }
  if (!["online", "offline"].includes(paymentMethod)) {
    res.status(400);
    throw new Error("Select a payment method: online or offline");
  }

  const existing = await Teacher.findOne({ email: ownerEmail.toLowerCase().trim() });
  if (existing) {
    res.status(400);
    throw new Error("An account with this email already exists");
  }

  if (plan) {
    const planDoc = await Plan.findById(plan);
    if (!planDoc || !planDoc.isActive) {
      res.status(400);
      throw new Error("Selected plan is not available");
    }
  }

  const count = await Academy.countDocuments();
  let attempt = count + 1;
  while (await Academy.findOne({ academyId: `ACADEMY_${String(attempt).padStart(3, "0")}` })) attempt += 1;
  const academyId = `ACADEMY_${String(attempt).padStart(3, "0")}`;

  const academy = await Academy.create({
    academyId, academyName, ownerName, ownerEmail, phone, address, city, state, country,
    plan: plan || null,
    billingCycle: billingCycle === "yearly" ? "yearly" : "monthly",
    paymentMethod,
    paymentProofUrl: paymentMethod === "offline" ? paymentProofUrl || "" : "",
    status: "PENDING",
  });

  await Teacher.create({
    name: ownerName,
    email: ownerEmail,
    password,
    role: "admin",
    phone,
    academyId: academy._id,
  });

  res.status(201).json({
    success: true,
    message: "Registration submitted. Your academy will be reviewed and activated by our team shortly.",
    data: { academyId: academy.academyId, status: academy.status },
  });
});

module.exports = { getPublicPlans, getPublicAcademies, registerAcademy };
