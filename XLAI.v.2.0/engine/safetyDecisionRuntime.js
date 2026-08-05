"use strict";

const {
  buildSafetyDecision,
  validateSafetyDecision,
} = require("./safetyDecisionEngine");

function asMessage(error) {
  if (!error) return "unknown_error";
  if (typeof error.message === "string" && error.message.trim()) {
    return error.message.trim();
  }
  return String(error);
}

function buildSafetyDecisionSafe({
  route,
  contextEnvelope,
  deterministicResult,
  semanticResult,
  policyVersion,
  buildDecision,
  validateDecision,
  emitDebug,
  logger,
} = {}) {
  const safeRoute = typeof route === "string" && route.trim() ? route.trim() : "unknown";
  const buildFn = typeof buildDecision === "function" ? buildDecision : buildSafetyDecision;
  const validateFn = typeof validateDecision === "function" ? validateDecision : validateSafetyDecision;
  const debugFn = typeof emitDebug === "function" ? emitDebug : () => {};
  const log = logger && typeof logger.warn === "function" ? logger : console;

  try {
    const decision = buildFn({
      contextEnvelope,
      deterministicResult,
      semanticResult,
      policyVersion,
    });

    let validation = { ok: true, errors: [] };
    try {
      validation = validateFn(decision);
    } catch (error) {
      const message = asMessage(error);
      validation = {
        ok: false,
        errors: [`decision_validation_exception:${message}`],
      };
      log.warn("[SAFETY_DECISION] Validation execution failed", {
        route: safeRoute,
        error: message,
      });
    }

    try {
      debugFn(safeRoute, decision, validation);
    } catch (error) {
      log.warn("[SAFETY_DECISION] Debug emission failed", {
        route: safeRoute,
        error: asMessage(error),
      });
    }

    return {
      ok: true,
      decision,
      validation,
    };
  } catch (error) {
    const message = asMessage(error);
    const validation = {
      ok: false,
      errors: [`decision_build_exception:${message}`],
    };

    log.warn("[SAFETY_DECISION] Decision build failed", {
      route: safeRoute,
      error: message,
    });

    try {
      debugFn(safeRoute, null, validation);
    } catch (_debugError) {
      // Keep route flow safe if debug logger fails.
    }

    return {
      ok: false,
      decision: null,
      validation,
    };
  }
}

module.exports = {
  buildSafetyDecisionSafe,
};
