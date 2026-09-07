# XLAI Safety Corpus Changelog

This changelog records versioned changes to the Safety Corpus foundation. It does not record runtime enforcement changes.

## v0.1.5 - Context Vocabulary Governance

- Clarified neutral participant/reference semantics for speakerRole and targetRole.
- Added ongoing to the canonical closed temporality vocabulary.
- Documented none, none_observed, and unknown as distinct evidence states.
- Added a separate corpus scenario metadata registry for current contextType values.
- Added development-only ontology and scenario-registry validation without changing schema shape, safety policy, or runtime behavior.
- Kept requestedAction, conversationGoal, and emotionalState outside the Phase 4C-B controlled vocabulary contract.

## v0.1.4 - Behavioral Evidence Provenance

- Added per-item evidenceSource to multi-turn behavioral-context evidence: directly_observed, user_reported, or inferred.
- Preserved baselineStatus as a separate evidence-state summary; observed baselines require directly observed support.
- Made provenance optional for general multi-turn observations without requiring corpus-wide observation migration.
- Migrated the three behavioral-context records and all multi-turn schema-version references.
- Added development-only structural validation and provenance self-tests.
- No safety category, level, policy, runtime, dependency, or classifier implementation changed.

## v0.1.3 - Pilot A Behavioral Context Revision

- Added optional evidence-bound `behavioralContext` to both schemas for baseline status, observed patterns, recurring themes, baseline deviations, interaction loops, and contextual modifiers.
- Declared conversation-level `safetyAnnotation` and `expectedBehavior` because Pilot A uses both fields.
- Documented behavioral baselines, baseline deviation, recurring-theme reasoning, interaction loops, and evidence requirements for strengths and vulnerabilities.
- Documented user-versus-recipient evidence asymmetry and prohibited recipient mind-reading, diagnoses, permanent personality labels, and hidden-motive claims.
- Established that humor, sarcasm, exaggeration, emojis, retractions, and minimization neither dismiss safety signals nor prove concealed intent.
- Revised Pilot A vocabulary, deterministic expectations, annotation certainty, recipient perspective, trajectories, and multi-turn transitions against current engine behavior.
- Extended the development-only validator with multi-turn continuity and category/level transition checks plus self-tests.
- No safety policy, runtime enforcement, retention behavior, dependency, or production integration changed.

## v0.1.2 — Foundation Readiness Validation

- Added per-turn annotation certainty to the conversation schema.
- Corrected stale specification status statements.
- Aligned provenance and annotation-guideline metadata terminology.
- Added a development-only corpus validator for semantic consistency against the Safety Knowledge Base.
- No corpus records exist yet.
- No safety policy changed.
- No runtime enforcement changed.

## v0.1.1 — Annotation Review/Certainty Separation

- Separated review quality (`draft`, `reviewed`, `gold`) from annotation certainty (`clear`, `uncertain`, `ambiguous`).
- No corpus records required migration because corpus generation had not begun.
- No safety policy changed.
- No runtime behavior changed.

## v0.1 — Safety Corpus Foundation

Completed:

- corpus specification;
- corpus schemas;
- annotation ontology;
- quality and governance foundation.

Scope and status:

- No production corpus dataset exists yet.
- No semantic classifier exists yet.
- Deterministic enforcement remains authoritative.
- No runtime safety behavior changed.
- No routes, model calls, response contracts, package dependencies, or existing engine files were modified by the corpus foundation.
- The Safety Knowledge Base remains authoritative for safety policy.
- Communication risk remains separate from safety risk.
- Future semantic classification is initially limited to internal shadow-mode comparison.

This entry documents the foundation only. It does not claim that synthetic, evaluation, or real-world corpus records have been created.
