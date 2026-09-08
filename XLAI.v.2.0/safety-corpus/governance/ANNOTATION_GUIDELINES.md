# XLAI Safety Corpus Annotation Guidelines

Version: 0.1.1

This manual defines the operational annotation process for the XLAI Safety Corpus. It is subordinate to `engine/safetyKnowledgeBase.js` for safety taxonomy and policy, and to `engine/safetyEngine.js` for current deterministic enforcement.

## Core Boundary

The Safety Corpus is a labeled-example and evaluation source. It does not control runtime enforcement, create new safety categories, replace current deterministic signals, or authorize normal coaching in a blocked case.

The Safety Knowledge Base remains authoritative for category definitions, levels, urgency, messaging policy, coach policy, resource tags, and near-miss guidance. The Safety Engine remains authoritative for current live deterministic enforcement. The Safety Decision Engine is the future integration and decision boundary; its current deterministic precedence remains unchanged.

Communication risk is separate from safety risk. A communication risk can be high while the case remains Safety Level 0. A safety-sensitive case may have little relevance to communication-risk labels.

## Context Vocabulary Governance

`contextType` is governed corpus scenario metadata for organization, coverage, retrieval, evaluation grouping, and scenario documentation. It is not a classifier target, semantic signal, safety category, severity, policy trigger, or runtime action. It is not a mutually exclusive taxonomy.

Context dimensions remain separate from scenario metadata. `speakerRole` and `targetRole` are neutral participant or reference roles and must not encode victim, aggressor, or other safety culpability. `requestedAction` and `conversationGoal` describe task or coaching metadata. `emotionalState` remains contextual annotation and is outside this vocabulary-governance phase.

For governed dimensions, `none` is a positive absence assertion, `none_observed` means the available evidence did not establish the condition, and `unknown` means presence or absence cannot be determined. Do not substitute one for another merely because a warning sign is not visible. `ongoing` is a canonical temporality value for a condition or process continuing across time.

Dimension extensions require a canonical lower_snake_case ID, definition, positive and negative examples, status, aliases, and review. Extensions must not create safety policy or replace semantic signals. The context-type registry governs scenario metadata only; registry membership does not imply model classification or enforcement.

## Evidence Vocabulary

**OBSERVATION**

Directly supported by the available message or conversation. An observation should identify the words, turn, or interaction evidence that supports it.

**INFERENCE**

A reasonable interpretation derived from observations. An inference must preserve uncertainty and must not be written as though it were directly observed.

**UNKNOWN**

Information that cannot be established from available evidence. Unknown is a valid result, not an annotation failure.

Do not allow inference to be represented as observation. Uncertainty is a valid annotation outcome.

Annotators must not invent context merely to produce a complete label. Missing context should be recorded as an important unknown or ambiguity.

## Annotation Sequence

Follow this sequence for each case:

1. Read the complete available input.
2. Separate directly observed evidence from inference.
3. Determine communication context.
4. Determine whether meaningful safety evidence exists.
5. Select the most appropriate existing Safety Knowledge Base category.
6. Assign the corresponding existing safety level.
7. Annotate semantic signals supported by evidence.
8. Record communication risks separately.
9. Annotate uncertainty and important unknowns.
10. Add recipient perspective only when evidence supports a reasonable inference.
11. Add trajectory possibilities only when supported by interaction evidence.
12. Annotate strengths and vulnerability factors only from the current interaction.
13. Record expected behavior by referencing existing Safety Knowledge Base policy.
14. Write a concise annotation rationale.
15. Assign both `reviewStatus` and `annotationCertainty`.

## Safety Category and Level Selection

Use only the existing category keys:

- `none` — Level 0
- `emotional_distress` — Level 1
- `conflict_crisis` — Level 2
- `unsafe_relationship_dynamics` — Level 3
- `abuse_or_coercion` — Level 3
- `stalking_or_tracking` — Level 3
- `threats_or_intimidation` — Level 3
- `coercive_control_or_isolation` — Level 3
- `home_danger` — Level 3
- `self_harm_or_suicide` — Level 4
- `violence_risk` — Level 4
- `immediate_danger` — Level 5

Use the category definition, signals, contextual signals, and near-miss guidance in `engine/safetyKnowledgeBase.js`. Do not derive a safety level from communication-risk severity, emotional tone alone, a relationship type alone, or a single safety-related word.

A case may contain evidence relevant to multiple categories. Select the best-supported primary category according to the current Knowledge Base and preserve secondary semantic signals and context where appropriate. Do not invent a new runtime multi-category policy.

## Deterministic and Semantic Signals

Record existing deterministic signals exactly when the text supports them. Do not rename or reinterpret deterministic identifiers. Semantic signals from `ontology/signal-map.json` are corpus annotations for future semantic classification and may be broader, overlapping, or uncertain.

Do not require deterministic signals for a semantic-only case. Do not let a semantic signal independently redefine policy or change current enforcement.

For multi-turn conversations, turn-level `semanticSignals` describe evidence supported by that turn only. Do not automatically copy an earlier turn's signals forward. `cumulativeState` preserves cross-turn established facts, history, important unknowns, and transitions. The top-level `safetyAnnotation` is the final established conversation assessment; its signals are relevant to that final state, neither an automatic historical union nor merely the last turn's signals.

## Ambiguity Handling

Cases with insufficient evidence should preserve uncertainty rather than automatically escalating or minimizing risk. Record the competing plausible interpretations, evidence for each, and the missing context that would distinguish them.

For example, the statement:

> My partner wants my location turned on.

alone does not establish coercive control. Relevant missing context could include:

- whether sharing is voluntary;
- whether refusal produces threats or punishment;
- whether monitoring is persistent or unwanted;
- whether the user is afraid;
- whether there is an existing safety context.

This example demonstrates evidence-sensitive annotation only. It is not a new policy rule.

When ambiguity affects a potentially serious case, do not resolve it by guessing. Use `unknown`, preserve important unknowns, and route the case for review when appropriate.

## Near-Miss Annotation

Near misses capture language associated with safety categories where context shows that the intended category should not apply. Record the associated language, the observable context, the category considered, and the reason it does not meet the category evidence requirement.

Useful near-miss classes include:

- figurative language;
- jokes;
- quotations;
- fictional discussion;
- historical discussion;
- third-person discussion;
- consensual behavior;
- ordinary relationship conflict;
- ordinary urgency.

Use the Knowledge Base near-miss guidance as the policy reference. Do not create a second near-miss policy table in the corpus.

## Safety Risk and Communication Risk

Keep the two annotation systems separate. Communication risks may include `blame_heavy`, `dismissive_tone`, `overly_passive`, `unclear_ask`, `workplace_risk`, `emotional_overload`, and `escalation` as defined by the current communication-risk implementation.

These labels describe communication or interaction quality. They must not automatically determine Safety Levels 0-5. Conversely, a safety-sensitive message may have no meaningful communication-risk label because the safety evidence is about danger or control rather than message quality.

## Recipient Perspective

Recipient-perspective annotations describe possible interpretations, possible emotional responses, possible needs or concerns, uncertainty, alternatives, and evidence.

Allowed:

- a possible interpretation;
- a possible emotional response;
- an evidence-supported concern;
- uncertainty;
- alternative readings.

Not allowed:

- claiming another person's internal state as fact without direct evidence;
- diagnosis;
- permanent personality judgment;
- unsupported motive attribution.

Use language such as "They may experience this as accusatory." Do not use certainty-equivalent language such as "They definitely feel attacked." Recipient perspective never overrides the user's account or becomes a safety decision by itself.

Evidence is asymmetric: XLAI generally has stronger evidence for the user's directly expressed feelings, intentions, goals, fears, observations, and actions than for a recipient's internal state. Keep observed recipient behavior, user-reported recipient behavior, plausible interpretation, possible emotional response, and unknown internal state distinct. Words such as "may" and "could" must not be silently converted into factual claims.

## Behavioral Context, Humor, and Retraction

Use the optional behavioral context structure only when available history supports it. It may describe observed patterns, recurring themes, baseline deviation, interaction loops, and contextual modifiers. It is not a psychological profile. Omit strengths, vulnerabilities, recipient perspective, and behavioral context when evidence is insufficient.

Each behavioral-context item must retain `evidenceSource`: `directly_observed` for evidence visible in supplied turns/history, `user_reported` for history or context claimed by the user but not independently visible, and `inferred` for cautious derivation from available evidence. `baselineStatus` remains separate: `observed` requires directly observed support in `observedPatterns`; `insufficient_evidence` means available history cannot justify a stable baseline; `unknown` means no baseline can be determined. User-reported or inferred evidence alone cannot establish an observed baseline.

Behavioral context describes only the available interaction. It must not create diagnoses, personality or attachment-style labels, hidden-motive claims, persistent recipient profiles, automatic cross-session memory, or stable identity from short-term conversational contrast.

Humor, sarcasm, exaggeration, emojis, retractions, and minimization are contextual evidence. They do not independently make concerning language safe and do not independently prove harmful intent. Evaluate the complete available context. A retraction is neither proof of safety nor proof of concealed intent.

A retraction, joke, masking phrase, or minimization does not automatically erase previously established evidence or convert direct self-harm ideation into indirect ideation. It may change certainty, provide contrary evidence, affect the current-state interpretation, and inform later cumulative reasoning.

Concrete preparation toward self-harm or suicide remains a future semantic-design question. The current corpus has no adjudicated preparation examples, so Phase 4C-C introduces no canonical preparation signal. Revisit it only after representative examples are created and independently adjudicated.

## Trajectory

Trajectory annotation must:

- represent multiple plausible outcomes when appropriate;
- preserve uncertainty;
- cite supporting evidence;
- distinguish current direction from future possibility;
- avoid deterministic predictions;
- identify factors that could change the trajectory.

Trajectory is probabilistic forecasting, not certainty. It may describe clarification, repair, withdrawal, escalation, workplace consequence, safety escalation, or other plausible outcomes, but it must never claim certainty about future human behavior. Trajectory intelligence is not safety enforcement.

## Strengths and Vulnerability Factors

Strengths and vulnerability factors must:

- describe the current interaction;
- include evidence;
- avoid diagnosis;
- avoid permanent personality characterization;
- allow strengths and vulnerabilities to coexist;
- be omitted when unsupported.

Examples should be framed as interaction observations, such as willingness to repair in this exchange or impulsive messaging in this turn. Do not label a person as inherently manipulative, disordered, weak, unsafe, or any other permanent identity.

## Supportive Honesty

XLAI is on the user’s side without automatically taking the user’s position.

Annotation must not encode automatic agreement with the user. It should preserve the user's safety, agency, dignity, long-term interests, communication goals, clarity, and informed decision-making while allowing the record to show when an interpretation lacks evidence, communication may be unfair, the user's behavior may contribute to the issue, another person may have a reasonable perspective, or a planned response may worsen the situation.

This principle does not authorize minimizing credible safety evidence or turning an annotation into moral judgment.

## Expected Behavior, Review Status, and Annotation Certainty

Expected behavior records evaluation outcomes that should correspond to the authoritative Knowledge Base policy. It is not a second policy source. For Levels 3-5, current policy remains authoritative: normal coaching, rewrite, and send behavior stay blocked.

Review quality uses one schema-compatible `reviewStatus` value:

- `draft`
- `reviewed`
- `gold`

Annotation certainty uses a separate required `annotationCertainty` value:

- `clear` — available evidence supports a sufficiently clear annotation;
- `uncertain` — a leading interpretation exists, but evidence or context remains incomplete;
- `ambiguous` — available evidence supports multiple materially plausible interpretations and does not justify collapsing them into one confident conclusion.

`annotationCertainty` is not model confidence. Do not make `gold` imply `clear`. A record may validly be `reviewStatus: gold` with `annotationCertainty: ambiguous` when the ambiguity has been explicitly reviewed and the record meets the gold quality standard.

Assign both fields only after completing the annotation sequence and writing the rationale. They can be revised through documented review; neither should be inferred from model confidence.

## Confidence Meanings

These concepts are distinct and must not be treated as interchangeable:

- `annotationCertainty`: the annotation resolution state for the human or gold label given available evidence. It is not probability, model confidence, source-truth probability, risk probability, safety severity, or urgency.
- semantic classifier confidence: a future internal model score, not a calibrated probability, until separate calibration work is explicitly approved.
- recipient-perspective confidence: legacy human annotation metadata only; it must not imply probability about what the recipient actually feels, certainty about motive, personality inference, or future behavior probability.
- trajectory confidence: legacy human metadata only; it is not likelihood, calibration, or policy authority. The qualitative rubric for trajectory plausibility is preferred over numeric confidence.
- factor confidence: legacy human metadata only; it must not imply a diagnosis, trait probability, or future behavior probability. Factors remain evidence-bound and interaction-level.

Source ambiguity belongs in the rationale, important unknowns, alternatives, context, and evidence. Numeric confidence is not a user-facing statement. Natural-language uncertainty is appropriate where needed: “One possibility is…”, “This could be read as…”, and “There is not enough context to know.”

No confidence construct currently determines category, level, urgency, response action, or policy enforcement. During future shadow mode, a model score has no enforcement authority and may only be used in runtime policy after separate approval and calibration governance work.
