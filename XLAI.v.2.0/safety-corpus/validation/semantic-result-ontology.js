"use strict";

const canonicalOntology = require("../ontology/signal-map.json");

const VALIDATOR_VERSION = "0.1.0";
const SUPPORTED_STATUSES = new Set([
  "success",
  "abstained",
  "invalid_output",
  "timeout",
  "provider_error",
]);
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

function validateOntologyArtifact(artifact) {
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    return { error: "Ontology artifact must be an object." };
  }
  if (typeof artifact.version !== "string" || artifact.version.trim() === "") {
    return { error: "Ontology artifact must expose a non-empty version." };
  }
  if (!Array.isArray(artifact.semanticSignals)) {
    return { error: "Ontology artifact must expose semanticSignals as an array." };
  }

  const signalKeys = new Set();
  for (let index = 0; index < artifact.semanticSignals.length; index += 1) {
    const entry = artifact.semanticSignals[index];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { error: `Ontology semanticSignals[${index}] must be an object.` };
    }
    if (typeof entry.signalKey !== "string" || entry.signalKey.trim() === "") {
      return { error: `Ontology semanticSignals[${index}].signalKey must be a non-empty string.` };
    }
    if (entry.source !== "semantic") {
      return { error: `Ontology semanticSignals[${index}].source must be semantic.` };
    }
    if (signalKeys.has(entry.signalKey)) {
      return { error: `Ontology semanticSignals[${index}].signalKey must be unique.` };
    }
    signalKeys.add(entry.signalKey);
  }

  return { version: artifact.version, signalKeys };
}

function validateSemanticResultOntology(result) {
  return validateSemanticResultOntologyFromArtifact(result, canonicalOntology);
}

function validateSemanticResultOntologyFromArtifact(result, artifact) {
  const checks = [
    check("ontology_artifact", "failed"),
    check("ontology_version", "not_applicable"),
    check("semantic_signal_membership", "not_applicable"),
    check("evidence_signal_membership", "not_applicable"),
    check("evidence_signal_declaration", "not_applicable"),
    check("declared_signal_evidence_coverage", "not_applicable"),
  ];
  const errors = [];

  try {
    const artifactResult = validateOntologyArtifact(artifact);
    if (artifactResult.error) {
      errors.push(error("ONTOLOGY_ARTIFACT_INVALID", "ontology", artifactResult.error));
      return report(false, errors, checks);
    }
    checks[0].status = "passed";

    if (!result || typeof result !== "object" || Array.isArray(result)) {
      errors.push(error("INVALID_CANDIDATE", "result", "SemanticResult candidate must be an object."));
      return report(false, errors, checks);
    }

    if (typeof result.ontologyVersion !== "string" || result.ontologyVersion !== artifactResult.version) {
      errors.push(error(
        "ONTOLOGY_VERSION_MISMATCH",
        "ontologyVersion",
        "Result ontologyVersion must match the canonical signal-map artifact version."
      ));
      checks[1].status = "failed";
    } else {
      checks[1].status = "passed";
    }

    if (result.inferenceStatus === "success") {
      if (!Array.isArray(result.semanticSignals)) {
        errors.push(error("INVALID_SEMANTIC_SIGNALS", "semanticSignals", "semanticSignals must be an array for ontology validation."));
        return report(false, errors, checks);
      }
      if (!Array.isArray(result.evidence)) {
        errors.push(error("INVALID_EVIDENCE", "evidence", "evidence must be an array for ontology validation."));
        return report(false, errors, checks);
      }

      const declaredSignals = new Set(result.semanticSignals);
      let signalMembershipValid = true;
      result.semanticSignals.forEach((signal, index) => {
        if (typeof signal !== "string" || !artifactResult.signalKeys.has(signal)) {
          signalMembershipValid = false;
          errors.push(error(
            "UNKNOWN_SEMANTIC_SIGNAL",
            `semanticSignals[${index}]`,
            "semanticSignals must contain only governed semantic signal identifiers."
          ));
        }
      });
      checks[2].status = signalMembershipValid ? "passed" : "failed";

      const evidencedSignals = new Set();
      let evidenceMembershipValid = true;
      let evidenceDeclarationValid = true;
      result.evidence.forEach((evidence, index) => {
        if (!evidence || typeof evidence !== "object" || Array.isArray(evidence) || typeof evidence.signal !== "string" || evidence.signal.trim() === "") {
          evidenceMembershipValid = false;
          errors.push(error("INVALID_EVIDENCE", `evidence[${index}]`, "Evidence entries must contain a non-empty signal."));
          return;
        }
        if (!artifactResult.signalKeys.has(evidence.signal)) {
          evidenceMembershipValid = false;
          errors.push(error(
            "UNKNOWN_EVIDENCE_SIGNAL",
            `evidence[${index}].signal`,
            "Evidence signal must be a governed semantic signal identifier."
          ));
          return;
        }
        evidencedSignals.add(evidence.signal);
        if (!declaredSignals.has(evidence.signal)) {
          evidenceDeclarationValid = false;
          errors.push(error(
            "EVIDENCE_SIGNAL_NOT_DECLARED",
            `evidence[${index}].signal`,
            "Evidence signal must also appear in semanticSignals."
          ));
        }
      });
      checks[3].status = evidenceMembershipValid ? "passed" : "failed";
      checks[4].status = evidenceDeclarationValid ? "passed" : "failed";

      let coverageValid = true;
      result.semanticSignals.forEach((signal, index) => {
        if (typeof signal === "string" && !evidencedSignals.has(signal)) {
          coverageValid = false;
          errors.push(error(
            "SEMANTIC_SIGNAL_MISSING_EVIDENCE",
            `semanticSignals[${index}]`,
            "Each declared semantic signal must have a matching evidence signal."
          ));
        }
      });
      checks[5].status = coverageValid ? "passed" : "failed";
    } else if (NON_SUCCESS_STATUSES.has(result.inferenceStatus)) {
      checks[2].status = "not_applicable";
      checks[3].status = "not_applicable";
      checks[4].status = "not_applicable";
      checks[5].status = "not_applicable";
    } else if (!SUPPORTED_STATUSES.has(result.inferenceStatus)) {
      errors.push(error(
        "UNSUPPORTED_INFERENCE_STATUS",
        "inferenceStatus",
        "Ontology validation requires a supported SemanticResult inferenceStatus."
      ));
    }

    return report(errors.length === 0, errors, checks);
  } catch (caughtError) {
    errors.push(error(
      "INTERNAL_VALIDATOR_ERROR",
      "ontology",
      "Ontology-aware validation failed unexpectedly."
    ));
    return report(false, errors, checks);
  }
}

module.exports = {
  VALIDATOR_VERSION,
  validateSemanticResultOntology,
  __test: {
    validateOntologyArtifact,
    validateSemanticResultOntologyWithArtifact: validateSemanticResultOntologyFromArtifact,
  },
};