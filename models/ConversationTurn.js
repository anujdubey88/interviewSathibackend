const mongoose = require("mongoose");

const conversationTurnSchema = new mongoose.Schema(
    {
        sessionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "InterviewSession",
            required: true,
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },

        turnNumber: { type: Number, required: true }, // 1, 2, 3...

        // ── Question from Gemini ──
        question: {
            text: { type: String, required: true },
            category: { type: String, default: "" }, // e.g. "event-loop", "closures"
        },

        // ── User's Answer ──
        answer: {
            text: { type: String, default: "" },
            inputMethod: {
                type: String,
                enum: ["text", "voice"],
                default: "text",
            },
            submittedAt: { type: Date },
        },

        // ── Gemini's Evaluation of the answer ──
        evaluation: {
            score: { type: Number, default: 0 }, // 0-10
            feedback: { type: String, default: "" },
            wasCorrect: { type: Boolean, default: false },
            keyPointsMissed: { type: [String], default: [] },
            evaluatedAt: { type: Date, default: null },
        },

        isSessionComplete: { type: Boolean, default: false },
    },
    { timestamps: true }
);

module.exports = mongoose.model("ConversationTurn", conversationTurnSchema);
