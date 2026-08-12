"use strict";

const { buildCommunicationContract } = require("./communicationContract");
const { analyzeIntent } = require("./intentEngine");
const { analyzeEmotion } = require("./emotionEngine");
const { analyzeRelationship } = require("./relationshipEngine");
const { analyzeRisks } = require("./riskEngine");
const { analyzeRecipientImpact } = require("./recipientImpactEngine");
const { analyzeCoachingStrategy } = require("./coachingStrategyEngine");

function collectText(input = {}) {
  const baseText = String(input.text || "").trim();
  const draft = String(input.draft || "").trim();
  const recent = Array.isArray(input.context?.recentMessages)
    ? input.context.recentMessages.map((m) => String(m?.text || "").trim()).filter(Boolean).join("\n")
    : "";

  return [baseText, draft, recent].filter(Boolean).join("\n").trim();
}

function analyzeCommunication(input = {}) {
  const text = collectText(input);
  const coachMode = String(input.coachMode || "soft").toLowerCase();
  const emotionHint = String(input.emotionHint || "");
  const conversationName = input.context?.conversationName || "";

  const intent = analyzeIntent(text);
  const emotion = analyzeEmotion(text, emotionHint);
  const relationship = analyzeRelationship(text, { conversationName });
  const risks = analyzeRisks(text, {
    intentLabel: intent.label,
    emotionPrimary: emotion.primary,
    emotionIntensity: emotion.intensity,
  });
  const recipientImpact = analyzeRecipientImpact({ risks, emotionPrimary: emotion.primary });
  const coachingStrategy = analyzeCoachingStrategy({ mode: coachMode, risks });

  return buildCommunicationContract({
    intent,
    emotion,
    relationship,
    risks,
    recipientImpact,
    coachingStrategy,
  });
}

module.exports = { analyzeCommunication };
