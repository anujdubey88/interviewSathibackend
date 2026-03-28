const mongoose = require("mongoose");

const interviewSessionSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },

        // ── Session Config ──
        program: {
            type: String,
            required: true,
            enum: [
                "nodejs",
                "html-css",
                "javascript",
                "react",
                "nextjs",
                "system-design",
                "fullstack",
                "dsa",
                "mongodb",
                "devops",
                "typescript",
                "expressjs",
            ],
        },
        level: {
            type: String,
            required: true,
            enum: [
                "beginner",
                "intermediate",
                "advanced-intermediate",
                "expert",
                "pro",
            ],
        },

        status: {
            type: String,
            enum: ["active", "completed", "abandoned"],
            default: "active",
        },

        totalTurns: { type: Number, default: 0 },

        // ── Gemini-generated final feedback ──
        feedback: {
            overallScore: { type: Number, default: 0 }, // 0-100
            strengths: { type: [String], default: [] },
            weaknesses: { type: [String], default: [] },
            suggestions: { type: [String], default: [] },
            summary: { type: String, default: "" },
        },

        startedAt: { type: Date, default: Date.now },
        completedAt: { type: Date },
    },
    { timestamps: true }
);

module.exports = mongoose.model("InterviewSession", interviewSessionSchema);
