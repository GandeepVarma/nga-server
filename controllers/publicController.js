const asyncHandler = require("express-async-handler");
const Plan = require("../models/Plan");
const Academy = require("../models/Academy");
const Teacher = require("../models/Teacher");
const Program = require("../models/Program");
const Story = require("../models/Story");
const DigitalHub = require("../models/DigitalHub");

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

// @desc  Active programs from active academies for the public Programs page
// @route GET /api/public/programs
// @access Public
const getPublicPrograms = asyncHandler(async (req, res) => {
  const activeAcademies = await Academy.find({ status: "ACTIVE" }).select("_id academyName").lean();
  const academyIds = activeAcademies.map((academy) => academy._id);
  const academyNames = new Map(activeAcademies.map((academy) => [String(academy._id), academy.academyName]));
  const programs = await Program.find({ academyId: { $in: academyIds }, isActive: true })
    .sort({ sortOrder: 1, createdAt: 1 })
    .lean();
  res.json({
    success: true,
    data: programs.map((program) => ({ ...program, academyName: academyNames.get(String(program.academyId)) || "" })),
  });
});

const getPublicStory = asyncHandler(async (req, res) => {
  const academy = await Academy.findOne({ status: "ACTIVE" }).select("_id academyName").sort({ isFounderAcademy: -1, createdAt: 1 });
  const story = academy ? await Story.findOne({ academyId: academy._id }).lean() : null;
  res.json({ success: true, data: story ? { ...story, academyName: academy.academyName } : null });
});

const getPublicDigitalHub = asyncHandler(async (req, res) => {
  const academy = await Academy.findOne({ status: "ACTIVE" }).select("_id").sort({ isFounderAcademy: -1, createdAt: 1 });
  const hub = academy ? await DigitalHub.findOne({ academyId: academy._id }).lean() : null;
  res.json({ success: true, data: hub });
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

  let resolvedPlanKey = "free";
  if (plan) {
    const planDoc = await Plan.findById(plan);
    if (!planDoc || !planDoc.isActive) {
      res.status(400);
      throw new Error("Selected plan is not available");
    }
    resolvedPlanKey = String(planDoc.name).trim().toLowerCase();
  }

  const count = await Academy.countDocuments();
  let attempt = count + 1;
  while (await Academy.findOne({ academyId: `ACADEMY_${String(attempt).padStart(3, "0")}` })) attempt += 1;
  const academyId = `ACADEMY_${String(attempt).padStart(3, "0")}`;

  const academy = await Academy.create({
    academyId, academyName, ownerName, ownerEmail, phone, address, city, state, country,
    plan: resolvedPlanKey,
    requestedPlan: plan || null,
    approvedPlan: null,
    subscriptionStatus: "pending",
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
    message: "Your academy registration is pending approval.",
    data: { academyId: academy.academyId, status: academy.status },
  });
});

module.exports = { getPublicPlans, getPublicAcademies, getPublicPrograms, getPublicStory, getPublicDigitalHub, registerAcademy };
