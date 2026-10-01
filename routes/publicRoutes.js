const express = require("express");
const router = express.Router();
const { getPublicPlans, getPublicAcademies, getPublicPrograms, getPublicStory, getPublicDigitalHub, getPublicResults, registerAcademy } = require("../controllers/publicController");

router.get("/plans", getPublicPlans);
router.get("/academies", getPublicAcademies);
router.get("/programs", getPublicPrograms);
router.get("/story", getPublicStory);
router.get("/digital-hub", getPublicDigitalHub);
router.get("/results", getPublicResults);
router.post("/register-academy", registerAcademy);

module.exports = router;
