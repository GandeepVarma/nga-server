const asyncHandler = require("express-async-handler");
const DigitalHub = require("../models/DigitalHub");

const getDigitalHub = asyncHandler(async (req, res) => {
  const hub = await DigitalHub.findOne({ academyId: req.academyId });
  res.json({ success: true, data: hub });
});

const updateDigitalHub = asyncHandler(async (req, res) => {
  const fields = ["heading", "intro", "closingQuote", "youtube", "instagram"];
  const values = {};
  fields.forEach((field) => {
    if (req.body[field] !== undefined) {
      values[field] = typeof req.body[field] === "string" && ["youtube", "instagram"].includes(field)
        ? JSON.parse(req.body[field])
        : req.body[field];
    }
  });
  const hub = await DigitalHub.findOneAndUpdate(
    { academyId: req.academyId },
    { $set: values, $setOnInsert: { academyId: req.academyId } },
    { new: true, upsert: true, runValidators: true }
  );
  res.json({ success: true, data: hub });
});

module.exports = { getDigitalHub, updateDigitalHub };
