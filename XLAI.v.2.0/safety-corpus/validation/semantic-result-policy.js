"use strict";

const canonicalPolicy = require("../../engine/safetyKnowledgeBase");

const VALIDATOR_VERSION = "0.1.0";
const NON_SUCCESS_STATUSES = new Set([
  "abstained",
  "invalid_output",
  "timeout",
  "provider_error",
]);

function check(name, status) {
  return { name, status };
}

function error(code, path, message) {
  return { code, path, message };
}

function report(valid, errors, checks) {
  return {
    valid,
    errors,
    checks,
    validatorVersion: VALIDATOR_VERSION,
  };
}

function validatePolicyArtifact(policy) {
  if (!policy || typeof policy !== "object") {
    return "Policy artifact must be an object.";
  }
  if (typeof policy.SAFETY_POLICY_VERSION !== "string" || policy.SAFETY_POLICY_VERSION.length === 0) {
    return "Policy artifact must expose a non-empty SAFETY_POLICY_VERSION.";
  }
  if (!policy.SAFETY_CATEGORIES || typeof policy.SAFETY_CATEGORIES !== "object" || Array.isArray(policy.SAFETY_CATEGORIES)) {
    return "Policy artifact must expose SAFETY_CATEGORIES as an object.";
  }
  if (typeof policy.validateSafetyKnowledgeBase !== "function") {
    return "Policy artifact must expose validateSafetyKnowledgeBase.";
  }

  const validation = policy.validateSafetyKnowledgeBase();
  if (!validation || validation.ok !== true) {
    return "Canonical Safety Knowledge Base validation failed.";
  }

  return null;
}

function validateSemanticResultPolicy(result, options = {}) {
  const checks = [
    check("policy_version", "failed"),
    check("category_exists", "not_applicable"),
    check("category_level_alignment", "not_applicable"),
  ];
  const errors = [];

  try {
    const loadPolicy = options.loadPolicy || (() => canonicalPolicy);
    const policy = loadPolicy();
    const policyError = validatePolicyArtifact(policy);
    if (policyError) {
      errors.push(error("POLICY_ARTIFACT_INVALID", "policy", policyError));
      return report(false, errors, checks);
    }

    if (!result || typeof result !== "object" || Array.isArray(result)) {
      errors.push(error("INVALID_CANDIDATE", "result", "SemanticResult candidate must be an object."));
      return report(false, errors, checks);
    }

    if (typeof result.policyReferenceVersion !== "string" || result.policyReferenceVersion !== policy.SAFETY_POLICY_VERSION) {
      errors.push(error(
        "POLICY_VERSION_MISMATCH",
        "policyReferenceVersion",
        "Result policyReferenceVersion must match the canonical Safety Knowledge Base version."
      ));
    } else {
      checks[0].status = "passed";
    }

    if (result.inferenceStatus === "success") {
      const hasCanonicalCategory = Object.prototype.hasOwnProperty.call(policy.SAFETY_CATEGORIES, result.category);
      if (!hasCanonicalCategory) {
        errors.push(error(
          "UNKNOWN_CATEGORY",
          "category",
          "Result category must exist in the canonical Safety Knowledge Base."
        ));
      } else {
        const category = policy.SAFETY_CATEGORIES[result.category];
        if (!category || typeof category !== "object" || Array.isArray(category)) {
          errors.push(error(
            "POLICY_ARTIFACT_INVALID",
            "policy.SAFETY_CATEGORIES",
            "Canonical category definition must be a non-null object."
          ));
          return report(false, errors, checks);
        }
        checks[1].status = "passed";
        if (category.level !== result.level) {
          errors.push(error(
            "CATEGORY_LEVEL_MISMATCH",
            "level",
            "Result level must match the canonical level for its category."
          ));
        } else {
          checks[2].status = "passed";
        }
      }
    } else if (NON_SUCCESS_STATUSES.has(result.inferenceStatus)) {
      checks[1].status = "not_applicable";
      checks[2].status = "not_applicable";
    } else {
      errors.push(error(
        "UNSUPPORTED_INFERENCE_STATUS",
        "inferenceStatus",
        "Policy validation requires a supported SemanticResult inferenceStatus."
      ));
    }

    return report(errors.length === 0, errors, checks);
  } catch (caughtError) {
    errors.push(error(
      "INTERNAL_VALIDATOR_ERROR",
      "policy",
      "Policy-aware validation failed unexpectedly."
    ));
    return report(false, errors, checks);
  }
}

module.exports = {
  VALIDATOR_VERSION,
  validateSemanticResultPolicy,
};