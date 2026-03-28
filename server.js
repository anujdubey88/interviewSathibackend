const express = require("express");
const mongoose = require("mongoose");
const cookieParser = require("cookie-parser");
const cors = require("cors");
require("dotenv").config();

const authRoutes = require("./routes/authRoutes");
const interviewRoutes = require("./routes/interviewRoutes");
const userRoutes = require("./routes/userRoutes");

const app = express();

// ─── Middlewares ─────────────────────────────────────────────────────────────
app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  })
);

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/interview", interviewRoutes);
app.use("/api/user", userRoutes);

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "InterviewSathi API is running 🚀" });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("Global Error:", err.message);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
});

// ─── DB + Server Start ────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

const connectDB = async () => {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error(
        "MONGO_URI is not defined in .env file. Please set it to a valid MongoDB connection string."
      );
    }

    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    console.log("✅ MongoDB connected successfully");
    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      console.log(
        `📡 API Health Check: http://localhost:${PORT}/api/health`
      );
    });
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err.message);
    console.error(
      "\n📝 Troubleshooting:\n",
      "1. Ensure MongoDB is running locally (mongosh works?)\n",
      "2. Or use MongoDB Atlas: mongodb+srv://username:password@cluster.mongodb.net/interviewsath\n",
      "3. Update your .env MONGO_URI value\n"
    );
    process.exit(1);
  }
};

connectDB();
