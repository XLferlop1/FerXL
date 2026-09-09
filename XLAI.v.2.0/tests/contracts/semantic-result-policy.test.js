"use strict";

const assert = require("assert");
const {
  SAFETY_POLICY_VERSION,
  SAFETY_CATEGORIES,
} = require("../../engine/safetyKnowledgeBase");
const {
  validateSemanticResultPolicy,
} = require("../../safety-corpus/validation/semantic-result-policy");

function candidate(overrides = {}) {
  return {
    policyReferenceVersion: SAFETY_POLICY_VERSION,
    category: "none",
    level: 0,
    inferenceStatus: "success",
    ...overrides,
  };
}

function assertValid(result, name) {
  assert.strictEqual(result.valid, true, `${name}: expected valid result`);
  assert.deepStrictEqual(result.errors, [], `${name}: expected no errors`);
}

function assertCode(result, code, name) {
  assert.strictEqual(result.valid, false, `${name}: expected invalid result`);
  assert(result.errors.some((entry) => entry.code === code), `${name}: expected ${code}`);
}

function run() {
  ["none", "emotional_distress", "self_harm_or_suicide", "immediate_danger"].forEach((category) => {
    assertValid(
      validateSemanticResultPolicy(candidate({ category, level: SAFETY_CATEGORIES[category].level })),
      `canonical ${category}`
    );
  });

  ["abstained", "timeout", "provider_error", "invalid_output"].forEach((inferenceStatus) => {
    const result = validateSemanticResultPolicy(candidate({
      category: null,
      level: null,
      inferenceStatus,
    }));
    assertValid(result, `non-success ${inferenceStatus}`);
    assert(result.checks.every((entry) => entry.name === "policy_version" || entry.status === "not_applicable"));
  });

  assertCode(validateSemanticResultPolicy(candidate({ category: "future_category" })), "UNKNOWN_CATEGORY", "unknown category");
  ["__proto__", "constructor", "toString"].forEach((category) => {
    assertCode(
      validateSemanticResultPolicy(candidate({ category })),
      "UNKNOWN_CATEGORY",
      `inherited category ${category}`
    );
  });
  assertValid(
    validateSemanticResultPolicy(candidate({ category: "none", level: SAFETY_CATEGORIES.none.level })),
    "canonical category after own-property checks"
  );
  assertCode(validateSemanticResultPolicy(candidate({ category: "emotional_distress", level: 2 })), "CATEGORY_LEVEL_MISMATCH", "category level mismatch");
  assertCode(validateSemanticResultPolicy(candidate({ level: 1 })), "CATEGORY_LEVEL_MISMATCH", "none wrong level");
  assertCode(validateSemanticResultPolicy(candidate({ category: "self_harm_or_suicide", level: 3 })), "CATEGORY_LEVEL_MISMATCH", "self-harm wrong level");

  ["success", "abstained", "timeout", "provider_error", "invalid_output"].forEach((inferenceStatus) => {
    assertCode(
      validateSemanticResultPolicy(candidate({ policyReferenceVersion: "wrong-version", inferenceStatus })),
      "POLICY_VERSION_MISMATCH",
      `wrong policy version ${inferenceStatus}`
    );
  });

  assertCode(validateSemanticResultPolicy(null), "INVALID_CANDIDATE", "null candidate");
  assertCode(validateSemanticResultPolicy(candidate({ inferenceStatus: "unknown" })), "UNSUPPORTED_INFERENCE_STATUS", "unsupported status");
  assertCode(
    validateSemanticResultPolicy(candidate({ text: "private input must not be returned" }), {
      loadPolicy: () => { throw new Error("loader failure"); },
    }),
    "INTERNAL_VALIDATOR_ERROR",
    "loader exception"
  );
  assertCode(
    validateSemanticResultPolicy(candidate(), {
      loadPolicy: () => ({
        SAFETY_POLICY_VERSION,
        SAFETY_CATEGORIES,
        validateSafetyKnowledgeBase: () => ({ ok: false }),
      }),
    }),
    "POLICY_ARTIFACT_INVALID",
    "malformed policy artifact"
  );
  assertCode(
    validateSemanticResultPolicy(candidate({ category: "some_category" }), {
      loadPolicy: () => ({
        SAFETY_POLICY_VERSION,
        SAFETY_CATEGORIES: { some_category: null },
        validateSafetyKnowledgeBase: () => ({ ok: true }),
      }),
    }),
    "POLICY_ARTIFACT_INVALID",
    "malformed canonical category entry"
  );

  const privacyResult = validateSemanticResultPolicy(candidate({ text: "private input must not be returned" }));
  assert(!JSON.stringify(privacyResult).includes("private input must not be returned"), "validation output must not expose raw input");

  console.log("SemanticResult policy validator tests passed.");
}

run();