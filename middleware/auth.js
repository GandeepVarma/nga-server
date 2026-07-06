const jwt = require("jsonwebtoken");
const asyncHandler = require("express-async-handler");
const Teacher = require("../models/Teacher");
const Student = require("../models/Student");

// Verifies the JWT from the Authorization header and attaches the
// authenticated user (teacher or student) to req.user, along with req.userRole.
const protect = asyncHandler(async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
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
      req.userRole = "student";
    } else {
      req.user = await Teacher.findById(decoded.id).select("-password");
      req.userRole = "teacher";
    }

    if (!req.user) {
      res.status(401);
      throw new Error("Not authorized, user no longer exists");
    }

    next();
  } catch (error) {
    res.status(401);
    throw new Error("Not authorized, token invalid or expired");
  }
});

// Restricts a route to teachers only
const teacherOnly = (req, res, next) => {
  if (req.userRole !== "teacher") {
    res.status(403);
    throw new Error("Access denied: teachers only");
  }
  next();
};

// Restricts a route to students only
const studentOnly = (req, res, next) => {
  if (req.userRole !== "student") {
    res.status(403);
    throw new Error("Access denied: students only");
  }
  next();
};

module.exports = { protect, teacherOnly, studentOnly };
