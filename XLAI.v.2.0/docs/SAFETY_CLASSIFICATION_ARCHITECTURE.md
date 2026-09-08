# Safety Classification Architecture

## 1. Architecture overview

This document describes the future safety architecture. The current initial mode is explicitly messaging-only, shadow-only, observational-only, and independent from deterministic inference. It does not introduce a runtime module, route integration, semantic input to `SafetyDecisionEngine`, or enforcement change.

- contextRouter.js
- semanticSafetyClassifier.js
- safetyKnowledgeBase.js
- safetyDecisionEngine.js

Target outcome:

- Keep the current deterministic Safety Engine as the first gate.
- Add a semantic safety layer that captures intent and context not covered by exact pattern matches.
- Standardize route-level safety decisions through a single decision policy only in a future, separately approved design.
- Preserve current user-facing blocking behavior for high-risk situations while improving classification precision in future controlled stages.

Proposed high-level flow:

1. Route receives request payload.
2. contextRouter.js classifies request context (messaging, coach, analysis, journal) only in future design work.
3. Deterministic Safety Engine runs first (existing behavior).
4. A future semantic classifier may run as an isolated shadow observer in messaging only.
5. A future comparison layer may compare deterministic and semantic observations only after separate approval.
6. Route returns either:
   - safety-blocked deterministic response shape for stop cases, or
   - normal route behavior for allow cases.

Current initial mode is not a semantic policy merge, not an enforcement path, and not a semantic classifier authority for routing, threshold setting, or coach/journal behavior.

## 2. Current safety baseline

Current baseline in production/beta runtime:

- Safety Engine is deterministic and rule based.
- Safety levels are 0 to 5.
- Levels 3 to 5 stop normal coaching behavior.
- Safety executes before normal generation in:
  - POST /api/send
  - POST /api/rephrase
  - POST /api/analyze-intensity
- Blocked responses are deterministic JSON and include coachingBlocked true.

Current strengths:

- Fast execution.
- Predictable output.
- Explainable matched signals.

Current limitations:

- Pattern matching can miss semantically equivalent risk language.
- Route behavior is consistent but safety reasoning depth differs by phrase coverage.
- No formal semantic confidence layer yet.

## 3. Module responsibilities

### contextRouter.js

Purpose:

- Normalize route-level context before classification.

Responsibilities:

- Identify route context:
  - messaging_send
  - messaging_rephrase
  - coaching_analysis
  - coach_interaction
  - journal_entry
- Extract user text candidates from payload safely.
- Build a Context Envelope for downstream modules.
- Provide default context when payload is partial.

Inputs:

- Route name
- Request body
- Optional metadata (conversation id, message intent hints)

Outputs:

- context object with:
  - contextType
  - text
  - channel
  - actor
  - requestedAction
  - route

### semanticSafetyClassifier.js

Purpose:

- Perform non-authoritative, turn-local semantic interpretation in initial shadow mode only.

Responsibilities:

- Interpret the current user-authored message with, at most, two directly preceding turns for bounded context.
- Return governed semantic signals, one existing category, aligned semantic level, resolution, evidence references, and version metadata.
- Remain independent of deterministic output during inference; comparison occurs after both results exist.
- Never select urgency, response policy, user-facing action, cumulative state, or enforcement.
- Remain outside any SafetyDecisionEngine merge or route authority in the initial phase.

Inputs:

- current message, source role, channel, turn identity, and optional bounded prior turns
- canonical taxonomy reference for output validation only

Outputs:

- `SemanticResult` contract `0.2.0` as defined by `safety-corpus/schema/semantic-result.schema.json`

This module does not grant semantic route authority, semantic threshold authority, or semantic enforcement authority.

### safetyKnowledgeBase.js

Purpose:

- Central source of truth for taxonomy, urgency defaults, and response policy metadata.

Responsibilities:

- Define canonical safety categories and aliases.
- Store level mapping rules and urgency mapping.
- Store route-specific policy overrides (if any).
- Version policy artifacts for safe rollout.

Inputs:

- None at runtime beyond module load or periodic refresh.

Outputs:

- taxonomy definitions
- urgency defaults
- policy defaults

Phase 2 implementation status:

- Implemented as `engine/safetyKnowledgeBase.js`
- Current implementation centralizes category taxonomy, level mapping, urgency defaults, messaging policy, coach policy, near-miss guidance, and module validation
- Does not replace or change current Safety Engine enforcement

### safetyDecisionEngine.js

Purpose:

- Produce final safety outcome for each request under the current deterministic-only runtime.

Responsibilities:

- Keep deterministic precedence as the active execution path.
- Maintain a decision policy boundary that excludes semantic output from live enforcement in initial shadow mode.
- Resolve final level, shouldStopNormalCoaching, and response policy only from deterministic runtime behavior.
- Emit standardized decision objects consumed by current routes without semantic authority.

Inputs:

- context object
- deterministic safety result
- policy config from safetyKnowledgeBase.js

Outputs:

- final deterministic decision with:
  - level
  - label
  - category
  - urgency
  - shouldStopNormalCoaching
  - reason
  - matchedSignals
  - decisionTrace

Phase 3 implementation status:

- Implemented as `engine/safetyDecisionEngine.js`
- Integrated internally after deterministic Safety Engine evaluation in:
  - POST /api/send
  - POST /api/rephrase
  - POST /api/analyze-intensity
- Non-enforcing in this phase: live route blocking still uses deterministic Safety Engine output directly
- Semantic input remains optional and currently passed as `null`
- External API response shapes remain unchanged

Future semantic merge, threshold selection, calibration, or policy enforcement is not active in initial shadow mode and requires separate approval.

## 4. Route integration plan

### Future shadow integration

If separately approved after privacy review, a shadow invocation may receive the current messaging text and bounded context in parallel with the existing deterministic path. It must be time-bounded, failure-isolated, and observational only. It must not delay, alter, or become an input to current route behavior, `SafetyDecisionEngine`, or enforcement. Route scope beyond messaging requires separate design and approval.

## 5. Deterministic safety layer behavior

Behavior remains first and authoritative for hard stops:

- Execute current Safety Engine exactly as implemented.
- Maintain existing levels 0 to 5.
- Keep current level 3 to 5 stop behavior and response shape.
- Preserve matchedSignals semantics for explainability.

Deterministic precedence rule:

- If deterministic level is 3 or above, final decision must stop regardless of semantic output.

## 6. Semantic safety layer behavior

Semantic layer goals:

- Detect risk phrasing not captured by explicit patterns.
- Improve recall on abuse, coercion, threats, stalking, and unsafe dynamics.
- Produce structured observations for human review and disagreement analysis.

Operating rules:

- Semantic inference is independent of deterministic output and is shadow-only in the first experiment.
- Semantic output does not enter `SafetyDecisionEngine` or route enforcement during initial shadow mode.
- Semantic output uses existing taxonomy keys for comparison compatibility only.

Semantic result quality constraints:

- Model resolution is distinct from human annotation certainty; numeric confidence is deferred as a decision input.
- Evidence references use bounded input offsets; no free-form chain-of-thought or raw quote retention is stored by default.
- Category outputs must be deterministic taxonomy keys.

## 7. Messaging Scope

The first contract is messaging-only. A future shadow invocation may operate alongside messaging processing only after separate privacy and operational approval. It must not alter the existing deterministic route behavior, response shape, persistence, or safety decisions. Coach, journal, and other product surfaces remain outside this contract.

## 8. Decision Contract Separation

`SafetyDecisionEngine` remains an internal decision-policy abstraction with deterministic precedence. The semantic result is not an input to that engine during initial shadow mode. Any future semantic-policy merge requires a separate contract, calibration evidence, high-severity review, privacy approval, and controlled-enforcement decision.

## 9. Expected JSON contracts

Decision object contract (internal standard, current behavior):

```json
{
  "safety": {
    "level": 0,
    "label": "normal",
    "category": "none",
    "urgency": "none",
    "shouldStopNormalCoaching": false,
    "reason": "No high-risk safety signals detected.",
    "matchedSignals": [],
    "decisionTrace": {
      "contextType": "messaging_send",
      "deterministicLevel": 0,
      "policyVersion": "<future-policy-version>"
    }
  },
  "coachingBlocked": false
}
```

This example is a FUTURE / NOT ACTIVE IN INITIAL SHADOW MODE placeholder only. It must not be mistaken for a current active contract field or current governed policy version. `semanticTopConfidence` is experimental and non-authoritative if retained in future examples; it is not a current active contract field.

Blocked response compatibility contract (external, unchanged in initial rollout):

```json
{
  "safety": {
    "level": 3,
    "label": "possible abuse or coercion",
    "shouldStopNormalCoaching": true,
    "reason": "Possible abuse, coercion, stalking, or unsafe relationship dynamics detected.",
    "matchedSignals": ["abuse_or_coercion"],
    "resources": ["..."]
  },
  "coachingBlocked": true,
  "message": "XLAI paused normal coaching because this may involve coercion, abuse, stalking, or unsafe relationship dynamics.",
  "suggestedRewrite": null
}
```

Contract stability requirements:

- Existing route response fields remain intact.
- New safety metadata fields must be additive and optional where exposed.
- No breaking changes for current clients.

## 10. Safety taxonomy and categories

Canonical categories:

- none
- emotional_distress
- conflict_crisis
- unsafe_relationship_dynamics
- abuse_or_coercion
- stalking_or_tracking
- threats_or_intimidation
- coercive_control_or_isolation
- home_danger
- self_harm_or_suicide
- violence_risk
- immediate_danger

Semantic observations may contain one primary category for comparison. Selecting an authoritative decision category or resolving multiple semantic candidates is outside the initial shadow contract.

Level alignment:

- Level 0: none
- Level 1: emotional_distress
- Level 2: conflict_crisis
- Level 3: unsafe_relationship_dynamics, abuse_or_coercion, stalking_or_tracking, threats_or_intimidation, coercive_control_or_isolation, home_danger
- Level 4: self_harm_or_suicide, violence_risk
- Level 5: immediate_danger

## 11. Confidence and urgency

The initial shadow contract does not use semantic numeric confidence, thresholds, or semantic urgency to select policy or action. The classifier may report `resolution` as `clear`, `uncertain`, `ambiguous`, or `insufficient_evidence`; this is a model interpretation state, not human annotation certainty or policy authority. Existing Knowledge Base urgency remains authoritative for deterministic decisions. Any future confidence or urgency use requires a separate calibrated policy contract and explicit approval. Future merge, threshold, calibration, and enforcement concepts are FUTURE / NOT ACTIVE IN INITIAL SHADOW MODE.

## 12. Privacy and retention rules

Privacy constraints for this phase:

- Do not store raw user text in new safety metadata fields.
- Persist only approved structured operational metadata, version references, hashes, and minimal comparison traces when needed.
- Avoid logging sensitive quoted text in classification logs.

Retention alignment:

- Follow existing centralized retention windows for messages, coach interactions, and journal entries.
- Safety metadata retention follows parent record retention.
- Decision trace retention should be minimal and policy-versioned.

Operational safeguards:

- Redact request text from warning/error logs where feasible.
- Keep resources and safety reasons deterministic and non-identifying.

## 13. Testing strategy

Test layers:

- Unit tests for each new module:
  - context extraction and route classification
  - semantic category mapping
  - bounded-context and evidence-reference validation
  - abstention and operational failure handling
- Contract tests:
  - confirm blocked response compatibility
  - confirm additive optional fields do not break shape
- Integration tests after separate approval:
  - isolated shadow invocation cannot alter deterministic route behavior
- Regression tests:
  - verify deterministic hard-stop behavior remains unchanged

Test dataset guidance:

- Include phrase variants per category.
- Include ambiguous borderline samples.
- Include safe false-positive guard samples.
- Include emergency and immediate danger samples.

Acceptance criteria:

- No breaking API contract changes.
- Deterministic level 3 to 5 behavior remains stable.
- Semantic observations are reviewable without changing deterministic behavior.

## 14. Migration plan from current Safety Engine

This plan is FUTURE / NOT ACTIVE IN INITIAL SHADOW MODE.

Phase 0: Documentation and policy freeze

- Finalize taxonomy, the semantic result contract, privacy constraints, and shadow comparison protocol.
- Align contract expectations with product and API docs.

Phase 1: Introduce modules behind flags

- Add an isolated classifier interface and shadow runner only after separate implementation approval.
- Keep semantic layer dry-run only (observe, do not enforce).

Phase 2: Shadow evaluation

- Compare independent deterministic and semantic observations.
- Track disagreements for human review; do not calibrate policy thresholds in the first experiment.
- Require the held-out gate before any formal HELD_OUT evaluation.

Phase 3: Controlled enforcement

- Consider semantic-informed decisions only after separate controlled-enforcement approval.
- Keep blocked external payload contract unchanged.

Phase 4: General availability

- Enable across target routes.
- Publish final docs and operational playbook.

Rollback plan:

- Single feature flag to revert to deterministic-only decisions.
- Preserve existing route behavior with no schema rollback required.

## 15. Implementation checklist

This checklist is FUTURE / NOT ACTIVE IN INITIAL SHADOW MODE unless separately approved.

- Define context envelope schema for all target routes.
- Implement contextRouter.js with route mappings.
- Implement safetyKnowledgeBase.js taxonomy and thresholds.
- Implement semanticSafetyClassifier.js with normalized outputs.
- Implement safetyDecisionEngine.js merge policy and precedence.
- Add feature flags for semantic dry-run and enforcement.
- Add structured telemetry for decision outcomes (non-sensitive).
- Add unit, integration, and contract coverage for new pipeline.
- Run shadow metrics and calibrate thresholds.
- Validate privacy redaction in logs and persisted metadata.
- Confirm no API breaking changes before rollout.
- Update docs and readiness checklist before enforcement.

Current completion markers:

- Phase 1 complete: `contextRouter.js`
- Phase 2 complete: `safetyKnowledgeBase.js`
- Phase 3 complete (internal-only, non-enforcing): `safetyDecisionEngine.js`
- Semantic classifier not started: `semanticSafetyClassifier.js`

No semantic classifier output currently enters route authority, threshold authority, or enforcement authority.

## 16. Risks and mitigations

Risk: semantic false positives increase unnecessary blocking.

- Mitigation: conservative thresholds, shadow mode calibration, deterministic precedence, staged rollout.

Risk: semantic false negatives miss high-risk phrasing.

- Mitigation: expand taxonomy examples, add adversarial test set, tune category thresholds.

Risk: route inconsistency in safety behavior.

- Mitigation: central decision engine, shared context envelope, contract tests per route.

Risk: privacy leakage via logs or traces.

- Mitigation: strict redaction policy, no raw text persistence for new fields, retention-aligned metadata lifecycle.

Risk: client contract drift.

- Mitigation: preserve external blocked payload contract, keep new fields additive, enforce response contract tests.

Risk: operational complexity during migration.

- Mitigation: feature-flag rollout, clear rollback switch, phased deployment with metrics.

---

Status of this document:

- Architecture design only.
- No runtime behavior changes are implemented by this document.
