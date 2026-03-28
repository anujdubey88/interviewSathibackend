/**
 * groqService.js
 *
 * Service for calling Groq API using OpenAI-compatible endpoints
 * Groq API: https://api.groq.com/openai/v1
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

let resolvedModelCache = null;

const uniqueModels = (models) => {
    return [...new Set(models.filter(Boolean))];
};

const isModelNotFoundResponse = (status, errorBody) => {
    if (status !== 400 && status !== 404) {
        return false;
    }

    const body = (errorBody || "").toLowerCase();
    return body.includes("model not found") || body.includes("invalid model");
};

const requestCompletionWithModel = async (
    model,
    messages,
    { temperature = 0.2 } = {}
) => {
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

const callGroq = async (messages, { temperature = 0.2 } = {}) => {
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

    throw lastError || new Error("All Groq models failed");
};

module.exports = {
    callGroq,
    requestCompletionWithModel,
};
