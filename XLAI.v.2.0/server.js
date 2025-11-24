// server.js
// XL AI v2.0 backend
// - Serves static frontend (index, chat)
// - AI rephrase endpoint
// - Encrypted message storage with 24h TTL
// - Simple conversations list for demo contacts

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const { Pool } = require("pg");
const OpenAI = require("openai");

// ---------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------

const app = express();
const PORT = process.env.PORT || 3000;

// 24h TTL for messages
const TTL_HOURS = 24;
const TTL_INTERVAL_SQL = `NOW() - INTERVAL '${TTL_HOURS} hours'`;

// Default demo user (you)
const CURRENT_USER_ID = "user_A";

// OpenAI client (no key in code — uses .env / GitHub secret)
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Postgres / Neon connection
// Expect DATABASE_URL in .env (Neon connection string)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// ---------------------------------------------------------------------
// MIDDLEWARE
// ---------------------------------------------------------------------

app.use(cors());
app.use(express.json());

// Serve static files from this folder (index.html, chat.html, etc.)
app.use(express.static(path.join(__dirname)));

// ---------------------------------------------------------------------
// DB INIT (no email column anymore)
// ---------------------------------------------------------------------

async function initDb() {
  try {
    // USERS table: id + display_name only
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL
      );
    `);

    // CONVERSATIONS table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT,
        participant_a TEXT NOT NULL,
        participant_b TEXT NOT NULL
      );
    `);

    // MESSAGES table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id),
        sender_id TEXT NOT NULL,
        recipient_id TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Seed demo users (no email)
    await pool.query(`
      INSERT INTO users (id, display_name)
      VALUES
        ('${CURRENT_USER_ID}', 'You'),
        ('alex', 'Alex'),
        ('jordan', 'Jordan'),
        ('taylor', 'Taylor')
      ON CONFLICT (id) DO NOTHING;
    `);

    // Seed demo conversations
    await pool.query(`
      INSERT INTO conversations (id, title, participant_a, participant_b)
      VALUES
        ('conv_alex',   'Conversation with Alex',   '${CURRENT_USER_ID}', 'alex'),
        ('conv_jordan', 'Conversation with Jordan', '${CURRENT_USER_ID}', 'jordan'),
        ('conv_taylor', 'Conversation with Taylor', '${CURRENT_USER_ID}', 'taylor')
      ON CONFLICT (id) DO NOTHING;
    `);

    // Optional: initial messages (only if table empty)
    await pool.query(`
      INSERT INTO messages (conversation_id, sender_id, recipient_id, ciphertext)
      VALUES
        ('conv_alex', '${CURRENT_USER_ID}', 'alex',
         'I feel really frustrated because it seems like you''re often upset, and it makes it hard for me to talk to you.')
      ON CONFLICT DO NOTHING;
    `);

    // TTL cleanup: remove messages older than 24h
    await pool.query(`
      DELETE FROM messages
      WHERE created_at < ${TTL_INTERVAL_SQL};
    `);

    console.log("✅ Neon DB is ready (users, conversations, messages tables).");
  } catch (err) {
    console.error("❌ Error initializing database:", err);
  }
}

// ---------------------------------------------------------------------
// AI REPHRASE ENDPOINT
// ---------------------------------------------------------------------

app.post("/api/rephrase", async (req, res) => {
  const { text, tone } = req.body || {};

  if (!text || typeof text !== "string") {
    return res.status(400).json({ error: "Missing or invalid 'text' field." });
  }

  const toneLabel =
    tone === "professional"
      ? "professional and clear"
      : tone === "lowkey"
      ? "low-key, more reserved"
      : "calm and empathetic";

  const systemPrompt = `
You are XL AI, an emotionally intelligent communication coach.
Your job is to rewrite the user's message into a calmer, more emotionally aware version,
based on the selected tone.

Rules:
- Keep the user's core message and boundaries.
- Remove insults, threats, or passive-aggressive jabs.
- Use first-person language ("I feel...", "I notice...").
- Avoid sounding like a therapist or robot; sound human, honest, grounded.
- Do NOT add emojis.
- Do NOT mention "I'm just an AI" or "as an AI".
- Only return the rewritten message. No explanations.

Requested tone: ${toneLabel}.
`;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
      temperature: 0.7,
    });

    const suggestion =
      completion.choices[0]?.message?.content?.trim() ||
      "I’m not sure how to rephrase that right now.";

    console.log("XL AI rephrase request:", { text, tone });
    console.log("XL AI suggestion:", suggestion);

    res.json({ suggestion });
  } catch (error) {
    console.error("XL AI /api/rephrase error:", error);
    res.status(500).json({
      error: "Failed to generate rephrase.",
    });
  }
});

// ---------------------------------------------------------------------
// MESSAGES ENDPOINTS
// ---------------------------------------------------------------------

// POST /api/messages  -> store encrypted message
app.post("/api/messages", async (req, res) => {
  const { conversationId, senderId, recipientId, ciphertext } = req.body || {};

  if (!conversationId || !senderId || !recipientId || !ciphertext) {
    return res.status(400).json({
      error: "Missing required fields (conversationId, senderId, recipientId, ciphertext).",
    });
  }

  try {
    const result = await pool.query(
      `
      INSERT INTO messages (conversation_id, sender_id, recipient_id, ciphertext)
      VALUES ($1, $2, $3, $4)
      RETURNING id, conversation_id, sender_id, recipient_id, ciphertext, created_at;
    `,
      [conversationId, senderId, recipientId, ciphertext]
    );

    const message = result.rows[0];
    res.status(201).json({ message });
  } catch (err) {
    console.error("Error saving message:", err);
    res.status(500).json({ error: "Failed to save message." });
  }
});

// GET /api/messages?conversationId=conv_alex
// Returns last 24h of messages in that conversation
app.get("/api/messages", async (req, res) => {
  const conversationId = req.query.conversationId;

  if (!conversationId) {
    return res.status(400).json({ error: "Missing conversationId query param." });
  }

  try {
    const result = await pool.query(
      `
      SELECT id, conversation_id, sender_id, recipient_id, ciphertext, created_at
      FROM messages
      WHERE conversation_id = $1
        AND created_at >= ${TTL_INTERVAL_SQL}
      ORDER BY created_at ASC;
    `,
      [conversationId]
    );

    res.json({ messages: result.rows });
  } catch (err) {
    console.error("Error loading messages:", err);
    res.status(500).json({ error: "Failed to load messages." });
  }
});

// ---------------------------------------------------------------------
// CONVERSATIONS ENDPOINT (for home screen)
// ---------------------------------------------------------------------

// GET /api/conversations?userId=user_A
app.get("/api/conversations", async (req, res) => {
  const userId = req.query.userId || CURRENT_USER_ID;

  try {
    // Get all conversations where the user participates
    const convResult = await pool.query(
      `
      SELECT
        c.id,
        c.title,
        c.participant_a,
        c.participant_b
      FROM conversations c
      WHERE c.participant_a = $1 OR c.participant_b = $1;
    `,
      [userId]
    );

    const conversations = [];

    for (const row of convResult.rows) {
      const isA = row.participant_a === userId;
      const otherId = isA ? row.participant_b : row.participant_a;

      // Get other user's display name
      const userResult = await pool.query(
        `SELECT display_name FROM users WHERE id = $1;`,
        [otherId]
      );
      const contactName =
        userResult.rows[0]?.display_name || "Unknown contact";

      // Get last message in this conversation (recent, within TTL)
      const msgResult = await pool.query(
        `
        SELECT ciphertext, created_at
        FROM messages
        WHERE conversation_id = $1
          AND created_at >= ${TTL_INTERVAL_SQL}
        ORDER BY created_at DESC
        LIMIT 1;
      `,
        [row.id]
      );

      let lastMessagePreview = "";
      let lastSeenLabel = "";

      if (msgResult.rows.length > 0) {
        lastMessagePreview = msgResult.rows[0].ciphertext;
        lastSeenLabel = "Recently active";
      } else {
        lastMessagePreview = "No recent messages. Tap to start with XL AI support.";
        lastSeenLabel = "Last seen recently";
      }

      conversations.push({
        id: row.id,
        contactId: otherId,
        contactName,
        lastMessagePreview,
        lastSeenLabel,
        statusLabel:
          otherId === "alex"
            ? "Online - using XL AI"
            : otherId === "jordan"
            ? "Last seen 2 hours ago"
            : "Last seen yesterday",
      });
    }

    res.json({ conversations });
  } catch (err) {
    console.error("Error loading conversations:", err);
    res.status(500).json({ error: "Failed to load conversations." });
  }
});

// ---------------------------------------------------------------------
// HEALTH CHECK
// ---------------------------------------------------------------------

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

// ---------------------------------------------------------------------
// START SERVER
// ---------------------------------------------------------------------

app.listen(PORT, async () => {
  console.log(`XL AI server listening on port ${PORT}`);
  await initDb();
});