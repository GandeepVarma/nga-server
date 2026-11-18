const asyncHandler = require("express-async-handler");
const crypto = require("crypto");
const Academy = require("../models/Academy");
const Teacher = require("../models/Teacher");
const Student = require("../models/Student");
const Plan = require("../models/Plan");
const Attendance = require("../models/Attendance");
const Fee = require("../models/Fee");
const Test = require("../models/Test");
const Assignment = require("../models/Assignment");
const OnlineTest = require("../models/OnlineTest");
const Submission = require("../models/Submission");
const QuestionBank = require("../models/QuestionBank");
const Notification = require("../models/Notification");
const NotificationLog = require("../models/NotificationLog");
const Settings = require("../models/Settings");
const SubscriptionAuditLog = require("../models/SubscriptionAuditLog");

// Generates a sequential, human-readable academy ID like "ACADEMY_001".
// Simple counting approach — fine for Phase 1's scale; the schema's unique
// index on academyId still guarantees no duplicate is ever persisted even
// in the rare case of a collision, which the while-loop below also guards.
const generateAcademyId = async () => {
  const count = await Academy.countDocuments();
  let attempt = count + 1;
  while (await Academy.findOne({ academyId: `ACADEMY_${String(attempt).padStart(3, "0")}` })) {
    attempt += 1;
  }
  return `ACADEMY_${String(attempt).padStart(3, "0")}`;
};

// Generates a temporary password to hand to a new Academy Admin — this
// project has no outbound email system, so Super Admin sees it once in the
// creation response and shares it with the academy owner directly.
const generateTempPassword = () => `${crypto.randomBytes(24).toString("hex")}aA1!`;

// @desc    Platform-wide statistics for the Super Admin dashboard.
//          Revenue/subscription figures are Phase 3 — returned as explicit
//          placeholders rather than fabricated numbers.
// @route   GET /api/super-admin/dashboard
// @access  Super Admin
const getDashboard = asyncHandler(async (req, res) => {
  const [totalAcademies, activeAcademies, pendingAcademies, suspendedAcademies, rejectedAcademies, totalStudents, totalTeachers] = await Promise.all([
    Academy.countDocuments(),
    Academy.countDocuments({ status: "ACTIVE" }),
    Academy.countDocuments({ status: { $in: ["PENDING", "APPROVED"] } }),
    Academy.countDocuments({ status: "SUSPENDED" }),
    Academy.countDocuments({ status: "REJECTED" }),
    Student.countDocuments(),
    Teacher.countDocuments({ role: { $in: ["teacher", "admin"] } }),
  ]);

  const recentAcademies = await Academy.find().sort({ createdAt: -1 }).limit(5).populate("approvedPlan", "name");

  res.json({
    success: true,
    data: {
      totalAcademies,
      activeAcademies,
      pendingAcademies,
      suspendedAcademies,
      rejectedAcademies,
      // Kept for anything still reading the old field name
      disabledAcademies: suspendedAcademies,
      totalStudents,
      totalTeachers,
      recentAcademies,
      revenue: null,
      activeSubscriptions: null,
      phase3ComingSoon: true,
    },
  });
});

// @desc    Create a new Academy AND its first Academy Admin account together
// @route   POST /api/super-admin/academies
// @access  Super Admin
const createAcademy = asyncHandler(async (req, res) => {
  const { academyName, ownerName, ownerEmail, phone, address, city, state, country, logo, status, plan, billingCycle } = req.body;

  if (!academyName || !ownerName || !ownerEmail || !phone) {
    res.status(400);
    throw new Error("academyName, ownerName, ownerEmail and phone are required");
  }

  const existingAdmin = await Teacher.findOne({ email: ownerEmail.toLowerCase().trim() });
  if (existingAdmin) {
    res.status(400);
    throw new Error("A staff account with this owner email already exists");
  }

  const academyId = await generateAcademyId();
  const validStatuses = ["PENDING", "APPROVED", "REJECTED", "ACTIVE", "SUSPENDED"];

  const normalizedPlan = plan ? (await Plan.findById(plan))?.name?.toLowerCase() || "free" : "free";

  const academy = await Academy.create({
    academyId, academyName, ownerName, ownerEmail, phone, address, city, state, country, logo,
    plan: normalizedPlan,
    requestedPlan: plan || null,
    approvedPlan: status === "PENDING" ? null : (plan || null),
    subscriptionStatus: status === "PENDING" ? "pending" : "active",
    billingCycle: billingCycle === "yearly" ? "yearly" : "monthly",
    // Manual Super Admin creation defaults straight to ACTIVE (skips the
    // approval workflow public self-registration requires), but Super
    // Admin can still pick a different starting status if needed.
    status: validStatuses.includes(status) ? status : "ACTIVE",
  });

  const tempPassword = generateTempPassword();
  const admin = await Teacher.create({
    name: ownerName,
    email: ownerEmail,
    password: tempPassword,
    role: "admin",
    phone,
    academyId: academy._id,
  });

  res.status(201).json({
    success: true,
    data: {
      academy,
      admin: { _id: admin._id, name: admin.name, email: admin.email },
      temporaryPassword: tempPassword,
    },
  });
});

// @desc    List academies with search, status filter, sort, pagination
// @route   GET /api/super-admin/academies?search=&status=&sort=&page=&limit=
// @access  Super Admin
const getAcademies = asyncHandler(async (req, res) => {
  const { search, status, sort = "-createdAt", page = 1, limit = 15 } = req.query;
  const query = {};
  if (status) query.status = status;
  if (search) {
    query.$or = [
      { academyName: { $regex: search, $options: "i" } },
      { ownerName: { $regex: search, $options: "i" } },
      { ownerEmail: { $regex: search, $options: "i" } },
      { academyId: { $regex: search, $options: "i" } },
    ];
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [academies, total] = await Promise.all([
    Academy.find(query)
      .populate("requestedPlan", "name")
      .populate("approvedPlan", "name")
      .sort(sort).skip(skip).limit(Number(limit)),
    Academy.countDocuments(query),
  ]);

  res.json({ success: true, count: academies.length, total, page: Number(page), data: academies });
});

// @desc    Academy details + basic usage counts
// @route   GET /api/super-admin/academies/:id
// @access  Super Admin
const getAcademyById = asyncHandler(async (req, res) => {
  const academy = await Academy.findById(req.params.id);
  if (!academy) {
    res.status(404);
    throw new Error("Academy not found");
  }

  const academyTeachers = await Teacher.find({ academyId: academy._id });
  const teacherIds = academyTeachers.filter((t) => t.role === "teacher").map((t) => t._id);
  const adminAccount = academyTeachers.find((t) => t.role === "admin");

  // Students aren't directly tagged with an academyId in Phase 1 — usage
  // here is derived transitively through assignedTeacher, which already exists.
  const studentCount = await Student.countDocuments({ assignedTeacher: { $in: teacherIds } });

  res.json({
    success: true,
    data: {
      academy,
      usage: {
        students: studentCount,
        teachers: teacherIds.length,
        // No separate Parent login exists in this app — reported as a
        // linked-contact count, not a fabricated separate figure.
        parentContactsLinkedViaStudents: studentCount,
      },
      adminAccount: adminAccount ? { _id: adminAccount._id, name: adminAccount.name, email: adminAccount.email } : null,
    },
  });
});

// @desc    Edit academy details
// @route   PUT /api/super-admin/academies/:id
// @access  Super Admin
const updateAcademy = asyncHandler(async (req, res) => {
  const academy = await Academy.findById(req.params.id);
  if (!academy) {
    res.status(404);
    throw new Error("Academy not found");
  }

  const fields = ["academyName", "ownerName", "phone", "address", "city", "state", "country", "logo"];
  fields.forEach((f) => { if (req.body[f] !== undefined) academy[f] = req.body[f]; });

  await academy.save();
  res.json({ success: true, data: academy });
});

// @desc    Change an academy's workflow status: approve, reject, activate,
//          or suspend. Soft — never deletes data.
// @route   PUT /api/super-admin/academies/:id/status
// @body    { status: "PENDING" | "APPROVED" | "REJECTED" | "ACTIVE" | "SUSPENDED" }
// @access  Super Admin
const setAcademyStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const validStatuses = ["PENDING", "APPROVED", "REJECTED", "ACTIVE", "SUSPENDED"];
  if (!validStatuses.includes(status)) {
    res.status(400);
    throw new Error(`status must be one of: ${validStatuses.join(", ")}`);
  }

  const academy = await Academy.findById(req.params.id);
  if (!academy) {
    res.status(404);
    throw new Error("Academy not found");
  }

  academy.status = status;
  if (status === "REJECTED") {
    academy.subscriptionStatus = "rejected";
    academy.approvedPlan = null;
  } else if (status === "SUSPENDED") {
    academy.subscriptionStatus = "suspended";
  } else if (status === "PENDING") {
    academy.subscriptionStatus = "pending";
  } else if (status === "ACTIVE" && academy.approvedPlan) {
    academy.subscriptionStatus = "active";
  }
  await academy.save();

  res.json({ success: true, message: `Academy status set to ${status}`, data: academy });
});

// @desc    Approve an academy with any plan selected by Super Admin
// @route   PUT /api/super-admin/academies/:id/plan
// @body    { planId, reason? }
const assignAcademyPlan = asyncHandler(async (req, res) => {
  const { planId, reason = "" } = req.body;
  const [academy, plan] = await Promise.all([
    Academy.findById(req.params.id),
    Plan.findOne({ _id: planId, isActive: true }),
  ]);
  if (!academy) { res.status(404); throw new Error("Academy not found"); }
  if (!plan) { res.status(400); throw new Error("A valid active plan is required"); }

  const previousPlan = academy.approvedPlan;
  const previousStatus = academy.status;
  academy.approvedPlan = plan._id;
  academy.plan = String(plan.name).trim().toLowerCase();
  if (previousStatus === "PENDING") {
    academy.subscriptionStatus = "active";
    academy.status = "ACTIVE";
  } else if (previousStatus === "ACTIVE" || previousStatus === "APPROVED") {
    academy.subscriptionStatus = "active";
  } else if (previousStatus === "SUSPENDED") {
    academy.subscriptionStatus = "suspended";
  } else if (previousStatus === "REJECTED") {
    academy.subscriptionStatus = "rejected";
  }
  await academy.save();
  await SubscriptionAuditLog.create({ academyId: academy._id, previousPlan, newPlan: plan._id, changedBy: req.user._id, reason });

  res.json({ success: true, message: `Academy approved with ${plan.name}`, data: academy });
});

// @desc    Set academy-specific feature overrides. Values are booleans.
// @route   PUT /api/super-admin/academies/:id/features
const updateAcademyFeatures = asyncHandler(async (req, res) => {
  const { overrides } = req.body;
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    res.status(400); throw new Error("overrides must be an object of feature names and booleans");
  }
  const academy = await Academy.findById(req.params.id);
  if (!academy) { res.status(404); throw new Error("Academy not found"); }
  for (const [feature, enabled] of Object.entries(overrides)) {
    if (typeof enabled !== "boolean") { res.status(400); throw new Error(`Override for ${feature} must be boolean`); }
    academy.featureOverrides.set(feature, enabled);
  }
  await academy.save();
  res.json({ success: true, data: academy });
});

const deleteAcademy = asyncHandler(async (req, res) => {
  const session = await Academy.startSession();
  const academyId = req.params.id;
  const deleted = {};
  try {
    await session.withTransaction(async () => {
      const academy = await Academy.findById(academyId).session(session);
      if (!academy) {
        const error = new Error("Academy not found");
        error.status = 404;
        throw error;
      }
      const scopedDeletes = [
        ["submissions", Submission], ["notifications", Notification], ["notificationLogs", NotificationLog],
        ["attendance", Attendance], ["fees", Fee], ["assignments", Assignment], ["tests", Test],
        ["onlineTests", OnlineTest], ["questionBank", QuestionBank], ["students", Student],
        ["teachers", Teacher], ["settings", Settings],
      ];
      for (const [name, Model] of scopedDeletes) {
        const result = await Model.deleteMany({ academyId }).session(session);
        deleted[name] = result.deletedCount;
      }
      await Academy.deleteOne({ _id: academyId }).session(session);
      deleted.academies = 1;
    });
  } finally {
    await session.endSession();
  }
  res.json({ success: true, message: "Academy and all tenant data deleted", data: { academyId, deleted } });
});

// ---------- Plan management ----------

// @desc    List all plans (including inactive ones — the public endpoint
//          only returns active plans; this admin view shows everything)
// @route   GET /api/super-admin/plans
// @access  Super Admin
const getPlans = asyncHandler(async (req, res) => {
  const plans = await Plan.find().sort({ sortOrder: 1, priceMonthly: 1 });
  res.json({ success: true, data: plans });
});

// @desc    Create a new plan
// @route   POST /api/super-admin/plans
// @access  Super Admin
const createPlan = asyncHandler(async (req, res) => {
  const { name, priceMonthly, priceYearly, studentLimit, teacherLimit, features, sortOrder } = req.body;
  if (!name || priceMonthly === undefined || priceYearly === undefined) {
    res.status(400);
    throw new Error("name, priceMonthly and priceYearly are required");
  }
  const plan = await Plan.create({ name, priceMonthly, priceYearly, studentLimit, teacherLimit, features, sortOrder });
  res.status(201).json({ success: true, data: plan });
});

// @desc    Update a plan (price changes take effect for the public Pricing
//          page immediately — existing academies on the plan are unaffected
//          in Phase 1 since there's no active billing enforcement yet)
// @route   PUT /api/super-admin/plans/:id
// @access  Super Admin
const updatePlan = asyncHandler(async (req, res) => {
  const plan = await Plan.findById(req.params.id);
  if (!plan) {
    res.status(404);
    throw new Error("Plan not found");
  }
  const fields = ["name", "priceMonthly", "priceYearly", "studentLimit", "teacherLimit", "features", "isActive", "sortOrder"];
  fields.forEach((f) => { if (req.body[f] !== undefined) plan[f] = req.body[f]; });
  await plan.save();
  res.json({ success: true, data: plan });
});

module.exports = {
  getDashboard, createAcademy, getAcademies, getAcademyById, updateAcademy, setAcademyStatus,
  generateTempPassword,
  getPlans, createPlan, updatePlan, deleteAcademy,
  assignAcademyPlan, updateAcademyFeatures,
};
