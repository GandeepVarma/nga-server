const express = require("express");
const router = express.Router();
const {
  getDashboard, createAcademy, getAcademies, getAcademyById, updateAcademy, setAcademyStatus,
  getPlans, createPlan, updatePlan, deleteAcademy,
} = require("../controllers/superAdminController");
const { protect, superAdminOnly } = require("../middleware/auth");

// Every route here requires an authenticated Super Admin — enforced
// server-side regardless of what the frontend does or doesn't show.
router.use(protect, superAdminOnly);

router.get("/dashboard", getDashboard);
router.route("/academies").post(createAcademy).get(getAcademies);
router.route("/academies/:id").get(getAcademyById).put(updateAcademy);
router.put("/academies/:id/status", setAcademyStatus);
router.delete("/academies/:id", deleteAcademy);

router.route("/plans").get(getPlans).post(createPlan);
router.put("/plans/:id", updatePlan);

module.exports = router;
