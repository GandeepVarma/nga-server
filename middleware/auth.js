const jwt = require("jsonwebtoken");
const asyncHandler = require("express-async-handler");
const Teacher = require("../models/Teacher");
const Student = require("../models/Student");

// Verifies the JWT and attaches the authenticated user to req.user.
// req.userType is "staff" (a Teacher-collection account, admin or teacher)
// or "student". req.user.role holds "admin" | "teacher" for staff accounts.
const protect = asyncHandler(async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    res.status(401);
    throw new Error("Not authorized, no token provided");
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.role === "student") {
      req.user = await Student.findById(decoded.id).select("-password");
      req.userType = "student";
    } else {
      req.user = await Teacher.findById(decoded.id).select("-password");
      req.userType = "staff";
    }

    if (!req.user) {
      res.status(401);
      throw new Error("Not authorized, user no longer exists");
    }

    if (req.userType === "staff" && req.user.isActive === false) {
      res.status(403);
      throw new Error("This account has been deactivated. Contact the academy admin.");
    }

    // Backwards-compatible alias used by existing route files
    req.userRole = req.userType === "staff" ? "teacher" : "student";

    next();
  } catch (error) {
    res.status(401);
    throw new Error(error.message || "Not authorized, token invalid or expired");
  }
});

// Restricts a route to any authenticated staff account (admin or teacher),
// regardless of which of the two specific roles they hold.
const teacherOnly = (req, res, next) => {
  if (req.userType !== "staff") {
    res.status(403);
    throw new Error("Access denied: staff only");
  }
  next();
};

const studentOnly = (req, res, next) => {
  if (req.userType !== "student") {
    res.status(403);
    throw new Error("Access denied: students only");
  }
  next();
};

// Fine-grained role check for staff accounts, e.g. authorizeRoles("admin")
// or authorizeRoles("admin", "teacher"). Must run after `protect`.
const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (req.userType !== "staff" || !roles.includes(req.user.role)) {
      res.status(403);
      throw new Error(`Access denied: requires role ${roles.join(" or ")}`);
    }
    next();
  };
};

const adminOnly = authorizeRoles("admin");

module.exports = { protect, teacherOnly, studentOnly, authorizeRoles, adminOnly };
