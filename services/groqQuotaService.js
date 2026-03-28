const UserDailyGroqUsage = require("../models/UserDailyGroqUsage");

const DAILY_GROQ_CALL_LIMIT = Number.parseInt(
  process.env.DAILY_GROQ_CALL_LIMIT || "15",
  10
);

const getDayKeyUtc = (date = new Date()) => {
  return date.toISOString().slice(0, 10);
};

const consumeGroqCallQuota = async (userId) => {
  const limit = Number.isFinite(DAILY_GROQ_CALL_LIMIT) && DAILY_GROQ_CALL_LIMIT > 0
    ? DAILY_GROQ_CALL_LIMIT
    : 15;

  const dayKey = getDayKeyUtc();

  try {
    const usage = await UserDailyGroqUsage.findOneAndUpdate(
      { userId, dayKey, count: { $lt: limit } },
      {
        $inc: { count: 1 },
        $setOnInsert: { userId, dayKey },
      },
      {
        new: true,
        upsert: true,
      }
    );

    if (!usage) {
      return {
        allowed: false,
        limit,
        used: limit,
        remaining: 0,
      };
    }

    return {
      allowed: true,
      limit,
      used: usage.count,
      remaining: Math.max(limit - usage.count, 0),
    };
  } catch (error) {
    // Unique race on (userId, dayKey) can happen under concurrent requests.
    if (error?.code === 11000) {
      const latestUsage = await UserDailyGroqUsage.findOne({ userId, dayKey }).select(
        "count"
      );
      const used = latestUsage?.count || limit;
      return {
        allowed: used < limit,
        limit,
        used,
        remaining: Math.max(limit - used, 0),
      };
    }

    throw error;
  }
};

module.exports = {
  DAILY_GROQ_CALL_LIMIT,
  consumeGroqCallQuota,
};
