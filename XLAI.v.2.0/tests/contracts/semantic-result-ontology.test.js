"use strict";

const assert = require("assert");
const signalMap = require("../../safety-corpus/ontology/signal-map.json");
const {
  validateSemanticResultOntology,
  __test,
} = require("../../safety-corpus/validation/semantic-result-ontology");

function candidate(overrides = {}) {
  return {
    ontologyVersion: signalMap.version,
    category: "none",
    level: 0,
    semanticSignals: [],
    evidence: [],
    inferenceStatus: "success",
    ...overrides,
  };
}

function evidence(signal) {
  return { signal };
}

function assertValid(result, name) {
  assert.strictEqual(result.valid, true, `${name}: expected valid result`);
  assert.deepStrictEqual(result.errors, [], `${name}: expected no errors`);
}

function assertCode(result, code, name) {
  assert.strictEqual(result.valid, false, `${name}: expected invalid result`);
  assert(result.errors.some((entry) => entry.code === code), `${name}: expected ${code}`);
}

function artifactWith(signalEntry) {
  return {
    ...signalMap,
    semanticSignals: [signalEntry],
  };
}

function statusOf(result, name) {
  return result.checks.find((entry) => entry.name === name).status;
}

function assertInvariant(result, name) {
  assert.strictEqual(result.valid, result.errors.length === 0, `${name}: valid must equal errors.length === 0`);
}

function run() {
  assertValid(
    validateSemanticResultOntology(candidate({
      semanticSignals: ["credible_threat"],
      evidence: [evidence("credible_threat")],
    })),
    "canonical governed signal"
  );
  assertValid(
    validateSemanticResultOntology(candidate({
      semanticSignals: ["credible_threat", "fear_of_harm"],
      evidence: [evidence("credible_threat"), evidence("fear_of_harm")],
    })),
    "multiple governed signals"
  );

  assertCode(validateSemanticResultOntology(candidate({ semanticSignals: ["unknown_signal"] })), "UNKNOWN_SEMANTIC_SIGNAL", "unknown semantic signal");
  assertCode(validateSemanticResultOntology(candidate({ semanticSignals: ["self_harm_or_suicide"] })), "UNKNOWN_SEMANTIC_SIGNAL", "deterministic signal is not semantic");
  assertCode(validateSemanticResultOntology(candidate({ semanticSignals: ["corpus_future_signal"] })), "UNKNOWN_SEMANTIC_SIGNAL", "unpublished corpus signal");
  ["__proto__", "constructor", "toString"].forEach((signal) => {
    if (signalMap.semanticSignals.some((entry) => entry.signalKey === signal)) return;

    const resultSignalReport = validateSemanticResultOntology(candidate({ semanticSignals: [signal] }));
    assertCode(resultSignalReport, "UNKNOWN_SEMANTIC_SIGNAL", `prototype result signal ${signal}`);
    assert.strictEqual(statusOf(resultSignalReport, "semantic_signal_membership"), "failed", `prototype result signal ${signal} should fail membership`);

    const evidenceSignalReport = validateSemanticResultOntology(candidate({ evidence: [evidence(signal)] }));
    assertCode(evidenceSignalReport, "UNKNOWN_EVIDENCE_SIGNAL", `prototype evidence signal ${signal}`);
    assert.strictEqual(statusOf(evidenceSignalReport, "evidence_signal_membership"), "failed", `prototype evidence signal ${signal} should fail membership`);
  });
  assertCode(validateSemanticResultOntology(candidate({ evidence: [evidence("unknown_signal")] })), "UNKNOWN_EVIDENCE_SIGNAL", "unknown evidence signal");
  assertCode(validateSemanticResultOntology(candidate({ semanticSignals: [], evidence: [evidence("credible_threat")] })), "EVIDENCE_SIGNAL_NOT_DECLARED", "undeclared evidence signal");
  assertCode(validateSemanticResultOntology(candidate({ semanticSignals: ["credible_threat"], evidence: [] })), "SEMANTIC_SIGNAL_MISSING_EVIDENCE", "missing signal evidence");

  assertValid(validateSemanticResultOntology(candidate({ category: "none", semanticSignals: [], evidence: [] })), "empty signals with none");
  assertValid(validateSemanticResultOntology(candidate({ category: "immediate_danger", level: 5, semanticSignals: [], evidence: [] })), "empty signals with non-none category");

  ["success", "abstained", "invalid_output", "timeout", "provider_error"].forEach((inferenceStatus) => {
    const result = validateSemanticResultOntology(candidate({
      inferenceStatus,
      category: null,
      level: null,
      semanticSignals: ["unknown_signal"],
      evidence: [{ malformed: true }],
    }));
    if (inferenceStatus === "success") {
      assertCode(result, "UNKNOWN_SEMANTIC_SIGNAL", "success applies signal checks");
    } else {
      assertValid(result, `non-success ${inferenceStatus}`);
      assert(result.checks.slice(2).every((entry) => entry.status === "not_applicable"));
    }
  });

  ["success", "abstained", "invalid_output", "timeout", "provider_error"].forEach((inferenceStatus) => {
    assertCode(
      validateSemanticResultOntology(candidate({ ontologyVersion: "wrong-version", inferenceStatus })),
      "ONTOLOGY_VERSION_MISMATCH",
      `ontology version ${inferenceStatus}`
    );
  });

  assertCode(validateSemanticResultOntology(candidate({ inferenceStatus: "unknown" })), "UNSUPPORTED_INFERENCE_STATUS", "unsupported status");
  assertCode(validateSemanticResultOntology(null), "INVALID_CANDIDATE", "null candidate");
  assertCode(validateSemanticResultOntology(candidate({ semanticSignals: "credible_threat" })), "INVALID_SEMANTIC_SIGNALS", "non-array signals");
  assertCode(validateSemanticResultOntology(candidate({ evidence: {} })), "INVALID_EVIDENCE", "non-array evidence");
  assertCode(validateSemanticResultOntology(candidate({ evidence: [null] })), "INVALID_EVIDENCE", "malformed evidence entry");

  assert.strictEqual(__test.validateOntologyArtifact(null).error !== undefined, true, "null artifact should be invalid");
  assert(__test.validateOntologyArtifact({ semanticSignals: [] }).error, "missing artifact version should be invalid");
  assert(__test.validateOntologyArtifact({ version: "0.1" }).error, "missing semanticSignals should be invalid");
  assert(__test.validateOntologyArtifact(artifactWith(null)).error, "malformed semantic entry should be invalid");
  assert(__test.validateOntologyArtifact(artifactWith({ signalKey: "test", source: "deterministic" })).error, "wrong source should be invalid");
  assert(__test.validateOntologyArtifact({ version: "0.1", semanticSignals: [{ signalKey: "test", source: "semantic" }, { signalKey: "test", source: "semantic" }] }).error, "duplicate artifact signal should be invalid");

  const firewallArtifact = artifactWith({
    signalKey: "firewall_test",
    source: "semantic",
    possibleCategories: ["immediate_danger"],
    possibleLevels: [5],
  });
  const firewallCheck = __test.validateOntologyArtifact(firewallArtifact);
  assert.deepStrictEqual([...firewallCheck.signalKeys], ["firewall_test"], "reference metadata must not affect membership");
  assertValid(
    __test.validateSemanticResultOntologyWithArtifact(candidate({
      category: "none",
      level: 0,
      semanticSignals: ["firewall_test"],
      evidence: [evidence("firewall_test")],
    }), firewallArtifact),
    "category and level reference metadata firewall"
  );

  const privacyResult = validateSemanticResultOntology(candidate({
    semanticSignals: ["unknown_signal"],
    evidence: [{ signal: "private excerpt must not appear" }],
  }));
  const serialized = JSON.stringify(privacyResult);
  assert(!serialized.includes("private excerpt must not appear"), "reports must not expose raw evidence text");

  const validReport = validateSemanticResultOntology(candidate({
    semanticSignals: ["credible_threat"],
    evidence: [evidence("credible_threat")],
  }));
  assertInvariant(validReport, "valid governed signal with matching evidence");
  assert.strictEqual(statusOf(validReport, "semantic_signal_membership"), "passed", "valid signal membership should pass");
  assert.strictEqual(statusOf(validReport, "evidence_signal_membership"), "passed", "valid evidence membership should pass");
  assert.strictEqual(statusOf(validReport, "evidence_signal_declaration"), "passed", "valid evidence declaration should pass");
  assert.strictEqual(statusOf(validReport, "declared_signal_evidence_coverage"), "passed", "valid coverage should pass");

  const unknownSignalReport = validateSemanticResultOntology(candidate({ semanticSignals: ["unknown_signal"] }));
  assertInvariant(unknownSignalReport, "unknown semantic signal");
  assert.strictEqual(statusOf(unknownSignalReport, "semantic_signal_membership"), "failed", "unknown semantic signal should fail membership");

  const unknownEvidenceReport = validateSemanticResultOntology(candidate({ evidence: [evidence("unknown_signal")] }));
  assertInvariant(unknownEvidenceReport, "unknown evidence signal");
  assert.strictEqual(statusOf(unknownEvidenceReport, "evidence_signal_membership"), "failed", "unknown evidence signal should fail membership");

  const undeclaredEvidenceReport = validateSemanticResultOntology(candidate({
    semanticSignals: [],
    evidence: [evidence("credible_threat")],
  }));
  assertInvariant(undeclaredEvidenceReport, "undeclared evidence signal");
  assert.strictEqual(statusOf(undeclaredEvidenceReport, "evidence_signal_declaration"), "failed", "undeclared evidence signal should fail declaration");

  const missingCoverageReport = validateSemanticResultOntology(candidate({
    semanticSignals: ["credible_threat"],
    evidence: [],
  }));
  assertInvariant(missingCoverageReport, "missing signal evidence");
  assert.strictEqual(statusOf(missingCoverageReport, "declared_signal_evidence_coverage"), "failed", "missing coverage should fail");

  const nonSuccessReport = validateSemanticResultOntology(candidate({
    inferenceStatus: "abstained",
    category: null,
    level: null,
    semanticSignals: [],
    evidence: [],
  }));
  assertInvariant(nonSuccessReport, "non-success result");
  ["semantic_signal_membership", "evidence_signal_membership", "evidence_signal_declaration", "declared_signal_evidence_coverage"].forEach((name) => {
    assert.strictEqual(statusOf(nonSuccessReport, name), "not_applicable", `${name} should be not_applicable for non-success results`);
  });

  const malformedArtifactReport = __test.validateSemanticResultOntologyWithArtifact(candidate(), { version: "0.1", semanticSignals: null });
  assertInvariant(malformedArtifactReport, "malformed ontology artifact");
  assert.strictEqual(statusOf(malformedArtifactReport, "ontology_artifact"), "failed", "malformed ontology artifact should fail");

  const versionMismatchReport = validateSemanticResultOntology(candidate({ ontologyVersion: "wrong-version" }));
  assertInvariant(versionMismatchReport, "ontology version mismatch");
  assert.strictEqual(statusOf(versionMismatchReport, "ontology_version"), "failed", "ontology version mismatch should fail");

  console.log("SemanticResult ontology validator tests passed.");
}

run();