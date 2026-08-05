"use strict";

function analyzeIntent(text = "") {
  const raw = String(text || "").trim();
  const lower = raw.toLowerCase();

  if (!raw) {
    return {
      label: "unknown",
      confidence: 0.05,
      explanation: "No message text provided.",
    };
  }

  if (/\b(sorry|apologize|my bad|forgive me)\b/.test(lower)) {
    return {
      label: "apologize",
      confidence: 0.9,
      explanation: "Contains direct apology language.",
    };
  }

  if (/\b(i need|i won't|not okay|please stop|my boundary|respect)\b/.test(lower)) {
    return {
      label: "set_boundary",
      confidence: 0.84,
      explanation: "Contains explicit boundary-setting phrasing.",
    };
  }

  if (/\b(can you|could you|please|i need you to|would you|let me know)\b/.test(lower)) {
    return {
      label: "request_action",
      confidence: 0.8,
      explanation: "Contains clear action-oriented request cues.",
    };
  }

  if (/\b(i feel|i felt|hurt|upset|angry|frustrated|anxious|overwhelmed)\b/.test(lower)) {
    return {
      label: "express_feeling",
      confidence: 0.78,
      explanation: "Contains explicit feeling or emotional expression cues.",
    };
  }

  if (/\b(can we reset|work this out|repair|move forward|talk this through)\b/.test(lower)) {
    return {
      label: "repair_conflict",
      confidence: 0.82,
      explanation: "Contains repair and reconnection language.",
    };
  }

  if (/\b(i disagree|i don't agree|that's not right|i see it differently)\b/.test(lower)) {
    return {
      label: "disagree",
      confidence: 0.76,
      explanation: "Contains disagreement framing.",
    };
  }

  if (/\b(update|deadline|project|team|meeting|status|deliverable)\b/.test(lower)) {
    return {
      label: "professional_update",
      confidence: 0.72,
      explanation: "Contains workplace update language.",
    };
  }

  if (/\?|\b(what|how|why|clarify|explain|understand)\b/.test(lower)) {
    return {
      label: "clarify",
      confidence: 0.65,
      explanation: "Contains clarification-style questions.",
    };
  }

  return {
    label: "unknown",
    confidence: 0.3,
    explanation: "No dominant intent rule matched.",
  };
}

module.exports = { analyzeIntent };
