"use strict";

const INTENT_LABELS = Object.freeze([
  "clarify",
  "apologize",
  "set_boundary",
  "express_feeling",
  "request_action",
  "disagree",
  "repair_conflict",
  "professional_update",
  "unknown",
]);

const EMOTION_LABELS = Object.freeze([
  "calm",
  "frustrated",
  "angry",
  "hurt",
  "anxious",
  "confused",
  "overwhelmed",
  "neutral",
]);

const RELATIONSHIP_TYPES = Object.freeze([
  "partner",
  "family",
  "friend",
  "coworker",
  "manager",
  "employee",
  "customer",
  "unknown",
]);

const RISK_TYPES = Object.freeze([
  "escalation",
  "blame_heavy",
  "unclear_ask",
  "dismissive_tone",
  "overly_passive",
  "workplace_risk",
  "emotional_overload",
]);

const COACHING_MODES = Object.freeze(["soft", "direct", "professional"]);

const SEVERITY_LEVELS = Object.freeze(["low", "medium", "high"]);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function asConfidence(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return Number(clamp(value, 0, 1).toFixed(2));
}

function asIntensity(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return Number(clamp(value, 0, 1).toFixed(2));
}

function ensureEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function buildCommunicationContract(parts = {}) {
  const intent = parts.intent || {};
  const emotion = parts.emotion || {};
  const relationship = parts.relationship || {};
  const risks = Array.isArray(parts.risks) ? parts.risks : [];
  const recipientImpact = parts.recipientImpact || {};
  const coachingStrategy = parts.coachingStrategy || {};

  return {
    communication: {
      intent: {
        label: ensureEnum(intent.label || "unknown", INTENT_LABELS, "unknown"),
        confidence: asConfidence(intent.confidence),
        explanation: String(intent.explanation || "No clear intent detected."),
      },
      emotion: {
        primary: ensureEnum(emotion.primary || "neutral", EMOTION_LABELS, "neutral"),
        intensity: asIntensity(emotion.intensity),
        explanation: String(emotion.explanation || "No strong emotion signal detected."),
      },
      relationship: {
        type: ensureEnum(relationship.type || "unknown", RELATIONSHIP_TYPES, "unknown"),
        confidence: asConfidence(relationship.confidence),
        explanation: String(relationship.explanation || "Relationship context is unclear."),
      },
      risks: risks
        .map((risk) => ({
          type: ensureEnum(risk.type, RISK_TYPES, "unclear_ask"),
          severity: ensureEnum(risk.severity, SEVERITY_LEVELS, "low"),
          explanation: String(risk.explanation || "Risk signal detected."),
        }))
        .slice(0, 7),
      recipientImpact: {
        likelyReaction: String(recipientImpact.likelyReaction || "Unclear reaction."),
        explanation: String(recipientImpact.explanation || "Insufficient context for impact prediction."),
      },
      coachingStrategy: {
        mode: ensureEnum(coachingStrategy.mode || "soft", COACHING_MODES, "soft"),
        approach: String(coachingStrategy.approach || "Use concise, respectful language and one clear ask."),
        userLesson: String(coachingStrategy.userLesson || "Clear requests improve communication outcomes."),
      },
    },
  };
}

module.exports = {
  INTENT_LABELS,
  EMOTION_LABELS,
  RELATIONSHIP_TYPES,
  RISK_TYPES,
  COACHING_MODES,
  SEVERITY_LEVELS,
  buildCommunicationContract,
};
