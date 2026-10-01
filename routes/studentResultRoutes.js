const express = require("express");
const router = express.Router();
const upload = require("../middleware/upload");
const cloudinary = require("../config/cloudinary");
const { protect, adminOnly } = require("../middleware/auth");
const { getResults, createResult, updateResult, deleteResult } = require("../controllers/studentResultController");

router.use(protect, adminOnly);

const requireCloudinaryForImages = (req, res, next) => {
  if (req.is("multipart/form-data") && !cloudinary.cloudinaryConfigured) {
    res.status(503);
    return next(new Error("Image uploads are not configured. Add Cloudinary credentials or use image URLs."));
  }
  next();
};

const uploadResultPhotos = upload.fields([
  { name: "beforePhoto", maxCount: 1 },
  { name: "afterPhoto", maxCount: 1 },
]);

router.get("/", getResults);
router.post("/", requireCloudinaryForImages, uploadResultPhotos, createResult);
router.put("/:id", requireCloudinaryForImages, uploadResultPhotos, updateResult);
router.delete("/:id", deleteResult);

module.exports = router;