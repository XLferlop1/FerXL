// server.js
// XL AI v2 - backend with:
// - AI rephrase endpoint (tone-aware)
// - basic messaging API (plaintext-as-ciphertext for now)

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // serve index.html, script.js, style.css

// OpenAI client (used only for suggestions, not message storage)
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// TEMP in-memory message store
const messages = [];

// Health check
app.get("/api/health", (req, res) => {
  res.json({ ok: true });
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

// ---------- BASIC MESSAGING API (E2EE-ready shape) ----------

app.post("/api/messages", (req, res) => {
  const { conversationId, senderId, recipientId, ciphertext } = req.body;

  if (!conversationId || !senderId || !recipientId || !ciphertext) {
    return res
      .status(400)
      .json({ error: "Missing required message fields." });
  }

  const message = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    conversationId,
    senderId,
    recipientId,
    ciphertext, // will be real encrypted text later
    createdAt: new Date().toISOString(),
  };

  messages.push(message);
  res.status(201).json({ message });
});

app.get("/api/messages", (req, res) => {
  const { conversationId } = req.query;
  if (!conversationId) {
    return res.status(400).json({ error: "conversationId is required" });
  }

  const convoMessages = messages
    .filter((m) => m.conversationId === conversationId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  res.json({ messages: convoMessages });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`XL AI server listening on port ${PORT}`);
});