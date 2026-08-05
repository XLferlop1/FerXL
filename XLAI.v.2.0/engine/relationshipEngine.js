"use strict";

function analyzeRelationship(text = "", options = {}) {
  const lower = String(text || "").toLowerCase();
  const conversationName = String(options.conversationName || "").toLowerCase();
  const scope = `${lower}\n${conversationName}`;

  const rules = [
    { type: "manager", confidence: 0.86, regex: /\b(manager|boss|supervisor|director|lead)\b/ },
    { type: "employee", confidence: 0.82, regex: /\b(my employee|reporting to me|direct report|team member)\b/ },
    { type: "coworker", confidence: 0.78, regex: /\b(coworker|colleague|teammate|team)\b/ },
    { type: "partner", confidence: 0.82, regex: /\b(partner|spouse|husband|wife|boyfriend|girlfriend)\b/ },
    { type: "family", confidence: 0.8, regex: /\b(mom|dad|mother|father|sister|brother|family|cousin)\b/ },
    { type: "friend", confidence: 0.72, regex: /\b(friend|bestie|buddy)\b/ },
    { type: "customer", confidence: 0.78, regex: /\b(customer|client|buyer|account)\b/ },
  ];

  for (const rule of rules) {
    if (rule.regex.test(scope)) {
      return {
        type: rule.type,
        confidence: rule.confidence,
        explanation: `Detected ${rule.type}-relationship keywords.`,
      };
    }
  }

  return {
    type: "unknown",
    confidence: 0.25,
    explanation: "No reliable relationship indicators found.",
  };
}

module.exports = { analyzeRelationship };
