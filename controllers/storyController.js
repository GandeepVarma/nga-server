const asyncHandler = require("express-async-handler");
const Story = require("../models/Story");

const getStory = asyncHandler(async (req, res) => {
  const story = await Story.findOne({ academyId: req.academyId });
  res.json({ success: true, data: story });
});

const updateStory = asyncHandler(async (req, res) => {
  const fields = ["heading", "intro", "story", "vision", "mission", "leaderName", "leaderRole", "leaderPhotoUrl"];
  const values = {};
  fields.forEach((field) => {
    if (req.body[field] !== undefined) values[field] = req.body[field];
  });
  if (req.file?.path) values.leaderPhotoUrl = req.file.path;

  const story = await Story.findOneAndUpdate(
    { academyId: req.academyId },
    { $set: values, $setOnInsert: { academyId: req.academyId } },
    { new: true, upsert: true, runValidators: true }
  );
  res.json({ success: true, data: story });
});

module.exports = { getStory, updateStory };
