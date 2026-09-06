const mongoose = require("mongoose");

const getAcademyId = (req) => {
  if (req.userType === "student") return req.user.academyId || null;
  if (req.user?.role === "super_admin") return null;
  return req.user?.academyId || null;
};

const requireAcademyId = (req) => {
  const academyId = getAcademyId(req);
  if (!academyId) {
    const error = new Error("Authenticated account is not assigned to an academy");
    error.status = 403;
    throw error;
  }
  return academyId;
};

const academyFilter = (req, extra = {}) => ({
  ...extra,
  academyId: requireAcademyId(req),
});

const stripTenantFields = (body) => {
  const data = { ...body };
  delete data.academyId;
  delete data.tenantId;
  return data;
};

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

module.exports = { getAcademyId, requireAcademyId, academyFilter, stripTenantFields, isValidObjectId };