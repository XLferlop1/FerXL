// server.js
// XL AI / EQ Connect backend: Neon DB + OpenAI rephrase + intensity analysis

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const OpenAI = require("openai");
const path = require("path");  // ⬅️ ADD THIS LINE

// --- Basic app setup ---
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
// Serve static frontend files (index.html, chat.html, CSS, JS)
app.use(express.static(__dirname));

// Explicit root route -> index.html
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});
// --- Neon / Postgres pool ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

// --- OpenAI client (server-side only, key stays hidden) ---
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// --- Helper: safe JSON parse ---
function safeJsonParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

// -------------------------
//  API: Intensity analysis
// -------------------------
app.post("/api/analyze-intensity", async (req, res) => {
  const { text } = req.body || {};

  if (!text || typeof text !== "string") {
    return res.status(400).json({ error: "Missing 'text' in request body." });
  }
// Save a delivered message with full emotional metadata
// Save a message with emotional metadata
app.post("/api/send", async (req, res) => {
  try {
    const {
      conversationId,
      originalText,
      finalText,
      preSendEmotion,
      intensityScore,
      wasPauseTaken,
      usedSuggestion,
      isRepairAttempt,
      userId,
    } = req.body || {};

    // Basic validation
    if (!conversationId || !finalText) {
      return res
        .status(400)
        .json({ error: "conversationId and finalText are required" });
    }

    // For now we keep a simple sender / recipient model
    const senderId = userId || "xx";
    const recipientId = "partner";

    // Encrypt the final text so we never store raw text without encryption
    const ciphertext = await encryptText(finalText);

    const result = await pool.query(
      `
      INSERT INTO messages (
        conversation_id,
        sender_id,
        recipient_id,
        ciphertext,
        original_text,
        final_text,
        pre_send_emotion,
        intensity_score,
        was_pause_taken,
        used_suggestion,
        is_repair_attempt,
        user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING id
      `,
      [
        conversationId,
        senderId,
        recipientId,
        ciphertext,
        originalText || finalText,                         // always keep original
        finalText,
        preSendEmotion || null,
        typeof intensityScore === "number" ? intensityScore : null,
        Boolean(wasPauseTaken),
        Boolean(usedSuggestion),
        Boolean(isRepairAttempt),
        senderId,
      ]
    );

    res.json({ ok: true, id: result.rows[0].id });
  } catch (err) {
    console.error("Error in /api/send:", err);
    res.status(500).json({ error: "Failed to save message" });
  }
});
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a clinical sentiment analysis engine. " +
            "Respond ONLY with a JSON object: " +
            '{"intensity_score": number between 0 and 1, "primary_emotion": string}.',
        },
        {
          role: "user",
          content:
            `Analyze the following message for urgency and emotional intensity on a scale of 0.0 (calm) to 1.0 (crisis). ` +
            `Also identify the primary emotion (e.g., Anger, Fear, Joy). Message: "${text}"`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = safeJsonParse(raw, {});
    const intensity = typeof parsed.intensity_score === "number" ? parsed.intensity_score : 0.0;
    const primaryEmotion =
      typeof parsed.primary_emotion === "string" ? parsed.primary_emotion : "unknown";

    return res.json({ intensity, primaryEmotion });
  } catch (err) {
    console.error("❌ OpenAI /api/analyze-intensity error:", err);
    // Fail-safe: treat as calm so we don't block users
    return res.status(500).json({ intensity: 0.0, primaryEmotion: "unknown" });
  }
});

// -------------------------
//  API: Rephrase + logging
// -------------------------
app.post("/api/rephrase", async (req, res) => {
  const {
    text,
    tone,
    conversationId,
    preSendEmotion,
    intensityScore,
    wasPauseTaken,
    isRepairAttempt,
    userId,
  } = req.body || {};

  if (!text || !tone) {
    return res
      .status(400)
      .json({ error: "Missing 'text' or 'tone' in request body." });
  }

  const safeConversationId = conversationId || "alex";
  const safeUserId = userId || "user_A"; // temporary until real auth
  const safeRecipientId = "coach";

  try {
    // --- Call OpenAI for rephrase suggestion ---
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are XL AI, a relationship communication coach. " +
            "Given a raw message and a requested tone (calm, professional, or low-key), " +
            "rewrite the message so it is clear, honest, and emotionally safe. " +
            "Use first-person 'I' statements when helpful. " +
            "Respond with ONLY the rewritten message text, no extra commentary.",
        },
        {
          role: "user",
          content:
            `Tone: ${tone}\n` +
            (preSendEmotion
              ? `User reported feeling: ${preSendEmotion}\n`
              : "") +
            `Original message: "${text}"`,
        },
      ],
    });

    const suggestion = completion.choices[0]?.message?.content?.trim() || "";

    if (!suggestion) {
      console.error("⚠️ OpenAI returned empty suggestion.");
      return res.status(500).json({
        error: "XL AI couldn't generate a suggestion right now. Please try again.",
      });
    }

    // --- Insert into Neon messages table ---
    const insertSql = `
      INSERT INTO messages (
        conversation_id,
        sender_id,
        recipient_id,
        ciphertext,
        original_text,
        final_text,
        pre_send_emotion,
        intensity_score,
        was_pause_taken,
        used_suggestion,
        is_repair_attempt,
        user_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING id;
    `;

    const values = [
      safeConversationId,
      safeUserId,                  // sender_id
      safeRecipientId,             // recipient_id
      null,                        // ciphertext (future encryption)
      text,                        // original_text
      suggestion,                  // final_text
      preSendEmotion || null,      // pre_send_emotion
      typeof intensityScore === "number" ? intensityScore : null,
      !!wasPauseTaken,             // was_pause_taken
      false,                       // used_suggestion (front-end can update later)
      !!isRepairAttempt,           // is_repair_attempt
      safeUserId,                  // user_id (same for now)
    ];

    try {
      const dbRes = await pool.query(insertSql, values);
      console.log("💾 Logged message row id:", dbRes.rows[0]?.id);
    } catch (dbErr) {
      console.error("❌ Failed to insert message into Neon:", dbErr);
      // We don't fail the request for logging errors – user still gets the suggestion.
    }

    return res.json({ suggestion });
  } catch (err) {
    console.error("❌ OpenAI /api/rephrase error:", err);
    return res.status(500).json({
      error: "XL AI had trouble generating a suggestion right now. Please try again.",
    });
  }
});

// -------------------------
//  Health check (optional)
// -------------------------
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// -------------------------
//  DB init + server start
// -------------------------

async function initDb() {
  const createSql = `
    CREATE TABLE IF NOT EXISTS messages (
      id BIGSERIAL PRIMARY KEY,
      conversation_id   TEXT NOT NULL,
      sender_id         TEXT NOT NULL,
      recipient_id      TEXT NOT NULL,
      ciphertext        TEXT,
      original_text     TEXT,
      final_text        TEXT,
      pre_send_emotion  TEXT,
      intensity_score   REAL,
      was_pause_taken   BOOLEAN DEFAULT FALSE,
      used_suggestion   BOOLEAN DEFAULT FALSE,
      is_repair_attempt BOOLEAN DEFAULT FALSE,
      user_id           TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;

  try {
    await pool.query(createSql);
    console.log("✅ Neon DB is ready (messages table).");
  } catch (err) {
    console.error("❌ Failed to init DB:", err);
    throw err;
  }
}

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🔥 XL AI server listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Server not started because DB init failed:", err);
  });