const Academy = require("../models/Academy");
const { PLAN_FEATURES, normalizePlanKey, getFeatureAccessForPlan } = require("../config/planFeatures");

const featureUnavailable = (res, plan = "free", feature = "") => {
  res.status(403);
  return res.json({
    success: false,
    code: "FEATURE_NOT_AVAILABLE",
    message: "This feature is not available in your current plan.",
    plan,
    feature,
  });
};

const getAcademyFeatureAccess = async (academyId) => {
  if (!academyId) {
    return { active: true, plan: "free", features: new Set(Object.keys(PLAN_FEATURES.free).filter((key) => PLAN_FEATURES.free[key])) };
  }

  const academy = await Academy.findById(academyId).populate("approvedPlan", "name features");

  if (!academy) {
    return { active: false, plan: "free", features: new Set() };
  }

  const planName = normalizePlanKey(academy.plan || academy.approvedPlan?.name || academy.requestedPlan?.name || "free");
  const baseFeatures = getFeatureAccessForPlan(planName);
  const features = new Set(
    Object.entries(baseFeatures)
      .filter(([, enabled]) => enabled)
      .map(([feature]) => feature)
  );

  if (academy.featureOverrides instanceof Map) {
    for (const [feature, enabled] of academy.featureOverrides.entries()) {
      if (enabled) features.add(feature);
      else features.delete(feature);
    }
  }

  const isActive = academy.subscriptionStatus === "active" || academy.status === "ACTIVE";
  return {
    active: isActive && Boolean(baseFeatures),
    plan: planName,
    features,
    subscriptionStatus: academy.subscriptionStatus,
    status: academy.status,
  };
};

const requireFeature = (feature) => async (req, res, next) => {
  if (req.user?.role === "super_admin") {
    return next();
  }

  const access = await getAcademyFeatureAccess(req.academyId);
  if (!access.active || !access.features.has(feature)) {
    return featureUnavailable(res, access.plan, feature);
  }

  next();
};

module.exports = { getAcademyFeatureAccess, requireFeature, featureUnavailable };