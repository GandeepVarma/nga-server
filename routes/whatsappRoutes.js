const express = require("express");
const router = express.Router();
const {
  getSettings, updateSettings, sendTestMessage, sendBroadcastMessage, getLogs, retryMessage,
} = require("../controllers/whatsappController");
const { protect, teacherOnly, adminOnly } = require("../middleware/auth");

// Settings/credentials — Admin only, this is academy-wide configuration
router.get("/settings", protect, adminOnly, getSettings);
router.put("/settings", protect, adminOnly, updateSettings);
router.post("/settings/test", protect, adminOnly, sendTestMessage);

// Broadcast + logs — any staff account, scoped to their own students inside the controller
router.post("/broadcast", protect, teacherOnly, sendBroadcastMessage);
router.get("/logs", protect, teacherOnly, getLogs);
router.post("/logs/:id/retry", protect, teacherOnly, retryMessage);

module.exports = router;
