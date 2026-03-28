const mongoose = require("mongoose");

const userDailyGroqUsageSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    dayKey: {
      type: String,
      required: true,
      // UTC date key in YYYY-MM-DD format.
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    count: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

userDailyGroqUsageSchema.index({ userId: 1, dayKey: 1 }, { unique: true });

module.exports = mongoose.model("UserDailyGroqUsage", userDailyGroqUsageSchema);
