const asyncHandler = require("express-async-handler");
const Program = require("../models/Program");

const normalizeFeatures = (features) => {
  if (Array.isArray(features)) return features.map((item) => String(item).trim()).filter(Boolean);
  if (typeof features === "string") return features.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
};

const getPrograms = asyncHandler(async (req, res) => {
  const programs = await Program.find({ academyId: req.academyId }).sort({ sortOrder: 1, createdAt: 1 });
  res.json({ success: true, data: programs });
});

const createProgram = asyncHandler(async (req, res) => {
  const { name, level, badge, description, features, imageUrl, monthlyFee, sortOrder, isActive } = req.body;
  if (!name || !description) {
    res.status(400);
    throw new Error("Program name and description are required");
  }

  const program = await Program.create({
    academyId: req.academyId,
    name,
    level: level || "",
    badge: badge || "Program",
    description,
    features: normalizeFeatures(features),
    imageUrl: req.file?.path || imageUrl || "",
    monthlyFee: monthlyFee === "" || monthlyFee == null ? null : Number(monthlyFee),
    sortOrder: Number(sortOrder) || 0,
    isActive: isActive !== "false",
  });
  res.status(201).json({ success: true, data: program });
});

const updateProgram = asyncHandler(async (req, res) => {
  const program = await Program.findOne({ _id: req.params.id, academyId: req.academyId });
  if (!program) {
    res.status(404);
    throw new Error("Program not found");
  }

  const allowed = ["name", "level", "badge", "description", "imageUrl", "monthlyFee", "sortOrder", "isActive"];
  allowed.forEach((field) => {
    if (req.body[field] !== undefined) program[field] = req.body[field];
  });
  if (req.body.features !== undefined) program.features = normalizeFeatures(req.body.features);
  if (req.file?.path) program.imageUrl = req.file.path;
  await program.save();
  res.json({ success: true, data: program });
});

const deleteProgram = asyncHandler(async (req, res) => {
  const program = await Program.findOneAndDelete({ _id: req.params.id, academyId: req.academyId });
  if (!program) {
    res.status(404);
    throw new Error("Program not found");
  }
  res.json({ success: true, message: "Program deleted" });
});

module.exports = { getPrograms, createProgram, updateProgram, deleteProgram };
