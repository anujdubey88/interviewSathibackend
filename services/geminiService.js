/**
 * geminiService.js
 *
 * NOTE:
 * This file keeps its original name to avoid breaking imports,
 * but it now uses Groq API (OpenAI-compatible) under the hood.
 */

const {
    buildSystemPrompt,
    buildSingleTurnHistory,
} = require("../utils/promptBuilder");

if (!process.env.GROQ_API_KEY) {
    throw new Error(
        
        "GROQ_API_KEY not found in .env file. Please set your Groq API key."
    );
}

const GROQ_API_BASE_URL =
    process.env.GROQ_API_BASE_URL || "https://api.groq.com/openai/v1";
const PRIMARY_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const ENV_FALLBACK_MODELS = (process.env.GROQ_MODEL_FALLBACKS || "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
const DEFAULT_FALLBACK_MODELS = [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
];
const REQUEST_TIMEOUT_MS = Number(process.env.GROQ_TIMEOUT_MS || 20000);
const MAX_NETWORK_RETRIES = Number(process.env.GROQ_NETWORK_RETRIES || 2);

let resolvedModelCache = null;

const FALLBACK_OPENERS = {
    javascript: {
        beginner: "What is the difference between var, let, and const in JavaScript?",
        intermediate: "Explain JavaScript closures with one practical use case.",
        expert: "How does the JavaScript event loop prioritize microtasks and macrotasks?",
    },
    nodejs: {
        beginner: "What is Node.js and where is it typically used?",
        intermediate: "How does the event loop help Node.js handle concurrency?",
        expert: "How would you debug and prevent event-loop blocking in production Node.js apps?",
    },
    react: {
        beginner: "What is the role of state in React components?",
        intermediate: "When would you use useMemo vs useCallback?",
        expert: "How do reconciliation and keys impact React rendering performance?",
    },
    nextjs: {
        beginner: "What is the difference between server and client components in Next.js?",
        intermediate: "When should you prefer server-side rendering over static generation in Next.js?",
        expert: "How would you structure data fetching and caching for a high-traffic Next.js app?",
    },
};

const uniqueModels = (models) => {
    return [...new Set(models.filter(Boolean))];
};

const isModelNotFoundResponse = (status, errorBody) => {
    if (status !== 400 && status !== 404) {
        return false;
    }

    const body = (errorBody || "").toLowerCase();
    return (
        body.includes("model not found") ||
        body.includes("invalid model") ||
        body.includes("model_decommissioned") ||
        body.includes("decommissioned")
    );
};

const isTransientNetworkError = (error) => {
    const status = error?.statusCode;
    if (typeof status === "number" && (status >= 500 || status === 429)) {
        return true;
    }

    const msg = String(error?.message || "").toLowerCase();
    return (
        msg.includes("fetch failed") ||
        msg.includes("fetch is not defined") ||
        msg.includes("etimedout") ||
        msg.includes("econnreset") ||
        msg.includes("enotfound") ||
        msg.includes("econnrefused") ||
        msg.includes("aborted") ||
        msg.includes("network")
    );
};

const requestCompletionWithModel = async (
    model,
    messages,
    { temperature = 0.2 } = {}
) => {
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_NETWORK_RETRIES + 1; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
            const response = await fetch(`${GROQ_API_BASE_URL}/chat/completions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
                },
                body: JSON.stringify({
                    model,
                    messages,
                    temperature,
                }),
                signal: controller.signal,
            });

            if (!response.ok) {
                const errorText = await response.text();
                const err = new Error(`Groq API error (${response.status}): ${errorText}`);
                err.statusCode = response.status;
                err.errorBody = errorText;
                err.model = model;
                throw err;
            }

            const data = await response.json();
            return data?.choices?.[0]?.message?.content || "";
        } catch (error) {
            lastError = error;
            if (!isTransientNetworkError(error) || attempt > MAX_NETWORK_RETRIES) {
                throw error;
            }
        } finally {
            clearTimeout(timer);
        }
    }

    throw lastError || new Error("Groq API request failed");
};

const fetchAvailableModels = async () => {
    try {
        const response = await fetch(`${GROQ_API_BASE_URL}/models`, {
            headers: {
                Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
            },
        });

        if (!response.ok) {
            return [];
        }

        const data = await response.json();
        const models = Array.isArray(data?.data) ? data.data : [];
        return models
            .map((m) => m?.id)
            .filter((id) => typeof id === "string");
    } catch {
        return [];
    }
};

const callGrok = async (messages, { temperature = 0.2 } = {}) => {
    const baseCandidates = uniqueModels([
        resolvedModelCache,
        PRIMARY_MODEL,
        ...ENV_FALLBACK_MODELS,
        ...DEFAULT_FALLBACK_MODELS,
    ]);

    let lastError = null;

    for (const model of baseCandidates) {
        try {
            const content = await requestCompletionWithModel(model, messages, {
                temperature,
            });
            resolvedModelCache = model;
            return content;
        } catch (error) {
            lastError = error;
            if (!isModelNotFoundResponse(error.statusCode, error.errorBody)) {
                throw error;
            }
        }
    }

    const discoveredModels = await fetchAvailableModels();
    const discoveryCandidates = uniqueModels(discoveredModels).filter(
        (m) => !baseCandidates.includes(m)
    );

    for (const model of discoveryCandidates) {
        try {
            const content = await requestCompletionWithModel(model, messages, {
                temperature,
            });
            resolvedModelCache = model;
            return content;
        } catch (error) {
            lastError = error;
            if (!isModelNotFoundResponse(error.statusCode, error.errorBody)) {
                throw error;
            }
        }
    }

    throw (
        lastError ||
        new Error("Groq API error: no compatible model could be resolved.")
    );
};

const getFallbackOpener = (session) => {
    const byProgram = FALLBACK_OPENERS[session?.program] || {};

    if (session?.level === "beginner") {
        return byProgram.beginner;
    }

    if (session?.level === "intermediate" || session?.level === "advanced-intermediate") {
        return byProgram.intermediate;
    }

    return byProgram.expert;
};

const buildFallbackStartResponse = ({ user, session }) => {
    const fallbackQuestion =
        getFallbackOpener(session) ||
        `Tell me about your approach to solving ${session?.program || "technical"} problems in a production setting.`;

    return {
        evaluation: {
            score: null,
            feedback: null,
            wasCorrect: null,
            keyPointsMissed: [],
        },
        nextQuestion: {
            text: `Hey ${user?.name || "there"}! Let's begin. ${fallbackQuestion}`,
            category: "foundations",
        },
        turnNumber: 1,
        isSessionComplete: false,
        fallbackUsed: true,
    };
};

/**
 * Starts a new interview session.
 * Full past session data is injected into the system prompt.
 *
 * @param {Object} user             - User mongoose doc
 * @param {Object} session          - Current InterviewSession doc
 * @param {Array}  pastSessionsData - Array of { session, turns[] } — full past history
 * @returns {Object} Parsed Grok JSON response (first question + greeting)
 */
const startInterview = async ({ user, session, pastSessionsData = [] }) => {
    try {
        const content = await callGrok([
            {
                role: "system",
                content: buildSystemPrompt({ user, session, pastSessionsData }),
            },
            {
                role: "user",
                content:
                    "Start the interview. Greet me by name and ask the first question.",
            },
        ]);

        return parseModelJsonResponse(content);
    } catch (error) {
        console.error("Groq startInterview error:", error.message);
        if (isTransientNetworkError(error)) {
            console.warn("Using fallback opening question due to Groq availability issue.");
            return buildFallbackStartResponse({ user, session });
        }

        throw new Error("Failed to start interview: " + error.message);
    }
};

/**
 * Continues a session — evaluates the user's answer and asks the next question.
 * Only sends the SINGLE PREVIOUS turn as chat history (lean strategy).
 *
 * @param {Object} user             - User mongoose doc
 * @param {Object} session          - Current InterviewSession doc
 * @param {Object} previousTurn     - The single most recent ConversationTurn doc
 * @param {String} userAnswer       - The answer the user just submitted
 * @param {Array}  pastSessionsData - Same full past data (for system prompt consistency)
 * @param {Array}  currentSessionQuestions - Questions already asked in this active session
 * @returns {Object} Parsed Grok JSON (evaluation + next question or session summary)
 */
const continueInterview = async ({
    user,
    session,
    previousTurn,        // ← ONLY the 1 previous turn, not all turns
    userAnswer,
    pastSessionsData = [],
    currentSessionQuestions = [],
}) => {
    try {
        const history = buildSingleTurnHistory(previousTurn);

        const messages = [
            {
                role: "system",
                content: buildSystemPrompt({
                    user,
                    session,
                    pastSessionsData,
                    currentSessionQuestions,
                }),
            },
            ...history,
            {
                role: "user",
                content: userAnswer,
            },
        ];

        const content = await callGrok(messages);
        return parseModelJsonResponse(content);
    } catch (error) {
        console.error("Groq continueInterview error:", error.message);
        throw new Error("Failed to continue interview: " + error.message);
    }
};

/**
 * Generates a final session summary independently.
 * Used when Gemini doesn't include sessionSummary in the 10th turn response.
 *
 * @param {Object} user     - User doc
 * @param {Object} session  - Session doc
 * @param {Array}  allTurns - All ConversationTurn docs for this session
 */
const generateSessionSummary = async ({ user, session, allTurns }) => {
    try {
        const turnsSummary = allTurns
            .map(
                (t) =>
                    `Q${t.turnNumber}: ${t.question?.text || "N/A"}\n` +
                    `Answer: ${t.answer?.text || "(no answer)"}\n` +
                    `Score: ${t.evaluation?.score ?? "N/A"}/10 | Feedback: ${t.evaluation?.feedback || "N/A"}`
            )
            .join("\n\n");

        const prompt = `You evaluated a mock interview for ${user.name}.
Topic: ${session.program} | Level: ${session.level}

All Q&A:
${turnsSummary}

Generate a session summary in EXACT JSON (no markdown):
{
  "overallScore": <0-100>,
  "strengths": ["<strength>"],
  "weaknesses": ["<weakness>"],
  "suggestions": ["<study topic>"],
  "summary": "<2-3 sentence summary>"
}`;

        const content = await callGrok([
            {
                role: "system",
                content:
                    "You are an expert technical interviewer. Return only valid JSON with no markdown.",
            },
            {
                role: "user",
                content: prompt,
            },
        ]);

        return parseModelJsonResponse(content);
    } catch (error) {
        console.error("Groq generateSessionSummary error:", error.message);
        throw new Error("Failed to generate session summary: " + error.message);
    }
};

/**
 * Parses model text response into a JSON object.
 * Handles markdown code block wrappers if the model adds them.
 */
const parseModelJsonResponse = (text) => {
    let cleaned = text.trim();
    if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    try {
        return JSON.parse(cleaned);
    } catch (err) {
        console.error("Failed to parse model response:\n", cleaned);
        throw new Error("Model returned invalid JSON");
    }
};

module.exports = {
    startInterview,
    continueInterview,
    generateSessionSummary,
};
