const express = require("express");
const {
    startSession,
    submitAnswer,
    endSession,
    getSessions,
    getSessionDetail,
} = require("../controllers/interviewController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

// All interview routes are protected
router.use(protect);

router.post("/start", startSession);
router.post("/answer", submitAnswer);
router.post("/end", endSession);
router.get("/sessions", getSessions);
router.get("/sessions/:id", getSessionDetail);

module.exports = router;
