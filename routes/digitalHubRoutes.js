const express = require("express");
const router = express.Router();
const { protect, adminOnly } = require("../middleware/auth");
const { getDigitalHub, updateDigitalHub } = require("../controllers/digitalHubController");

router.use(protect, adminOnly);
router.get("/", getDigitalHub);
router.put("/", updateDigitalHub);

module.exports = router;
