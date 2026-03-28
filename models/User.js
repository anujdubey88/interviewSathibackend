const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, "Name is required"],
            trim: true,
        },
        email: {
            type: String,
            required: [true, "Email is required"],
            unique: true,
            lowercase: true,
            trim: true,
        },
        password: {
            type: String,
            required: [true, "Password is required"],
            minlength: 6,
            select: false, // don't return password by default
        },

        // ── Interview Preferences (saved for Gemini context) ──
        preferredPrograms: {
            type: [String],
            default: [],
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
        preferredLevel: {
            type: String,
            default: "beginner",
            enum: [
                "beginner",
                "intermediate",
                "advanced-intermediate",
                "expert",
                "pro",
            ],
        },

        // ── Stats ──
        totalSessions: { type: Number, default: 0 },
        totalQuestionsAnswered: { type: Number, default: 0 },
        averageScore: { type: Number, default: 0 },
    },
    { timestamps: true }
);

// Hash password before saving
userSchema.pre("save", async function (next) {
    if (!this.isModified("password")) return next();
    this.password = await bcrypt.hash(this.password, 12);
    next();
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model("User", userSchema);
