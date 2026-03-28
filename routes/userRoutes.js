const express = require("express");
const { getProfile, updatePreferences } = require("../controllers/userController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.use(protect);

router.get("/profile", getProfile);
router.put("/preferences", updatePreferences);

module.exports = router;
