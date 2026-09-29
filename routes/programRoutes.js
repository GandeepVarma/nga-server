const express = require("express");
const router = express.Router();
const upload = require("../middleware/upload");
const cloudinary = require("../config/cloudinary");
const { protect, adminOnly } = require("../middleware/auth");
const { getPrograms, createProgram, updateProgram, deleteProgram } = require("../controllers/programController");

router.use(protect, adminOnly);
const requireCloudinaryForImage = (req, res, next) => {
	if (req.headers["content-type"]?.includes("multipart/form-data") && !cloudinary.cloudinaryConfigured) {
		res.status(503);
		return next(new Error("Image uploads are not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET to the server environment, or use an image URL."));
	}
	next();
};

router.route("/").get(getPrograms).post(requireCloudinaryForImage, upload.single("image"), createProgram);
router.route("/:id").put(requireCloudinaryForImage, upload.single("image"), updateProgram).delete(deleteProgram);

module.exports = router;
