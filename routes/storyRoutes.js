const express = require("express");
const router = express.Router();
const upload = require("../middleware/upload");
const cloudinary = require("../config/cloudinary");
const { protect, adminOnly } = require("../middleware/auth");
const { getStory, updateStory } = require("../controllers/storyController");

router.use(protect, adminOnly);
const requireCloudinaryForImage = (req, res, next) => {
  if (req.headers["content-type"]?.includes("multipart/form-data") && !cloudinary.cloudinaryConfigured) {
    res.status(503);
    return next(new Error("Image uploads are not configured. Add Cloudinary credentials or use an image URL."));
  }
  next();
};

router.get("/", getStory);
router.put("/", requireCloudinaryForImage, upload.single("leaderPhoto"), updateStory);

module.exports = router;
