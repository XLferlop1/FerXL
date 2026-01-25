// XL AI / EQ Connect backend – rephrasing, intensity, EQ logging

const express = require("express");
const cors = require("cors");
const path = require("path");
const dotenv = require("dotenv");
const { Pool } = require("pg");
const OpenAI = require("openai");

// Load environment variables (.env)
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

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

// --------- EXPRESS MIDDLEWARE ----------

// ---------- EXPRESS MIDDLEWARE ----------
// Middleware
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

// Health check (used by smoke tests + uptime checks)
app.get("/health", (req, res) => {
  res.status(200).type("text/plain").send("healthy");
});

// Optional: keep an API version too
app.get("/api/health", (req, res) => {
  res.status(200).json({ ok: true });
});

// ---------- DB INIT (messages table) ----------
async function initDb() {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id BIGSERIAL PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        original_text TEXT,
        final_text   TEXT NOT NULL,
        pre_send_emotion      TEXT,
        intensity_score DOUBLE PRECISION,
        was_pause_taken BOOLEAN DEFAULT FALSE,
        used_suggestion BOOLEAN DEFAULT FALSE,
        created_at_timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log("✅ messages table is ready in Neon.");
  } catch (err) {
    console.error("❌ Error initializing DB:", err);
  }
}
async function cleanupOldMessages() {
  if (!pool) return;
  try {
    await pool.query(
      "DELETE FROM messages WHERE created_at_timestamp < NOW() - INTERVAL '24 hours'"
    );
  } catch (e) {
    console.error("cleanupOldMessages error:", e);
  }
}
setInterval(cleanupOldMessages, 60 * 60 * 1000); // every hour


// ---------- HELPERS ----------
function labelFromScore(score) {
  if (score == null || Number.isNaN(score)) return "low";
  if (score < 0.4) return "low";
  if (score < 0.7) return "medium";
  return "high";
}

// ---------- ROUTES ----------

// Health check


// 🔹 1) Analyze intensity + get XL AI rephrase suggestion
app.post("/api/analyze-intensity", async (req, res) => {
  const { text, tone, emotion, rewriteStrength } = req.body || {};
  if (!text || !text.trim()) {
    return res.status(400).json({ error: "Missing text" });
  }

  const effectiveTone = tone || "calm";

  try {
    const systemPrompt = `
You are XL AI, an emotionally intelligent communication assistant focused on producing a single, clean rewrite of the user's message.

Your tasks:
1) Estimate the emotional intensity of the user's message from 0.0 (very calm) to 1.0 (very intense).
2) Provide a short label: "low", "medium", or "high".
3) Produce ONE rewritten version of the user's message and place it in the "suggestion" field. The "suggestion" value MUST contain ONLY the rewritten message text and NOTHING ELSE (no advice, no coaching, no explanations, no extra sentences).

Constraints for the rewrite in "suggestion":
- Preserve the original meaning and intent; do not introduce new emotional content or new facts.
- Keep similar length to the original unless a small edit improves clarity.
- Match the requested tone (calm / professional / low-key) as indicated by the user prompt.
- Do NOT mention you are an AI or a coach. Do not add preambles or follow-up questions.

Return ONLY a JSON object with exactly this shape and no other commentary:
{
  "intensity": number,
  "label": "low" | "medium" | "high",
  "suggestion": string
}
`.trim();

    const userPrompt = `
  Tone preference: ${effectiveTone}
  User emotion chip: ${emotion || "none"}
  Rewrite strength: ${rewriteStrength || "low"}

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
      max_tokens: 220,
    });

    const raw = completion.choices?.[0]?.message?.content?.trim() || "";
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.warn("⚠️ Could not parse AI JSON, falling back. Raw:", raw);
      parsed = {
        intensity: 0.5,
        label: "medium",
        suggestion: "",
      };
    }

    const intensityScore =
      typeof parsed.intensity === "number" ? parsed.intensity : 0.5;
    const intensityLabel = parsed.label || labelFromScore(intensityScore);
    const suggestion =
      typeof parsed.suggestion === "string" ? parsed.suggestion : "";

    const payload = {
      intensity: {
        intensity: intensityScore,
        label: intensityLabel,
      },
      suggestion,
    };

    console.log("[XL AI] /api/analyze-intensity ->", {
      rewriteStrength: rewriteStrength || "low",
      payload,
    });
    res.json(payload);
  } catch (err) {
    console.error("❌ /api/analyze-intensity error:", err);
    res.status(500).json({
      error:
        "XL AI had trouble analyzing that message right now. Please try again.",
    });
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

// 🔹 2) Store final message in Neon (EQ log)
// 2) Save a message into Neon + return saved row id & timestamp
app.post("/api/send", async (req, res) => {
  if (!pool) {
    return res.status(500).json({ error: "Database is not configured (no DATABASE_URL)" });
  }

  const isSmoke = req.get("X-Smoke-Test") === "1";
if (isSmoke) {
  console.log("[XL AI] Smoke dry-run: skipping DB insert");
  return res.json({
    ok: true,
    dry_run: true,
    id: null,
    created_at: new Date().toISOString(),
  });
}

  const {
    conversationId,
    originalText,
    finalText,
    preSendEmotion,
    intensityScore,
    wasPauseTaken,
    usedSuggestion,
    userId,
  } = req.body || {};

  // basic validation – require conversation, user and finalText; originalText may be null for privacy
  if (!conversationId || !userId || !finalText) {
    console.log("[XL AI] Skipping insert, missing required fields:", {
      conversationId,
      userId,
      originalText,
      finalText,
    });
    return res.status(400).json({ error: "Missing required fields" });
  }

try {
  const result = await pool.query(
      `
      INSERT INTO messages (
        conversation_id,
        user_id,
        original_text,
        final_text,
        pre_send_emotion,
        intensity_score,
        was_pause_taken,
        used_suggestion
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING id, created_at_timestamp;
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
      ]
    );

    const row = result.rows[0];
    console.log("[XL AI] Saved message:", row);
    res.json({ ok: true, id: row.id, created_at: row.created_at_timestamp });
  } catch (err) {
    console.error("[XL AI] Error inserting message:", err);
    res.status(500).json({ error: "Failed to save message" });
  }
});

// 🔹 3) History for chat + EQ log sidebar
app.get("/api/history", async (req, res) => {
  if (!pool) {
    return res
      .status(500)
      .json({ error: "Database is not configured (no DATABASE_URL)." });
  }

  const conversationId = req.query.conversation || "alex";

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

  const conversationId = req.query.conversation || "alex";

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

// 3) Fetch messages for EQ Log
// 3) Fetch messages for EQ Log
app.get("/api/messages", async (req, res) => {
  if (!pool) {
    return res
      .status(500)
      .json({ error: "Database is not configured (no DATABASE_URL)." });
  }

  // default to "alex" if not provided, but EQ Log will normally pass ?conversation=alex
  const conversationId = req.query.conversation || "alex";

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
        created_at_timestamp
      FROM messages
      WHERE conversation_id = $1
      ORDER BY created_at_timestamp DESC
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
// --- Start server ---
(async () => {
  if (pool) {
    await initDb();
  } else {
    console.log("⚠️ No pool: DATABASE_URL missing, messages won't save.");
  }
 app.listen(PORT, async () => {
  console.log(`✅ XL AI server listening on port ${PORT}`);
  await initDb();
});
})();