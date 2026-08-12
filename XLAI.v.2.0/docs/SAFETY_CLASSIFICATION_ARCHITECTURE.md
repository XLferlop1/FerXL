# Safety Classification Architecture

## 1. Architecture overview

This document defines the next safety architecture phase for XLAI by introducing four new modules that sit between route input parsing and downstream coaching logic:

- contextRouter.js
- semanticSafetyClassifier.js
- safetyKnowledgeBase.js
- safetyDecisionEngine.js

Target outcome:

- Keep the current deterministic Safety Engine as the first gate.
- Add a semantic safety layer that captures intent and context not covered by exact pattern matches.
- Standardize route-level safety decisions through a single decision policy.
- Preserve current user-facing blocking behavior for high-risk situations while improving classification precision.

Proposed high-level flow:

1. Route receives request payload.
2. contextRouter.js classifies request context (messaging, coach, analysis, journal).
3. Deterministic Safety Engine runs first (existing behavior).
4. semanticSafetyClassifier.js runs for unresolved or borderline risk signals.
5. safetyDecisionEngine.js merges deterministic + semantic evidence.
6. Route returns either:
   - safety-blocked deterministic response shape for stop cases, or
   - normal route behavior for allow cases.

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

- Perform semantic risk interpretation after deterministic checks.

Responsibilities:

- Classify safety categories using semantic features and phrase variants.
- Return category confidences and urgency estimate.
- Attach rationale snippets safe for logs and debugging.
- Avoid replacing deterministic hard-stop matches.

Inputs:

- context object
- deterministic result
- taxonomy from safetyKnowledgeBase.js

Outputs:

- semantic result with:
  - categories
  - confidenceByCategory
  - urgency
  - semanticSignals
  - rationale

### safetyKnowledgeBase.js

Purpose:

- Central source of truth for taxonomy, thresholds, and response policy metadata.

Responsibilities:

- Define canonical safety categories and aliases.
- Store level mapping rules and urgency mapping.
- Store route-specific policy overrides (if any).
- Version policy artifacts for safe rollout.

Inputs:

- None at runtime beyond module load or periodic refresh.

Outputs:

- taxonomy definitions
- confidence thresholds
- urgency thresholds
- policy defaults

Phase 2 implementation status:

- Implemented as `engine/safetyKnowledgeBase.js`
- Current implementation centralizes category taxonomy, level mapping, urgency defaults, messaging policy, coach policy, near-miss guidance, and module validation
- Not wired into route enforcement yet
- Does not change current Safety Engine behavior

### safetyDecisionEngine.js

Purpose:

- Produce final safety outcome for each request.

Responsibilities:

- Merge deterministic and semantic outputs.
- Apply precedence rules (deterministic hard-stop always wins).
- Resolve final level, shouldStopNormalCoaching, and response policy.
- Emit standardized decision object consumed by routes.

Inputs:

- context object
- deterministic safety result
- semantic safety result
- policy config from safetyKnowledgeBase.js

Outputs:

- final decision with:
  - level
  - label
  - category
  - confidence
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

## 4. Route integration plan

### POST /api/send

Plan:

- Build context via contextRouter.js using outgoing message text.
- Run deterministic Safety Engine first.
- Run semantic classifier when deterministic does not already hard-stop.
- Use safetyDecisionEngine.js to resolve final outcome.
- If stop outcome, return existing blocked response contract and bypass persistence.
- If allow outcome, continue existing send flow unchanged.

### POST /api/rephrase

Plan:

- Route text through contextRouter.js with contextType messaging_rephrase.
- Run deterministic then semantic then decision merge.
- Stop outcomes return existing blocked contract with suggestedRewrite null.
- Allow outcomes continue existing rephrase flow.

### POST /api/analyze-intensity

Plan:

- Route text through contextRouter.js with contextType coaching_analysis.
- Execute deterministic and semantic classification.
- Decision engine returns stop or allow.
- Stop outcome uses deterministic blocked shape to maintain compatibility.
- Allow outcome continues intensity and communication analysis pipeline.

### POST /api/coach-interactions (if applicable)

Plan:

- Do not change current persistence semantics by default.
- Apply classification only if this endpoint begins accepting free-text coaching prompts in future.
- If free text is added later, use contextType coach_interaction and apply same decision pipeline.

### Journal routes (if applicable)

Plan:

- Journal text may contain high-risk disclosures.
- For create entry endpoints, classify text with contextType journal_entry.
- Initial policy recommendation:
  - Do not block journal write by default.
  - Attach non-invasive safety metadata for optional UI guidance.
  - Escalate only if explicit emergency patterns indicate immediate risk and product policy requires intervention.

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
- Quantify confidence and urgency for policy decisions.

Operating rules:

- Semantic layer is advisory when deterministic already hard-stops.
- Semantic layer is decision-informing when deterministic level is 0 to 2.
- Semantic output is normalized to existing taxonomy for compatibility.

Semantic result quality constraints:

- Confidence values are bounded to 0.0 to 1.0.
- Rationale text must avoid diagnosis and sensitive raw quote leakage in logs.
- Category outputs must be deterministic taxonomy keys.

## 7. Messaging System behavior

Scope:

- POST /api/send
- POST /api/rephrase

Behavior policy:

- Hard-stop cases return current blocked payload contract and do not persist blocked send content.
- Allow cases proceed with existing communication coaching and generation behavior.
- Borderline cases may trigger softer caution metadata internally without changing API shape in initial rollout.

User experience intent:

- Keep current blocking consistency.
- Improve false-negative detection without introducing abrupt API changes.

## 8. Coach Chat behavior

Scope:

- POST /api/analyze-intensity and coach-style interactions.

Behavior policy:

- Hard-stop categories continue to block normal coaching responses.
- Non-stop categories continue normal coaching and communication intelligence.
- Future extension: route-specific policy can allow contextual safety guidance without full block when urgency is medium and confidence is low.

Voice constraints remain unchanged:

- No diagnostic language.
- No therapeutic framing.
- Clear practical guidance and safety signposting when needed.

## 9. Expected JSON contracts

Decision object contract (internal standard):

```json
{
  "safety": {
    "level": 0,
    "label": "normal",
    "category": "none",
    "confidence": 0.0,
    "urgency": "none",
    "shouldStopNormalCoaching": false,
    "reason": "No high-risk safety signals detected.",
    "matchedSignals": [],
    "decisionTrace": {
      "contextType": "messaging_send",
      "deterministicLevel": 0,
      "semanticTopCategory": "none",
      "semanticTopConfidence": 0.0,
      "policyVersion": "vNext-1"
    }
  },
  "coachingBlocked": false
}
```

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

Category normalization rules:

- Multiple category hits are allowed.
- Decision engine selects primary category by severity, then confidence.
- Primary category maps to final level and label.

Level alignment:

- Level 0: none
- Level 1: emotional_distress
- Level 2: conflict_crisis
- Level 3: unsafe_relationship_dynamics, abuse_or_coercion, stalking_or_tracking, threats_or_intimidation, coercive_control_or_isolation, home_danger
- Level 4: self_harm_or_suicide, violence_risk
- Level 5: immediate_danger

## 11. Confidence and urgency mapping

Confidence tiers:

- low: 0.00 to 0.39
- medium: 0.40 to 0.69
- high: 0.70 to 0.89
- very_high: 0.90 to 1.00

Urgency levels:

- none
- monitor
- elevated
- high
- immediate

Default mapping logic:

- Deterministic level 5 always maps to urgency immediate.
- Deterministic level 4 maps to urgency high unless semantic immediate_danger confidence is very_high.
- Deterministic level 3 maps to urgency elevated by default, upgraded to high when semantic confidence is high.
- Deterministic levels 0 to 2 may be upgraded one tier when semantic confidence is very_high for a high-risk category.

Safety policy guardrails:

- Urgency escalation cannot bypass deterministic hard-stop precedence.
- Low-confidence semantic outputs cannot independently force level 4 to 5 transitions.

## 12. Privacy and retention rules

Privacy constraints for this phase:

- Do not store raw user text in new safety metadata fields.
- Persist only normalized category keys, confidence, level, and minimal decision trace when needed.
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
  - threshold and policy logic
  - deterministic plus semantic merge rules
- Contract tests:
  - confirm blocked response compatibility
  - confirm additive optional fields do not break shape
- Integration tests:
  - route-level stop/allow behavior across send, rephrase, analyze-intensity
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
- Semantic layer improves detection coverage for known missed variants.

## 14. Migration plan from current Safety Engine

Phase 0: Documentation and policy freeze

- Finalize taxonomy, thresholds, and response policy.
- Align contract expectations with product and API docs.

Phase 1: Introduce modules behind flags

- Add contextRouter.js, semanticSafetyClassifier.js, safetyKnowledgeBase.js, safetyDecisionEngine.js.
- Keep semantic layer dry-run only at first (observe, do not enforce).

Phase 2: Shadow evaluation

- Compare deterministic-only vs deterministic-plus-semantic outcomes.
- Track disagreement rates and calibrate thresholds.

Phase 3: Controlled enforcement

- Enable semantic-informed decisions for selected routes with rollout gates.
- Keep blocked external payload contract unchanged.

Phase 4: General availability

- Enable across target routes.
- Publish final docs and operational playbook.

Rollback plan:

- Single feature flag to revert to deterministic-only decisions.
- Preserve existing route behavior with no schema rollback required.

## 15. Implementation checklist

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
