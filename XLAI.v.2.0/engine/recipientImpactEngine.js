"use strict";

function analyzeRecipientImpact(input = {}) {
  const risks = Array.isArray(input.risks) ? input.risks : [];
  const emotion = input.emotionPrimary || "neutral";

  if (risks.some((r) => r.type === "blame_heavy" || r.type === "escalation")) {
    return {
      likelyReaction: "Recipient may become defensive and focus on rebuttal.",
      explanation: "Blame-heavy or escalatory wording often triggers argument loops.",
    };
  }

  if (risks.some((r) => r.type === "dismissive_tone")) {
    return {
      likelyReaction: "Recipient may disengage or mirror dismissive tone.",
      explanation: "Dismissive language can reduce psychological safety in conversation.",
    };
  }

  if (risks.some((r) => r.type === "unclear_ask")) {
    return {
      likelyReaction: "Recipient may feel unsure what action is expected.",
      explanation: "Without a clear ask, recipients often respond vaguely or not at all.",
    };
  }

  if (emotion === "anxious" || emotion === "hurt") {
    return {
      likelyReaction: "Recipient may respond with concern but miss the concrete need.",
      explanation: "Emotion-forward messages can land better when paired with a clear ask.",
    };
  }

  return {
    likelyReaction: "Recipient is likely to understand the message with minor clarification.",
    explanation: "No dominant high-risk communication pattern detected.",
  };
}

module.exports = { analyzeRecipientImpact };
