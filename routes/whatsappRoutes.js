const express = require("express");
const router = express.Router();
const {
  getSettings, updateSettings, sendTestMessage, sendBroadcastMessage, getLogs, retryMessage,
} = require("../controllers/whatsappController");
const { protect, teacherOnly, adminOnly } = require("../middleware/auth");
const { requireFeature } = require("../middleware/featureAccess");

// Settings/credentials — Admin only, this is academy-wide configuration
router.get("/settings", protect, adminOnly, requireFeature("whatsappReminders"), getSettings);
router.put("/settings", protect, adminOnly, requireFeature("whatsappReminders"), updateSettings);
router.post("/settings/test", protect, adminOnly, requireFeature("whatsappReminders"), sendTestMessage);

// Broadcast + logs — any staff account, scoped to their own students inside the controller
router.post("/broadcast", protect, teacherOnly, requireFeature("whatsappReminders"), sendBroadcastMessage);
router.get("/logs", protect, teacherOnly, requireFeature("whatsappReminders"), getLogs);
router.post("/logs/:id/retry", protect, teacherOnly, requireFeature("whatsappReminders"), retryMessage);

module.exports = router;
