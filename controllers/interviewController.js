const InterviewSession = require("../models/InterviewSession");
const ConversationTurn = require("../models/ConversationTurn");
const User = require("../models/User");
const {
    startInterview,
    continueInterview,
    generateSessionSummary,
} = require("../services/geminiService");
const { consumeGroqCallQuota } = require("../services/groqQuotaService");

const consumeQuotaOrReject = async (res, userId) => {
    const quota = await consumeGroqCallQuota(userId);

    if (!quota.allowed) {
        res.status(429).json({
            success: false,
            message: `Daily Groq limit reached. You can make up to ${quota.limit} AI calls per day.`,
            quota,
        });
        return null;
    }

    return quota;
};

const ALLOWED_PROGRAMS = new Set([
    "javascript",
    "nodejs",
    "react",
    "nextjs",
    "system-design",
    "fullstack",
    "dsa",
    "mongodb",
    "typescript",
    "expressjs",
    "html-css",
    "devops",
]);

const ALLOWED_LEVELS = new Set([
    "beginner",
    "intermediate",
    "advanced-intermediate",
    "expert",
    "pro",
]);

const getAnsweredTurnsForSession = async (sessionId) => {
    return ConversationTurn.find({
        sessionId,
        "answer.submittedAt": { $ne: null },
    }).select("evaluation");
};

const isEvaluatedTurn = (turn) => {
    const hasNumericScore = typeof turn.evaluation?.score === "number";
    if (!hasNumericScore) {
        return false;
    }

    // Primary signal for new data; fallback handles legacy turns created before this field.
    if (turn.evaluation?.evaluatedAt) {
        return true;
    }

    const hasFeedback =
        typeof turn.evaluation?.feedback === "string" &&
        turn.evaluation.feedback.trim().length > 0;
    const hasMissedPoints =
        Array.isArray(turn.evaluation?.keyPointsMissed) &&
        turn.evaluation.keyPointsMissed.length > 0;

    return hasFeedback || hasMissedPoints;
};

const calculateRunningSessionScore = (answeredTurns) => {
    const scoredTurns = answeredTurns.filter(isEvaluatedTurn);

    if (!scoredTurns.length) {
        return 0;
    }

    const avgOutOf10 =
        scoredTurns.reduce((sum, t) => sum + (t.evaluation?.score ?? 0), 0) /
        scoredTurns.length;

    return Math.round(avgOutOf10);
};

const recalculateUserStats = async (
    userId,
    { includeActiveScoredSessions = false } = {}
) => {
    const completedSessions = await InterviewSession.find({
        userId,
        status: "completed",
    }).select("feedback.overallScore");

    let activeScoredSessions = [];
    if (includeActiveScoredSessions) {
        const activeSessions = await InterviewSession.find({
            userId,
            status: "active",
        }).select("_id");

        if (activeSessions.length) {
            const activeScores = await Promise.all(
                activeSessions.map(async (s) => {
                    const answeredTurns = await getAnsweredTurnsForSession(s._id);
                    const runningScore = calculateRunningSessionScore(answeredTurns);
                    const hasEvaluatedTurns = answeredTurns.some(isEvaluatedTurn);
                    return hasEvaluatedTurns ? runningScore : null;
                })
            );

            activeScoredSessions = activeScores
                .filter((score) => score !== null)
                .map((score) => ({
                    feedback: { overallScore: score },
                }));
        }
    }

    const sessionsForAverage = [
        ...completedSessions,
        ...activeScoredSessions,
    ];
    const newTotal = completedSessions.length;
    const newAvgScore =
        sessionsForAverage.length > 0
            ? sessionsForAverage.reduce(
                (sum, s) => sum + (s.feedback?.overallScore ?? 0),
                0
            ) / sessionsForAverage.length
            : 0;

    await User.findByIdAndUpdate(userId, {
        totalSessions: newTotal,
        averageScore: Math.round(newAvgScore),
    });
};

// ─── Helper: Fetch full past session data for system prompt ───────────────────
/**
 * Fetches past completed sessions + their turns for a user.
 * This is only used ONCE at session start to build the system prompt.
 * Returns an array of { session, turns[] } objects.
 */
const fetchPastSessionsData = async (userId, excludeSessionId = null) => {
    const query = { userId, status: "completed" };
    if (excludeSessionId) query._id = { $ne: excludeSessionId };

    const pastSessions = await InterviewSession.find(query)
        .sort({ createdAt: -1 })
        .limit(5); // Last 5 sessions for context

    // Fetch turns for each session
    const pastSessionsData = await Promise.all(
        pastSessions.map(async (s) => {
            const turns = await ConversationTurn.find({ sessionId: s._id })
                .sort({ turnNumber: 1 })
                .select("turnNumber question answer evaluation");
            return { session: s, turns };
        })
    );

    return pastSessionsData;
};

// ─── START SESSION ────────────────────────────────────────────────────────────
/**
 * POST /api/interview/start
 * Body: { program, level }
 *
 * Strategy: Fetches FULL past sessions + all their turns.
 * Passes this to Gemini as system prompt context (one-time full context).
 */
const startSession = async (req, res) => {
    try {
        const program = (req.body.program || "").trim();
        const level = (req.body.level || "").trim();

        if (!program || !level) {
            return res
                .status(400)
                .json({ success: false, message: "Program and level are required." });
        }

        if (!ALLOWED_PROGRAMS.has(program)) {
            return res
                .status(400)
                .json({ success: false, message: "Invalid program selected." });
        }

        if (!ALLOWED_LEVELS.has(level)) {
            return res
                .status(400)
                .json({ success: false, message: "Invalid difficulty level selected." });
        }

        // Create the new session
        const session = await InterviewSession.create({
            userId: req.user._id,
            program,
            level,
            status: "active",
        });

        // ── Fetch FULL past history for system prompt (one-time context) ──
        const pastSessionsData = await fetchPastSessionsData(
            req.user._id,
            session._id
        );

        const quota = await consumeQuotaOrReject(res, req.user._id);
        if (!quota) return;

        // ── Call Gemini with full past context ────────────────────────────
        const geminiResponse = await startInterview({
            user: req.user,
            session,
            pastSessionsData, // Full past Q&A sent to system prompt
        });

        // Save the first turn (question only, no answer yet)
        const turn = await ConversationTurn.create({
            sessionId: session._id,
            userId: req.user._id,
            turnNumber: 1,
            question: {
                text: geminiResponse.nextQuestion?.text || "",
                category: geminiResponse.nextQuestion?.category || "",
            },
        });

        res.status(201).json({
            success: true,
            message: "Interview session started.",
            sessionId: session._id,
            turnId: turn._id,
            turnNumber: 1,
            question: geminiResponse.nextQuestion,
            quota,
        });
    } catch (error) {
        console.error("startSession error:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── SUBMIT ANSWER ────────────────────────────────────────────────────────────
/**
 * POST /api/interview/answer
 * Body: { sessionId, turnId, answer, inputMethod }
 *
 * Strategy: Only fetches the SINGLE PREVIOUS turn to send to Gemini.
 * Past context is already in Gemini's system prompt (from session start).
 */
const submitAnswer = async (req, res) => {
    try {
        const { sessionId, turnId, answer, inputMethod = "text" } = req.body;

        if (!sessionId || !turnId || !answer) {
            return res.status(400).json({
                success: false,
                message: "sessionId, turnId, and answer are required.",
            });
        }

        // Validate session
        const session = await InterviewSession.findById(sessionId);
        if (!session || session.status !== "active") {
            return res
                .status(404)
                .json({ success: false, message: "Active session not found." });
        }

        // Get & update current turn with the user's answer
        const currentTurn = await ConversationTurn.findById(turnId);
        if (!currentTurn) {
            return res
                .status(404)
                .json({ success: false, message: "Turn not found." });
        }

        currentTurn.answer = {
            text: answer,
            inputMethod,
            submittedAt: new Date(),
        };
        await currentTurn.save();

        // ── Fetch ONLY the previous turn for Gemini context ──────────────
        // (Not all turns — just the one before the current)
        const previousTurn =
            currentTurn.turnNumber > 1
                ? await ConversationTurn.findOne({
                    sessionId,
                    turnNumber: currentTurn.turnNumber - 1,
                })
                : null;

        // Re-fetch past sessions for system prompt (same as start)
        const pastSessionsData = await fetchPastSessionsData(
            req.user._id,
            sessionId
        );

        const currentSessionQuestions = (
            await ConversationTurn.find({ sessionId })
                .sort({ turnNumber: 1 })
                .select("question.text")
        )
            .map((t) => t.question?.text)
            .filter((text) => typeof text === "string" && text.trim().length > 0)
            .map((text) => text.trim());

        const quota = await consumeQuotaOrReject(res, req.user._id);
        if (!quota) return;

        // ── Call Gemini: only the previous turn as history ────────────────
        const geminiResponse = await continueInterview({
            user: req.user,
            session,
            previousTurn, // ← ONLY 1 previous turn, not full history
            userAnswer: answer,
            pastSessionsData,
            currentSessionQuestions,
        });

        // Save evaluation to the current turn
        let currentSessionScore = session.feedback?.overallScore ?? 0;
        if (geminiResponse.evaluation) {
            currentTurn.evaluation = {
                score: geminiResponse.evaluation.score ?? 0,
                feedback: geminiResponse.evaluation.feedback ?? "",
                wasCorrect: geminiResponse.evaluation.wasCorrect ?? false,
                keyPointsMissed: geminiResponse.evaluation.keyPointsMissed ?? [],
                evaluatedAt: new Date(),
            };
            currentTurn.isSessionComplete = geminiResponse.isSessionComplete || false;
            await currentTurn.save();

            // Keep a running session score (0-100) so dashboard/history can show progress.
            const answeredTurns = await getAnsweredTurnsForSession(sessionId);
            currentSessionScore = calculateRunningSessionScore(answeredTurns);
            session.feedback.overallScore = currentSessionScore;
            session.totalTurns = answeredTurns.length;
            await session.save();

            // Keep user-level average in sync with live, in-progress session scoring.
            await recalculateUserStats(req.user._id, {
                includeActiveScoredSessions: true,
            });
        }

        // Update user question count
        await User.findByIdAndUpdate(req.user._id, {
            $inc: { totalQuestionsAnswered: 1 },
        });

        // ── Session complete? ─────────────────────────────────────────────
        if (geminiResponse.isSessionComplete) {
            return await handleSessionComplete({
                res,
                session,
                geminiResponse,
                user: req.user,
            });
        }

        // ── Save next question as new turn ────────────────────────────────
        const nextTurn = await ConversationTurn.create({
            sessionId: session._id,
            userId: req.user._id,
            turnNumber: currentTurn.turnNumber + 1,
            question: {
                text: geminiResponse.nextQuestion?.text || "",
                category: geminiResponse.nextQuestion?.category || "",
            },
        });

        const latestUser = await User.findById(req.user._id).select("averageScore");

        res.status(200).json({
            success: true,
            evaluation: geminiResponse.evaluation,
            currentSessionScore,
            currentAverageScore: latestUser?.averageScore ?? 0,
            nextQuestion: geminiResponse.nextQuestion,
            turnId: nextTurn._id,
            turnNumber: nextTurn.turnNumber,
            isSessionComplete: false,
            quota,
        });
    } catch (error) {
        console.error("submitAnswer error:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── HANDLE SESSION COMPLETE ──────────────────────────────────────────────────
const handleSessionComplete = async ({ res, session, geminiResponse, user }) => {
    try {
        let sessionSummary = geminiResponse.sessionSummary;

        // Fallback: generate summary if Gemini didn't include it
        if (!sessionSummary) {
            const allTurns = await ConversationTurn.find({
                sessionId: session._id,
            }).sort({ turnNumber: 1 });

            const quota = await consumeQuotaOrReject(res, user._id);
            if (!quota) return;

            sessionSummary = await generateSessionSummary({
                user,
                session,
                allTurns,
            });
        }

        // Update session record
        session.status = "completed";
        session.completedAt = new Date();
        session.totalTurns = 10;
        session.feedback = {
            overallScore: sessionSummary.overallScore ?? 0,
            strengths: sessionSummary.strengths ?? [],
            weaknesses: sessionSummary.weaknesses ?? [],
            suggestions: sessionSummary.suggestions ?? [],
            summary: sessionSummary.summary ?? "",
        };
        await session.save();

        // Recalculate user stats after session completion.
        await recalculateUserStats(user._id);

        res.status(200).json({
            success: true,
            isSessionComplete: true,
            evaluation: geminiResponse.evaluation,
            sessionSummary: session.feedback,
            sessionId: session._id,
        });
    } catch (error) {
        console.error("handleSessionComplete error:", error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── END SESSION (Manual abandon) ────────────────────────────────────────────
const endSession = async (req, res) => {
    try {
        const { sessionId } = req.body;

        const session = await InterviewSession.findById(sessionId);
        if (!session || session.userId.toString() !== req.user._id.toString()) {
            return res
                .status(404)
                .json({ success: false, message: "Session not found." });
        }
        if (session.status === "completed") {
            return res
                .status(400)
                .json({ success: false, message: "Session already completed." });
        }

        const allTurns = await ConversationTurn.find({ sessionId }).sort({
            turnNumber: 1,
        });

        const quota = await consumeQuotaOrReject(res, req.user._id);
        if (!quota) return;

        const sessionSummary = await generateSessionSummary({
            user: req.user,
            session,
            allTurns,
        });

        session.status = "completed";
        session.completedAt = new Date();
        session.totalTurns = allTurns.length;
        session.feedback = {
            overallScore: sessionSummary.overallScore ?? 0,
            strengths: sessionSummary.strengths ?? [],
            weaknesses: sessionSummary.weaknesses ?? [],
            suggestions: sessionSummary.suggestions ?? [],
            summary: sessionSummary.summary ?? "",
        };
        await session.save();

        await recalculateUserStats(req.user._id);

        res.status(200).json({
            success: true,
            message: "Session ended.",
            sessionSummary: session.feedback,
            quota,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── GET ALL SESSIONS ─────────────────────────────────────────────────────────
const getSessions = async (req, res) => {
    try {
        const sessions = await InterviewSession.find({ userId: req.user._id })
            .sort({ createdAt: -1 })
            .select("-__v");

        const normalizedSessions = await Promise.all(
            sessions.map(async (sessionDoc) => {
                const session = sessionDoc.toObject();

                if (session.status !== "active") {
                    return session;
                }

                const answeredTurns = await getAnsweredTurnsForSession(session._id);
                const liveScore = calculateRunningSessionScore(answeredTurns);

                session.totalTurns = answeredTurns.length;
                session.feedback = {
                    ...(session.feedback || {}),
                    overallScore: liveScore,
                };

                return session;
            })
        );

        res.status(200).json({ success: true, sessions: normalizedSessions });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─── GET SESSION DETAIL ───────────────────────────────────────────────────────
const getSessionDetail = async (req, res) => {
    try {
        const { id } = req.params;

        const sessionDoc = await InterviewSession.findById(id);
        if (!sessionDoc || sessionDoc.userId.toString() !== req.user._id.toString()) {
            return res
                .status(404)
                .json({ success: false, message: "Session not found." });
        }

        const turns = await ConversationTurn.find({ sessionId: id })
            .sort({ turnNumber: 1 })
            .select("-__v");

        const session = sessionDoc.toObject();
        if (session.status === "active") {
            const answeredTurns = turns.filter((t) => t.answer?.submittedAt);
            const liveScore = calculateRunningSessionScore(answeredTurns);

            session.totalTurns = answeredTurns.length;
            session.feedback = {
                ...(session.feedback || {}),
                overallScore: liveScore,
            };
        }

        res.status(200).json({ success: true, session, turns });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    startSession,
    submitAnswer,
    endSession,
    getSessions,
    getSessionDetail,
};
