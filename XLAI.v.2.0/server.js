// server.js
// XL AI v2.0 backend with:
// - Tone-aware AI rephrase endpoint (OpenAI)
// - Messaging API backed by Neon Postgres
// - 24h TTL (messages auto-expire)
// - Last-message previews for the Home screen
// - Users + Conversations + /api/contacts for home list

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const { Pool } = require("pg");
require("dotenv").config();

const app = express();

// ---------- Middleware ----------
app.use(cors());
app.use(express.json());
// Serve index.html, script.js, style.css from this folder
app.use(express.static(__dirname));

// ---------- OpenAI Client ----------
if (!process.env.OPENAI_API_KEY) {
  console.warn(
    "WARNING: OPENAI_API_KEY is not set. /api/rephrase will fail until you add it to .env."
  );
}
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ---------- Neon Postgres Setup ----------
if (!process.env.DATABASE_URL) {
  console.warn(
    "WARNING: DATABASE_URL is not set. Neon DB will not work until you add it to .env."
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// TTL = 24h
const TTL_INTERVAL_SQL = "now() - interval '24 hours'";

// ---------- DB INIT + SEED DEMO DATA ----------
async function initDb() {
  // gen_random_uuid() lives in pgcrypto
  await pool.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

  // Users table (simple demo users, no auth yet)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id text PRIMARY KEY,
      display_name text NOT NULL
    );
  `);

  // Conversations (1:1 for now)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id text PRIMARY KEY,
      user_a text NOT NULL REFERENCES users(id),
      user_b text NOT NULL REFERENCES users(id)
    );
  `);

  // Messages table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id text NOT NULL REFERENCES conversations(id),
      sender_id text NOT NULL REFERENCES users(id),
      recipient_id text NOT NULL REFERENCES users(id),
      ciphertext text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  // ---- Seed demo users ----
  const demoUsers = [
    { id: "user_A", name: "You" },
    { id: "user_B", name: "Alex" },
    { id: "user_C", name: "Jordan" },
    { id: "user_D", name: "Taylor" },
  ];

  for (const u of demoUsers) {
    await pool.query(
      `
      INSERT INTO users (id, display_name)
      VALUES ($1, $2)
      ON CONFLICT (id) DO NOTHING;
    `,
      [u.id, u.name]
    );
  }

  // ---- Seed demo conversations (You ↔ others) ----
  const demoConversations = [
    {
      id: "conv_user_A_user_B",
      a: "user_A",
      b: "user_B",
    },
    {
      id: "conv_user_A_user_C",
      a: "user_A",
      b: "user_C",
    },
    {
      id: "conv_user_A_user_D",
      a: "user_A",
      b: "user_D",
    },
  ];

  for (const c of demoConversations) {
    await pool.query(
      `
      INSERT INTO conversations (id, user_a, user_b)
      VALUES ($1, $2, $3)
      ON CONFLICT (id) DO NOTHING;
    `,
      [c.id, c.a, c.b]
    );
  }

  console.log("✅ Neon DB is ready (users, conversations, messages).");
}

// Helper: prune expired messages
async function pruneExpiredMessages() {
  try {
    await pool.query(
      `
      DELETE FROM messages
      WHERE created_at <= ${TTL_INTERVAL_SQL};
    `
    );
  } catch (err) {
    console.error("Error pruning expired messages:", err);
  }
}

initDb().catch((err) => {
  console.error("❌ Error initializing database:", err);
});

// ---------- Health Check ----------
app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, db: true });
  } catch (err) {
    console.error("Health check DB error:", err);
    res.status(500).json({ ok: false, db: false });
  }
});

// ---------- AI REPHRASE ENDPOINT ----------
app.post("/api/rephrase", async (req, res) => {
  const { text, tone } = req.body;

  if (!text || typeof text !== "string") {
    return res.status(400).json({ error: "Missing 'text' in body." });
  }

  const toneKey =
    typeof tone === "string" ? tone.toLowerCase().trim() : "calm";

  let toneLabel = "Calm";
  let toneInstruction =
    "Keep the tone gentle, steady, and de-escalating. Focus on emotional safety and understanding while staying honest.";

  if (toneKey === "professional") {
    toneLabel = "Professional";
    toneInstruction =
      "Sound respectful, clear, and composed, like a professional conversation or email. Avoid slang. Focus on impact and next steps.";
  } else if (toneKey === "lowkey") {
    toneLabel = "Low-key";
    toneInstruction =
      "Sound reserved, minimal, and low-drama. Use fewer words and softer wording, but keep the core feeling honest.";
  }

  const systemContent = `
You are XL AI, an ethical communication coach.

GOAL:
- Help the user say what they truly feel in a way that is calm, honest, and emotionally intelligent.
- Reduce blame and attacks, increase clarity and respect.
- Support better communication between two adults (18+). You are not a therapist and you don't give life advice here — you only rewrite the message.

STYLE:
- Very human, warm, grounded, and genuine.
- First person ("I" statements), speaking as the user.
- Brief and natural: usually 1–3 sentences, no long speeches.
- Keep the same language as the user's message (English, Spanish, Spanglish, etc.).
- Match the user's level of formality and length, but slightly calmer and more thoughtful.
- Remove insults and harsh blame, but keep the real feeling.
- Focus on what the user feels, needs, or wants ("I feel...", "I want...", "I'm confused about...").

TONE MODE: ${toneLabel}
- ${toneInstruction}

RULES:
- Do NOT add explanations, tips, or analysis.
- Do NOT speak as XL AI; speak as the user talking to the other person.
- Do NOT change the meaning or minimize their feelings.
- Output ONLY the rewritten message, nothing else.
`.trim();

  try {
    console.log("XL AI rephrase request:", { text, tone: toneLabel });

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: text },
      ],
      temperature: 0.4,
      max_tokens: 120,
    });

    const suggestion =
      completion.choices[0]?.message?.content?.trim() ||
      "I’m not sure how to rephrase that, but I want to respond calmly and respectfully.";

    console.log("XL AI suggestion:", suggestion);

    res.json({ suggestion });
  } catch (err) {
    console.error(
      "OpenAI error:",
      err?.response?.data || err.message || err.toString()
    );
    res.status(500).json({ error: "AI rephrase failed on the server." });
  }
});

// ---------- CONTACT LIST API ----------
// GET /api/contacts?userId=user_A
app.get("/api/contacts", async (req, res) => {
  const userId = req.query.userId;
  if (!userId) {
    return res.status(400).json({ error: "userId query param is required." });
  }

  try {
    const result = await pool.query(
      `
      SELECT
        CASE
          WHEN c.user_a = $1 THEN c.user_b
          ELSE c.user_a
        END AS contact_id,
        u.display_name AS contact_name,
        c.id AS conversation_id
      FROM conversations c
      JOIN users u
        ON u.id = CASE
          WHEN c.user_a = $1 THEN c.user_b
          ELSE c.user_a
        END
      WHERE c.user_a = $1 OR c.user_b = $1;
    `,
      [userId]
    );

    // add fake status labels for now
    const contacts = result.rows.map((row) => {
      let status = "Using XL AI";
      if (row.contact_id === "user_B")
        status = "Online · using XL AI";
      else if (row.contact_id === "user_C")
        status = "Last seen 2 hours ago";
      else if (row.contact_id === "user_D")
        status = "Last seen yesterday";

      return {
        id: row.contact_id,
        name: row.contact_name,
        status,
        conversationId: row.conversation_id,
      };
    });

    res.json({ contacts });
  } catch (err) {
    console.error("Error fetching contacts:", err);
    res.status(500).json({ error: "Failed to load contacts." });
  }
});

// ---------- MESSAGING API (Neon DB) ----------

// POST /api/messages
// body: { conversationId, senderId, recipientId, ciphertext }
app.post("/api/messages", async (req, res) => {
  const { conversationId, senderId, recipientId, ciphertext } = req.body;

  if (!conversationId || !senderId || !recipientId || !ciphertext) {
    return res
      .status(400)
      .json({ error: "Missing required message fields." });
  }

  try {
    // Clean up expired messages (best-effort)
    await pruneExpiredMessages();

    const result = await pool.query(
      `
      INSERT INTO messages (conversation_id, sender_id, recipient_id, ciphertext)
      VALUES ($1, $2, $3, $4)
      RETURNING id, conversation_id, sender_id, recipient_id, ciphertext, created_at;
    `,
      [conversationId, senderId, recipientId, ciphertext]
    );

    res.status(201).json({ message: result.rows[0] });
  } catch (err) {
    console.error("Error inserting message:", err);
    res.status(500).json({ error: "Failed to save message." });
  }
});

// GET /api/messages?conversationId=...
// Returns all non-expired messages for that conversation
app.get("/api/messages", async (req, res) => {
  const { conversationId } = req.query;
  if (!conversationId) {
    return res
      .status(400)
      .json({ error: "conversationId query param is required." });
  }

  try {
    const result = await pool.query(
      `
      SELECT id, conversation_id, sender_id, recipient_id, ciphertext, created_at
      FROM messages
      WHERE conversation_id = $1
        AND created_at > ${TTL_INTERVAL_SQL}
      ORDER BY created_at ASC;
    `,
      [conversationId]
    );

    res.json({ messages: result.rows });
  } catch (err) {
    console.error("Error fetching messages:", err);
    res.status(500).json({ error: "Failed to load messages." });
  }
});

// GET /api/last-messages
// Returns the latest non-expired message per conversation (for Home previews)
app.get("/api/last-messages", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT ON (conversation_id)
             conversation_id,
             sender_id,
             recipient_id,
             ciphertext,
             created_at
      FROM messages
      WHERE created_at > ${TTL_INTERVAL_SQL}
      ORDER BY conversation_id, created_at DESC;
    `);

    res.json({ lastMessages: result.rows });
  } catch (err) {
    console.error("Error fetching last messages:", err);
    res.status(500).json({ error: "Failed to load last messages." });
  }
});

// ---------- Start server ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`XL AI server listening on port ${PORT}`);
});