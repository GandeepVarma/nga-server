const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");

// Stores uploads directly to Cloudinary. Works for both PDFs and images,
// which covers assignment attachments and student/teacher profile photos.
const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: "nextgen-learning-academy",
    resource_type: file.mimetype === "application/pdf" ? "raw" : "image",
    allowed_formats: ["jpg", "jpeg", "png", "webp", "pdf"],
  }),
});

const fileFilter = (req, file, cb) => {
  const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Only JPG, PNG, WEBP images and PDF files are allowed"), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
});

module.exports = upload;
