const mongoose = require("mongoose");

const digitalHubSchema = new mongoose.Schema(
  {
    academyId: { type: mongoose.Schema.Types.ObjectId, ref: "Academy", required: true, unique: true, index: true },
    heading: { type: String, default: "Our Digital Learning Ecosystem", trim: true },
    intro: { type: String, default: "We bridge classroom learning with useful online resources, study guidance and motivation.", trim: true },
    youtube: {
      name: { type: String, default: "Official YouTube Channel", trim: true },
      handle: { type: String, default: "", trim: true },
      description: { type: String, default: "Concept explainers, study guidance and motivation for students.", trim: true },
      url: { type: String, default: "https://youtube.com", trim: true },
      videoUrl: { type: String, default: "", trim: true },
      imageUrl: { type: String, default: "", trim: true },
      features: { type: [String], default: [] },
    },
    instagram: {
      name: { type: String, default: "NGA on Instagram", trim: true },
      handle: { type: String, default: "", trim: true },
      description: { type: String, default: "Academy moments, reminders and useful learning prompts.", trim: true },
      url: { type: String, default: "https://instagram.com", trim: true },
      imageUrl: { type: String, default: "", trim: true },
      features: { type: [String], default: [] },
    },
    closingQuote: { type: String, default: "We use digital content to build consistency, confidence and a serious mindset in every learner.", trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("DigitalHub", digitalHubSchema);
