"use strict";

const SAFETY_LEVELS = {
  0: {
    label: "normal coaching",
    shouldStopNormalCoaching: false,
    reason: "No critical safety signals detected.",
    resources: [],
  },
  1: {
    label: "emotional distress",
    shouldStopNormalCoaching: false,
    reason: "Emotional distress language detected.",
    resources: [
      "Take a short pause before sending if you feel overwhelmed.",
    ],
  },
  2: {
    label: "high-conflict relationship crisis",
    shouldStopNormalCoaching: false,
    reason: "High-conflict relationship language detected.",
    resources: [
      "Focus on one concrete issue and one clear request.",
    ],
  },
  3: {
    label: "possible abuse or coercion",
    shouldStopNormalCoaching: true,
    reason: "Possible abuse, coercion, stalking, or unsafe relationship dynamics detected.",
    resources: [
      "If you feel unsafe, prioritize your physical safety first.",
      "Consider contacting a trusted person or a local domestic violence support service.",
      "If you are in immediate danger, contact local emergency services now.",
    ],
  },
  4: {
    label: "self-harm or violence risk",
    shouldStopNormalCoaching: true,
    reason: "Possible self-harm, suicide, or violence risk detected.",
    resources: [
      "If you may act on thoughts of self-harm or harming someone, call local emergency services now.",
      "If available in your region, contact your local crisis hotline immediately.",
      "In the US and Canada, you can call or text 988 for immediate crisis support.",
    ],
  },
  5: {
    label: "emergency immediate danger",
    shouldStopNormalCoaching: true,
    reason: "Immediate danger or emergency language detected.",
    resources: [
      "Call local emergency services now.",
      "Move to a safer place immediately if you can do so safely.",
      "If available in your region, contact your local crisis hotline right now.",
    ],
  },
};

// Keep level-3 coverage readable/maintainable by grouping related safety categories.
const LEVEL3_CATEGORY_PATTERNS = {
  unsafe_feeling_or_fear: [
    /\b(i\s+do(?:n'?t|\s+not)\s+feel\s+safe(?:\s+(?:around|with)\s+you|\s+at\s+home)?)\b/i,
    /\b(i\s+feel\s+unsafe(?:\s+(?:around|with)\s+you)?)\b/i,
    /\b(you\s+make\s+me\s+feel\s+unsafe)\b/i,
    /\b(i\s*(?:am|'?m)\s+(?:scared|afraid)\s+of\s+you)\b/i,
    /\b(i\s*(?:am|'?m)\s+scared\s+to\s+go\s+home)\b/i,
    /\b(i\s+do(?:n'?t|\s+not)\s+feel\s+safe\s+at\s+home)\b/i,
  ],
  threats_or_intimidation: [
    /\b(they\s+threaten(?:ed|ing|s)?\s+me)\b/i,
    /\b(my\s+partner\s+threaten(?:ed|ing|s)?\s+me)\b/i,
    /\b((?:he|she|they)\s+said\s+(?:he|she|they)\s+would\s+hurt\s+me)\b/i,
    /\b(they\s+keep\s+threaten(?:ing|s)\s+me)\b/i,
    /\b(they\s+are\s+trying\s+to\s+scare\s+me)\b/i,
    /\b(i\s*(?:am|'?m)\s+scared\s+they\s+will\s+hurt\s+me)\b/i,
  ],
  stalking_tracking_monitoring: [
    /\b(they\s+are\s+tracking\s+me)\b/i,
    /\b(my\s+partner\s+tracks?\s+my\s+location)\b/i,
    /\b(track(?:ing|s|ed)?\s+(?:where\s+i\s+go|my\s+location))\b/i,
    /\b(they\s+follow\s+me)\b/i,
    /\b(they\s+keep\s+showing\s+up)\b/i,
    /\b(they\s+check\s+my\s+phone)\b/i,
    /\b(they\s+monitor\s+where\s+i\s+go)\b/i,
    /\b(stalking\s+me|following\s+me\s+everywhere)\b/i,
  ],
  coercive_control_or_isolation: [
    /\b(they\s+won'?t\s+let\s+me\s+leave)\b/i,
    /\b(they\s+control\s+who\s+i\s+talk\s+to)\b/i,
    /\b(they\s+took\s+my\s+phone)\b/i,
    /\b(they\s+won'?t\s+let\s+me\s+see\s+my\s+family)\b/i,
    /\b(they\s+control\s+my\s+money)\b/i,
    /\b(they\s+force\s+me\s+to\s+answer)\b/i,
    /\b(he|she|they)\s+(won'?t|will\s+not)\s+let\s+me\s+leave\b/i,
    /\b(he|she|they)\s+controls\s+who\s+i\s+see\b/i,
    /\b(forcing\s+me|coercing\s+me)\b/i,
  ],
  abuse_concern: [
    /\b(i\s+think\s+i\s*(?:am|'?m)\s+being\s+abused)\b/i,
    /\b(he|she|they)\s+(hit|hits|hurt|hurts|choked|strangled)\s+me\b/i,
    /\b(they\s+hit\s+me|they\s+grabbed\s+me|they\s+pushed\s+me)\b/i,
    /\b(they\s+won'?t\s+stop\s+yelling\s+at\s+me)\b/i,
  ],
  home_danger: [
    /\b(home\s+is\s+not\s+safe)\b/i,
    /\b(i\s*(?:am|'?m)\s+afraid\s+to\s+go\s+home)\b/i,
    /\b(i\s+need\s+to\s+leave\s+the\s+house\s+safely)\b/i,
  ],
};

const LEVEL3_PATTERNS = Object.values(LEVEL3_CATEGORY_PATTERNS).flat();

const SIGNAL_RULES = [
  {
    signal: "emergency_immediate_danger",
    level: 5,
    patterns: [
      /\b(call|dial)\s*(911|999|112)\b/i,
      /\b(he|she|they)\s+(has|have)\s+a\s+weapon\b/i,
      /\b(i\s*am|i\'?m)\s+in\s+immediate\s+danger\b/i,
      /\b(i\s*(?:am|\'?m)\s+not\s+safe\s+right\s+now)\b/i,
      /\b(immediate\s+danger|life\s+threatening)\b/i,
      /\b(someone\s+is\s+trying\s+to\s+kill\s+me)\b/i,
      /\b(someone\s+is\s+trying\s+to\s+hurt\s+me\s+now)\b/i,
      /\b(i\s+need\s+help\s+now)\b/i,
      /\b(i\s+need\s+an\s+ambulance\s+now)\b/i,
    ],
  },
  {
    signal: "self_harm_or_suicide",
    level: 4,
    patterns: [
      /\b(i\s+want\s+to\s+die)\b/i,
      /\b(i\s+don\'?t\s+want\s+to\s+live)\b/i,
      /\b(kill\s+myself|end\s+my\s+life|suicide)\b/i,
      /\b(self\s*harm|hurt\s+myself|cut\s+myself)\b/i,
      /\b(overdose|od\b)\b/i,
    ],
  },
  {
    signal: "violence_risk",
    level: 4,
    patterns: [
      /\b(i\s+want\s+to\s+kill\s+him|i\s+want\s+to\s+kill\s+her|i\s+want\s+to\s+kill\s+them)\b/i,
      /\b(i\s+might\s+hurt\s+someone)\b/i,
      /\b(i\s+am\s+going\s+to\s+hurt\s+him|i\s+am\s+going\s+to\s+hurt\s+her|i\s+am\s+going\s+to\s+hurt\s+them)\b/i,
      /\b(violent\s+thoughts?)\b/i,
    ],
  },
  {
    signal: "abuse_or_coercion",
    level: 3,
    patterns: LEVEL3_PATTERNS,
  },
  {
    signal: "high_conflict_relationship",
    level: 2,
    patterns: [
      /\b(divorce|break\s*up|separat(e|ion))\b/i,
      /\b(cheated\s+on\s+me|betrayed\s+me|can\'?t\s+trust\s+you)\b/i,
      /\b(you\s+always|you\s+never)\b/i,
      /\b(screaming\s+match|explosive\s+fight)\b/i,
      /\b(done\s+with\s+this\s+relationship)\b/i,
    ],
  },
  {
    signal: "emotional_distress",
    level: 1,
    patterns: [
      /\b(i\s+feel\s+hopeless|i\s+feel\s+empty)\b/i,
      /\b(i\s+can\'?t\s+cope|i\s+can\'?t\s+handle\s+this)\b/i,
      /\b(panic\s+attack|shaking\s+right\s+now)\b/i,
      /\b(i\s+am\s+falling\s+apart|i\'?m\s+falling\s+apart)\b/i,
      /\b(i\s+feel\s+broken|i\s+feel\s+worthless)\b/i,
    ],
  },
];

function normalizeInput(raw) {
  return String(raw || "")
    .toLowerCase()
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function evaluateSafetySignals(rawText) {
  const text = normalizeInput(rawText);
  const matchedSignals = [];
  let maxLevel = 0;

  if (!text) {
    return { level: 0, matchedSignals };
  }

  for (const rule of SIGNAL_RULES) {
    const matched = rule.patterns.some((pattern) => pattern.test(text));
    if (matched) {
      matchedSignals.push(rule.signal);
      if (rule.level > maxLevel) {
        maxLevel = rule.level;
      }
    }
  }

  return { level: maxLevel, matchedSignals };
}

function evaluateSafety(rawText) {
  const { level, matchedSignals } = evaluateSafetySignals(rawText);
  const meta = SAFETY_LEVELS[level] || SAFETY_LEVELS[0];

  return {
    level,
    label: meta.label,
    shouldStopNormalCoaching: meta.shouldStopNormalCoaching,
    reason: meta.reason,
    matchedSignals,
    resources: meta.resources,
  };
}

function buildSafetyBlockedResponse(safety, levelMessages = {}) {
  const defaultMessages = {
    3: "XLAI paused normal coaching because this may involve unsafe relationship dynamics. Please prioritize your safety first.",
    4: "XLAI paused normal coaching because this may involve self-harm or violence risk. Please seek immediate emergency or crisis support.",
    5: "XLAI paused normal coaching because this looks like an immediate danger emergency. Contact local emergency services now.",
  };

  const message = levelMessages[safety.level] || defaultMessages[safety.level] || "XLAI paused normal coaching for safety reasons.";

  return {
    safety,
    coachingBlocked: true,
    message,
    suggestedRewrite: null,
  };
}

module.exports = {
  evaluateSafety,
  buildSafetyBlockedResponse,
};
