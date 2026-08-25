const jwt = require("jsonwebtoken");

// Encodes user id + role into the JWT so middleware/auth.js can
// look the user up in the right collection (Teacher vs Student).
const generateToken = (id, role, academyId = null) => {
  return jwt.sign({ id, role, academyId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || "7d",
  });
};

module.exports = generateToken;
