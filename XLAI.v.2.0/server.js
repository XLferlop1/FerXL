// server.js
// XL AI v2.0 backend with:
// - Tone-aware AI rephrase endpoint (OpenAI)
// - Users + Conversations + Contacts from Neon Postgres
// - Messages stored with demo encryption + 24h TTL
// - Auth Phase 1: Signup + Login with bcrypt + JWT (backend only)

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const app = express();

// ---------- Middleware ----------
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // serve index.html, script.js, style.css

// ---------- Config ----------
const JWT_SECRET = process.env.JWT_SECRET || "xlai-dev-secret";
const TTL_INTERVAL_SQL = "now() - interval '24 hours'";

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

// ---------- DB INIT + SEED DEMO DATA ----------
async function initDb() {
  // UUID helper
  await pool.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

  // Users table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id text PRIMARY KEY,
      display_name text NOT NULL,
      email text UNIQUE,
      password_hash text
    );
  `);

  // Conversations table (1:1)
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

  // ---- Seed demo users (IDs match what front-end uses now) ----
  const demoUsers = [
    { id: "user_A", name: "You", email: "you@example.com" },
    { id: "user_B", name: "Alex", email: "alex@example.com" },
    { id: "user_C", name: "Jordan", email: "jordan@example.com" },
    { id: "user_D", name: "Taylor", email: "taylor@example.com" },
  ];

  for (const u of demoUsers) {
    await pool.query(
      `
      INSERT INTO users (id, display_name, email)
      VALUES ($1, $2, $3)
      ON CONFLICT (id) DO NOTHING;
    `,
      [u.id, u.name, u.email]
    );
  }

  // ---- Seed demo conversations (You ↔ others) ----
  const demoConversations = [
    { id: "conv_user_A_user_B", a: "user_A", b: "user_B" },
    { id: "conv_user_A_user_C", a: "user_A", b: "user_C" },
    { id: "conv_user_A_user_D", a: "user_A", b: "user_D" },
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

// ======================================================================
// AUTH PHASE 1: SIGNUP + LOGIN (BACKEND ONLY)
// ======================================================================

// POST /api/signup
// body: { email, password, displayName }
// Creates a new user with a random id (for future real users)
app.post("/api/signup", async (req, res) => {
  const { email, password, displayName } = req.body;

  if (!email || !password || !displayName) {
    return res
      .status(400)
      .json({ error: "email, password, and displayName are required." });
  }

  try {
    const hash = await bcrypt.hash(password, 12);
    const userId = "user_" + Date.now().toString(36); // simple id for now

    const result = await pool.query(
      `
      INSERT INTO users (id, display_name, email, password_hash)
      VALUES ($1, $2, $3, $4)
      RETURNING id, display_name, email;
    `,
      [userId, displayName, email.toLowerCase(), hash]
    );

    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, {
      expiresIn: "7d",
    });

    res.status(201).json({
      token,
      user: {
        id: user.id,
        displayName: user.display_name,
        email: user.email,
      },
    });
  } catch (err) {
    console.error("Signup error:", err);
    if (err.code === "23505") {
      // unique_violation on email
      return res.status(409).json({ error: "Email already in use." });
    }
    res.status(500).json({ error: "Signup failed." });
  }
});

// POST /api/login
// body: { email, password }
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "email and password required." });
  }

  try {
    const result = await pool.query(
      `
      SELECT id, display_name, email, password_hash
      FROM users
      WHERE email = $1;
    `,
      [email.toLowerCase()]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    const user = result.rows[0];
    if (!user.password_hash) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, {
      expiresIn: "7d",
    });

    res.json({
      token,
      user: {
        id: user.id,
        displayName: user.display_name,
        email: user.email,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed." });
  }
});

// (We will plug this middleware into protected routes in a later phase)
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ error: "Missing auth token." });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token." });
  }
}

// ======================================================================
// AI REPHRASE ENDPOINT
// ======================================================================

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

// ======================================================================
// CONTACT LIST API
// ======================================================================

// GET /api/contacts?userId=user_A   (for now)
// Later this will use req.userId from authMiddleware.
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

// ======================================================================
// MESSAGING API (Neon DB)
// ======================================================================

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

// GET /api/last-messages  (for previews)
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