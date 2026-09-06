const PLAN_FEATURES = {
  free: {
    dashboard: true,
    students: true,
    attendance: true,
    fees: false,
    tests: false,
    assignments: false,
    studyMaterials: false,
    analytics: false,
    aiInsights: false,
    whatsappReminders: false,
    qrAttendance: false,
    advancedReports: false,
  },
  basic: {
    dashboard: true,
    students: true,
    attendance: true,
    fees: true,
    tests: true,
    assignments: false,
    studyMaterials: false,
    analytics: false,
    aiInsights: false,
    whatsappReminders: false,
    qrAttendance: false,
    advancedReports: false,
  },
  standard: {
    dashboard: true,
    students: true,
    attendance: true,
    fees: true,
    tests: true,
    assignments: true,
    studyMaterials: true,
    analytics: true,
    aiInsights: false,
    whatsappReminders: false,
    qrAttendance: true,
    advancedReports: false,
  },
  premium: {
    dashboard: true,
    students: true,
    attendance: true,
    fees: true,
    tests: true,
    assignments: true,
    studyMaterials: true,
    analytics: true,
    aiInsights: true,
    whatsappReminders: true,
    qrAttendance: true,
    advancedReports: true,
  },
};

const normalizePlanKey = (plan) => {
  if (!plan) return "free";

  if (typeof plan === "string") {
    const normalized = plan.toLowerCase().trim();
    if (PLAN_FEATURES[normalized]) return normalized;
    const match = Object.keys(PLAN_FEATURES).find((key) => key.toLowerCase() === normalized);
    return match || "free";
  }

  if (typeof plan === "object") {
    if (plan.key) return normalizePlanKey(plan.key);
    if (plan.name) return normalizePlanKey(plan.name);
  }

  return "free";
};

const getFeatureAccessForPlan = (plan) => ({
  ...PLAN_FEATURES[normalizePlanKey(plan)],
});

const hasPlanFeature = (plan, feature) => Boolean(getFeatureAccessForPlan(plan)[feature]);

const getPlanLabel = (plan) => {
  const key = normalizePlanKey(plan);
  return key.charAt(0).toUpperCase() + key.slice(1);
};

module.exports = {
  PLAN_FEATURES,
  normalizePlanKey,
  getFeatureAccessForPlan,
  hasPlanFeature,
  getPlanLabel,
};
