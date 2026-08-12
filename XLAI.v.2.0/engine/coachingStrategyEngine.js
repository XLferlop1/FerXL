"use strict";

function analyzeCoachingStrategy(input = {}) {
  const mode = ["soft", "direct", "professional"].includes(input.mode) ? input.mode : "soft";
  const risks = Array.isArray(input.risks) ? input.risks : [];

  if (mode === "professional") {
    return {
      mode,
      approach: "Use concise, non-accusatory wording with one specific ask and a clear next step.",
      userLesson: "Professional communication improves when tone is neutral and requests are explicit.",
    };
  }

  if (mode === "direct") {
    if (risks.some((r) => r.type === "blame_heavy" || r.type === "escalation")) {
      return {
        mode,
        approach: "Remove absolutes, name one concrete event, and ask for one actionable change.",
        userLesson: "Direct communication is strongest when specific, not accusatory.",
      };
    }

    return {
      mode,
      approach: "State what happened, what you need, and the next action in plain language.",
      userLesson: "Clarity plus action framing improves response quality.",
    };
  }

  // soft mode default
  if (risks.some((r) => r.type === "emotional_overload")) {
    return {
      mode,
      approach: "Acknowledge emotion, soften opening tone, then make a clear and respectful ask.",
      userLesson: "Warm framing helps difficult messages land without losing your point.",
    };
  }

  return {
    mode,
    approach: "Keep tone supportive, avoid blame, and end with a clear request.",
    userLesson: "Soft tone and explicit asks reduce conflict and improve understanding.",
  };
}

module.exports = { analyzeCoachingStrategy };
