const jwt = require("jsonwebtoken");
const User = require("../models/User");

// ─── Generate JWT ─────────────────────────────────────────────────────────────
const generateToken = (userId) => {
    return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    });
};

// ─── Send token as httpOnly cookie ───────────────────────────────────────────
const sendTokenCookie = (res, token) => {
    res.cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
};

// ─── SIGNUP ───────────────────────────────────────────────────────────────────
const signup = async (req, res) => {
    try {
        const { name, email, password } = req.body;

        if (!name || !email || !password) {
            return res
                .status(400)
                .json({ success: false, message: "All fields are required." });
        }

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res
                .status(409)
                .json({ success: false, message: "Email already registered." });
        }

        const user = await User.create({ name, email, password });
        const token = generateToken(user._id);
        sendTokenCookie(res, token);

        res.status(201).json({
            success: true,
            message: "Account created successfully.",
            token,
            user: {
                _id: user._id,
                name: user.name,
                email: user.email,
                preferredPrograms: user.preferredPrograms,
                preferredLevel: user.preferredLevel,
                totalSessions: user.totalSessions,
                averageScore: user.averageScore,
            },
        });
    } catch (error) {
        console.error("Signup error:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── LOGIN ────────────────────────────────────────────────────────────────────
const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res
                .status(400)
                .json({ success: false, message: "Email and password are required." });
        }

        const user = await User.findOne({ email }).select("+password");
        if (!user || !(await user.comparePassword(password))) {
            return res
                .status(401)
                .json({ success: false, message: "Invalid email or password." });
        }

        const token = generateToken(user._id);
        sendTokenCookie(res, token);

        res.status(200).json({
            success: true,
            message: "Logged in successfully.",
            token,
            user: {
                _id: user._id,
                name: user.name,
                email: user.email,
                preferredPrograms: user.preferredPrograms,
                preferredLevel: user.preferredLevel,
                totalSessions: user.totalSessions,
                averageScore: user.averageScore,
            },
        });
    } catch (error) {
        console.error("Login error:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── LOGOUT ───────────────────────────────────────────────────────────────────
const logout = async (req, res) => {
    res.clearCookie("token");
    res.status(200).json({ success: true, message: "Logged out successfully." });
};

// ─── GET CURRENT USER ─────────────────────────────────────────────────────────
const getMe = async (req, res) => {
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
};

module.exports = { signup, login, logout, getMe };
