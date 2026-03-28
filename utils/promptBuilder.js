/**
 * promptBuilder.js
 *
 * TWO-LAYER CONTEXT STRATEGY:
 *
 * Layer 1 — System Prompt (sent ONCE at session start):
 *   → Full past sessions history (all Q&A from previous sessions)
 *   → User profile, preferences, strengths/weaknesses
 *   → This gives Gemini full long-term memory about the user
 *
 * Layer 2 — Per-turn (sent on EACH answer):
 *   → Only the IMMEDIATELY PREVIOUS question + answer
 *   → Keeps each Gemini call lean and fast
 */

const PROGRAM_LABELS = {
    nodejs: "Node.js",
    "html-css": "HTML & CSS",
    javascript: "JavaScript",
    react: "React.js",
    nextjs: "Next.js",
    "system-design": "System Design",
    fullstack: "Full Stack Development",
    dsa: "Data Structures & Algorithms",
    mongodb: "MongoDB",
    devops: "DevOps & CI/CD",
    typescript: "TypeScript",
    expressjs: "Express.js",
};

const LEVEL_DESCRIPTIONS = {
    beginner:
        "Basic concepts, syntax, definitions. Suitable for someone just starting out.",
    intermediate:
        "Applied knowledge, common patterns, practical usage. Some experience expected.",
    "advanced-intermediate":
        "Edge cases, optimization, design patterns. Solid experience expected.",
    expert:
        "Deep internals, architecture decisions, performance. Senior-level knowledge.",
    pro: "Production-level scenarios, leadership questions, system trade-offs. Principal/Staff level.",
};

/**
 * Builds the SYSTEM PROMPT sent ONCE at the start of each session.
 *
 * Includes:
 *  - User profile + stats
 *  - Current session config
 *  - Full past session Q&A history (so Gemini knows EVERYTHING about the user)
 *
 * @param {Object} user              - Mongoose User document
 * @param {Object} session           - Current InterviewSession document
 * @param {Array}  pastSessionsData       - Array of { session, turns[] } objects from past sessions
 * @param {Array}  currentSessionQuestions - Array of current session questions already asked
 */
const buildSystemPrompt = ({
    user,
    session,
    pastSessionsData = [],
    currentSessionQuestions = [],
}) => {
    const programLabel = PROGRAM_LABELS[session.program] || session.program;
    const levelDesc = LEVEL_DESCRIPTIONS[session.level] || session.level;

    // ── Build past history section ──────────────────────────────────────────────
    let pastHistorySection = "";

    if (pastSessionsData.length > 0) {
        const pastBlocks = pastSessionsData.map((entry, idx) => {
            const s = entry.session;
            const turns = entry.turns;

            const qaLines = turns
                .map(
                    (t) =>
                        `  Q${t.turnNumber}: ${t.question?.text || "N/A"}\n` +
                        `  Answer: ${t.answer?.text || "(no answer)"}\n` +
                        `  Score: ${t.evaluation?.score ?? "N/A"}/10 | Feedback: ${t.evaluation?.feedback || "N/A"}`
                )
                .join("\n\n");

            return (
                `Past Session ${idx + 1}: ${PROGRAM_LABELS[s.program] || s.program} | Level: ${s.level} | ` +
                `Score: ${s.feedback?.overallScore ?? "N/A"}/100\n` +
                `Strengths: ${s.feedback?.strengths?.join(", ") || "none recorded"}\n` +
                `Weaknesses: ${s.feedback?.weaknesses?.join(", ") || "none recorded"}\n` +
                `Questions & Answers:\n${qaLines}`
            );
        });

        pastHistorySection = `
== CANDIDATE'S FULL PAST INTERVIEW HISTORY ==
(Use this to understand the candidate's knowledge gaps and avoid repeating questions they already answered well.)

${pastBlocks.join("\n\n---\n\n")}
`;
    } else {
        pastHistorySection = `
== PAST HISTORY ==
This is the candidate's FIRST interview session on the platform. No prior history available.
`;
    }

    const currentSessionQuestionSection = currentSessionQuestions.length
        ? `
== QUESTIONS ALREADY ASKED IN THIS CURRENT SESSION ==
${currentSessionQuestions
    .map((q, idx) => `${idx + 1}. ${q}`)
    .join("\n")}
`
        : `
== QUESTIONS ALREADY ASKED IN THIS CURRENT SESSION ==
None yet (you are about to ask question 1).
`;

    // ── Main system prompt ──────────────────────────────────────────────────────
    return `You are an expert technical interviewer on the InterviewSathi platform.

== CANDIDATE PROFILE ==
- Name: ${user.name}
- Topic: ${programLabel}
- Difficulty Level: ${session.level} — ${levelDesc}
- Total Past Sessions: ${user.totalSessions || 0}
- Overall Average Score: ${user.averageScore || "N/A"}/100
${pastHistorySection}
${currentSessionQuestionSection}

== CURRENT SESSION ==
- Topic: ${programLabel}
- Level: ${session.level}
- Max Questions: 10

== YOUR ROLE ==
You are a professional, encouraging, but honest interviewer. Your goals:
1. Ask questions APPROPRIATE to the selected level.
2. Use the candidate's past history to:
   - AVOID asking questions they already answered correctly.
   - FOCUS on their weak areas.
   - Build on topics they partially understood before.
3. NEVER repeat questions in the same session.
    - Do not ask the same question text again.
    - Do not ask a near-duplicate or rephrased version of a previously asked question.
    - If a topic must continue, ask a distinctly different follow-up question.
4. Evaluate answers fairly — credit correct parts, gently point out gaps.
5. Adapt dynamically:
   - Great answer → increase difficulty slightly.
   - Struggling → stay at level or give simpler related question.
6. After the 10th question is answered, generate a full session summary.

== RULES ==
- Ask EXACTLY ONE question at a time.
- NEVER reveal the correct answer before the candidate tries.
- Be conversational and encouraging.
- For System Design: ask scenario-based, architecture questions.
- For DSA: ask about concepts AND time/space complexity.

== IMPORTANT: CONTEXT PER TURN ==
During this session, you will receive only the PREVIOUS question and answer for context (to keep things efficient).
The candidate's full history is already captured above in your system instructions.

== RESPONSE FORMAT ==
Always respond in EXACT JSON (no markdown, no extra text):

Normal turns (questions 1–9):
{
  "evaluation": {
    "score": <0-10 | null for first question>,
    "feedback": "<1-2 sentence eval | null for first question>",
    "wasCorrect": <true/false | null for first question>,
    "keyPointsMissed": ["<concept>"]
  },
  "nextQuestion": {
    "text": "<your question>",
    "category": "<topic e.g. event-loop>"
  },
  "turnNumber": <question number>,
  "isSessionComplete": false
}

Final turn (after 10 answers):
{
  "evaluation": {
    "score": <0-10>,
    "feedback": "<eval of last answer>",
    "wasCorrect": <true/false>,
    "keyPointsMissed": []
  },
  "nextQuestion": null,
  "turnNumber": 10,
  "isSessionComplete": true,
  "sessionSummary": {
    "overallScore": <0-100>,
    "strengths": ["<strength>"],
    "weaknesses": ["<weakness>"],
    "suggestions": ["<study topic>"],
    "summary": "<2-3 sentence overall summary>"
  }
}

Greet the candidate by name warmly and ask the FIRST question immediately. Set evaluation fields to null for the first message.`;
};

/**
 * Builds a minimal 2-message history for the CURRENT session turn.
 * Only sends the IMMEDIATELY PREVIOUS question and answer.
 * This keeps each model API call lean.
 *
 * @param {Object} previousTurn - The single most recent ConversationTurn document
 * @returns {Array} OpenAI-compatible chat history (2 messages max)
 */
const buildSingleTurnHistory = (previousTurn) => {
    if (!previousTurn) return [];

    const history = [];

    // Provide previous turn context as a user message, then a short assistant ack.
    const previousQuestion = previousTurn.question?.text || "";
    const previousAnswer = previousTurn.answer?.text || "";

    if (previousQuestion || previousAnswer) {
        history.push({
            role: "user",
            content:
                "Previous turn context:\n" +
                `Question: ${previousQuestion || "N/A"}\n` +
                `Answer: ${previousAnswer || "N/A"}`,
        });

        history.push({
            role: "assistant",
            content:
                "Understood. I will use the previous turn as context while evaluating the next answer.",
        });
    }

    return history;
};

module.exports = {
    buildSystemPrompt,
    buildSingleTurnHistory,
    PROGRAM_LABELS,
    LEVEL_DESCRIPTIONS,
};
