#!/usr/bin/env node
"use strict";

// Development and QA utility only. This validator checks corpus data against the
// authoritative Safety Knowledge Base; it does not define policy or affect runtime enforcement.
const fs = require("fs");
const path = require("path");
const {
  getSafetyCategory,
} = require("../../engine/safetyKnowledgeBase");

const REVIEW_STATUSES = new Set(["draft", "reviewed", "gold"]);
const ANNOTATION_CERTAINTIES = new Set(["clear", "uncertain", "ambiguous"]);
const EXPECTED_BEHAVIOR_FIELDS = [
  "shouldStopNormalCoaching",
  "allowNormalSend",
  "allowRewriteApply",
  "useSafetyGuidance",
  "showSafetyResources",
];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function addError(errors, file, record, field, reason) {
  errors.push({
    file,
    recordId: isObject(record) && typeof record.id === "string" ? record.id : "unknown",
    field,
    reason,
  });
}

function validateLevel(level, file, record, field, errors) {
  if (!Number.isInteger(level) || level < 0 || level > 5) {
    addError(errors, file, record, field, "must be an integer from 0 through 5");
    return false;
  }
  return true;
}

function validateSafetyAnnotation(annotation, file, record, field, errors, requireCertainty) {
  if (!isObject(annotation)) {
    addError(errors, file, record, field, "must be an object");
    return;
  }

  const category = getSafetyCategory(annotation.category);
  if (!category) {
    addError(errors, file, record, `${field}.category`, "must be an existing Safety Knowledge Base category key");
  }

  const levelIsValid = validateLevel(annotation.level, file, record, `${field}.level`, errors);
  if (category && levelIsValid && annotation.level !== category.level) {
    addError(
      errors,
      file,
      record,
      `${field}.level`,
      `must be ${category.level} for category '${category.key}'`
    );
  }

  if (requireCertainty || Object.prototype.hasOwnProperty.call(annotation, "annotationCertainty")) {
    if (!ANNOTATION_CERTAINTIES.has(annotation.annotationCertainty)) {
      addError(
        errors,
        file,
        record,
        `${field}.annotationCertainty`,
        "must be one of clear, uncertain, ambiguous"
      );
    }
  }

  return category;
}

function validateExpectedBehavior(expectedBehavior, category, file, record, errors) {
  if (!isObject(expectedBehavior) || !category) return;

  const expectedPolicy = {
    shouldStopNormalCoaching: category.level >= 3,
    allowNormalSend: category.messagingPolicy.allowNormalSend,
    allowRewriteApply: category.coachPolicy.allowRewriteApply,
    useSafetyGuidance: category.coachPolicy.useSafetyGuidance,
    showSafetyResources: category.coachPolicy.showSafetyResources,
  };

  EXPECTED_BEHAVIOR_FIELDS.forEach((field) => {
    if (expectedBehavior[field] !== expectedPolicy[field]) {
      addError(
        errors,
        file,
        record,
        `expectedBehavior.${field}`,
        `must match authoritative Safety Knowledge Base policy value ${expectedPolicy[field]}`
      );
    }
  });
}

function validateAnnotationMeta(meta, file, record, errors) {
  if (!isObject(meta)) return;

  if (!REVIEW_STATUSES.has(meta.reviewStatus)) {
    addError(errors, file, record, "annotationMeta.reviewStatus", "must be one of draft, reviewed, gold");
  }
  if (!ANNOTATION_CERTAINTIES.has(meta.annotationCertainty)) {
    addError(
      errors,
      file,
      record,
      "annotationMeta.annotationCertainty",
      "must be one of clear, uncertain, ambiguous"
    );
  }
}

function validateConversation(record, file, errors) {
  const annotatedTurns = new Map();
  if (Array.isArray(record.turns)) {
    record.turns.forEach((turn, index) => {
      if (isObject(turn) && Object.prototype.hasOwnProperty.call(turn, "safetyAnnotation")) {
        validateSafetyAnnotation(
          turn.safetyAnnotation,
          file,
          record,
          `turns[${index}].safetyAnnotation`,
          errors,
          true
        );
        if (isObject(turn.safetyAnnotation) && Number.isInteger(turn.safetyAnnotation.level)) {
          annotatedTurns.set(turn.turnNumber, turn.safetyAnnotation);
        }
      }
    });
  }

  if (isObject(record.cumulativeState)) {
    const state = record.cumulativeState;
    const hasCategory = Object.prototype.hasOwnProperty.call(state, "currentSafetyCategory");
    const hasLevel = Object.prototype.hasOwnProperty.call(state, "currentSafetyLevel");
    if (hasCategory !== hasLevel) {
      addError(
        errors,
        file,
        record,
        "cumulativeState",
        "currentSafetyCategory and currentSafetyLevel must be supplied together when either is supplied"
      );
    } else if (hasCategory && state.currentSafetyCategory !== null && state.currentSafetyLevel !== null) {
      validateSafetyAnnotation(
        { category: state.currentSafetyCategory, level: state.currentSafetyLevel },
        file,
        record,
        "cumulativeState",
        errors,
        false
      );
    }
  }

  if (Array.isArray(record.safetyTransitions)) {
    record.safetyTransitions.forEach((transition, index) => {
      if (!isObject(transition)) {
        addError(errors, file, record, `safetyTransitions[${index}]`, "must be an object");
        return;
      }
      validateLevel(transition.fromLevel, file, record, `safetyTransitions[${index}].fromLevel`, errors);
      validateLevel(transition.toLevel, file, record, `safetyTransitions[${index}].toLevel`, errors);
      if (!annotatedTurns.has(transition.atTurn)) {
        addError(errors, file, record, `safetyTransitions[${index}].atTurn`, "must reference a turn with a safety annotation");
        return;
      }
      const annotatedTurn = annotatedTurns.get(transition.atTurn);
      if (annotatedTurn.level !== transition.toLevel) {
        addError(errors, file, record, `safetyTransitions[${index}].toLevel`, "must match the annotated level at atTurn");
      }
      const priorTurns = [...annotatedTurns.keys()].filter((turnNumber) => turnNumber < transition.atTurn);
      const priorLevel = priorTurns.length > 0
        ? annotatedTurns.get(priorTurns.sort((a, b) => b - a)[0]).level
        : record.conversationMetadata && record.conversationMetadata.startingSafetyLevel;
      if (Number.isInteger(priorLevel) && priorLevel !== transition.fromLevel) {
        addError(errors, file, record, `safetyTransitions[${index}].fromLevel`, "must match the prior established conversation level");
      }
    });
  }

  const finalTurnNumber = [...annotatedTurns.keys()].sort((a, b) => b - a)[0];
  const finalAnnotation = finalTurnNumber === undefined ? null : annotatedTurns.get(finalTurnNumber);
  if (finalAnnotation && isObject(record.cumulativeState)) {
    if (record.cumulativeState.currentSafetyLevel !== finalAnnotation.level) {
      addError(errors, file, record, "cumulativeState.currentSafetyLevel", "must match the final annotated conversation level");
    }
    if (record.cumulativeState.currentSafetyCategory !== finalAnnotation.category) {
      addError(errors, file, record, "cumulativeState.currentSafetyCategory", "must match the final annotated conversation category");
    }
  }
}

function validateRecord(record, file) {
  const errors = [];
  if (!isObject(record)) {
    addError(errors, file, record, "record", "must be an object");
    return errors;
  }

  const category = validateSafetyAnnotation(record.safetyAnnotation, file, record, "safetyAnnotation", errors, false);
  validateExpectedBehavior(record.expectedBehavior, category, file, record, errors);
  validateAnnotationMeta(record.annotationMeta, file, record, errors);

  if (Array.isArray(record.turns)) {
    validateConversation(record, file, errors);
  }

  return errors;
}

function readRecords(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  if (path.extname(filePath).toLowerCase() === ".jsonl") {
    return raw
      .split(/\r?\n/)
      .map((line, index) => ({ line, index: index + 1 }))
      .filter(({ line }) => line.trim())
      .map(({ line, index }) => ({ record: JSON.parse(line), source: `${filePath}:${index}` }));
  }
  return [{ record: JSON.parse(raw), source: filePath }];
}

function collectInputFiles(inputPath) {
  const stat = fs.statSync(inputPath);
  if (stat.isFile()) return [inputPath];
  if (!stat.isDirectory()) return [];

  const files = [];
  for (const entry of fs.readdirSync(inputPath, { withFileTypes: true })) {
    const entryPath = path.join(inputPath, entry.name);
    if (entry.isDirectory()) files.push(...collectInputFiles(entryPath));
    else if ([".json", ".jsonl"].includes(path.extname(entry.name).toLowerCase())) files.push(entryPath);
  }
  return files;
}

function validatePath(inputPath) {
  const errors = [];
  const files = collectInputFiles(inputPath);
  if (files.length === 0) {
    addError(errors, inputPath, null, "path", "contains no .json or .jsonl files");
    return errors;
  }

  files.forEach((file) => {
    try {
      readRecords(file).forEach(({ record, source }) => errors.push(...validateRecord(record, source)));
    } catch (error) {
      addError(errors, file, null, "file", `cannot parse JSON: ${error.message}`);
    }
  });
  return errors;
}

function expectedBehaviorFor(categoryKey) {
  const category = getSafetyCategory(categoryKey);
  return {
    shouldStopNormalCoaching: category.level >= 3,
    allowNormalSend: category.messagingPolicy.allowNormalSend,
    allowRewriteApply: category.coachPolicy.allowRewriteApply,
    useSafetyGuidance: category.coachPolicy.useSafetyGuidance,
    showSafetyResources: category.coachPolicy.showSafetyResources,
  };
}

function baseRecord(categoryKey, level) {
  return {
    id: "self-test-record",
    safetyAnnotation: { category: categoryKey, level },
    expectedBehavior: expectedBehaviorFor(categoryKey),
    annotationMeta: { reviewStatus: "draft", annotationCertainty: "clear" },
  };
}

function runSelfTest() {
  const cases = [
    { name: "valid Level 0", record: baseRecord("none", 0), shouldPass: true },
    { name: "valid Level 3 policy", record: baseRecord("abuse_or_coercion", 3), shouldPass: true },
    { name: "immediate danger at Level 0", record: baseRecord("immediate_danger", 0), shouldPass: false },
    {
      name: "Level 3 allows normal send",
      record: { ...baseRecord("abuse_or_coercion", 3), expectedBehavior: { ...expectedBehaviorFor("abuse_or_coercion"), allowNormalSend: true } },
      shouldPass: false,
    },
    {
      name: "invalid review status",
      record: { ...baseRecord("none", 0), annotationMeta: { reviewStatus: "ambiguous", annotationCertainty: "clear" } },
      shouldPass: false,
    },
    {
      name: "invalid annotation certainty",
      record: { ...baseRecord("none", 0), annotationMeta: { reviewStatus: "draft", annotationCertainty: "certain" } },
      shouldPass: false,
    },
    {
      name: "conversation certainty progression",
      record: {
        ...baseRecord("none", 0),
        id: "self-test-conversation",
        turns: [
          { turnNumber: 1, speaker: "user", text: "First", safetyAnnotation: { category: "none", level: 0, annotationCertainty: "ambiguous" } },
          { turnNumber: 2, speaker: "other", text: "Second", safetyAnnotation: { category: "none", level: 0, annotationCertainty: "uncertain" } },
          { turnNumber: 3, speaker: "user", text: "Third", safetyAnnotation: { category: "none", level: 0, annotationCertainty: "clear" } },
        ],
        cumulativeState: { currentSafetyCategory: "none", currentSafetyLevel: 0 },
        safetyTransitions: [],
      },
      shouldPass: true,
    },
    {
      name: "conversation transition continuity",
      record: {
        ...baseRecord("none", 0),
        id: "self-test-transition",
        conversationMetadata: { startingSafetyLevel: 0 },
        turns: [
          { turnNumber: 1, speaker: "user", text: "First", safetyAnnotation: { category: "none", level: 0, annotationCertainty: "ambiguous" } },
          { turnNumber: 2, speaker: "user", text: "Second", safetyAnnotation: { category: "abuse_or_coercion", level: 3, annotationCertainty: "clear" } },
        ],
        cumulativeState: { currentSafetyCategory: "abuse_or_coercion", currentSafetyLevel: 3 },
        safetyTransitions: [{ fromLevel: 0, toLevel: 3, atTurn: 2, reason: "New evidence", evidence: ["Second"] }],
      },
      shouldPass: true,
    },
    {
      name: "conversation transition wrong prior level",
      record: {
        ...baseRecord("none", 0),
        id: "self-test-invalid-transition",
        conversationMetadata: { startingSafetyLevel: 0 },
        turns: [
          { turnNumber: 1, speaker: "user", text: "First", safetyAnnotation: { category: "none", level: 0, annotationCertainty: "clear" } },
          { turnNumber: 2, speaker: "user", text: "Second", safetyAnnotation: { category: "abuse_or_coercion", level: 3, annotationCertainty: "clear" } },
        ],
        cumulativeState: { currentSafetyCategory: "abuse_or_coercion", currentSafetyLevel: 3 },
        safetyTransitions: [{ fromLevel: 2, toLevel: 3, atTurn: 2, reason: "New evidence", evidence: ["Second"] }],
      },
      shouldPass: false,
    },
    {
      name: "conversation transition nonexistent turn",
      record: {
        ...baseRecord("none", 0),
        id: "self-test-missing-turn",
        conversationMetadata: { startingSafetyLevel: 0 },
        turns: [{ turnNumber: 1, speaker: "user", text: "First", safetyAnnotation: { category: "none", level: 0, annotationCertainty: "clear" } }],
        cumulativeState: { currentSafetyCategory: "none", currentSafetyLevel: 0 },
        safetyTransitions: [{ fromLevel: 0, toLevel: 3, atTurn: 3, reason: "Missing", evidence: ["Missing"] }],
      },
      shouldPass: false,
    },
  ];

  let failed = false;
  cases.forEach(({ name, record, shouldPass }) => {
    const errors = validateRecord(record, "self-test");
    const passed = errors.length === 0;
    if (passed !== shouldPass) {
      failed = true;
      console.error(`SELF-TEST FAILED: ${name}`);
      errors.forEach((error) => console.error(`  ${error.field}: ${error.reason}`));
    } else {
      console.log(`SELF-TEST PASSED: ${name}`);
    }
  });
  return failed ? 1 : 0;
}

function printErrors(errors) {
  errors.forEach((error) => {
    console.error(`${error.file} [record: ${error.recordId}] ${error.field}: ${error.reason}`);
  });
}

function main() {
  const inputPath = process.argv[2];
  if (inputPath === "--self-test") return runSelfTest();
  if (!inputPath) {
    console.error("Usage: node safety-corpus/tools/validate-corpus.js <path>");
    return 2;
  }

  try {
    const errors = validatePath(path.resolve(inputPath));
    if (errors.length > 0) {
      printErrors(errors);
      return 1;
    }
    console.log(`Corpus validation passed: ${inputPath}`);
    return 0;
  } catch (error) {
    console.error(`Validation failed: ${error.message}`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = {
  validateRecord,
  validatePath,
};
