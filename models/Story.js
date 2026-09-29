const mongoose = require("mongoose");

const storySchema = new mongoose.Schema(
  {
    academyId: { type: mongoose.Schema.Types.ObjectId, ref: "Academy", required: true, unique: true, index: true },
    heading: { type: String, default: "WHERE LEARNING BECOMES UNDERSTANDING", trim: true },
    intro: { type: String, default: "", trim: true },
    story: { type: String, default: "", trim: true },
    vision: { type: String, default: "", trim: true },
    mission: { type: String, default: "", trim: true },
    leaderName: { type: String, default: "", trim: true },
    leaderRole: { type: String, default: "Principal / Mentor", trim: true },
    leaderPhotoUrl: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Story", storySchema);
