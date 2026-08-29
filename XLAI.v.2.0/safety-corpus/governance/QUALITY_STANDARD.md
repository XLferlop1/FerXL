# XLAI Safety Corpus Quality Standard

Version: 0.1.1

This standard defines measurable quality expectations for future Safety Corpus records. It governs corpus data and evaluation quality only. It does not alter the Safety Knowledge Base, deterministic Safety Engine, runtime routes, response contracts, or enforcement.

## Quality Boundaries

The Safety Knowledge Base is the authoritative policy source. The Safety Corpus is the labeled-example and evaluation source. The Safety Engine is the current deterministic enforcement source. A future semantic classifier is initially shadow-mode only, and the Safety Decision Engine remains the future integration and decision boundary.

Communication risk is not safety risk. Trajectory intelligence is not safety enforcement. Recipient perspective is not factual mind-reading. Vulnerability factors are not diagnosis. Strengths and vulnerabilities describe interaction evidence, not permanent identity. Uncertainty is preferable to fabricated certainty. Gold labels come from review standards, not model confidence.

## Review Quality and Annotation Certainty

The current schemas separate two independent concepts. `reviewStatus` records review quality. `annotationCertainty` records the evidence state. Neither field is model confidence.

### Review quality: `reviewStatus`

### `draft`

Created but not independently reviewed. Draft records may contain unresolved quality issues and must not be used as gold evaluation data.

### `reviewed`

Checked for schema validity, evidence alignment, taxonomy compatibility, annotation quality, and policy consistency by an independent reviewer.

### `gold`

Meets the highest corpus standard after independent review. The rationale is evidence-grounded, the category and level are compatible with the Knowledge Base, uncertainty is handled explicitly, and no critical defect remains.

The allowed values are `draft`, `reviewed`, and `gold`. `ambiguous` is not a review status.

### Annotation certainty: `annotationCertainty`

The allowed values are:

- `clear`: available evidence supports a sufficiently clear annotation;
- `uncertain`: a leading interpretation exists, but evidence or context remains incomplete;
- `ambiguous`: available evidence supports multiple materially plausible interpretations and does not justify collapsing them into one confident conclusion.

Gold and ambiguity are compatible. A record may validly be `reviewStatus: gold` and `annotationCertainty: ambiguous` when the ambiguity was explicitly reviewed and the record meets the gold quality standard. Gold does not imply clear, and annotation certainty must never be treated as model confidence.

### Behavioral-context quality

Behavioral baselines must be derived only from available conversation history and must use observable, time-bounded patterns. `insufficient_evidence` or `unknown` is preferred when history is too small. Recurring themes and interaction loops require evidence and must not become diagnoses, permanent labels, hidden motives, or unsupported causal claims. Humor and retraction are contextual modifiers rather than automatic safety dismissals or concealed-intent proofs.

Each behavioral-context item must declare `evidenceSource`: `directly_observed`, `user_reported`, or `inferred`. An `observed` baseline requires directly observed evidence in `observedPatterns`; user-reported or inferred evidence alone requires `insufficient_evidence` or `unknown`.

The current schemas require `annotationCertainty` and use this separation. Future schema changes may add further adjudication detail, but this standard does not create a new policy source.

## Minimum Quality Dimensions

Every record intended for review should be assessed for:

- schema validity;
- taxonomy correctness;
- evidence grounding;
- context fidelity;
- safety and communication separation;
- uncertainty calibration;
- inference discipline;
- policy consistency;
- annotation completeness;
- language realism;
- diversity;
- privacy compliance.

A record does not become high quality by being complete if its context was invented. A sparse, explicitly uncertain record can be higher quality than a detailed record unsupported by evidence.

## Recommended Review Rubric

Reviewers should assess each dimension using a documented qualitative judgment, with optional local scoring for analysis. No production threshold is established at this stage.

1. **Safety label correctness:** Does the primary category and level match the existing Knowledge Base?
2. **Evidence support:** Can each meaningful label or inference be traced to message or conversation evidence?
3. **Context interpretation:** Are relationship, temporality, literalness, immediacy, and other dimensions supported rather than assumed?
4. **False-positive resistance:** Does the annotation avoid escalating near misses, figurative language, ordinary urgency, or communication problems into safety risk?
5. **False-negative resistance:** Does the annotation recognize clear safety evidence, especially at Levels 3-5?
6. **Uncertainty handling:** Are unknowns, alternatives, and ambiguity preserved where evidence is incomplete?
7. **Recipient-inference discipline:** Are possible recipient interpretations clearly distinguished from factual internal states?
8. **Trajectory-inference discipline:** Are future directions probabilistic, evidence-supported, and non-deterministic?
9. **Policy consistency:** Do expected behavior fields correspond to authoritative Knowledge Base policy without creating a second policy?
10. **Overall annotation quality:** Is the record clear, concise, realistic, privacy-compliant, and useful for corpus development or evaluation?

Review notes should identify the evidence behind the judgment and any required correction. Scores must not be treated as a runtime decision threshold.

## Critical Defects

The following are critical defects requiring correction, rejection, or adjudication:

- nonexistent safety category;
- incorrect category/level mapping;
- unsupported escalation to Level 3 or higher;
- dangerous under-classification when clear evidence is present;
- fabricated context;
- diagnosis presented as fact;
- recipient feelings asserted without evidence;
- deterministic future prediction presented as fact;
- communication risk incorrectly used as a safety level;
- expected policy outcome contradicting the Safety Knowledge Base;
- personal data included contrary to provenance or privacy rules;
- renamed or invented deterministic signal identifiers;
- semantic signal treated as an independent enforcement rule.

A critical defect should block `gold` status until resolved or explicitly documented as an unresolved ambiguity.

## Disagreement Handling

For annotation disagreements:

1. preserve both proposed interpretations;
2. identify the exact evidence causing disagreement;
3. compare each interpretation against Safety Knowledge Base definitions and near misses;
4. identify missing context;
5. resolve when the evidence supports resolution;
6. otherwise retain ambiguity;
7. document the adjudication and rationale.

Do not resolve disagreement by majority vote alone. Agreement is useful evidence about consistency, but the governing question is whether the proposed label is supported by the available evidence and current policy.

## Corpus Balance Expectations

Future corpus QA should measure distribution across:

- Levels 0-5;
- all existing categories;
- explicit versus indirect wording;
- positive versus negative and near-miss cases;
- single-turn versus multi-turn cases;
- literal versus figurative language;
- clear versus ambiguous cases;
- different relationship contexts;
- different communication styles;
- different message lengths;
- linguistic variation;
- trajectory directions.

Balance work must avoid demographic stereotyping. Distribution targets must not encode assumptions that any demographic, relationship type, communication style, or emotional expression predicts danger. Coverage should expose model and annotation weaknesses, not manufacture identity-based associations.

## False-Positive and False-Negative Priority

Both error types matter.

For Levels 3-5, false negatives can carry severe safety consequences and require urgent review. False positives also matter because unnecessary crisis handling can damage trust, interrupt ordinary communication, and make XLAI feel alarmist.

The project does not establish numeric tradeoff thresholds yet. Future calibration must report both error classes by category, level, context, near-miss class, and ambiguity state before any controlled enforcement decision.

## Release and Use Rules

Draft and ambiguous records should not silently enter gold evaluation sets. Gold records require documented independent review. Evaluation records must remain separated from development records according to provenance and contamination controls. Any correction to a gold record requires a versioned change rationale.
