"use strict";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isString(value) {
  return typeof value === "string";
}

function isNumber(value) {
  return typeof value === "number" && !Number.isNaN(value);
}

function inRange(value, min, max) {
  return isNumber(value) && value >= min && value <= max;
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function ensure(path, condition, errors, message) {
  if (!condition) {
    errors.push(`${path}: ${message}`);
  }
}

function validateCommunicationContract(communication, path = "communication") {
  const errors = [];

  ensure(path, isObject(communication), errors, "must be an object");
  if (!isObject(communication)) return { ok: false, errors };

  ensure(`${path}.intent`, isObject(communication.intent), errors, "must be an object");
  if (isObject(communication.intent)) {
    ensure(`${path}.intent.label`, isString(communication.intent.label), errors, "must be a string");
    ensure(`${path}.intent.confidence`, inRange(communication.intent.confidence, 0, 1), errors, "must be number 0..1");
    ensure(`${path}.intent.explanation`, isString(communication.intent.explanation), errors, "must be a string");
  }

  ensure(`${path}.emotion`, isObject(communication.emotion), errors, "must be an object");
  if (isObject(communication.emotion)) {
    ensure(`${path}.emotion.primary`, isString(communication.emotion.primary), errors, "must be a string");
    ensure(`${path}.emotion.intensity`, inRange(communication.emotion.intensity, 0, 1), errors, "must be number 0..1");
    ensure(`${path}.emotion.explanation`, isString(communication.emotion.explanation), errors, "must be a string");
  }

  ensure(`${path}.relationship`, isObject(communication.relationship), errors, "must be an object");
  if (isObject(communication.relationship)) {
    ensure(`${path}.relationship.type`, isString(communication.relationship.type), errors, "must be a string");
    ensure(`${path}.relationship.confidence`, inRange(communication.relationship.confidence, 0, 1), errors, "must be number 0..1");
    ensure(`${path}.relationship.explanation`, isString(communication.relationship.explanation), errors, "must be a string");
  }

  ensure(`${path}.risks`, Array.isArray(communication.risks), errors, "must be an array");
  if (Array.isArray(communication.risks)) {
    communication.risks.forEach((risk, index) => {
      ensure(`${path}.risks[${index}]`, isObject(risk), errors, "must be an object");
      if (isObject(risk)) {
        ensure(`${path}.risks[${index}].type`, isString(risk.type), errors, "must be a string");
        ensure(`${path}.risks[${index}].severity`, isString(risk.severity), errors, "must be a string");
        ensure(`${path}.risks[${index}].explanation`, isString(risk.explanation), errors, "must be a string");
      }
    });
  }

  ensure(`${path}.recipientImpact`, isObject(communication.recipientImpact), errors, "must be an object");
  if (isObject(communication.recipientImpact)) {
    ensure(`${path}.recipientImpact.likelyReaction`, isString(communication.recipientImpact.likelyReaction), errors, "must be a string");
    ensure(`${path}.recipientImpact.explanation`, isString(communication.recipientImpact.explanation), errors, "must be a string");
  }

  ensure(`${path}.coachingStrategy`, isObject(communication.coachingStrategy), errors, "must be an object");
  if (isObject(communication.coachingStrategy)) {
    ensure(`${path}.coachingStrategy.mode`, isString(communication.coachingStrategy.mode), errors, "must be a string");
    ensure(`${path}.coachingStrategy.approach`, isString(communication.coachingStrategy.approach), errors, "must be a string");
    ensure(`${path}.coachingStrategy.userLesson`, isString(communication.coachingStrategy.userLesson), errors, "must be a string");
  }

  return { ok: errors.length === 0, errors };
}

function validateSafetyBlockedResponse(payload) {
  const errors = [];
  ensure("payload", isObject(payload), errors, "must be an object");
  if (!isObject(payload)) return { ok: false, errors };

  ensure("safety", isObject(payload.safety), errors, "must be an object");
  if (isObject(payload.safety)) {
    ensure("safety.level", Number.isInteger(payload.safety.level), errors, "must be an integer");
    ensure("safety.label", isString(payload.safety.label), errors, "must be a string");
    ensure("safety.shouldStopNormalCoaching", typeof payload.safety.shouldStopNormalCoaching === "boolean", errors, "must be boolean");
    ensure("safety.reason", isString(payload.safety.reason), errors, "must be a string");
    ensure("safety.matchedSignals", isStringArray(payload.safety.matchedSignals), errors, "must be an array of strings");
    ensure("safety.resources", isStringArray(payload.safety.resources), errors, "must be an array of strings");
  }

  ensure("coachingBlocked", payload.coachingBlocked === true, errors, "must be true");
  ensure("message", isString(payload.message), errors, "must be a string");
  ensure("suggestedRewrite", payload.suggestedRewrite === null, errors, "must be null");

  return { ok: errors.length === 0, errors };
}

function validateAnalyzeIntensityResponse(payload) {
  const errors = [];
  ensure("payload", isObject(payload), errors, "must be an object");
  if (!isObject(payload)) return { ok: false, errors };

  if (payload.coachingBlocked === true) {
    return validateSafetyBlockedResponse(payload);
  }

  ensure("ok", payload.ok === true, errors, "must be true");
  ensure("intent", isString(payload.intent), errors, "must be a string");
  ensure("analysis", isObject(payload.analysis), errors, "must be an object");
  ensure("coaching", isObject(payload.coaching), errors, "must be an object");
  ensure("communication", isObject(payload.communication), errors, "must be an object");

  if (isObject(payload.analysis)) {
    ensure("analysis.risk_level", isString(payload.analysis.risk_level), errors, "must be a string");
    ensure("analysis.reason", isString(payload.analysis.reason), errors, "must be a string");
    ensure("analysis.tone", isString(payload.analysis.tone), errors, "must be a string");
    ensure("analysis.intensity", inRange(payload.analysis.intensity, 0, 1), errors, "must be number 0..1");
    ensure("analysis.intensity_label", isString(payload.analysis.intensity_label), errors, "must be a string");
    ensure("analysis.risks", isStringArray(payload.analysis.risks), errors, "must be an array of strings");
    ensure("analysis.intent_guess", isString(payload.analysis.intent_guess), errors, "must be a string");
    ensure("analysis.intent_type", isString(payload.analysis.intent_type), errors, "must be a string");
  }

  if (isObject(payload.coaching)) {
    ensure("coaching.natural_response", isString(payload.coaching.natural_response), errors, "must be a string");
    ensure("coaching.suggestion", isString(payload.coaching.suggestion), errors, "must be a string");
    ensure("coaching.soft_alternative", isString(payload.coaching.soft_alternative), errors, "must be a string");
    ensure("coaching.note", isString(payload.coaching.note), errors, "must be a string");
    ensure("coaching.response", isString(payload.coaching.response), errors, "must be a string");
    ensure("coaching.quick_read", isString(payload.coaching.quick_read), errors, "must be a string");
    ensure("coaching.what_to_do", isStringArray(payload.coaching.what_to_do), errors, "must be an array of strings");
    ensure("coaching.what_to_say", isStringArray(payload.coaching.what_to_say), errors, "must be an array of strings");
    ensure("coaching.when_to_use_each", isStringArray(payload.coaching.when_to_use_each), errors, "must be an array of strings");
    ensure("coaching.insight", isString(payload.coaching.insight), errors, "must be a string");
    ensure("coaching.principle", isString(payload.coaching.principle), errors, "must be a string");
    ensure("coaching.rewrite", isString(payload.coaching.rewrite), errors, "must be a string");
  }

  if (isObject(payload.communication)) {
    const communicationResult = validateCommunicationContract(payload.communication, "communication");
    errors.push(...communicationResult.errors);
  }

  if (payload.adaptiveThreshold !== undefined) {
    ensure("adaptiveThreshold", inRange(payload.adaptiveThreshold, 0, 1), errors, "must be number 0..1 when present");
  }

  return { ok: errors.length === 0, errors };
}

function validateRephraseResponse(payload) {
  const errors = [];
  ensure("payload", isObject(payload), errors, "must be an object");
  if (!isObject(payload)) return { ok: false, errors };

  if (payload.coachingBlocked === true) {
    return validateSafetyBlockedResponse(payload);
  }

  ensure("ok", payload.ok === true, errors, "must be true");
  ensure("mode", payload.mode === "simple" || payload.mode === "deep", errors, "must be simple or deep");
  ensure("rewrite", isString(payload.rewrite), errors, "must be a string");
  ensure("communication", isObject(payload.communication), errors, "must be an object");

  if (payload.mode === "simple") {
    ensure("shortReason", payload.shortReason === undefined || isString(payload.shortReason), errors, "must be a string when present");
  }

  if (payload.mode === "deep") {
    ensure("quickRead", isString(payload.quickRead), errors, "must be a string");
    ensure("whyItMatters", isString(payload.whyItMatters), errors, "must be a string");
    ensure("bestMove", isString(payload.bestMove), errors, "must be a string");
    ensure("optionalAlternative", isString(payload.optionalAlternative), errors, "must be a string");
  }

  if (isObject(payload.communication)) {
    const communicationResult = validateCommunicationContract(payload.communication, "communication");
    errors.push(...communicationResult.errors);
  }

  return { ok: errors.length === 0, errors };
}

function validateSendResponse(payload) {
  const errors = [];
  ensure("payload", isObject(payload), errors, "must be an object");
  if (!isObject(payload)) return { ok: false, errors };

  if (payload.coachingBlocked === true) {
    return validateSafetyBlockedResponse(payload);
  }

  ensure("ok", payload.ok === true, errors, "must be true");
  ensure("id", payload.id === null || Number.isInteger(payload.id), errors, "must be integer or null");
  ensure("created_at", isString(payload.created_at), errors, "must be a string");

  if (payload.dry_run !== undefined) {
    ensure("dry_run", typeof payload.dry_run === "boolean", errors, "must be boolean when present");
  }

  ensure("communication", isObject(payload.communication), errors, "must be an object");
  if (isObject(payload.communication)) {
    const communicationResult = validateCommunicationContract(payload.communication, "communication");
    errors.push(...communicationResult.errors);
  }

  return { ok: errors.length === 0, errors };
}

const CONTRACT_VALIDATORS = Object.freeze({
  analyzeIntensity: validateAnalyzeIntensityResponse,
  rephrase: validateRephraseResponse,
  send: validateSendResponse,
  safetyBlocked: validateSafetyBlockedResponse,
});

function hardenContract(contractName, payload, options = {}) {
  const validator = CONTRACT_VALIDATORS[contractName];
  if (typeof validator !== "function") {
    return payload;
  }

  const result = validator(payload);
  if (!result.ok) {
    const route = options.route || contractName;
    const logger = options.logger || console;
    logger.warn(`[CONTRACT] ${route} response drift detected`, {
      contract: contractName,
      errors: result.errors,
    });
  }

  return payload;
}

module.exports = {
  validateCommunicationContract,
  validateSafetyBlockedResponse,
  validateAnalyzeIntensityResponse,
  validateRephraseResponse,
  validateSendResponse,
  hardenContract,
};
