"use strict";

const {
  SAFETY_POLICY_VERSION,
  getSafetyCategory,
  listSafetyCategories,
} = require("./safetyKnowledgeBase");

const DECISION_VERSION = "phase3-safety-decision-v1";

const VALID_CHANNELS = Object.freeze(["messaging", "coach", "journal", "unknown"]);
const VALID_SOURCES = Object.freeze(["deterministic", "semantic", "merged", "none"]);

const REQUIRED_MESSAGING_POLICY_FIELDS = Object.freeze([
  "allowNormalSend",
  "shouldPauseSend",
  "persistAsNormalMessage",
  "showSafetyResources",
]);

const REQUIRED_COACH_POLICY_FIELDS = Object.freeze([
  "allowNormalCoaching",
  "useSafetyGuidance",
  "showSafetyResources",
  "allowRewriteApply",
]);

const SIGNAL_TO_CATEGORY = Object.freeze({
  emergency_immediate_danger: "immediate_danger",
  self_harm_or_suicide: "self_harm_or_suicide",
  violence_risk: "violence_risk",
  abuse_or_coercion: "abuse_or_coercion",
  high_conflict_relationship: "conflict_crisis",
  emotional_distress: "emotional_distress",
});

const LABEL_TO_CATEGORY = Object.freeze({
  "normal coaching": "none",
  "emotional distress": "emotional_distress",
  "high-conflict relationship crisis": "conflict_crisis",
  "possible abuse or coercion": "abuse_or_coercion",
  "self-harm or violence risk": "self_harm_or_suicide",
  "emergency immediate danger": "immediate_danger",
});

const LEVEL_FALLBACK_CATEGORY = Object.freeze({
  0: "none",
  1: "emotional_distress",
  2: "conflict_crisis",
  3: "unsafe_relationship_dynamics",
  4: "self_harm_or_suicide",
  5: "immediate_danger",
});

const KNOWN_CATEGORY_KEYS = new Set(
  listSafetyCategories().map((category) => category && category.key).filter(Boolean)
);

function asString(value) {
  if (value == null) return "";
  return String(value).trim();
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function toFiniteNumber(value, fallback) {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    return fallback;
  }
  return value;
}

function toBoundedConfidence(value, fallback) {
  const numeric = toFiniteNumber(value, fallback);
  if (numeric < 0) return 0;
  if (numeric > 1) return 1;
  return numeric;
}

function normalizeChannel(channel) {
  const normalized = asString(channel).toLowerCase();
  if (VALID_CHANNELS.includes(normalized)) {
    return normalized;
  }
  return "unknown";
}

function normalizeContextType(contextType) {
  const normalized = asString(contextType);
  return normalized || "unknown";
}

function normalizePolicyVersion(policyVersion) {
  const normalized = asString(policyVersion);
  return normalized || SAFETY_POLICY_VERSION;
}

function hasRequiredBooleanFields(target, requiredFields) {
  return requiredFields.every(
    (field) => Object.prototype.hasOwnProperty.call(target, field) && typeof target[field] === "boolean"
  );
}

function clonePolicy(policy, requiredFields, fallbackPolicy) {
  const source = policy && typeof policy === "object" ? policy : fallbackPolicy;
  const output = {};
  requiredFields.forEach((field) => {
    output[field] = Boolean(source && source[field]);
  });
  return output;
}

function resolveCategoryKey({ deterministicResult, semanticResult }) {
  const matchedSignals = Array.isArray(deterministicResult && deterministicResult.matchedSignals)
    ? deterministicResult.matchedSignals
    : [];

  for (const signal of matchedSignals) {
    const mapped = SIGNAL_TO_CATEGORY[signal];
    if (mapped && KNOWN_CATEGORY_KEYS.has(mapped)) {
      return mapped;
    }
  }

  const deterministicLabel = asString(deterministicResult && deterministicResult.label).toLowerCase();
  if (deterministicLabel && LABEL_TO_CATEGORY[deterministicLabel]) {
    return LABEL_TO_CATEGORY[deterministicLabel];
  }

  const semanticCategory = asString(semanticResult && semanticResult.category);
  if (semanticCategory && KNOWN_CATEGORY_KEYS.has(semanticCategory)) {
    return semanticCategory;
  }

  const level = Number.isInteger(deterministicResult && deterministicResult.level)
    ? deterministicResult.level
    : Number.isInteger(semanticResult && semanticResult.level)
      ? semanticResult.level
      : 0;

  return LEVEL_FALLBACK_CATEGORY[level] || "none";
}

function resolveSource({ deterministicResult, semanticResult }) {
  const deterministicLevel = Number.isInteger(deterministicResult && deterministicResult.level)
    ? deterministicResult.level
    : null;

  if (deterministicLevel != null) {
    if (deterministicLevel >= 3) return "deterministic";
    if (semanticResult && typeof semanticResult === "object") return "merged";
    return "deterministic";
  }

  if (semanticResult && typeof semanticResult === "object") {
    return "semantic";
  }

  return "none";
}

function getDecisionPolicyForContext({ contextEnvelope, categoryKey, fallbackLevel } = {}) {
  const resolvedCategoryKey =
    KNOWN_CATEGORY_KEYS.has(asString(categoryKey))
      ? asString(categoryKey)
      : LEVEL_FALLBACK_CATEGORY[Number.isInteger(fallbackLevel) ? fallbackLevel : 0] || "none";

  const category = getSafetyCategory(resolvedCategoryKey) || getSafetyCategory("none");
  const fallbackCategory = getSafetyCategory("none");

  return {
    categoryKey: category && category.key ? category.key : "none",
    urgency: asString(category && category.defaultUrgency) || "none",
    messagingPolicy: clonePolicy(
      category && category.messagingPolicy,
      REQUIRED_MESSAGING_POLICY_FIELDS,
      fallbackCategory.messagingPolicy
    ),
    coachPolicy: clonePolicy(
      category && category.coachPolicy,
      REQUIRED_COACH_POLICY_FIELDS,
      fallbackCategory.coachPolicy
    ),
  };
}

function buildSafetyDecision({
  contextEnvelope,
  deterministicResult,
  semanticResult,
  policyVersion,
} = {}) {
  const safeContext = contextEnvelope && typeof contextEnvelope === "object" ? contextEnvelope : {};
  const safeDeterministic = deterministicResult && typeof deterministicResult === "object" ? deterministicResult : {};
  const safeSemantic = semanticResult && typeof semanticResult === "object" ? semanticResult : null;

  const deterministicLevel = Number.isInteger(safeDeterministic.level) ? safeDeterministic.level : 0;
  const semanticLevel = Number.isInteger(safeSemantic && safeSemantic.level) ? safeSemantic.level : null;

  // Phase 3 precedence: deterministic output remains authoritative.
  const level = deterministicLevel;
  const categoryKey = resolveCategoryKey({ deterministicResult: safeDeterministic, semanticResult: safeSemantic });
  const policy = getDecisionPolicyForContext({
    contextEnvelope: safeContext,
    categoryKey,
    fallbackLevel: level,
  });

  const source = resolveSource({ deterministicResult: safeDeterministic, semanticResult: safeSemantic });

  const confidence = source === "none"
    ? 0
    : source === "deterministic"
      ? 1
      : source === "semantic"
        ? toBoundedConfidence(safeSemantic && safeSemantic.confidence, 0)
        : toBoundedConfidence(safeSemantic && safeSemantic.confidence, 1);

  const matchedSignals = isStringArray(safeDeterministic.matchedSignals)
    ? [...safeDeterministic.matchedSignals]
    : isStringArray(safeSemantic && safeSemantic.semanticSignals)
      ? [...safeSemantic.semanticSignals]
      : [];

  const defaultReason = level >= 3
    ? "Safety-sensitive content detected; standard coaching policy is paused."
    : "No critical safety signals detected.";

  return {
    decisionVersion: DECISION_VERSION,
    contextType: normalizeContextType(safeContext.contextType),
    channel: normalizeChannel(safeContext.channel),
    category: policy.categoryKey,
    level,
    confidence,
    urgency: policy.urgency,
    source,
    shouldStopNormalCoaching:
      typeof safeDeterministic.shouldStopNormalCoaching === "boolean"
        ? safeDeterministic.shouldStopNormalCoaching
        : level >= 3,
    messagingPolicy: policy.messagingPolicy,
    coachPolicy: policy.coachPolicy,
    matchedSignals,
    reason: asString(safeDeterministic.reason) || defaultReason,
    trace: {
      deterministicLevel,
      deterministicLabel: asString(safeDeterministic.label) || "unknown",
      semanticCategory: asString(safeSemantic && safeSemantic.category) || null,
      semanticConfidence:
        typeof (safeSemantic && safeSemantic.confidence) === "number"
          ? toBoundedConfidence(safeSemantic.confidence, 0)
          : null,
      policyVersion: normalizePolicyVersion(policyVersion),
    },
  };
}

function validateSafetyDecision(decision) {
  const errors = [];

  if (!decision || typeof decision !== "object") {
    return { ok: false, errors: ["decision: must be an object"] };
  }

  if (asString(decision.decisionVersion) === "") {
    errors.push("decisionVersion: must be a non-empty string");
  }

  if (normalizeContextType(decision.contextType) === "unknown" && asString(decision.contextType) === "") {
    errors.push("contextType: must be a non-empty string");
  }

  if (!VALID_CHANNELS.includes(decision.channel)) {
    errors.push(`channel: must be one of ${VALID_CHANNELS.join(", ")}`);
  }

  if (!KNOWN_CATEGORY_KEYS.has(asString(decision.category))) {
    errors.push("category: must be a known safety category key");
  }

  if (!Number.isInteger(decision.level) || decision.level < 0 || decision.level > 5) {
    errors.push("level: must be an integer between 0 and 5");
  }

  if (typeof decision.confidence !== "number" || decision.confidence < 0 || decision.confidence > 1) {
    errors.push("confidence: must be a number between 0 and 1");
  }

  const category = getSafetyCategory(asString(decision.category));
  const validUrgencies = new Set(listSafetyCategories().map((item) => item.defaultUrgency));
  if (!validUrgencies.has(asString(decision.urgency))) {
    errors.push("urgency: must be a valid urgency value from safety knowledge base");
  }

  if (!VALID_SOURCES.includes(decision.source)) {
    errors.push(`source: must be one of ${VALID_SOURCES.join(", ")}`);
  }

  if (typeof decision.shouldStopNormalCoaching !== "boolean") {
    errors.push("shouldStopNormalCoaching: must be a boolean");
  }

  if (!decision.messagingPolicy || typeof decision.messagingPolicy !== "object") {
    errors.push("messagingPolicy: must be an object");
  } else if (!hasRequiredBooleanFields(decision.messagingPolicy, REQUIRED_MESSAGING_POLICY_FIELDS)) {
    errors.push(`messagingPolicy: must include boolean fields ${REQUIRED_MESSAGING_POLICY_FIELDS.join(", ")}`);
  }

  if (!decision.coachPolicy || typeof decision.coachPolicy !== "object") {
    errors.push("coachPolicy: must be an object");
  } else if (!hasRequiredBooleanFields(decision.coachPolicy, REQUIRED_COACH_POLICY_FIELDS)) {
    errors.push(`coachPolicy: must include boolean fields ${REQUIRED_COACH_POLICY_FIELDS.join(", ")}`);
  }

  if (!isStringArray(decision.matchedSignals)) {
    errors.push("matchedSignals: must be an array of strings");
  }

  if (asString(decision.reason) === "") {
    errors.push("reason: must be a non-empty string");
  }

  if (!decision.trace || typeof decision.trace !== "object") {
    errors.push("trace: must be an object");
  } else {
    if (!Number.isInteger(decision.trace.deterministicLevel) || decision.trace.deterministicLevel < 0 || decision.trace.deterministicLevel > 5) {
      errors.push("trace.deterministicLevel: must be an integer between 0 and 5");
    }

    if (asString(decision.trace.deterministicLabel) === "") {
      errors.push("trace.deterministicLabel: must be a non-empty string");
    }

    if (
      decision.trace.semanticCategory !== null &&
      typeof decision.trace.semanticCategory !== "string"
    ) {
      errors.push("trace.semanticCategory: must be a string or null");
    }

    if (
      decision.trace.semanticConfidence !== null &&
      (typeof decision.trace.semanticConfidence !== "number" ||
        decision.trace.semanticConfidence < 0 ||
        decision.trace.semanticConfidence > 1)
    ) {
      errors.push("trace.semanticConfidence: must be a number between 0 and 1 or null");
    }

    if (asString(decision.trace.policyVersion) === "") {
      errors.push("trace.policyVersion: must be a non-empty string");
    }
  }

  if (category && category.level >= 3) {
    if (decision.messagingPolicy.allowNormalSend !== false) {
      errors.push("messagingPolicy.allowNormalSend: must be false for level 3+");
    }
    if (decision.messagingPolicy.shouldPauseSend !== true) {
      errors.push("messagingPolicy.shouldPauseSend: must be true for level 3+");
    }
    if (decision.coachPolicy.allowNormalCoaching !== false) {
      errors.push("coachPolicy.allowNormalCoaching: must be false for level 3+");
    }
    if (decision.coachPolicy.allowRewriteApply !== false) {
      errors.push("coachPolicy.allowRewriteApply: must be false for level 3+");
    }
  }

  if (category && category.level === 0) {
    if (decision.messagingPolicy.allowNormalSend !== true) {
      errors.push("messagingPolicy.allowNormalSend: must be true for level 0");
    }
    if (decision.coachPolicy.allowNormalCoaching !== true) {
      errors.push("coachPolicy.allowNormalCoaching: must be true for level 0");
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

module.exports = {
  DECISION_VERSION,
  buildSafetyDecision,
  validateSafetyDecision,
  getDecisionPolicyForContext,
};
