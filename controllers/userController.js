const User = require("../models/User");

// ─── GET USER PROFILE ─────────────────────────────────────────────────────────
const getProfile = async (req, res) => {
    try {
        res.status(200).json({
            success: true,
            user: {
                _id: req.user._id,
                name: req.user.name,
                email: req.user.email,
                preferredPrograms: req.user.preferredPrograms,
                preferredLevel: req.user.preferredLevel,
                totalSessions: req.user.totalSessions,
                totalQuestionsAnswered: req.user.totalQuestionsAnswered,
                averageScore: req.user.averageScore,
                createdAt: req.user.createdAt,
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── UPDATE PREFERENCES ───────────────────────────────────────────────────────
const updatePreferences = async (req, res) => {
    try {
        const { preferredPrograms, preferredLevel } = req.body;

        const updates = {};
        if (preferredPrograms) updates.preferredPrograms = preferredPrograms;
        if (preferredLevel) updates.preferredLevel = preferredLevel;

        const user = await User.findByIdAndUpdate(req.user._id, updates, {
            new: true,
            runValidators: true,
        });

        res.status(200).json({
            success: true,
            message: "Preferences updated.",
            user: {
                preferredPrograms: user.preferredPrograms,
                preferredLevel: user.preferredLevel,
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { getProfile, updatePreferences };
