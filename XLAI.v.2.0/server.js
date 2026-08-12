// XL AI / EQ Connect backend – rephrasing, intensity, EQ logging

const express = require("express");
const cors = require("cors");
const path = require("path");
const dotenv = require("dotenv");
const { Pool } = require("pg");
const OpenAI = require("openai");
const { evaluateSafety, buildSafetyBlockedResponse } = require("./engine/safetyEngine");
const { analyzeCommunication } = require("./engine/communicationEngine");
const { buildContextEnvelope } = require("./engine/contextRouter");
const { SAFETY_POLICY_VERSION } = require("./engine/safetyKnowledgeBase");
const { buildSafetyDecisionSafe } = require("./engine/safetyDecisionRuntime");
const {
  CLEANUP_INTERVAL_MS,
  getPrivacyStatus,
  runPrivacyCleanupSafe,
} = require("./engine/privacyEngine");
const { hardenContract } = require("./engine/responseContracts");

// Load environment variables (.env)
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const DEFAULT_CONVERSATION_ID = process.env.DEFAULT_CONVERSATION_ID || "default";

// --------- OpenAI SETUP ----------
if (!process.env.OPENAI_API_KEY) {
  console.warn("⚠️  OPENAI_API_KEY is missing in .env");
}
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --------- NEON / POSTGRES SETUP ----------
let pool = null;

if (!process.env.DATABASE_URL) {
  console.warn("⚠️  DATABASE_URL is missing in .env – skipping Neon pool init.");
} else {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  console.log("✅ Neon DB pool created");
}

// ---------- EXPRESS MIDDLEWARE ----------
app.use(cors());
app.use(express.json());

// Serve static files from /public
app.use(express.static(path.join(__dirname, "public")));

// Serve main chat UI
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "chat.html"));
});

// Serve internal EQ log UI
app.get("/eq-log.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "/eq-log.html"));
});

// Health checks
app.get("/health", (req, res) => {
  res.status(200).type("text/plain").send("healthy");
});

app.get("/api/health", (req, res) => {
  res.status(200).json({ ok: true });
});

// ---------- DB INIT ----------
async function initDb() {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id BIGSERIAL PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        original_text TEXT,
        final_text TEXT NOT NULL,
        pre_send_emotion TEXT,
        intensity_score DOUBLE PRECISION,
        was_pause_taken BOOLEAN DEFAULT FALSE,
        used_suggestion BOOLEAN DEFAULT FALSE,
        action_taken TEXT,
        pause_reason TEXT,
        risks TEXT[],
        intent_guess TEXT,
        coach_mode TEXT,
        created_at_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS coach_interactions (
        id BIGSERIAL PRIMARY KEY,
        conversation_id TEXT,
        user_id TEXT,
        coach_question_text TEXT NOT NULL,
        coach_response_text TEXT,
        intent_guess TEXT,
        intent_type TEXT,
        rewrite_text TEXT,
        insight_text TEXT,
        principle_text TEXT,
        intensity_score DOUBLE PRECISION,
        intensity_label TEXT,
        risks TEXT[],
        coach_mode TEXT,
        created_at_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS journal_entries (
        id BIGSERIAL PRIMARY KEY,
        conversation_id TEXT,
        user_id TEXT,
        entry_text TEXT NOT NULL,
        retain_until_timestamp TIMESTAMPTZ,
        mood TEXT,
        main_emotion TEXT,
        possible_trigger TEXT,
        communication_pattern TEXT,
        reflection_takeaway TEXT,
        suggested_next_step TEXT,
        created_at_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await pool.query(`
      ALTER TABLE journal_entries
      ADD COLUMN IF NOT EXISTS retain_until_timestamp TIMESTAMPTZ;
    `);

    // Communication Intelligence persistence fields (additive, nullable)
    await pool.query(`
      ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS communication_intent_label TEXT,
      ADD COLUMN IF NOT EXISTS communication_intent_confidence DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS communication_emotion_primary TEXT,
      ADD COLUMN IF NOT EXISTS communication_emotion_intensity DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS communication_relationship_type TEXT,
      ADD COLUMN IF NOT EXISTS communication_relationship_confidence DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS communication_recipient_reaction TEXT,
      ADD COLUMN IF NOT EXISTS communication_strategy_mode TEXT,
      ADD COLUMN IF NOT EXISTS communication_strategy_approach TEXT,
      ADD COLUMN IF NOT EXISTS communication_risks TEXT[],
      ADD COLUMN IF NOT EXISTS communication_max_risk_severity DOUBLE PRECISION;
    `);

    await pool.query(`
      ALTER TABLE coach_interactions
      ADD COLUMN IF NOT EXISTS communication_intent_label TEXT,
      ADD COLUMN IF NOT EXISTS communication_intent_confidence DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS communication_emotion_primary TEXT,
      ADD COLUMN IF NOT EXISTS communication_emotion_intensity DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS communication_relationship_type TEXT,
      ADD COLUMN IF NOT EXISTS communication_relationship_confidence DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS communication_recipient_reaction TEXT,
      ADD COLUMN IF NOT EXISTS communication_strategy_mode TEXT,
      ADD COLUMN IF NOT EXISTS communication_strategy_approach TEXT,
      ADD COLUMN IF NOT EXISTS communication_risks TEXT[],
      ADD COLUMN IF NOT EXISTS communication_max_risk_severity DOUBLE PRECISION;
    `);

    // Query-performance indexes (safe, additive)
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at
      ON messages (conversation_id, created_at_timestamp DESC);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_user_created_at
      ON messages (user_id, created_at_timestamp DESC);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_coach_interactions_conversation_created_at
      ON coach_interactions (conversation_id, created_at_timestamp DESC);
    `);

    console.log("✅ messages, coach_interactions, and journal_entries tables are ready in Neon.");
  } catch (err) {
    console.error("❌ Error initializing DB:", err);
  }
}

function triggerPrivacyCleanup(reason, options = {}) {
  if (!pool) return;

  runPrivacyCleanupSafe(pool, options)
    .then((result) => {
      if (!result || result.skipped) return;
      const summary = Array.isArray(result.summary) ? result.summary : [];
      const compact = summary.map((item) => `${item.target}:${item.deleted}`).join(", ");
      console.log(`[PRIVACY] Cleanup (${reason}) -> ${compact || "no changes"}`);
    })
    .catch((err) => {
      console.error(`[PRIVACY] Cleanup (${reason}) error:`, err);
    });
}

setInterval(() => {
  triggerPrivacyCleanup("scheduled_hourly", { minIntervalMs: CLEANUP_INTERVAL_MS });
}, CLEANUP_INTERVAL_MS);


// ---------- HELPERS ----------
function labelFromScore(score) {
  if (score == null || Number.isNaN(score)) return "low";
  if (score < 0.4) return "low";
  if (score < 0.7) return "medium";
  return "high";
}

function collectSafetyInput(parts = []) {
  return parts
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join("\n");
}

const SAFETY_DECISION_DEBUG = process.env.SAFETY_DECISION_DEBUG === "1";

function emitSafetyDecisionDebug(route, decision, validation) {
  if (!SAFETY_DECISION_DEBUG) return;

  console.log("[SAFETY_DECISION]", {
    route,
    ok: !!(validation && validation.ok),
    errors: validation && !validation.ok ? validation.errors : [],
    decisionVersion: decision && decision.decisionVersion,
    contextType: decision && decision.contextType,
    channel: decision && decision.channel,
    category: decision && decision.category,
    level: decision && decision.level,
    source: decision && decision.source,
    policyVersion: decision && decision.trace ? decision.trace.policyVersion : null,
  });
}

function deriveIntentType(text = "", draftContext = "", intentGuess = "") {
  const normalized = (text || "").toLowerCase();
  const draftNormalized = (draftContext || "").toLowerCase();
  const guess = (intentGuess || "").toLowerCase();

  const askKeywords = /\b(how|what|why|when|should|could|would|can|advice|help|recommend)\b/;
  const rewriteKeywords = /\b(rewrite|rephrase|redraft|reword|polish|clean up|edit|tone|better wording|fix)\b/;
  const hasQuestion = askKeywords.test(normalized) || normalized.includes("?");
  const hasRewrite = rewriteKeywords.test(normalized) || rewriteKeywords.test(draftNormalized);
  const hasDraft = draftContext.trim().length > 20;

  if (guess.includes("coach_question") || (hasQuestion && !hasRewrite)) return "coach_question";
  if (guess.includes("rewrite_request") || hasRewrite) return "rewrite_request";
  if (guess.includes("mixed") || (hasQuestion && hasRewrite)) return "mixed";
  if (guess.includes("draft_analysis") || (hasDraft && !hasQuestion)) return "draft_analysis";
  if (hasDraft && hasQuestion) return "mixed";
  return "draft_analysis";
}

function shortPreview(text, maxLen = 140) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  return raw.length > maxLen ? `${raw.slice(0, maxLen - 1)}...` : raw;
}

function formatConversationDisplayName(conversationId = "") {
  const raw = String(conversationId || "").trim();
  if (!raw) return "Conversation";
  return raw
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function riskSeverityToScore(severity = "") {
  const normalized = String(severity || "").toLowerCase().trim();
  if (normalized === "high") return 3;
  if (normalized === "medium") return 2;
  if (normalized === "low") return 1;
  return 0;
}

function extractCommunicationPersistenceFields(communication) {
  const c = communication && typeof communication === "object" ? communication : {};
  const risks = Array.isArray(c.risks)
    ? c.risks
        .map((risk) => {
          if (!risk || typeof risk !== "object") return "";
          return String(risk.type || "").trim();
        })
        .filter(Boolean)
    : [];

  const maxRiskSeverity = Array.isArray(c.risks)
    ? c.risks.reduce((max, risk) => {
        const score = riskSeverityToScore(risk && risk.severity);
        return score > max ? score : max;
      }, 0)
    : 0;

  return {
    communicationIntentLabel:
      c.intent && c.intent.label ? String(c.intent.label).trim() : null,
    communicationIntentConfidence:
      c.intent && typeof c.intent.confidence === "number" ? c.intent.confidence : null,
    communicationEmotionPrimary:
      c.emotion && c.emotion.primary ? String(c.emotion.primary).trim() : null,
    communicationEmotionIntensity:
      c.emotion && typeof c.emotion.intensity === "number" ? c.emotion.intensity : null,
    communicationRelationshipType:
      c.relationship && c.relationship.type ? String(c.relationship.type).trim() : null,
    communicationRelationshipConfidence:
      c.relationship && typeof c.relationship.confidence === "number"
        ? c.relationship.confidence
        : null,
    communicationRecipientReaction:
      c.recipientImpact && c.recipientImpact.likelyReaction
        ? String(c.recipientImpact.likelyReaction).trim()
        : null,
    communicationStrategyMode:
      c.coachingStrategy && c.coachingStrategy.mode
        ? String(c.coachingStrategy.mode).trim()
        : null,
    communicationStrategyApproach:
      c.coachingStrategy && c.coachingStrategy.approach
        ? String(c.coachingStrategy.approach).trim()
        : null,
    communicationRisks: risks.length ? risks : null,
    communicationMaxRiskSeverity: maxRiskSeverity > 0 ? maxRiskSeverity : null,
  };
}

async function insertMessageRecord({
  conversationId,
  userId,
  originalText = null,
  finalText,
  preSendEmotion = null,
  intensityScore = null,
  wasPauseTaken = false,
  usedSuggestion = false,
  actionTaken = null,
  pauseReason = null,
  risks = null,
  intentGuess = null,
  coachMode = null,
  communicationFields = null,
}) {
  const ci = {
    communicationIntentLabel: null,
    communicationIntentConfidence: null,
    communicationEmotionPrimary: null,
    communicationEmotionIntensity: null,
    communicationRelationshipType: null,
    communicationRelationshipConfidence: null,
    communicationRecipientReaction: null,
    communicationStrategyMode: null,
    communicationStrategyApproach: null,
    communicationRisks: null,
    communicationMaxRiskSeverity: null,
    ...(communicationFields || {}),
  };

  return pool.query(
    `
      INSERT INTO messages (
        conversation_id,
        user_id,
        original_text,
        final_text,
        pre_send_emotion,
        intensity_score,
        was_pause_taken,
        used_suggestion,
        action_taken,
        pause_reason,
        risks,
        intent_guess,
        coach_mode,
        communication_intent_label,
        communication_intent_confidence,
        communication_emotion_primary,
        communication_emotion_intensity,
        communication_relationship_type,
        communication_relationship_confidence,
        communication_recipient_reaction,
        communication_strategy_mode,
        communication_strategy_approach,
        communication_risks,
        communication_max_risk_severity
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
      RETURNING
        id,
        conversation_id,
        user_id,
        original_text,
        final_text,
        pre_send_emotion,
        intensity_score,
        was_pause_taken,
        used_suggestion,
        action_taken,
        pause_reason,
        risks,
        intent_guess,
        coach_mode,
        communication_intent_label,
        communication_intent_confidence,
        communication_emotion_primary,
        communication_emotion_intensity,
        communication_relationship_type,
        communication_relationship_confidence,
        communication_recipient_reaction,
        communication_strategy_mode,
        communication_strategy_approach,
        communication_risks,
        communication_max_risk_severity,
        created_at_timestamp;
    `,
    [
      conversationId,
      userId,
      originalText || null,
      finalText,
      preSendEmotion || null,
      typeof intensityScore === "number" ? intensityScore : null,
      !!wasPauseTaken,
      !!usedSuggestion,
      actionTaken || null,
      pauseReason || null,
      Array.isArray(risks) ? risks : null,
      intentGuess || null,
      coachMode || null,
      ci.communicationIntentLabel || null,
      typeof ci.communicationIntentConfidence === "number" ? ci.communicationIntentConfidence : null,
      ci.communicationEmotionPrimary || null,
      typeof ci.communicationEmotionIntensity === "number" ? ci.communicationEmotionIntensity : null,
      ci.communicationRelationshipType || null,
      typeof ci.communicationRelationshipConfidence === "number" ? ci.communicationRelationshipConfidence : null,
      ci.communicationRecipientReaction || null,
      ci.communicationStrategyMode || null,
      ci.communicationStrategyApproach || null,
      Array.isArray(ci.communicationRisks) ? ci.communicationRisks : null,
      typeof ci.communicationMaxRiskSeverity === "number" ? ci.communicationMaxRiskSeverity : null,
    ]
  );
}

// Compute adaptive metrics for a user
async function computeAdaptiveMetrics(userId) {
  if (!pool || !userId) {
    return {
      pauseRate: 0,
      rewriteAcceptanceRate: 0,
      sentAnywayRate: 0,
      topRisk: null,
      totalMessages: 0
    };
  }

  try {
    const result = await pool.query(
      `
      SELECT
        was_pause_taken,
        action_taken,
        risks
      FROM messages
      WHERE user_id = $1
      ORDER BY created_at_timestamp DESC
      LIMIT 50;
      `,
      [userId]
    );

    const rows = result.rows || [];
    const totalMessages = rows.length;
    if (totalMessages === 0) {
      return {
        pauseRate: 0,
        rewriteAcceptanceRate: 0,
        sentAnywayRate: 0,
        topRisk: null,
        totalMessages: 0
      };
    }

    const pauseCount = rows.filter(r => r.was_pause_taken).length;
    const pauseRate = pauseCount / totalMessages;

    const rewriteAcceptanceRate = pauseCount > 0 ? rows.filter(r => r.was_pause_taken && r.action_taken === 'used_suggestion').length / pauseCount : 0;
    const sentAnywayRate = pauseCount > 0 ? rows.filter(r => r.was_pause_taken && r.action_taken === 'sent_anyway').length / pauseCount : 0;

    const allRisks = rows.flatMap(r => r.risks || []).filter(risk => risk);
    const riskCounts = {};
    allRisks.forEach(risk => riskCounts[risk] = (riskCounts[risk] || 0) + 1);
    const topRisk = Object.keys(riskCounts).sort((a, b) => riskCounts[b] - riskCounts[a])[0] || null;

    return {
      pauseRate,
      rewriteAcceptanceRate,
      sentAnywayRate,
      topRisk,
      totalMessages
    };
  } catch (err) {
    console.error("computeAdaptiveMetrics error:", err);
    return {
      pauseRate: 0,
      rewriteAcceptanceRate: 0,
      sentAnywayRate: 0,
      topRisk: null,
      totalMessages: 0
    };
  }
}

async function analyzeJournalEntry(entryText, mood) {
  const safeText = String(entryText || "").trim();
  const safeMood = String(mood || "").trim();

  if (!safeText) {
    return {
      main_emotion: safeMood || "mixed",
      possible_trigger: "unclear",
      communication_pattern: "unclear",
      reflection_takeaway: "Short reflection is better than no reflection.",
      suggested_next_step: "Write one more sentence about what you want to do next time.",
    };
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are XL AI Journal Analyzer for communication growth.

Return ONLY JSON with this exact shape:
{
  "main_emotion": "string",
  "possible_trigger": "string",
  "communication_pattern": "string",
  "reflection_takeaway": "string",
  "suggested_next_step": "string"
}

Rules:
- Keep the tone practical, reflective, and growth-oriented.
- This is not therapy or diagnosis.
- Use concise language.
- Ground your outputs in the journal text.
- reflection_takeaway and suggested_next_step must be specific and actionable.
`.trim(),
        },
        {
          role: "user",
          content: `Mood (optional): ${safeMood || "none"}\n\nJournal entry:\n${safeText}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 220,
    });

    const raw = completion.choices?.[0]?.message?.content?.trim() || "";
    const parsed = JSON.parse(raw);

    return {
      main_emotion: String(parsed.main_emotion || safeMood || "mixed").trim(),
      possible_trigger: String(parsed.possible_trigger || "unclear").trim(),
      communication_pattern: String(parsed.communication_pattern || "unclear").trim(),
      reflection_takeaway: String(parsed.reflection_takeaway || "You are building awareness by reflecting on this moment.").trim(),
      suggested_next_step: String(parsed.suggested_next_step || "Try one clear sentence for what you want to say next time.").trim(),
    };
  } catch (err) {
    console.error("analyzeJournalEntry error:", err);
    return {
      main_emotion: safeMood || "mixed",
      possible_trigger: "A recent interaction likely triggered this entry.",
      communication_pattern: "You are noticing emotional carry-over into communication.",
      reflection_takeaway: "Naming what happened and how you felt is a strong first step.",
      suggested_next_step: "Write one specific sentence you want to use in your next important conversation.",
    };
  }
}

// ---------- ROUTES ----------

// Health check


// 🔹 1) Analyze intensity + get XL AI rephrase suggestion
app.post("/api/analyze-intensity", async (req, res) => {
  const { text, draft, tone, emotion, rewriteStrength, coachMode, userId, context } = req.body || {};
  const contextEnvelope = buildContextEnvelope({
    route: req.path,
    body: req.body,
    query: req.query,
    headers: req.headers,
  });
  if (!text || !text.trim()) {
    return res.status(400).json({ error: "Missing text" });
  }

  const effectiveTone = tone || "calm";
  const effectiveCoachMode = coachMode || "soft";
  const draftContext = (draft || "").trim();

  // Phase 7: Extract context fields
  const ctx = context || {};
  const contextUserId = ctx.userId || userId || null;
  const conversationName = ctx.conversationName || null;
  const recentMessages = Array.isArray(ctx.recentMessages) ? ctx.recentMessages.slice(-8) : [];
  const analyzer = ctx.analyzer || null;
  const latestRefine = ctx.latestRefine || null;
  const currentDraft = ctx.currentDraft || draftContext;

  const safetyText = collectSafetyInput([
    text,
    draftContext,
    currentDraft,
    conversationName,
    ...recentMessages.map((m) => m && m.text),
  ]);
  const safety = evaluateSafety(safetyText);
  buildSafetyDecisionSafe({
    route: "/api/analyze-intensity",
    contextEnvelope,
    deterministicResult: safety,
    semanticResult: null,
    policyVersion: SAFETY_POLICY_VERSION,
    emitDebug: emitSafetyDecisionDebug,
  });
  if (safety.shouldStopNormalCoaching) {
    return res.json(
      hardenContract("safetyBlocked", buildSafetyBlockedResponse(safety, {
        3: "XLAI paused normal coaching because this may involve coercion, abuse, stalking, or unsafe relationship dynamics.",
        4: "XLAI paused normal coaching because this may involve self-harm or violence risk. Please seek immediate emergency or crisis support.",
        5: "XLAI paused normal coaching because this appears to be an emergency or immediate danger situation. Contact local emergency services now.",
      }), { route: "/api/analyze-intensity" })
    );
  }

  const communicationAnalysis = analyzeCommunication({
    text,
    draft: draftContext,
    coachMode: effectiveCoachMode,
    emotionHint: emotion,
    context: {
      conversationName,
      recentMessages,
      routeContext: contextEnvelope,
    },
  });

  // Compute adaptive metrics
  const metrics = await computeAdaptiveMetrics(contextUserId);

  try {
    let modeInstructions = "";
    if (effectiveCoachMode === "soft") {
      modeInstructions = "Use a gentle, warm, and supportive coaching tone. Provide nurturing insights and principles. Rewrite in a softer, more empathetic style.";
    } else if (effectiveCoachMode === "direct") {
      modeInstructions = "Use a clear, firm, and straightforward coaching tone. Provide direct insights and principles. Rewrite in a clearer, more assertive style.";
    } else if (effectiveCoachMode === "professional") {
      modeInstructions = "Use a concise, neutral, and workplace-appropriate coaching tone. Provide practical insights and principles. Rewrite in a professional, neutral style.";
    }

    // Adaptive adjustments
    let adaptiveInstructions = "";
    if (metrics.pauseRate > 0.5) {
      adaptiveInstructions += "User pauses frequently, so provide slightly more intense coaching to encourage deeper reflection. ";
    } else if (metrics.pauseRate < 0.2) {
      adaptiveInstructions += "User rarely pauses, so gently encourage more mindful communication. ";
    }
    if (metrics.rewriteAcceptanceRate > 0.7) {
      adaptiveInstructions += "User often accepts rewrites, so emphasize the benefits of the suggested changes. ";
    } else if (metrics.rewriteAcceptanceRate < 0.3) {
      adaptiveInstructions += "User rarely accepts rewrites, so focus on validating their original intent while offering optional improvements. ";
    }
    if (metrics.sentAnywayRate > 0.5) {
      adaptiveInstructions += "User often sends anyway after pausing, so highlight potential risks more prominently. ";
    }
    if (metrics.topRisk) {
      adaptiveInstructions += `Common risk: ${metrics.topRisk}, so tailor advice to address this pattern. `;
    }

    // Phase 7: Build context awareness section
    let contextSection = "";
    if (conversationName || recentMessages.length > 0 || analyzer || latestRefine) {
      contextSection = "\n---\nCONVERSATION CONTEXT:\n";

      if (conversationName) {
        contextSection += `Talking to: ${conversationName}\n`;
      }

      if (recentMessages.length > 0) {
        contextSection += `\nRecent messages (last ${recentMessages.length}):\n`;
        recentMessages.forEach(m => {
          const sender = m.sender === 'me' ? 'User' : (conversationName || 'Other person');
          contextSection += `${sender}: "${m.text}"\n`;
        });
      }

      if (currentDraft && currentDraft.trim()) {
        contextSection += `\nCurrent draft: "${currentDraft}"\n`;
      }

      if (analyzer) {
        contextSection += `\nLocal analyzer detected:\n`;
        if (analyzer.communicationPattern) {
          contextSection += `- Pattern: ${analyzer.communicationPattern}\n`;
        }
        if (analyzer.stateOfMind) {
          contextSection += `- State of mind: ${analyzer.stateOfMind}\n`;
        }
        if (analyzer.likelyRecipientReaction) {
          contextSection += `- Likely reaction: ${analyzer.likelyRecipientReaction}\n`;
        }
        if (analyzer.bestCommunicationMove) {
          contextSection += `- Best move: ${analyzer.bestCommunicationMove}\n`;
        }
        if (analyzer.risk) {
          contextSection += `- Risk: ${analyzer.risk}\n`;
        }
        if (analyzer.needsAIHelp) {
          contextSection += `- Complex situation (needs deeper help)\n`;
        }
      }

      if (latestRefine) {
        contextSection += `\nUser already used Refine:\n`;
        if (latestRefine.mode) {
          contextSection += `- Mode: ${latestRefine.mode}\n`;
        }
        if (latestRefine.bestMove || latestRefine.quickRead) {
          contextSection += `- Suggestion: ${latestRefine.bestMove || latestRefine.quickRead}\n`;
        }
        if (latestRefine.rewrite) {
          contextSection += `- Rewrite: "${latestRefine.rewrite}"\n`;
        }
      }

      contextSection += `\nIMPORTANT CONTEXT RULES:
- Use conversation context when relevant to the user's question
- Don't repeat what the local analyzer or Refine already said unless building on it
- If recent messages show conflict, acknowledge the situation directly
- If talking to a manager/coworker, adjust to workplace context
- If messages show hurt/betrayal/shutdown patterns, address them specifically
- Give practical next steps based on what actually happened, not generic advice
- Reference specific messages when helpful ("They said X, so you might...")
---\n`;
    }

    if (communicationAnalysis && communicationAnalysis.communication) {
      const ci = communicationAnalysis.communication;
      const riskSummary = (ci.risks || [])
        .map((risk) => `${risk.type}:${risk.severity}`)
        .join(", ");

      contextSection += `\nDETERMINISTIC COMMUNICATION ANALYSIS:\n`;
      contextSection += `- Intent: ${ci.intent.label} (confidence ${ci.intent.confidence})\n`;
      contextSection += `- Emotion: ${ci.emotion.primary} (intensity ${ci.emotion.intensity})\n`;
      contextSection += `- Relationship: ${ci.relationship.type}\n`;
      contextSection += `- Risks: ${riskSummary || "none"}\n`;
      contextSection += `- Recipient impact: ${ci.recipientImpact.likelyReaction}\n`;
      contextSection += `- Coaching strategy: ${ci.coachingStrategy.approach}\n`;
    }

    const systemPrompt = `
You are XL AI, a practical communication coach.

Coach mode: ${effectiveCoachMode}
${modeInstructions}

Adaptive tuning based on user patterns:
${adaptiveInstructions}
${contextSection}

Rules:
- Sound human, warm, and practical.
- Keep advice focused on better communication outcomes.
- Do not use therapy language or clinical analysis.
- Use conversation context when it helps.
- Keep it concise.

Return ONLY valid JSON in this exact shape:
{
  "ok": true,
  "intent": "coach_question | rewrite_request | mixed",
  "coaching": {
    "natural_response": "2-4 sentence paragraph, human and practical",
    "suggestion": "one message the user could send, optional",
    "soft_alternative": "a softer version, optional",
    "note": "short note, optional"
  },
  "analysis": {
    "risk_level": "low | medium | high",
    "reason": "internal brief reason"
  }
}
`.trim();

    const userPrompt = `
  Tone preference: ${effectiveTone}
  User emotion chip: ${emotion || "none"}
  Rewrite strength: ${rewriteStrength || "low"}
  Draft context: ${draftContext || "none"}

  Message:
  "${text}"
  `.trim();

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.4,
      max_tokens: 800,  // Phase 7.5: Increased for natural_response + examples
    });

    const raw = completion.choices?.[0]?.message?.content?.trim() || "";
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.warn("⚠️ Could not parse AI JSON, falling back. Raw:", raw);
      parsed = {
        ok: true,
        intent: "coach_question",
        analysis: {
          risk_level: "medium",
          reason: "Fallback due to parse error"
        },
        coaching: {
          natural_response: "I can help you phrase this in a clearer and calmer way.",
          suggestion: "",
          soft_alternative: "",
          note: ""
        }
      };
    }

    // Extract and validate (Phase 7.6 natural format first)
    const normalizeIntent = (raw) => {
      const val = String(raw || "").toLowerCase();
      if (val.includes("rewrite")) return "rewrite_request";
      if (val.includes("mixed")) return "mixed";
      return "coach_question";
    };

    const riskLevelToIntensity = (riskLevel) => {
      if (riskLevel === "high") return 0.82;
      if (riskLevel === "medium") return 0.55;
      return 0.28;
    };

    const parsedAnalysis = parsed.analysis || {};
    const parsedCoaching = parsed.coaching || {};
    const riskLevel = String(parsedAnalysis.risk_level || "medium").toLowerCase();
    const riskReason = String(parsedAnalysis.reason || "").trim();
    const intentType = normalizeIntent(parsed.intent);
    const intentGuess = intentType.replace("_", " ");
    const intensityScore = riskLevelToIntensity(riskLevel);
    const intensityLabel = labelFromScore(intensityScore);

    const naturalResponse = String(parsedCoaching.natural_response || "").trim();
    const suggestion = String(parsedCoaching.suggestion || "").trim();
    const softAlternative = String(parsedCoaching.soft_alternative || "").trim();
    const note = String(parsedCoaching.note || "").trim();

    const safeNaturalResponse = naturalResponse || "You can make this land better by naming what happened, how it affected you, and what you want next.";
    const safeSuggestion = suggestion || "";
    const safeSoftAlternative = softAlternative || "";
    const safeNote = note || (riskReason ? `Note: ${riskReason}` : "");

    const payload = {
      ok: true,
      intent: intentType,
      communication: communicationAnalysis.communication,
      analysis: {
        risk_level: riskLevel === "high" || riskLevel === "low" ? riskLevel : "medium",
        reason: riskReason,
        tone: "coach",
        intensity: intensityScore,
        intensity_label: intensityLabel,
        risks: safeNote ? [safeNote] : [],
        intent_guess: intentGuess,
        intent_type: intentType,
      },
      coaching: {
        natural_response: safeNaturalResponse,
        suggestion: safeSuggestion,
        soft_alternative: safeSoftAlternative,
        note: safeNote,
        response: safeNaturalResponse,
        quick_read: safeNaturalResponse,
        what_to_do: [],
        what_to_say: safeSuggestion ? [safeSuggestion] : [],
        when_to_use_each: safeSoftAlternative ? [safeSoftAlternative] : [],
        insight: safeNote,
        principle: "",
        rewrite: safeSuggestion,
      }
    };

    // Adaptive threshold adjustment
    let baseThreshold;
    if (effectiveCoachMode === "soft") baseThreshold = 0.9;
    else if (effectiveCoachMode === "direct") baseThreshold = 0.7;
    else baseThreshold = 0.8; // professional

    let adjustment = 0;
    if (metrics.pauseRate < 0.3) adjustment -= 0.05; // encourage pausing
    else if (metrics.pauseRate > 0.7) adjustment += 0.05; // less sensitive
    if (metrics.sentAnywayRate > 0.6) adjustment -= 0.05; // more sensitive

    const adaptiveThreshold = Math.max(0.5, Math.min(0.95, baseThreshold + adjustment));

    payload.adaptiveThreshold = adaptiveThreshold;

    console.log("[XL AI] /api/analyze-intensity ->", {
      rewriteStrength: rewriteStrength || "low",
      analysis: payload.analysis,
      coaching: payload.coaching,
      adaptiveThreshold,
      metrics
    });
    res.json(hardenContract("analyzeIntensity", payload, { route: "/api/analyze-intensity" }));
  } catch (err) {
    console.error("❌ /api/analyze-intensity error:", err);
    res.status(500).json({
      error:
        "XL AI had trouble analyzing that message right now. Please try again.",
    });
  }
});

// Optional lightweight rewrite for Smart Compose refine action
// Phase 6: AI Refine / Coach Escalation Upgrade
app.post("/api/rephrase", async (req, res) => {
  const {
    text,
    tone,
    needsAIHelp,
    stateOfMind,
    intent,
    risk,
    confidence,
    emotion
  } = req.body || {};
  const contextEnvelope = buildContextEnvelope({
    route: req.path,
    body: req.body,
    query: req.query,
    headers: req.headers,
  });

  const sourceText = String(text || "").trim();

  if (!sourceText) {
    return res.status(400).json({ error: "Missing text" });
  }

  const safety = evaluateSafety(sourceText);
  buildSafetyDecisionSafe({
    route: "/api/rephrase",
    contextEnvelope,
    deterministicResult: safety,
    semanticResult: null,
    policyVersion: SAFETY_POLICY_VERSION,
    emitDebug: emitSafetyDecisionDebug,
  });
  if (safety.shouldStopNormalCoaching) {
    return res.json(
      hardenContract("safetyBlocked", buildSafetyBlockedResponse(safety, {
        3: "XLAI paused normal rewriting because this may involve coercion, abuse, stalking, or unsafe relationship dynamics.",
        4: "XLAI paused normal rewriting because this may involve self-harm or violence risk. Please seek immediate emergency or crisis support.",
        5: "XLAI paused normal rewriting because this appears to be an emergency or immediate danger situation. Contact local emergency services now.",
      }), { route: "/api/rephrase" })
    );
  }

  const communicationAnalysis = analyzeCommunication({
    text: sourceText,
    coachMode: "soft",
    emotionHint: emotion,
    context: {
      conversationName: "",
      recentMessages: [],
      routeContext: contextEnvelope,
    },
  });

  const toneHint = String(tone || "neutral").toLowerCase();
  const deepMode = needsAIHelp === true;

  try {
    let systemPrompt, userPrompt, maxTokens;

    if (!deepMode) {
      // MODE 1: SIMPLE REFINE - quick, clean rewrite only
      systemPrompt = [
        "You are a concise communication assistant.",
        "Rewrite the user's message to be clear, calm, and direct.",
        "Keep intent and key details unchanged.",
        "Do not add new facts or extra context.",
        "Return only the rewritten message text.",
      ].join(" ");

      userPrompt = `Tone context: ${toneHint}.\n\nMessage:\n${sourceText}`;
      maxTokens = 220;

    } else {
      // MODE 2: DEEPER HELP - context-aware coaching
      systemPrompt = [
        "You are a calm communication coach helping someone express themselves clearly.",
        "Be direct but human. Practical and emotionally aware.",
        "Not a therapist. Not robotic. No clinical language.",
        "",
        "Return ONLY valid JSON with this exact structure:",
        "{",
        '  "quickRead": "One sentence: what this is really about.",',
        '  "whyItMatters": "One sentence: why the current wording may not work.",',
        '  "bestMove": "One sentence: the best communication move here.",',
        '  "rewrite": "A better message they can send.",',
        '  "optionalAlternative": "A second option if helpful, or empty string."',
        "}",
        "",
        "Keep each field short. No therapy language. No 'Your feelings are valid' or 'It\\'s understandable'.",
        "Use phrases like: 'This is about...', 'If you send it this way...', 'A better move is...', 'Try this...', 'Ask for...'",
      ].join("\n");

      const contextParts = [];
      if (stateOfMind) contextParts.push(`State of mind: ${stateOfMind}`);
      if (intent) contextParts.push(`Intent: ${intent}`);
      if (risk) contextParts.push(`Risk level: ${risk}`);
      if (confidence !== undefined) contextParts.push(`Confidence: ${confidence}`);
      if (emotion) contextParts.push(`User feels: ${emotion}`);

      const contextStr = contextParts.length > 0 ? contextParts.join("\n") + "\n\n" : "";

      userPrompt = `${contextStr}Tone: ${toneHint}\n\nMessage:\n${sourceText}`;
      maxTokens = 500;
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: deepMode ? 0.4 : 0.35,
      max_tokens: maxTokens,
    });

    const rawResponse = String(completion.choices?.[0]?.message?.content || "").trim();
    if (!rawResponse) {
      return res.status(502).json({ error: "No response returned" });
    }

    if (!deepMode) {
      // Simple mode: return just the rewrite
      return res.json(hardenContract("rephrase", {
        ok: true,
        mode: "simple",
        rewrite: rawResponse,
        shortReason: "Refined for clarity",
        communication: communicationAnalysis.communication,
      }, { route: "/api/rephrase" }));
    } else {
      // Deep mode: parse JSON response
      try {
        const parsed = JSON.parse(rawResponse);
        const response = {
          ok: true,
          mode: "deep",
          rewrite: String(parsed.rewrite || "").trim(),
          quickRead: String(parsed.quickRead || "").trim(),
          whyItMatters: String(parsed.whyItMatters || "").trim(),
          bestMove: String(parsed.bestMove || "").trim(),
          optionalAlternative: String(parsed.optionalAlternative || "").trim(),
          communication: communicationAnalysis.communication,
        };

        // Validate rewrite exists
        if (!response.rewrite) {
          return res.status(502).json({ error: "No rewrite in deep response" });
        }

        return res.json(hardenContract("rephrase", response, { route: "/api/rephrase" }));
      } catch (parseErr) {
        console.error("[XL AI] Deep mode JSON parse error:", parseErr);
        // Fallback: treat raw response as rewrite
        return res.json(hardenContract("rephrase", {
          ok: true,
          mode: "deep",
          rewrite: rawResponse,
          quickRead: "Unable to parse deeper guidance",
          whyItMatters: "",
          bestMove: "",
          optionalAlternative: "",
          communication: communicationAnalysis.communication,
        }, { route: "/api/rephrase" }));
      }
    }
  } catch (err) {
    console.error("[XL AI] /api/rephrase error:", err);
    return res.status(500).json({ error: "Unable to refine message" });
  }
});

// Optional: tiny DB health endpoint for quick checks
app.get("/api/db-health", async (req, res) => {
  if (!pool) {
    return res.json({ connected: false, latest: null });
  }

  try {
    const r = await pool.query(
      `SELECT id, created_at_timestamp FROM messages ORDER BY created_at_timestamp DESC LIMIT 1;`
    );
    const latest = r.rows[0] || null;
    res.json({ connected: true, latest });
  } catch (err) {
    console.error("[XL AI] /api/db-health error:", err);
    res.status(500).json({ connected: false, latest: null });
  }
});

app.get("/api/privacy-status", (req, res) => {
  return res.json(getPrivacyStatus());
});

app.post("/api/privacy-cleanup", async (req, res) => {
  const isBetaDebug = process.env.NODE_ENV !== "production";
  if (!isBetaDebug) {
    return res.status(404).json({ error: "Not found" });
  }

  if (!pool) {
    return res.status(500).json({ error: "Database is not configured (no DATABASE_URL)" });
  }

  const result = await runPrivacyCleanupSafe(pool, { force: true });
  if (!result.ok) {
    return res.status(500).json(result);
  }

  return res.json(result);
});

// 🔹 2) Store final message in Neon (EQ log)
// 2) Save a message into Neon + return saved row id & timestamp
app.post("/api/send", async (req, res) => {
  if (!pool) {
    return res.status(500).json({ error: "Database is not configured (no DATABASE_URL)" });
  }

  const contextEnvelope = buildContextEnvelope({
    route: req.path,
    body: req.body,
    query: req.query,
    headers: req.headers,
  });

  const {
    conversationId,
    originalText,
    finalText,
    preSendEmotion,
    intensityScore,
    wasPauseTaken,
    usedSuggestion,
    userId,
    actionTaken,
    pauseReason,
    risks,
    intentGuess,
    coachMode,
  } = req.body || {};

  const safetyText = collectSafetyInput([originalText, finalText, pauseReason]);
  const safety = evaluateSafety(safetyText);
  buildSafetyDecisionSafe({
    route: "/api/send",
    contextEnvelope,
    deterministicResult: safety,
    semanticResult: null,
    policyVersion: SAFETY_POLICY_VERSION,
    emitDebug: emitSafetyDecisionDebug,
  });
  if (safety.shouldStopNormalCoaching) {
    return res.json(
      hardenContract("safetyBlocked", buildSafetyBlockedResponse(safety, {
        3: "XLAI paused message send because this may involve coercion, abuse, stalking, or unsafe relationship dynamics.",
        4: "XLAI paused message send because this may involve self-harm or violence risk. Please seek immediate emergency or crisis support.",
        5: "XLAI paused message send because this appears to be an emergency or immediate danger situation. Contact local emergency services now.",
      }), { route: "/api/send" })
    );
  }

  const communicationAnalysis = analyzeCommunication({
    text: collectSafetyInput([originalText, finalText, pauseReason]),
    coachMode,
    emotionHint: preSendEmotion,
    context: {
      conversationName: String(conversationId || ""),
      recentMessages: [],
      routeContext: contextEnvelope,
    },
  });

  const isSmoke = req.get("X-Smoke-Test") === "1";
  if (isSmoke) {
    console.log("[XL AI] Smoke dry-run: skipping DB insert");
    return res.json(hardenContract("send", {
      ok: true,
      dry_run: true,
      id: null,
      created_at: new Date().toISOString(),
      communication: communicationAnalysis.communication,
    }, { route: "/api/send" }));
  }

  triggerPrivacyCleanup("api_send", { minIntervalMs: 5 * 60 * 1000 });

  // basic validation – require conversation, user and finalText; originalText may be null for privacy
  if (!conversationId || !userId || !finalText) {
    console.log("[XL AI] Skipping insert, missing required fields:", {
      conversationId,
      userId,
      hasOriginalText: !!originalText,
      hasFinalText: !!finalText,
    });
    return res.status(400).json({ error: "Missing required fields" });
  }

try {
  const communicationFields = extractCommunicationPersistenceFields(communicationAnalysis.communication);
    const result = await insertMessageRecord({
      conversationId,
      userId,
      originalText,
      finalText,
      preSendEmotion,
      intensityScore,
      wasPauseTaken,
      usedSuggestion,
      actionTaken,
      pauseReason,
      risks,
      intentGuess,
      coachMode,
      communicationFields,
    });

    const row = result.rows[0];
    const rawCreatedAt = row.created_at_timestamp;
    let normalizedCreatedAt = new Date().toISOString();
    if (typeof rawCreatedAt === "string") {
      normalizedCreatedAt = rawCreatedAt;
    } else if (rawCreatedAt instanceof Date && !Number.isNaN(rawCreatedAt.getTime())) {
      normalizedCreatedAt = rawCreatedAt.toISOString();
    } else if (rawCreatedAt != null) {
      const parsedCreatedAt = new Date(rawCreatedAt);
      if (!Number.isNaN(parsedCreatedAt.getTime())) {
        normalizedCreatedAt = parsedCreatedAt.toISOString();
      }
    }

    console.log("[XL AI] Saved message:", {
      id: row.id,
      conversation_id: row.conversation_id,
      user_id: row.user_id,
      created_at_timestamp: row.created_at_timestamp,
      communication_intent_label: row.communication_intent_label || null,
      communication_emotion_primary: row.communication_emotion_primary || null,
      communication_relationship_type: row.communication_relationship_type || null,
      communication_strategy_mode: row.communication_strategy_mode || null,
    });
    res.json(hardenContract("send", {
      ok: true,
      id: row.id,
      created_at: normalizedCreatedAt,
      communication: communicationAnalysis.communication,
    }, { route: "/api/send" }));
  } catch (err) {
    console.error("[XL AI] Error inserting message:", err);
    res.status(500).json({ error: "Failed to save message" });
  }
});

// 🔹 2b) Store coach interaction for Insights
app.post("/api/coach-interactions", async (req, res) => {
  if (!pool) {
    return res.status(500).json({ error: "Database is not configured (no DATABASE_URL)" });
  }

  const {
    conversationId,
    userId,
    coachQuestionText,
    coachResponseText,
    intentGuess,
    intentType,
    rewriteText,
    insightText,
    principleText,
    intensityScore,
    intensityLabel,
    risks,
    coachMode,
    communication,
  } = req.body || {};

  if (!coachQuestionText || !coachQuestionText.trim()) {
    return res.status(400).json({ error: "Missing coachQuestionText" });
  }

  const communicationFields = extractCommunicationPersistenceFields(communication);

  triggerPrivacyCleanup("api_coach_interactions", { minIntervalMs: 5 * 60 * 1000 });

  try {
    const result = await pool.query(
      `
      INSERT INTO coach_interactions (
        conversation_id,
        user_id,
        coach_question_text,
        coach_response_text,
        intent_guess,
        intent_type,
        rewrite_text,
        insight_text,
        principle_text,
        intensity_score,
        intensity_label,
        risks,
        coach_mode,
        communication_intent_label,
        communication_intent_confidence,
        communication_emotion_primary,
        communication_emotion_intensity,
        communication_relationship_type,
        communication_relationship_confidence,
        communication_recipient_reaction,
        communication_strategy_mode,
        communication_strategy_approach,
        communication_risks,
        communication_max_risk_severity
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
      RETURNING id, created_at_timestamp;
      `,
      [
        conversationId || null,
        userId || null,
        coachQuestionText.trim(),
        coachResponseText || null,
        intentGuess || null,
        intentType || null,
        rewriteText || null,
        insightText || null,
        principleText || null,
        typeof intensityScore === "number" ? intensityScore : null,
        intensityLabel || null,
        Array.isArray(risks) ? risks : null,
        coachMode || null,
        communicationFields.communicationIntentLabel || null,
        typeof communicationFields.communicationIntentConfidence === "number" ? communicationFields.communicationIntentConfidence : null,
        communicationFields.communicationEmotionPrimary || null,
        typeof communicationFields.communicationEmotionIntensity === "number" ? communicationFields.communicationEmotionIntensity : null,
        communicationFields.communicationRelationshipType || null,
        typeof communicationFields.communicationRelationshipConfidence === "number" ? communicationFields.communicationRelationshipConfidence : null,
        communicationFields.communicationRecipientReaction || null,
        communicationFields.communicationStrategyMode || null,
        communicationFields.communicationStrategyApproach || null,
        Array.isArray(communicationFields.communicationRisks) ? communicationFields.communicationRisks : null,
        typeof communicationFields.communicationMaxRiskSeverity === "number" ? communicationFields.communicationMaxRiskSeverity : null,
      ]
    );

    const row = result.rows[0];
    res.json({ ok: true, id: row.id, created_at: row.created_at_timestamp });
  } catch (err) {
    console.error("[XL AI] /api/coach-interactions insert error:", err);
    res.status(500).json({ error: "Failed to save coach interaction" });
  }
});

// 🔹 2c) Journal entry create + reflection analyzer
app.post("/api/journal-entries", async (req, res) => {
  if (!pool) {
    return res.status(500).json({ error: "Database is not configured (no DATABASE_URL)" });
  }

  const { conversationId, userId, entryText, mood, retainUntil } = req.body || {};
  const text = String(entryText || "").trim();
  if (!text) {
    return res.status(400).json({ error: "Missing entryText" });
  }

  let retainUntilTimestamp = null;
  if (retainUntil != null) {
    const parsed = new Date(retainUntil);
    if (Number.isNaN(parsed.getTime())) {
      return res.status(400).json({ error: "Invalid retainUntil timestamp" });
    }
    retainUntilTimestamp = parsed.toISOString();
  }

  triggerPrivacyCleanup("api_journal_entries", { minIntervalMs: 5 * 60 * 1000 });

  try {
    const reflection = await analyzeJournalEntry(text, mood);

    const result = await pool.query(
      `
      INSERT INTO journal_entries (
        conversation_id,
        user_id,
        entry_text,
        retain_until_timestamp,
        mood,
        main_emotion,
        possible_trigger,
        communication_pattern,
        reflection_takeaway,
        suggested_next_step
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *;
      `,
      [
        conversationId || null,
        userId || null,
        text,
        retainUntilTimestamp,
        mood || null,
        reflection.main_emotion,
        reflection.possible_trigger,
        reflection.communication_pattern,
        reflection.reflection_takeaway,
        reflection.suggested_next_step,
      ]
    );

    return res.json({ ok: true, entry: result.rows[0] });
  } catch (err) {
    console.error("[XL AI] /api/journal-entries insert error:", err);
    return res.status(500).json({ error: "Failed to save journal entry" });
  }
});

// 🔹 2d) Journal entry list
app.get("/api/journal-entries", async (req, res) => {
  if (!pool) {
    return res.status(500).json({ error: "Database is not configured (no DATABASE_URL)." });
  }

  const conversationId = req.query.conversation || DEFAULT_CONVERSATION_ID;
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  try {
    const result = await pool.query(
      `
      SELECT
        id,
        conversation_id,
        user_id,
        entry_text,
        mood,
        main_emotion,
        possible_trigger,
        communication_pattern,
        reflection_takeaway,
        suggested_next_step,
        created_at_timestamp
      FROM journal_entries
      WHERE conversation_id = $1
      ORDER BY created_at_timestamp DESC
      LIMIT $2;
      `,
      [conversationId, limit]
    );

    return res.json({ ok: true, entries: result.rows });
  } catch (err) {
    console.error("[XL AI] /api/journal-entries read error:", err);
    return res.status(500).json({ error: "Failed to load journal entries" });
  }
});

// 🔹 3) History for chat + EQ log sidebar
app.get("/api/history", async (req, res) => {
  if (!pool) {
    return res
      .status(500)
      .json({ error: "Database is not configured (no DATABASE_URL)." });
  }

  const conversationId = req.query.conversation || DEFAULT_CONVERSATION_ID;

  try {
    const result = await pool.query(
      `
      SELECT
        id,
        conversation_id,
        user_id,
        original_text,
        final_text,
        pre_send_emotion,
        intensity_score,
        was_pause_taken,
        used_suggestion,
        action_taken,
        pause_reason,
        risks,
        intent_guess,
        coach_mode,
        created_at_timestamp
      FROM messages
      WHERE conversation_id = $1
      ORDER BY created_at_timestamp DESC
      LIMIT 100;
    `,
      [conversationId]
    );

    res.json({ messages: result.rows });
  } catch (err) {
    console.error("❌ /api/history DB error:", err);
    res.status(500).json({ error: "Failed to load history." });
  }
});

// 🔹 4) Behavior feedback for the right-hand EQ coach
app.get("/api/behavior-feedback", async (req, res) => {
  if (!pool) {
    return res
      .status(500)
      .json({ error: "Database is not configured (no DATABASE_URL)." });
  }

  const conversationId = req.query.conversation || DEFAULT_CONVERSATION_ID;

  try {
    const result = await pool.query(
      `
      SELECT intensity_score, pre_send_emotion, created_at_timestamp
      FROM messages
      WHERE conversation_id = $1
      ORDER BY created_at_timestamp DESC
      LIMIT 50;
    `,
      [conversationId]
    );

    const rows = result.rows || [];
    const recent = rows.filter((r) => r.intensity_score != null);

    let avg = null;
    if (recent.length > 0) {
      const sum = recent.reduce(
        (acc, r) => acc + Number(r.intensity_score || 0),
        0
      );
      avg = sum / recent.length;
    }

    const riskLevel = labelFromScore(avg);

    // Simple top emotion (use pre_send_emotion column from DB)
    const emotionCounts = {};
    for (const r of rows) {
      if (!r.pre_send_emotion) continue;
      const e = String(r.pre_send_emotion).toLowerCase();
      emotionCounts[e] = (emotionCounts[e] || 0) + 1;
    }
    let topEmotion = null;
    let topCount = 0;
    for (const [e, count] of Object.entries(emotionCounts)) {
      if (count > topCount) {
        topCount = count;
        topEmotion = e;
      }
    }

    let coachHint = "Your recent messages look fairly steady.";
    if (riskLevel === "high") {
      coachHint =
        "Tension looks high. Try slowing down, naming how you feel, and asking one curious question instead of defending.";
    } else if (riskLevel === "medium") {
      coachHint =
        "There’s some emotional charge here. Consider one validating sentence before sharing your side.";
    }

    res.json({
      feedback: {
        riskLevel,
        averageIntensity: avg,
        topEmotion,
        coachHint,
        sampleSize: rows.length,
      },
    });
  } catch (err) {
    console.error("❌ /api/behavior-feedback DB error:", err);
    res.status(500).json({ error: "Failed to compute behavior feedback." });
  }
});

// 3) Fetch conversation list for Chats
app.get("/api/conversations", async (req, res) => {
  if (!pool) {
    return res
      .status(500)
      .json({ error: "Database is not configured (no DATABASE_URL)." });
  }

  const userId = String(req.query.user_id || req.query.userId || "").trim() || null;

  try {
    const result = await pool.query(
      `
      SELECT conversation_id, final_text, original_text, created_at_timestamp
      FROM (
        SELECT DISTINCT ON (conversation_id)
          conversation_id,
          final_text,
          original_text,
          created_at_timestamp
        FROM messages
        WHERE ($1::text IS NULL OR user_id = $1)
        ORDER BY conversation_id, created_at_timestamp DESC
      ) latest
      ORDER BY created_at_timestamp DESC;
      `,
      [userId]
    );

    const conversations = (result.rows || []).map((row) => ({
      conversation_id: row.conversation_id,
      display_name: formatConversationDisplayName(row.conversation_id),
      last_message_preview: shortPreview(row.final_text || row.original_text || "", 72),
      last_message_at: row.created_at_timestamp,
    }));

    res.json({ ok: true, conversations });
  } catch (err) {
    console.error("[XL AI] /api/conversations DB error:", err);
    res.status(500).json({ error: "Failed to load conversations" });
  }
});

// 3) Fetch messages for EQ Log and Chats
app.get("/api/messages", async (req, res) => {
  if (!pool) {
    return res
      .status(500)
      .json({ error: "Database is not configured (no DATABASE_URL)." });
  }

  const conversationId = String(req.query.conversation || "").trim();
  if (!conversationId) {
    return res.status(400).json({ error: "Missing required query param: conversation" });
  }
  const order = String(req.query.order || "desc").toLowerCase() === "asc" ? "ASC" : "DESC";

  try {
    const result = await pool.query(
      `
      SELECT
        id,
        conversation_id,
        user_id,
        original_text,
        final_text,
        pre_send_emotion,
        intensity_score,
        was_pause_taken,
        used_suggestion,
        action_taken,
        pause_reason,
        risks,
        intent_guess,
        coach_mode,
        created_at_timestamp
      FROM messages
      WHERE conversation_id = $1
      ORDER BY created_at_timestamp ${order}
      LIMIT 200;
      `,
      [conversationId]
    );

    res.json({ ok: true, messages: result.rows });
  } catch (err) {
    console.error("[XL AI] /api/messages DB error:", err);
    res.status(500).json({ error: "Failed to load messages" });
  }
});

// 3b) Persist chat messages for the real Chats surface
app.post("/api/messages", async (req, res) => {
  if (!pool) {
    return res.status(500).json({ error: "Database is not configured (no DATABASE_URL)" });
  }

  const {
    conversationId,
    userId,
    text,
    finalText,
    originalText,
    preSendEmotion,
    intensityScore,
    wasPauseTaken,
    usedSuggestion,
    actionTaken,
    pauseReason,
    risks,
    intentGuess,
    coachMode,
  } = req.body || {};

  const safeConversationId = String(conversationId || "").trim();
  const safeUserId = String(userId || "").trim();
  const safeFinalText = String(finalText || text || "").trim();

  if (!safeConversationId || !safeUserId || !safeFinalText) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  triggerPrivacyCleanup("api_messages", { minIntervalMs: 5 * 60 * 1000 });

  try {
    const result = await insertMessageRecord({
      conversationId: safeConversationId,
      userId: safeUserId,
      originalText,
      finalText: safeFinalText,
      preSendEmotion,
      intensityScore,
      wasPauseTaken,
      usedSuggestion,
      actionTaken,
      pauseReason,
      risks,
      intentGuess,
      coachMode,
    });

    const message = result.rows[0] || null;
    res.json({ ok: true, message });
  } catch (err) {
    console.error("[XL AI] /api/messages insert error:", err);
    res.status(500).json({ error: "Failed to save message" });
  }
});

// 🔹 4b) Fetch coach interaction history for Insights
app.get("/api/coach-interactions", async (req, res) => {
  if (!pool) {
    return res
      .status(500)
      .json({ error: "Database is not configured (no DATABASE_URL)." });
  }

  const conversationId = req.query.conversation || DEFAULT_CONVERSATION_ID;

  try {
    const result = await pool.query(
      `
      SELECT
        id,
        conversation_id,
        user_id,
        coach_question_text,
        coach_response_text,
        intent_guess,
        intent_type,
        rewrite_text,
        insight_text,
        principle_text,
        intensity_score,
        intensity_label,
        risks,
        coach_mode,
        communication_intent_label,
        communication_intent_confidence,
        communication_emotion_primary,
        communication_emotion_intensity,
        communication_relationship_type,
        communication_relationship_confidence,
        communication_recipient_reaction,
        communication_strategy_mode,
        communication_strategy_approach,
        communication_risks,
        communication_max_risk_severity,
        created_at_timestamp
      FROM coach_interactions
      WHERE conversation_id = $1
      ORDER BY created_at_timestamp DESC
      LIMIT 100;
      `,
      [conversationId]
    );

    const rows = result.rows || [];
    const byIntentType = {};
    rows.forEach((r) => {
      const key = r.intent_type || "unknown";
      byIntentType[key] = (byIntentType[key] || 0) + 1;
    });

    res.json({
      ok: true,
      interactions: rows,
      summary: {
        totalCoachInteractions: rows.length,
        byIntentType,
      },
    });
  } catch (err) {
    console.error("[XL AI] /api/coach-interactions DB error:", err);
    res.status(500).json({ error: "Failed to load coach interactions" });
  }
});

// 🔹 4c) Unified timeline: messages + coach interactions
app.get("/api/interaction-timeline", async (req, res) => {
  if (!pool) {
    return res
      .status(500)
      .json({ error: "Database is not configured (no DATABASE_URL)." });
  }

  const conversationId = req.query.conversation || DEFAULT_CONVERSATION_ID;
  const limit = Math.min(Number(req.query.limit) || 120, 300);

  try {
    const [messagesResult, coachResult] = await Promise.all([
      pool.query(
        `
        SELECT
          id,
          conversation_id,
          user_id,
          final_text,
          original_text,
          used_suggestion,
          intent_guess,
          risks,
          created_at_timestamp
        FROM messages
        WHERE conversation_id = $1
        ORDER BY created_at_timestamp DESC
        LIMIT $2;
        `,
        [conversationId, limit]
      ),
      pool.query(
        `
        SELECT
          id,
          conversation_id,
          user_id,
          coach_question_text,
          coach_response_text,
          intent_type,
          intent_guess,
          rewrite_text,
          insight_text,
          principle_text,
          created_at_timestamp
        FROM coach_interactions
        WHERE conversation_id = $1
        ORDER BY created_at_timestamp DESC
        LIMIT $2;
        `,
        [conversationId, limit]
      ),
    ]);

    const messageEvents = (messagesResult.rows || []).map((row) => ({
      id: `m_${row.id}`,
      timestamp: row.created_at_timestamp,
      source: "message",
      eventType: "message_sent",
      conversationId: row.conversation_id,
      userId: row.user_id,
      preview: shortPreview(row.final_text || row.original_text || ""),
      context: {
        intentGuess: row.intent_guess || null,
        rewriteUsed: !!row.used_suggestion,
        risks: Array.isArray(row.risks) ? row.risks : [],
      },
    }));

    const coachEvents = (coachResult.rows || []).map((row) => ({
      id: `c_${row.id}`,
      timestamp: row.created_at_timestamp,
      source: "coach",
      eventType: "coach_interaction",
      conversationId: row.conversation_id,
      userId: row.user_id,
      preview: shortPreview(row.coach_question_text || ""),
      context: {
        intentType: row.intent_type || null,
        intentGuess: row.intent_guess || null,
        hasRewrite: !!row.rewrite_text,
        coachResponsePreview: shortPreview(row.coach_response_text || "", 110),
        rewritePreview: shortPreview(row.rewrite_text || "", 110),
        insightPreview: shortPreview(row.insight_text || "", 90),
        principlePreview: shortPreview(row.principle_text || "", 90),
      },
    }));

    const timeline = [...messageEvents, ...coachEvents]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);

    res.json({
      ok: true,
      timeline,
      summary: {
        totalEvents: timeline.length,
        messageEvents: messageEvents.length,
        coachEvents: coachEvents.length,
      },
    });
  } catch (err) {
    console.error("[XL AI] /api/interaction-timeline DB error:", err);
    res.status(500).json({ error: "Failed to load interaction timeline" });
  }
});

// 🔹 4d) Pattern summary for Insights
app.get("/api/pattern-summary", async (req, res) => {
  const conversationId = req.query.conversation || DEFAULT_CONVERSATION_ID;

  try {
    const result = await pool.query(
      `
      SELECT
        intensity_score,
        was_pause_taken,
        action_taken,
        risks,
        coach_mode,
        communication_intent_label,
        communication_emotion_primary,
        communication_relationship_type,
        communication_strategy_mode,
        communication_max_risk_severity,
        communication_risks
      FROM messages
      WHERE conversation_id = $1
      ORDER BY created_at_timestamp DESC
      LIMIT 100;
      `,
      [conversationId]
    );

    const rows = result.rows || [];
    const totalMessages = rows.length;
    if (totalMessages === 0) {
      return res.json({
        summary: {
          totalMessages: 0,
          averageIntensity: null,
          pauseCount: 0,
          pauseRate: 0,
          actionFrequencies: {},
          topRisk: null,
          rewriteAcceptanceRate: 0,
          sentAnywayRate: 0,
          mostCommonCoachMode: null,
          topCommunicationIntent: null,
          topCommunicationEmotion: null,
          topCommunicationRelationship: null,
          topCommunicationStrategyMode: null,
          averageCommunicationMaxRiskSeverity: null,
          communicationRiskCounts: {}
        },
        insights: ["No messages yet to analyze patterns."]
      });
    }

    // Compute metrics
    const intensities = rows.map(r => r.intensity_score).filter(i => i != null);
    const averageIntensity = intensities.length > 0 ? intensities.reduce((a, b) => a + b, 0) / intensities.length : null;

    const pauseCount = rows.filter(r => r.was_pause_taken).length;
    const pauseRate = totalMessages > 0 ? pauseCount / totalMessages : 0;

    const actionFrequencies = {};
    rows.forEach(r => {
      const action = r.action_taken;
      if (action) actionFrequencies[action] = (actionFrequencies[action] || 0) + 1;
    });

    const allRisks = rows.flatMap(r => r.risks || []).filter(risk => risk);
    const riskCounts = {};
    allRisks.forEach(risk => riskCounts[risk] = (riskCounts[risk] || 0) + 1);
    const topRisk = Object.keys(riskCounts).sort((a, b) => riskCounts[b] - riskCounts[a])[0] || null;

    const rewriteAcceptanceRate = pauseCount > 0 ? rows.filter(r => r.was_pause_taken && r.action_taken === 'used_suggestion').length / pauseCount : 0;
    const sentAnywayRate = pauseCount > 0 ? rows.filter(r => r.was_pause_taken && r.action_taken === 'sent_anyway').length / pauseCount : 0;

    const coachModes = rows.map(r => r.coach_mode).filter(m => m);
    const modeCounts = {};
    coachModes.forEach(mode => modeCounts[mode] = (modeCounts[mode] || 0) + 1);
    const mostCommonCoachMode = Object.keys(modeCounts).sort((a, b) => modeCounts[b] - modeCounts[a])[0] || null;

    const countMostCommon = (values = []) => {
      const counts = {};
      values.filter(Boolean).forEach((value) => {
        const key = String(value);
        counts[key] = (counts[key] || 0) + 1;
      });
      const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || null;
      return { top, counts };
    };

    const topIntentSummary = countMostCommon(rows.map((r) => r.communication_intent_label));
    const topEmotionSummary = countMostCommon(rows.map((r) => r.communication_emotion_primary));
    const topRelationshipSummary = countMostCommon(rows.map((r) => r.communication_relationship_type));
    const topStrategyModeSummary = countMostCommon(rows.map((r) => r.communication_strategy_mode));

    const maxRiskSeverityValues = rows
      .map((r) => r.communication_max_risk_severity)
      .filter((v) => typeof v === "number");
    const averageCommunicationMaxRiskSeverity = maxRiskSeverityValues.length
      ? maxRiskSeverityValues.reduce((a, b) => a + b, 0) / maxRiskSeverityValues.length
      : null;

    const communicationRiskCounts = {};
    rows
      .flatMap((r) => (Array.isArray(r.communication_risks) ? r.communication_risks : []))
      .filter(Boolean)
      .forEach((riskType) => {
        const key = String(riskType);
        communicationRiskCounts[key] = (communicationRiskCounts[key] || 0) + 1;
      });

    // Generate enhanced coaching insights
    const insights = [];
    let nextBestSuggestion = "Keep practicing mindful communication.";

    // Determine coaching style based on mode
    const modeStyle = mostCommonCoachMode === "soft" ? "gentle" : mostCommonCoachMode === "direct" ? "clear" : "balanced";

    // Combine patterns for richer insights
    if (pauseRate > 0.5 && rewriteAcceptanceRate > 0.7) {
      insights.push(`You're thoughtfully pausing and often embracing AI suggestions — this ${modeStyle} approach is building strong communication habits.`);
    } else if (pauseRate > 0.5 && sentAnywayRate > 0.5) {
      insights.push(`You pause frequently but prefer your original wording, showing confidence in your voice while being mindful.`);
    } else if (pauseRate < 0.2 && averageIntensity > 0.6) {
      insights.push(`Your messages carry emotional intensity, and you send quickly — consider brief pauses to ensure your intent comes through clearly.`);
      nextBestSuggestion = "Try a 5-second pause before sending intense messages.";
    } else if (pauseRate < 0.2) {
      insights.push(`You tend to send messages without pausing, which can be efficient but might miss opportunities for reflection.`);
      nextBestSuggestion = "Experiment with pausing on messages that feel important.";
    }

    if (averageIntensity && averageIntensity > 0.6 && topRisk) {
      insights.push(`Your communication often has higher intensity, with "${topRisk}" being a common risk — this awareness can help you navigate challenges.`);
    } else if (averageIntensity && averageIntensity < 0.4) {
      insights.push(`Your messages tend to be calm and measured, which helps maintain positive interactions.`);
    }

    if (rewriteAcceptanceRate > 0.7) {
      insights.push(`You frequently accept AI rephrasing, showing openness to refining your communication style.`);
    } else if (rewriteAcceptanceRate < 0.3 && sentAnywayRate > 0.5) {
      insights.push(`You prefer sticking with your original messages even after pauses, valuing authenticity in your expression.`);
      nextBestSuggestion = "Consider reviewing AI suggestions as optional inspiration rather than requirements.";
    }

    // Ensure 2-4 insights
    while (insights.length < 2) {
      if (mostCommonCoachMode) {
        insights.push(`Your preference for ${mostCommonCoachMode} coaching suggests you value ${modeStyle} guidance in communication.`);
      } else {
        insights.push("Your communication patterns are developing well with consistent use of the app.");
      }
    }
    if (insights.length > 4) insights.splice(4);

    // Tailor nextBestSuggestion based on patterns
    if (pauseRate < 0.3 && averageIntensity > 0.5) {
      nextBestSuggestion = "Practice pausing on emotionally charged messages to improve clarity.";
    } else if (rewriteAcceptanceRate < 0.4 && pauseRate > 0.4) {
      nextBestSuggestion = "When pausing, try experimenting with AI suggestions to see what resonates.";
    } else if (sentAnywayRate > 0.6) {
      nextBestSuggestion = "Reflect on why you often send anyway — it might reveal strong communication instincts.";
    }

    const coachResult = await pool.query(
      `
      SELECT intent_type
      FROM coach_interactions
      WHERE conversation_id = $1
      ORDER BY created_at_timestamp DESC
      LIMIT 100;
      `,
      [conversationId]
    );
    const coachRows = coachResult.rows || [];
    const coachIntentTypeCounts = {};
    coachRows.forEach((r) => {
      const key = r.intent_type || "unknown";
      coachIntentTypeCounts[key] = (coachIntentTypeCounts[key] || 0) + 1;
    });

    res.json({
      summary: {
        totalMessages,
        averageIntensity,
        pauseCount,
        pauseRate,
        actionFrequencies,
        topRisk,
        rewriteAcceptanceRate,
        sentAnywayRate,
        mostCommonCoachMode,
        topCommunicationIntent: topIntentSummary.top,
        topCommunicationEmotion: topEmotionSummary.top,
        topCommunicationRelationship: topRelationshipSummary.top,
        topCommunicationStrategyMode: topStrategyModeSummary.top,
        averageCommunicationMaxRiskSeverity,
        communicationRiskCounts,
        totalCoachInteractions: coachRows.length,
        coachIntentTypeCounts
      },
      insights,
      nextBestSuggestion
    });
  } catch (err) {
    console.error("[XL AI] /api/pattern-summary DB error:", err);
    res.status(500).json({ error: "Failed to compute pattern summary." });
  }
});

// --- Start server ---
(async () => {
  if (pool) {
    await initDb();
    const startupCleanup = await runPrivacyCleanupSafe(pool, { force: true });
    if (!startupCleanup.ok) {
      console.error("[PRIVACY] Startup cleanup failed:", startupCleanup);
    }
  } else {
    console.log("⚠️ No pool: DATABASE_URL missing, messages won't save.");
  }
 app.listen(PORT, async () => {
  console.log(`✅ XL AI server listening on port ${PORT}`);
  await initDb();
});
})();