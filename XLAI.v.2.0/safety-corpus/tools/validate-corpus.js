#!/usr/bin/env node
"use strict";

// Development and QA utility only. This validator checks corpus data against the
// authoritative Safety Knowledge Base; it does not define policy or affect runtime enforcement.
const fs = require("fs");
const path = require("path");
const {
  getSafetyCategory,
} = require("../../engine/safetyKnowledgeBase");

const ONTOLOGY_DIR = path.join(__dirname, "../ontology");
const CONTEXT_DIMENSIONS = JSON.parse(fs.readFileSync(path.join(ONTOLOGY_DIR, "context-dimensions.json"), "utf8"));
const CONTEXT_TYPES = JSON.parse(fs.readFileSync(path.join(ONTOLOGY_DIR, "context-types.json"), "utf8"));
const REVIEW_STATUSES = new Set(["draft", "reviewed", "gold"]);
const ANNOTATION_CERTAINTIES = new Set(["clear", "uncertain", "ambiguous"]);
const EVIDENCE_SOURCES = new Set(["directly_observed", "user_reported", "inferred"]);
const BEHAVIORAL_CONTEXT_FIELDS = ["observedPatterns", "recurringThemes", "baselineDeviations", "interactionLoops", "contextualModifiers"];
const EXPECTED_BEHAVIOR_FIELDS = [
  "shouldStopNormalCoaching",
  "allowNormalSend",
  "allowRewriteApply",
  "useSafetyGuidance",
  "showSafetyResources",
];

const GOVERNED_CONTEXT_FIELDS = ["speakerRole", "targetRole", "relationship", "intent", "vulnerabilityContext", "temporality", "immediacy", "literalness", "powerImbalance"];

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

function canonicalId(value) {
  return typeof value === "string" && /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(value);
}

function validateContextTypeRegistry(registry) {
  const errors = [];
  if (!isObject(registry) || registry.registryType !== "corpus_scenario_metadata" || !Array.isArray(registry.entries)) {
    errors.push({ field: "contextTypeRegistry", reason: "must be a corpus_scenario_metadata registry with entries" });
    return errors;
  }
  const ids = new Set();
  const canonicalIds = new Set(registry.entries.filter((entry) => isObject(entry) && typeof entry.id === "string").map((entry) => entry.id));
  const aliases = new Map();
  registry.entries.forEach((entry, index) => {
    const field = `contextTypeRegistry.entries[${index}]`;
    if (!isObject(entry) || !canonicalId(entry.id) || typeof entry.definition !== "string" || !entry.definition.trim() || typeof entry.status !== "string" || !entry.status.trim()) {
      errors.push({ field, reason: "must contain canonical lower_snake_case id, non-empty definition, and status" });
      return;
    }
    if (ids.has(entry.id)) errors.push({ field: `${field}.id`, reason: "duplicate canonical registry ID" });
    ids.add(entry.id);
    if (Object.prototype.hasOwnProperty.call(entry, "aliases")) {
      if (!Array.isArray(entry.aliases) || entry.aliases.some((alias) => typeof alias !== "string" || !canonicalId(alias))) {
        errors.push({ field: `${field}.aliases`, reason: "must be lower_snake_case strings" });
      } else entry.aliases.forEach((alias) => {
        if (alias === entry.id || canonicalIds.has(alias) || aliases.has(alias)) errors.push({ field: `${field}.aliases`, reason: `alias '${alias}' collides with a canonical ID or alias` });
        aliases.set(alias, entry.id);
      });
    }
  });
  return errors;
}

function dimensionValues(dimension) {
  if (!isObject(dimension)) return new Set();
  return new Set([...(Array.isArray(dimension.values) ? dimension.values : []), ...(Array.isArray(dimension.recommendedValues) ? dimension.recommendedValues : []), ...(Array.isArray(dimension.approvedExtensions) ? dimension.approvedExtensions.map((extension) => typeof extension === "string" ? extension : extension && extension.id) : [])].filter(Boolean));
}

function validateDimensionDefinitions(dimensions) {
  const errors = [];
  const definitions = isObject(dimensions) && isObject(dimensions.dimensions) ? dimensions.dimensions : {};
  Object.entries(definitions).forEach(([dimensionName, dimension]) => {
    if (!isObject(dimension) || !Array.isArray(dimension.approvedExtensions)) return;
    const baseValues = dimensionValues({ ...dimension, approvedExtensions: [] });
    const extensionIds = new Set();
    const allExtensionIds = new Set(dimension.approvedExtensions.filter((extension) => isObject(extension) && typeof extension.id === "string").map((extension) => extension.id));
    const aliases = new Set();
    dimension.approvedExtensions.forEach((extension, index) => {
      const field = `contextDimensions.${dimensionName}.approvedExtensions[${index}]`;
      if (!isObject(extension) || !canonicalId(extension.id) || typeof extension.definition !== "string" || !extension.definition.trim() || extension.status !== "approved" || !Array.isArray(extension.examples) || !Array.isArray(extension.nonExamples) || !Array.isArray(extension.aliases)) {
        errors.push({ field, reason: "must contain lower_snake_case id, definition, status approved, examples, nonExamples, and aliases" });
        return;
      }
      if (extensionIds.has(extension.id) || baseValues.has(extension.id)) errors.push({ field: `${field}.id`, reason: "duplicate extension or canonical dimension ID" });
      extensionIds.add(extension.id);
      extension.aliases.forEach((alias) => {
        if (!canonicalId(alias) || baseValues.has(alias) || allExtensionIds.has(alias) || aliases.has(alias)) errors.push({ field: `${field}.aliases`, reason: `alias '${alias}' collides with a canonical value, extension ID, or alias` });
        aliases.add(alias);
      });
    });
  });
  return errors;
}

function validateContextGovernance(record, file, errors, dimensions = CONTEXT_DIMENSIONS, registry = CONTEXT_TYPES) {
  validateDimensionDefinitions(dimensions).forEach((error) => addError(errors, file, record, error.field, error.reason));
  const registryErrors = validateContextTypeRegistry(registry);
  registryErrors.forEach((error) => addError(errors, file, record, error.field, error.reason));
  const contextType = record.input && record.input.contextType !== undefined
    ? record.input.contextType
    : record.conversationMetadata && record.conversationMetadata.contextType;
  if (contextType !== undefined && (!isObject(registry) || !registry.entries.some((entry) => entry && entry.id === contextType))) {
    addError(errors, file, record, "contextType", "must be a registered canonical context type ID");
  }
  const containers = [];
  if (isObject(record.context)) containers.push(["context", record.context]);
  if (isObject(record.conversationMetadata)) containers.push(["conversationMetadata", record.conversationMetadata]);
  containers.forEach(([containerName, container]) => {
    GOVERNED_CONTEXT_FIELDS.forEach((field) => {
      if (container[field] === undefined || container[field] === null) return;
      const dimension = dimensions && dimensions.dimensions && dimensions.dimensions[field];
      if (!dimension) return;
      if (!dimensionValues(dimension).has(container[field])) addError(errors, file, record, `${containerName}.${field}`, "must be a governed canonical value or approved extension");
    });
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

function validateBehavioralContext(context, file, record, errors) {
  if (context === undefined) return;
  if (!isObject(context)) { addError(errors, file, record, "behavioralContext", "must be an object"); return; }
  BEHAVIORAL_CONTEXT_FIELDS.forEach((field) => {
    if (!Array.isArray(context[field])) { addError(errors, file, record, `behavioralContext.${field}`, "must be an array"); return; }
    context[field].forEach((item, index) => {
      const itemField = `behavioralContext.${field}[${index}]`;
      if (!isObject(item)) { addError(errors, file, record, itemField, "must be an object"); return; }
      if (typeof item.type !== "string" || item.type.trim() === "") addError(errors, file, record, `${itemField}.type`, "must be a non-empty string");
      if (typeof item.evidence !== "string" || item.evidence.trim() === "") addError(errors, file, record, `${itemField}.evidence`, "must be a non-empty string");
      if (!EVIDENCE_SOURCES.has(item.evidenceSource)) addError(errors, file, record, `${itemField}.evidenceSource`, "must be directly_observed, user_reported, or inferred");
    });
  });
  if (context.baselineStatus === "observed" && !context.observedPatterns.some((item) => isObject(item) && item.evidenceSource === "directly_observed")) addError(errors, file, record, "behavioralContext.baselineStatus", "observed requires directly_observed support in observedPatterns");
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

function validateRecord(record, file, dimensions = CONTEXT_DIMENSIONS, registry = CONTEXT_TYPES) {
  const errors = [];
  if (!isObject(record)) {
    addError(errors, file, record, "record", "must be an object");
    return errors;
  }

  const category = validateSafetyAnnotation(record.safetyAnnotation, file, record, "safetyAnnotation", errors, false);
  validateExpectedBehavior(record.expectedBehavior, category, file, record, errors);
  validateAnnotationMeta(record.annotationMeta, file, record, errors);
  validateContextGovernance(record, file, errors, dimensions, registry);

  if (Array.isArray(record.turns)) {
    validateConversation(record, file, errors);
  }

  validateBehavioralContext(record.behavioralContext, file, record, errors);

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
    {
      name: "provenance: valid directly observed baseline",
      record: { ...baseRecord("none", 0), behavioralContext: { baselineStatus: "observed", observedPatterns: [{ type: "pattern", evidence: "Available turn.", evidenceSource: "directly_observed" }], recurringThemes: [], baselineDeviations: [], interactionLoops: [], contextualModifiers: [] } },
      shouldPass: true,
    },
    {
      name: "provenance: valid user-reported insufficient baseline",
      record: { ...baseRecord("none", 0), behavioralContext: { baselineStatus: "insufficient_evidence", observedPatterns: [{ type: "reported", evidence: "User report.", evidenceSource: "user_reported" }], recurringThemes: [], baselineDeviations: [], interactionLoops: [], contextualModifiers: [] } },
      shouldPass: true,
    },
    {
      name: "provenance: valid inferred insufficient baseline",
      record: { ...baseRecord("none", 0), behavioralContext: { baselineStatus: "insufficient_evidence", observedPatterns: [{ type: "inference", evidence: "Possible pattern.", evidenceSource: "inferred" }], recurringThemes: [], baselineDeviations: [], interactionLoops: [], contextualModifiers: [] } },
      shouldPass: true,
    },
    {
      name: "provenance: valid mixed observed baseline",
      record: { ...baseRecord("none", 0), behavioralContext: { baselineStatus: "observed", observedPatterns: [{ type: "pattern", evidence: "Available turn.", evidenceSource: "directly_observed" }, { type: "reported", evidence: "User report.", evidenceSource: "user_reported" }], recurringThemes: [], baselineDeviations: [], interactionLoops: [], contextualModifiers: [] } },
      shouldPass: true,
    },
    {
      name: "provenance: valid unknown baseline",
      record: { ...baseRecord("none", 0), behavioralContext: { baselineStatus: "unknown", observedPatterns: [], recurringThemes: [], baselineDeviations: [], interactionLoops: [], contextualModifiers: [] } },
      shouldPass: true,
    },
    {
      name: "provenance: reject invalid evidence source",
      record: { ...baseRecord("none", 0), behavioralContext: { baselineStatus: "unknown", observedPatterns: [{ type: "pattern", evidence: "Evidence.", evidenceSource: "invalid" }], recurringThemes: [], baselineDeviations: [], interactionLoops: [], contextualModifiers: [] } },
      shouldPass: false, expectedError: "evidenceSource",
    },
    {
      name: "provenance: reject missing behavioral source",
      record: { ...baseRecord("none", 0), behavioralContext: { baselineStatus: "unknown", observedPatterns: [{ type: "pattern", evidence: "Evidence." }], recurringThemes: [], baselineDeviations: [], interactionLoops: [], contextualModifiers: [] } },
      shouldPass: false, expectedError: "evidenceSource",
    },
    {
      name: "provenance: reject user-reported-only observed baseline",
      record: { ...baseRecord("none", 0), behavioralContext: { baselineStatus: "observed", observedPatterns: [{ type: "reported", evidence: "User report.", evidenceSource: "user_reported" }], recurringThemes: [], baselineDeviations: [], interactionLoops: [], contextualModifiers: [] } },
      shouldPass: false, expectedError: "baselineStatus",
    },
    {
      name: "provenance: reject inferred-only observed baseline",
      record: { ...baseRecord("none", 0), behavioralContext: { baselineStatus: "observed", observedPatterns: [{ type: "inference", evidence: "Inference.", evidenceSource: "inferred" }], recurringThemes: [], baselineDeviations: [], interactionLoops: [], contextualModifiers: [] } },
      shouldPass: false, expectedError: "baselineStatus",
    },
    {
      name: "provenance: reject malformed behavioral evidence",
      record: { ...baseRecord("none", 0), behavioralContext: { baselineStatus: "unknown", observedPatterns: [{}], recurringThemes: [], baselineDeviations: [], interactionLoops: [], contextualModifiers: [] } },
      shouldPass: false, expectedError: "observedPatterns[0]",
    },
    {
      name: "context: registered scenario and canonical closed values",
      record: { ...baseRecord("none", 0), input: { contextType: "self_harm_risk" }, context: { temporality: "current", immediacy: "none", literalness: "literal", powerImbalance: "none", vulnerabilityContext: "unknown" } },
      shouldPass: true,
    },
    {
      name: "context: ongoing temporality",
      record: { ...baseRecord("none", 0), input: { contextType: "location_control_escalation" }, context: { temporality: "ongoing" } },
      shouldPass: true,
    },
    {
      name: "context: approved extensible value",
      record: { ...baseRecord("none", 0), input: { contextType: "emotional_distress" }, context: { vulnerabilityContext: "anger_intense" } },
      shouldPass: true,
    },
    {
      name: "context: absence distinctions",
      record: { ...baseRecord("none", 0), input: { contextType: "relationship_boundary" }, context: { powerImbalance: "none", vulnerabilityContext: "none_observed" } },
      shouldPass: true,
    },
    {
      name: "context: unknown closed dimension",
      record: { ...baseRecord("none", 0), input: { contextType: "relationship_boundary" }, context: { temporality: "sometimes" } },
      shouldPass: false, expectedError: "temporality",
    },
    {
      name: "context: unknown unregistered extension",
      record: { ...baseRecord("none", 0), input: { contextType: "relationship_boundary" }, context: { relationship: "roommate" } },
      shouldPass: false, expectedError: "relationship",
    },
    {
      name: "context: unknown scenario type",
      record: { ...baseRecord("none", 0), input: { contextType: "unregistered_scenario" } },
      shouldPass: false, expectedError: "contextType",
    },
    {
      name: "context registry: duplicate canonical ID",
      record: { ...baseRecord("none", 0) },
      registry: { ...CONTEXT_TYPES, entries: [CONTEXT_TYPES.entries[0], CONTEXT_TYPES.entries[0]] },
      shouldPass: false, expectedError: "duplicate canonical registry ID",
    },
    {
      name: "context registry: alias collision",
      record: { ...baseRecord("none", 0) },
      registry: { ...CONTEXT_TYPES, entries: [{ id: "alpha_type", definition: "Alpha", status: "active", aliases: ["beta_type"] }, { id: "beta_type", definition: "Beta", status: "active" }] },
      shouldPass: false, expectedError: "alias",
    },
    {
      name: "context registry: alias is not canonical",
      record: { ...baseRecord("none", 0), input: { contextType: "old_scenario" } },
      registry: { ...CONTEXT_TYPES, entries: [{ id: "registered_scenario", definition: "Scenario", status: "active", aliases: ["old_scenario"] }] },
      shouldPass: false, expectedError: "contextType",
    },
    {
      name: "context registry: malformed item",
      record: { ...baseRecord("none", 0) },
      registry: { ...CONTEXT_TYPES, entries: [{ id: "bad id", definition: "", status: "" }] },
      shouldPass: false, expectedError: "contextTypeRegistry.entries[0]",
    },
    {
      name: "context extension: metadata-bearing approved value",
      record: { ...baseRecord("none", 0), input: { contextType: "relationship_boundary" }, context: { intent: "set_boundary" } },
      shouldPass: true,
    },
    {
      name: "context extension: reject bare string",
      record: { ...baseRecord("none", 0), input: { contextType: "relationship_boundary" } },
      dimensions: { ...CONTEXT_DIMENSIONS, dimensions: { ...CONTEXT_DIMENSIONS.dimensions, intent: { ...CONTEXT_DIMENSIONS.dimensions.intent, approvedExtensions: ["bare_value"] } } },
      shouldPass: false, expectedError: "approvedExtensions[0]",
    },
    {
      name: "context extension: reject missing definition",
      record: { ...baseRecord("none", 0), input: { contextType: "relationship_boundary" } },
      dimensions: { ...CONTEXT_DIMENSIONS, dimensions: { ...CONTEXT_DIMENSIONS.dimensions, intent: { ...CONTEXT_DIMENSIONS.dimensions.intent, approvedExtensions: [{ id: "missing_definition", status: "approved", examples: [], nonExamples: [], aliases: [] }] } } },
      shouldPass: false, expectedError: "approvedExtensions[0]",
    },
    {
      name: "context extension: reject invalid status",
      record: { ...baseRecord("none", 0), input: { contextType: "relationship_boundary" } },
      dimensions: { ...CONTEXT_DIMENSIONS, dimensions: { ...CONTEXT_DIMENSIONS.dimensions, intent: { ...CONTEXT_DIMENSIONS.dimensions.intent, approvedExtensions: [{ id: "invalid_status", definition: "Invalid status fixture.", status: "draft", examples: [], nonExamples: [], aliases: [] }] } } },
      shouldPass: false, expectedError: "approvedExtensions[0]",
    },
    {
      name: "context extension: reject duplicate ID",
      record: { ...baseRecord("none", 0), input: { contextType: "relationship_boundary" } },
      dimensions: { ...CONTEXT_DIMENSIONS, dimensions: { ...CONTEXT_DIMENSIONS.dimensions, intent: { ...CONTEXT_DIMENSIONS.dimensions.intent, approvedExtensions: [{ id: "duplicate_value", definition: "First value.", status: "approved", examples: [], nonExamples: [], aliases: [] }, { id: "duplicate_value", definition: "Second value.", status: "approved", examples: [], nonExamples: [], aliases: [] }] } } },
      shouldPass: false, expectedError: "duplicate extension",
    },
  ];

  let failed = false;
  cases.forEach(({ name, record, shouldPass, expectedError, registry, dimensions }) => {
    const errors = validateRecord(record, "self-test", dimensions || CONTEXT_DIMENSIONS, registry || CONTEXT_TYPES);
    const passed = errors.length === 0;
    if (passed !== shouldPass || (expectedError && !errors.some((error) => error.field.includes(expectedError) || error.reason.includes(expectedError)))) {
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
