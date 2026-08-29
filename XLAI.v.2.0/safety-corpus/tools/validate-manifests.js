#!/usr/bin/env node
"use strict";

// Development-only governance validation. This tool never changes corpus data.
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const CORPUS_DIR = path.join(PROJECT_ROOT, "safety-corpus", "corpus", "v0.1-draft");
const MANIFEST_DIR = path.join(PROJECT_ROOT, "safety-corpus", "manifests", "v0.1");
const CORPUS_FILES = [
  ["single-turn-pilot-a.jsonl", "single_turn"],
  ["multi-turn-pilot-a.jsonl", "multi_turn"],
  ["single-turn-pilot-b.jsonl", "single_turn"],
  ["multi-turn-pilot-b.jsonl", "multi_turn"],
];
const VALID_ROLES = new Set(["TRAINING", "DEVELOPMENT", "HELD_OUT"]);
const VALID_TYPES = new Set(["single_turn", "multi_turn"]);
const VALID_TIERS = new Set(["LOW", "MEDIUM", "HIGH", "VERY_HIGH"]);
const EXPECTED_ROLE_COUNTS = { TRAINING: 8, DEVELOPMENT: 9, HELD_OUT: 19 };
const EXPECTED_TYPE_ROLE_COUNTS = {
  TRAINING: { single_turn: 8, multi_turn: 0 },
  DEVELOPMENT: { single_turn: 7, multi_turn: 2 },
  HELD_OUT: { single_turn: 9, multi_turn: 10 },
};
const EXPECTED_CATEGORY_ROLE_COUNTS = {
  none: { TRAINING: 2, DEVELOPMENT: 6, HELD_OUT: 7, total: 15 },
  emotional_distress: { TRAINING: 1, DEVELOPMENT: 0, HELD_OUT: 3, total: 4 },
  conflict_crisis: { TRAINING: 1, DEVELOPMENT: 0, HELD_OUT: 0, total: 1 },
  coercive_control_or_isolation: { TRAINING: 1, DEVELOPMENT: 0, HELD_OUT: 3, total: 4 },
  stalking_or_tracking: { TRAINING: 1, DEVELOPMENT: 1, HELD_OUT: 0, total: 2 },
  self_harm_or_suicide: { TRAINING: 1, DEVELOPMENT: 0, HELD_OUT: 4, total: 5 },
  violence_risk: { TRAINING: 1, DEVELOPMENT: 1, HELD_OUT: 0, total: 2 },
  immediate_danger: { TRAINING: 0, DEVELOPMENT: 1, HELD_OUT: 2, total: 3 },
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readJsonl(filePath, recordType) {
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => ({ record: JSON.parse(line), file: filePath, line: index + 1, recordType }));
}

function loadCorpus() {
  const entries = [];
  for (const [fileName, recordType] of CORPUS_FILES) {
    entries.push(...readJsonl(path.join(CORPUS_DIR, fileName), recordType));
  }
  return entries;
}

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function addError(errors, recordId, field, expected, actual) {
  errors.push({ recordId: recordId || "unknown", field, expected, actual });
}

function countValues(values) {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function validateProtectedFamilies(familyRegistry, corpusById, errors) {
  const families = Array.isArray(familyRegistry.families) ? familyRegistry.families : [];
  const familyById = new Map();
  families.forEach((family, index) => {
    if (!family || typeof family.familyId !== "string") {
      addError(errors, "unknown", `families[${index}].familyId`, "non-empty family ID", family && family.familyId);
      return;
    }
    if (familyById.has(family.familyId)) {
      addError(errors, family.familyId, "familyId", "unique family ID", family.familyId);
    }
    familyById.set(family.familyId, family);
    const memberIds = Array.isArray(family.memberRecordIds) ? family.memberRecordIds : [];
    const seen = new Set();
    memberIds.forEach((recordId, memberIndex) => {
      if (seen.has(recordId)) addError(errors, family.familyId, `memberRecordIds[${memberIndex}]`, "no duplicate member IDs", recordId);
      seen.add(recordId);
      if (!corpusById.has(recordId)) addError(errors, family.familyId, `memberRecordIds[${memberIndex}]`, "existing corpus record ID", recordId);
    });
    if (!VALID_TIERS.has(family.contaminationTier)) {
      addError(errors, family.familyId, "contaminationTier", "LOW, MEDIUM, HIGH, or VERY_HIGH", family.contaminationTier);
    }
    if (!Array.isArray(family.evaluationType) || family.evaluationType.length === 0) {
      addError(errors, family.familyId, "evaluationType", "non-empty array", family.evaluationType);
    }
    if (!Array.isArray(family.restrictions) || family.restrictions.length === 0) {
      addError(errors, family.familyId, "restrictions", "non-empty array", family.restrictions);
    }
  });
  return familyById;
}

function validateManifestData(manifest, familyRegistry, tagRegistry, corpusEntries, options = {}) {
  const errors = [];
  const requireComplete = options.requireComplete !== false;
  const checkExpected = options.checkExpected !== false;
  const corpusById = new Map();
  const normalizedTexts = new Map();
  const normalizedSequences = new Map();

  corpusEntries.forEach((entry) => {
    const id = entry.record && entry.record.id;
    if (corpusById.has(id)) addError(errors, id, "corpus.id", "unique corpus ID", id);
    corpusById.set(id, entry);
    const text = entry.record.input ? entry.record.input.text : null;
    if (text !== null) {
      const normalized = normalizeText(text);
      if (normalizedTexts.has(normalized)) addError(errors, id, "input.text", "no identical normalized text", normalizedTexts.get(normalized));
      normalizedTexts.set(normalized, id);
    }
    if (entry.record.turns) {
      const sequence = entry.record.turns
        .filter((turn) => turn.speaker === "user")
        .map((turn) => normalizeText(turn.text))
        .join(" || ");
      if (normalizedSequences.has(sequence)) addError(errors, id, "turns", "no identical normalized user-turn sequence", normalizedSequences.get(sequence));
      normalizedSequences.set(sequence, id);
    }
  });

  if (requireComplete) {
    if (corpusEntries.length !== 36) addError(errors, "manifest", "corpus.total", 36, corpusEntries.length);
    const singleCount = corpusEntries.filter((entry) => entry.recordType === "single_turn").length;
    const multiCount = corpusEntries.filter((entry) => entry.recordType === "multi_turn").length;
    if (singleCount !== 24) addError(errors, "manifest", "corpus.single_turn", 24, singleCount);
    if (multiCount !== 12) addError(errors, "manifest", "corpus.multi_turn", 12, multiCount);
  }

  if (!manifest || manifest.manifestVersion !== "0.1") addError(errors, "manifest", "manifestVersion", "0.1", manifest && manifest.manifestVersion);
  if (!manifest || manifest.splitVersion !== "0.1") addError(errors, "manifest", "splitVersion", "0.1", manifest && manifest.splitVersion);
  if (!manifest || manifest.corpusVersion !== "v0.1-draft") addError(errors, "manifest", "corpusVersion", "v0.1-draft", manifest && manifest.corpusVersion);
  if (!manifest || JSON.stringify(manifest.channelScope) !== JSON.stringify(["messaging"])) addError(errors, "manifest", "channelScope", ["messaging"], manifest && manifest.channelScope);
  const expectedExposurePolicy = {
    TRAINING: ["May be exposed to approved future classifier training or fitting.", "Must not be treated as unbiased held-out evaluation after exposure."],
    DEVELOPMENT: ["May be used for prompt, threshold, calibration, architecture, and debugging work.", "Must not be reported as unbiased held-out evaluation."],
    HELD_OUT: ["Must not be used for training, few-shot examples, prompt examples, threshold tuning, calibration, retrieval, or synthetic-generation templates before evaluation."],
  };
  if (!manifest || JSON.stringify(manifest.exposurePolicy) !== JSON.stringify(expectedExposurePolicy)) addError(errors, "manifest", "exposurePolicy", expectedExposurePolicy, manifest && manifest.exposurePolicy);

  const familyById = validateProtectedFamilies(familyRegistry, corpusById, errors);
  const allowedTags = new Set((tagRegistry.tags || []).map((entry) => entry && entry.tag));
  const assignments = Array.isArray(manifest.records) ? manifest.records : [];
  const assignmentById = new Map();
  const roleCounts = { TRAINING: 0, DEVELOPMENT: 0, HELD_OUT: 0 };
  const typeRoleCounts = {};
  const categoryRoleCounts = {};
  const levelRoleCounts = {};

  assignments.forEach((assignment, index) => {
    const id = assignment && assignment.recordId;
    if (assignmentById.has(id)) addError(errors, id, "records", "one manifest assignment", "duplicate assignment");
    assignmentById.set(id, assignment);
    const corpus = corpusById.get(id);
    if (!corpus) {
      addError(errors, id, "recordId", "existing corpus record ID", id);
      return;
    }
    if (!VALID_TYPES.has(assignment.recordType)) addError(errors, id, "recordType", "single_turn or multi_turn", assignment.recordType);
    if (assignment.recordType !== corpus.recordType) addError(errors, id, "recordType", corpus.recordType, assignment.recordType);
    if (assignment.sourceSchemaVersion !== corpus.record.schemaVersion) addError(errors, id, "sourceSchemaVersion", corpus.record.schemaVersion, assignment.sourceSchemaVersion);
    if (corpus.record.corpusVersion !== manifest.corpusVersion) addError(errors, id, "corpusVersion", manifest.corpusVersion, corpus.record.corpusVersion);
    if (!VALID_ROLES.has(assignment.exposureRole)) addError(errors, id, "exposureRole", "TRAINING, DEVELOPMENT, or HELD_OUT", assignment.exposureRole);
    if (VALID_ROLES.has(assignment.exposureRole)) roleCounts[assignment.exposureRole] += 1;
    if (!VALID_TIERS.has(assignment.contaminationTier)) addError(errors, id, "contaminationTier", "LOW, MEDIUM, HIGH, or VERY_HIGH", assignment.contaminationTier);
    if (!familyById.has(assignment.conceptFamilyId)) addError(errors, id, "conceptFamilyId", "registered concept family", assignment.conceptFamilyId);
    else if (!familyById.get(assignment.conceptFamilyId).memberRecordIds.includes(id)) addError(errors, id, "conceptFamilyId", "family membership for record ID", assignment.conceptFamilyId);
    if (!Array.isArray(assignment.evaluationTags)) addError(errors, id, "evaluationTags", "array of governed tags", assignment.evaluationTags);
    else assignment.evaluationTags.forEach((tag, tagIndex) => {
      if (!allowedTags.has(tag)) addError(errors, id, `evaluationTags[${tagIndex}]`, "registered evaluation tag", tag);
    });
    if (!Array.isArray(assignment.protectedSiblingIds)) addError(errors, id, "protectedSiblingIds", "array of IDs", assignment.protectedSiblingIds);
    else {
      const siblings = new Set();
      assignment.protectedSiblingIds.forEach((siblingId, siblingIndex) => {
        if (siblings.has(siblingId)) addError(errors, id, `protectedSiblingIds[${siblingIndex}]`, "no duplicate sibling IDs", siblingId);
        siblings.add(siblingId);
        if (siblingId === id) addError(errors, id, `protectedSiblingIds[${siblingIndex}]`, "must not reference itself", siblingId);
        if (!corpusById.has(siblingId)) addError(errors, id, `protectedSiblingIds[${siblingIndex}]`, "existing corpus record ID", siblingId);
      });
    }
    if (typeof assignment.assignmentRationale !== "string" || assignment.assignmentRationale.trim() === "") addError(errors, id, "assignmentRationale", "non-empty rationale", assignment.assignmentRationale);
    const category = corpus.record.safetyAnnotation && corpus.record.safetyAnnotation.category;
    if (category) {
      categoryRoleCounts[category] ||= { TRAINING: 0, DEVELOPMENT: 0, HELD_OUT: 0, total: 0 };
      if (VALID_ROLES.has(assignment.exposureRole)) categoryRoleCounts[category][assignment.exposureRole] += 1;
      categoryRoleCounts[category].total += 1;
    }
    const level = corpus.record.safetyAnnotation && corpus.record.safetyAnnotation.level;
    if (Number.isInteger(level)) {
      levelRoleCounts[level] ||= { TRAINING: 0, DEVELOPMENT: 0, HELD_OUT: 0, total: 0 };
      if (VALID_ROLES.has(assignment.exposureRole)) levelRoleCounts[level][assignment.exposureRole] += 1;
      levelRoleCounts[level].total += 1;
    }
    typeRoleCounts[assignment.exposureRole] ||= { single_turn: 0, multi_turn: 0 };
    if (VALID_TYPES.has(assignment.recordType)) typeRoleCounts[assignment.exposureRole][assignment.recordType] += 1;
  });

  if (requireComplete) {
    corpusById.forEach((entry, id) => {
      if (!assignmentById.has(id)) addError(errors, id, "records", "exactly one manifest assignment", "missing assignment");
      const meta = entry.record.annotationMeta || {};
      if (meta.source !== "synthetic") addError(errors, id, "annotationMeta.source", "synthetic", meta.source);
      if (meta.reviewStatus !== "reviewed") addError(errors, id, "annotationMeta.reviewStatus", "reviewed", meta.reviewStatus);
      const actualChannel = entry.record.input ? entry.record.input.channel : entry.record.conversationMetadata.channel;
      if (actualChannel !== "messaging") addError(errors, id, "channel", "messaging", actualChannel);
    });
    if (assignmentById.size !== corpusById.size) addError(errors, "manifest", "records.length", corpusById.size, assignmentById.size);
  }

  if (checkExpected && requireComplete) {
    for (const [role, expected] of Object.entries(EXPECTED_ROLE_COUNTS)) if (roleCounts[role] !== expected) addError(errors, role, "calculatedRoleCount", expected, roleCounts[role]);
    for (const [role, expected] of Object.entries(EXPECTED_TYPE_ROLE_COUNTS)) {
      for (const type of Object.keys(expected)) if ((typeRoleCounts[role] && typeRoleCounts[role][type] || 0) !== expected[type]) addError(errors, role, `calculatedTypeRoleCount.${type}`, expected[type], typeRoleCounts[role] && typeRoleCounts[role][type] || 0);
    }
    for (const [category, expected] of Object.entries(EXPECTED_CATEGORY_ROLE_COUNTS)) {
      const actual = categoryRoleCounts[category] || { TRAINING: 0, DEVELOPMENT: 0, HELD_OUT: 0, total: 0 };
      for (const key of ["TRAINING", "DEVELOPMENT", "HELD_OUT", "total"]) if (actual[key] !== expected[key]) addError(errors, category, `calculatedCategoryRoleCount.${key}`, expected[key], actual[key]);
    }
  }

  return {
    errors,
    summary: {
      records: corpusEntries.length,
      single_turn: corpusEntries.filter((entry) => entry.recordType === "single_turn").length,
      multi_turn: corpusEntries.filter((entry) => entry.recordType === "multi_turn").length,
      exposure: roleCounts,
      typeRole: typeRoleCounts,
      categories: categoryRoleCounts,
      levels: levelRoleCounts,
      channels: countValues(corpusEntries.map((entry) => entry.record.input ? entry.record.input.channel : entry.record.conversationMetadata.channel)),
    },
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function runSelfTest() {
  const manifest = readJson(path.join(MANIFEST_DIR, "exposure-manifest.json"));
  const families = readJson(path.join(MANIFEST_DIR, "protected-families.json"));
  const tags = readJson(path.join(MANIFEST_DIR, "evaluation-tags.json"));
  const corpus = loadCorpus();
  const slice = corpus.slice(0, 1);
  const sliceManifest = clone(manifest);
  sliceManifest.records = [clone(manifest.records[0])];
  sliceManifest.records[0].protectedSiblingIds = [];
  const sliceFamilies = clone(families);
  sliceFamilies.families = sliceFamilies.families.filter((family) => family.familyId === manifest.records[0].conceptFamilyId);
  sliceFamilies.families[0].memberRecordIds = [manifest.records[0].recordId];
  const cases = [
    ["valid minimal manifest slice", () => validateManifestData(sliceManifest, sliceFamilies, tags, slice, { requireComplete: false, checkExpected: false }).errors.length === 0],
    ["duplicate record assignment", () => { const m=clone(manifest); m.records.push(clone(m.records[0])); return validateManifestData(m,families,tags,corpus).errors.some(e=>e.field==='records'); }],
    ["missing corpus record", () => { const m=clone(manifest); m.records=m.records.slice(1); return validateManifestData(m,families,tags,corpus).errors.some(e=>e.expected==='exactly one manifest assignment'); }],
    ["unknown record ID", () => { const m=clone(manifest); m.records[0].recordId='unknown-record'; return validateManifestData(m,families,tags,corpus).errors.some(e=>e.field==='recordId'); }],
    ["wrong recordType", () => { const m=clone(manifest); m.records[0].recordType='multi_turn'; return validateManifestData(m,families,tags,corpus).errors.some(e=>e.field==='recordType'); }],
    ["wrong sourceSchemaVersion", () => { const m=clone(manifest); m.records[0].sourceSchemaVersion='9.9.9'; return validateManifestData(m,families,tags,corpus).errors.some(e=>e.field==='sourceSchemaVersion'); }],
    ["invalid exposureRole", () => { const m=clone(manifest); m.records[0].exposureRole='REGRESSION'; return validateManifestData(m,families,tags,corpus).errors.some(e=>e.field==='exposureRole'); }],
    ["invalid contaminationTier", () => { const m=clone(manifest); m.records[0].contaminationTier='EXTREME'; return validateManifestData(m,families,tags,corpus).errors.some(e=>e.field==='contaminationTier'); }],
    ["unknown evaluation tag", () => { const m=clone(manifest); m.records[0].evaluationTags.push('not_governed'); return validateManifestData(m,families,tags,corpus).errors.some(e=>e.field.includes('evaluationTags')); }],
    ["protected sibling does not exist", () => { const m=clone(manifest); m.records[0].protectedSiblingIds.push('unknown-record'); return validateManifestData(m,families,tags,corpus).errors.some(e=>e.field.includes('protectedSiblingIds')); }],
    ["protected sibling references itself", () => { const m=clone(manifest); m.records[0].protectedSiblingIds.push(m.records[0].recordId); return validateManifestData(m,families,tags,corpus).errors.some(e=>e.expected==='must not reference itself'); }],
    ["duplicate protected sibling", () => { const m=clone(manifest); const sibling=m.records[0].protectedSiblingIds[0]; m.records[0].protectedSiblingIds.push(sibling); return validateManifestData(m,families,tags,corpus).errors.some(e=>e.expected==='no duplicate sibling IDs'); }],
    ["protected family contains nonexistent ID", () => { const f=clone(families); f.families[0].memberRecordIds.push('unknown-record'); return validateManifestData(manifest,f,tags,corpus).errors.some(e=>e.expected==='existing corpus record ID'); }],
    ["incorrect expected manifest total", () => { const m=clone(manifest); m.records.pop(); return validateManifestData(m,families,tags,corpus).errors.some(e=>e.field==='records.length'); }],
  ];
  let failed = false;
  cases.forEach(([name, check]) => {
    if (check()) console.log(`SELF-TEST PASSED: ${name}`);
    else { failed = true; console.error(`SELF-TEST FAILED: ${name}`); }
  });
  return failed ? 1 : 0;
}

function printSummary(summary) {
  console.log("Manifest validation passed.");
  console.log(`Records:\n  total: ${summary.records}\n  single_turn: ${summary.single_turn}\n  multi_turn: ${summary.multi_turn}`);
  console.log(`Exposure:\n  TRAINING: ${summary.exposure.TRAINING}\n  DEVELOPMENT: ${summary.exposure.DEVELOPMENT}\n  HELD_OUT: ${summary.exposure.HELD_OUT}`);
  console.log(`Channel:\n  messaging: ${summary.channels.messaging || 0}`);
  console.log("Levels/categories: calculated from authoritative corpus annotations.");
  console.log(JSON.stringify({ levels: summary.levels, categories: summary.categories }, null, 2));
}

function main() {
  if (process.argv[2] === "--self-test") return runSelfTest();
  try {
    const manifest = readJson(path.join(MANIFEST_DIR, "exposure-manifest.json"));
    const families = readJson(path.join(MANIFEST_DIR, "protected-families.json"));
    const tags = readJson(path.join(MANIFEST_DIR, "evaluation-tags.json"));
    const result = validateManifestData(manifest, families, tags, loadCorpus());
    if (result.errors.length) {
      result.errors.forEach((error) => console.error(`[record: ${error.recordId}] ${error.field}: expected ${JSON.stringify(error.expected)}, actual ${JSON.stringify(error.actual)}`));
      return 1;
    }
    printSummary(result.summary);
    return 0;
  } catch (error) {
    console.error(`Manifest validation failed: ${error.message}`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = { loadCorpus, validateManifestData, runSelfTest };
