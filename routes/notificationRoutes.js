const express = require("express");
const router = express.Router();
const { getMyNotifications, markAsRead } = require("../controllers/notificationController");
const { protect, studentOnly } = require("../middleware/auth");

router.get("/", protect, studentOnly, getMyNotifications);
router.put("/:id/read", protect, studentOnly, markAsRead);

module.exports = router;
