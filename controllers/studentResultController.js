const asyncHandler = require("express-async-handler");
const StudentResult = require("../models/StudentResult");

const resultFields = ["studentName", "programName", "marksBefore", "marksAfter", "beforePhotoUrl", "afterPhotoUrl", "sortOrder"];

const getResultValues = (req) => {
  const values = {};
  resultFields.forEach((field) => {
    if (req.body[field] !== undefined) values[field] = req.body[field];
  });
  if (req.files?.beforePhoto?.[0]?.path) values.beforePhotoUrl = req.files.beforePhoto[0].path;
  if (req.files?.afterPhoto?.[0]?.path) values.afterPhotoUrl = req.files.afterPhoto[0].path;
  return values;
};

const getResults = asyncHandler(async (req, res) => {
  const results = await StudentResult.find({ academyId: req.academyId }).sort({ sortOrder: 1, createdAt: -1 });
  res.json({ success: true, data: results });
});

const createResult = asyncHandler(async (req, res) => {
  const values = getResultValues(req);
  if (!String(values.programName || "").trim() || !String(values.marksBefore || "").trim() || !String(values.marksAfter || "").trim()) {
    res.status(400);
    throw new Error("Program and before/after marks are required");
  }

  const result = await StudentResult.create({ ...values, academyId: req.academyId });
  res.status(201).json({ success: true, data: result });
});

const updateResult = asyncHandler(async (req, res) => {
  const result = await StudentResult.findOne({ _id: req.params.id, academyId: req.academyId });
  if (!result) {
    res.status(404);
    throw new Error("Result not found");
  }

  result.set(getResultValues(req));
  await result.save();
  res.json({ success: true, data: result });
});

const deleteResult = asyncHandler(async (req, res) => {
  const result = await StudentResult.findOneAndDelete({ _id: req.params.id, academyId: req.academyId });
  if (!result) {
    res.status(404);
    throw new Error("Result not found");
  }
  res.json({ success: true, message: "Result deleted" });
});

module.exports = { getResults, createResult, updateResult, deleteResult };