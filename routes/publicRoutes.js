const express = require("express");
const router = express.Router();
const { getPublicPlans, getPublicAcademies, registerAcademy } = require("../controllers/publicController");

router.get("/plans", getPublicPlans);
router.get("/academies", getPublicAcademies);
router.post("/register-academy", registerAcademy);

module.exports = router;
