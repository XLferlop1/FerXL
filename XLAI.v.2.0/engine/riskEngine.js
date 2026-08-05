"use strict";

function analyzeRisks(text = "", context = {}) {
  const lower = String(text || "").toLowerCase();
  const risks = [];

  function push(type, severity, explanation) {
    risks.push({ type, severity, explanation });
  }

  if (/\b(always|never|you made me|your fault)\b/.test(lower)) {
    push("blame_heavy", "high", "Absolute or accusatory wording may trigger defensiveness.");
  }

  if (/\b(whatever|forget it|fine\.?$|nvm|never mind)\b/.test(lower)) {
    push("dismissive_tone", "medium", "Dismissive language may shut down constructive dialogue.");
  }

  if (/\b(maybe|if that's okay|i guess|whatever you want)\b/.test(lower)) {
    push("overly_passive", "medium", "Passive framing may hide the user's real need.");
  }

  const hasQuestionOrAsk = /\?|\b(can you|could you|please|i need|would you)\b/.test(lower);
  if (!hasQuestionOrAsk && context.intentLabel !== "professional_update") {
    push("unclear_ask", "medium", "Message lacks a clear ask or next step.");
  }

  if (/\b(work|project|deadline|team|manager|client|customer|professional)\b/.test(lower)) {
    if (/\b(always|never|angry|furious|ridiculous)\b/.test(lower)) {
      push("workplace_risk", "high", "High-emotion wording in workplace context can increase professional risk.");
    } else {
      push("workplace_risk", "low", "Workplace context detected; clarity and tone precision matter.");
    }
  }

  const emotion = context.emotionPrimary || "neutral";
  const intensity = Number(context.emotionIntensity || 0);
  if (["angry", "overwhelmed", "frustrated"].includes(emotion) && intensity >= 0.55) {
    push("emotional_overload", intensity > 0.75 ? "high" : "medium", "High emotional load may reduce message clarity.");
  }

  if (risks.some((r) => r.type === "blame_heavy") || risks.some((r) => r.type === "emotional_overload")) {
    push("escalation", "medium", "Current wording may escalate the conversation.");
  }

  // Deduplicate by type, keep highest severity.
  const rank = { low: 1, medium: 2, high: 3 };
  const byType = new Map();
  for (const risk of risks) {
    const existing = byType.get(risk.type);
    if (!existing || rank[risk.severity] > rank[existing.severity]) {
      byType.set(risk.type, risk);
    }
  }

  return Array.from(byType.values());
}

module.exports = { analyzeRisks };
