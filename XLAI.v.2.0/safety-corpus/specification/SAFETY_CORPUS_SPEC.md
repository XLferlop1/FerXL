# XLAI Safety Corpus Specification

Status: behavioral-context foundation revision

This specification defines the future corpus and semantic-classification data boundary for XLAI. It does not implement a classifier, change a route, change a regular expression, or change live safety enforcement.

## 1. Purpose

The Safety Corpus will provide governed data for labeled safety examples, semantic classification examples, edge cases, near misses, multi-turn examples, gold evaluation data, classifier QA, disagreement analysis, calibration data, and future semantic classifier development.

The corpus is intended to improve coverage and evaluation of safety-sensitive language while preserving the existing product safety contract. It must help distinguish genuine safety concerns from ordinary distress, conflict, figurative language, and communication problems without weakening deterministic protections.

## 2. Existing Safety Architecture

The existing implementation is the source of truth for current behavior:

- `engine/safetyEngine.js` performs deterministic safety detection and live blocking behavior.
- `engine/safetyKnowledgeBase.js` owns the authoritative taxonomy and policy: safety categories, safety levels, urgency, category definitions, messaging policy, coach policy, resource tags, near-miss guidance, and validation.
- `engine/safetyDecisionEngine.js` constructs and validates internal decisions using known Knowledge Base category keys. Deterministic output remains authoritative.
- `engine/safetyDecisionRuntime.js` failure-isolates internal decision construction and validation from route execution.
- `engine/contextRouter.js` supplies route, channel, context, and text-source context to safety-related processing.
- `engine/riskEngine.js` reports communication risks such as blame-heavy language, dismissive tone, overly passive wording, unclear asks, workplace risk, emotional overload, and escalation.
- `engine/responseContracts.js` protects existing external response shapes, including blocked safety responses.
- `docs/SAFETY.md` defines the product safety rule, stop behavior, voice constraints, and current implementation status.

The corpus supplements this architecture as data and evaluation documentation. It does not duplicate or replace the Safety Knowledge Base.

## 3. Authoritative Safety Levels

The corpus preserves these existing levels and meanings:

- **Level 0 — normal coaching:** no material safety concern is indicated.
- **Level 1 — emotional distress:** acute emotional strain without a clear immediate-harm signal.
- **Level 2 — high-conflict relationship crisis:** severe interpersonal conflict or rupture without a direct safety threat.
- **Level 3 — unsafe relationship dynamics / abuse / coercion / stalking / threats / related safety concerns:** the context may be unsafe or controlled by threat, coercion, surveillance, or related harm.
- **Level 4 — self-harm / suicide / violence risk:** possible self-directed or other-directed serious harm.
- **Level 5 — immediate danger:** a current emergency or life-threatening situation requiring immediate action.

Levels 0-2 continue current product behavior. Levels 3-5 remain subject to current blocking and deterministic safety responses. Corpus work must never restore normal coaching, rewrite, or send behavior for a blocked case.

## 4. Existing Safety Categories

The following category keys are authoritative and must be preserved exactly. The definitions, levels, urgency defaults, policies, resource tags, signals, contextual signals, and near misses remain in `engine/safetyKnowledgeBase.js`:

- `none`
- `emotional_distress`
- `conflict_crisis`
- `unsafe_relationship_dynamics`
- `abuse_or_coercion`
- `stalking_or_tracking`
- `threats_or_intimidation`
- `coercive_control_or_isolation`
- `home_danger`
- `self_harm_or_suicide`
- `violence_risk`
- `immediate_danger`

Corpus labels must reference these keys rather than inventing replacement taxonomy names. A corpus record may contain additional descriptive annotations, but those annotations cannot redefine category policy or level mapping.

## 5. Separation of Safety Risk and Communication Risk

Communication risk and safety risk are separate systems.

`riskEngine.js` can identify blame-heavy wording, dismissive tone, overly passive framing, an unclear ask, workplace risk, emotional overload, and escalation. These are communication and interaction concerns. They must not automatically determine Safety Levels 0-5.

A message can be high-risk communication without being a safety case, and safety risk can exist in calm, brief, or apparently well-written language. Corpus annotations must record the distinction explicitly and must not use communication severity as a hidden safety label.

## 6. Corpus Case Requirements

Each future case should support, at minimum:

- a stable case identifier and corpus version;
- source type and provenance status;
- de-identified text or a safe synthetic equivalent;
- applicable context and turn metadata;
- one authoritative safety category key and level where a gold label is warranted;
- urgency and relevant safety signals as references to the Knowledge Base;
- a distinction between observed evidence, interpretation, uncertainty, and annotation rationale;
- communication-risk annotations kept in a separate field or namespace;
- near-miss, edge-case, disagreement, and review status where applicable;
- annotator or adjudication metadata without exposing personal identity.

The corpus should represent both positive and negative evidence. Absence of evidence must not be converted into certainty that a situation is safe.

## 7. Context Dimensions

Cases should capture context that changes interpretation without changing the taxonomy. Useful dimensions include speaker perspective, recipient perspective, relationship type, location, time, immediacy, prior turns, quoted or third-party speech, figurative language, consent, surveillance or control context, requested action, communication channel, and whether the user is drafting, reporting, reflecting, or asking for help.

Context is evidence for interpretation, not permission to infer hidden facts. Annotators should separate what the text states from what context makes plausible.

`contextType` is governed corpus scenario metadata. It supports dataset organization, coverage tracking, retrieval, evaluation grouping, and scenario documentation. It is not a mutually exclusive taxonomy, classifier target, semantic signal, safety category, severity level, policy trigger, or runtime action. Orthogonal dimensions such as temporality, immediacy, literalness, relationship, power imbalance, and vulnerability context must remain separate from scenario labels.

`speakerRole` and `targetRole` are neutral participant or reference fields. They must not encode victim, aggressor, or other safety culpability. `requestedAction` and `conversationGoal` are task or coaching metadata, while `emotionalState` remains contextual annotation and is not governed by the Phase 4C-B vocabulary system.

For governed absence values, `none` asserts supported absence, `none_observed` means the condition was not established by available evidence, and `unknown` means presence or absence cannot be determined. `ongoing` is a closed temporality value for a continuing condition or process across time.

## 8. Near-Miss and Negative Examples

Near misses are essential. Include ordinary sadness, frustration, heated but non-dangerous conflict, firm boundaries, figurative expressions, abstract or third-person discussion, quoted language, consensual monitoring, stressful homes without danger cues, and workplace or relationship language that is harmful or unfair but not a Level 3-5 safety case.

Negative examples should be paired with the reason they do not meet a category signal. The existing Knowledge Base near-miss guidance is authoritative and should be referenced rather than copied as a second policy table.

## 9. Edge Cases

Edge cases should cover ambiguity, incomplete information, conflicting signals, euphemisms, sarcasm, jokes, idioms, roleplay, reported speech, historical versus current harm, uncertain actor, uncertain target, indirect threats, mixed intent, and language that changes meaning across turns.

The correct annotation may be uncertain or require review. Uncertainty must be represented rather than resolved by a confident diagnosis or invented fact.

## 9A. Behavioral Context and Baselines

XLAI may reason about an observed behavioral or interaction baseline only from conversation/history available to the system. `behavioralBaseline` and `interactionProfile` mean time-bounded, observable communication patterns, not psychological profiles, diagnoses, hidden motives, or permanent personality labels. The optional schema `behavioralContext` records observed patterns, recurring themes, baseline deviations, interaction loops, and contextual modifiers only when evidence supports them. Use `insufficient_evidence` or `unknown` rather than manufacturing a baseline from one or two messages.

Behavioral context is evidence, not policy. A recurring theme may increase relevance, but frequency alone cannot establish harmful intent or a safety category. Interaction loops may describe mutually reinforcing behavior as observed or plausible; they must not assign blame or unsupported causality.

Behavioral-context items preserve their source: directly_observed for evidence visible in supplied interaction/history, user_reported for user-supplied historical claims, and inferred for cautious derivation. baselineStatus is separate: observed requires directly observed support, while insufficient_evidence and unknown remain valid when history cannot establish a stable baseline. This metadata cannot create psychological profiles, hidden motives, persistent recipient models, or automatic cross-session memory.

Humor, sarcasm, exaggeration, emojis, retractions, and minimization are contextual modifiers. They do not independently dismiss a safety signal and do not independently establish concealed harmful intent. Retractions such as “I’m joking,” “lol chill,” “never mind,” “forget I said that,” “I wasn’t serious,” and “it’s nothing” are additional evidence whose meaning depends on context. Retraction is neither proof of safety nor proof of concealed intent.

### Development-only behavioral context cases

Future development and validator examples should cover: an obvious joke with a strong joking baseline and no distress; a joke surrounded by hopelessness or distress; a concerning statement followed by "I'm joking"; repeated dark-humor references across turns; an unusual hopeless or withdrawn message after a normally humorous baseline; and a reassurance-seeking/recipient-withdrawal interaction loop. These cases must demonstrate contextual reasoning without assigning hidden intent, diagnoses, blame, or permanent traits. They are requirements for future work, not Batch B data in this revision.

## 10. Multi-Turn Conversations

Future records should preserve turn order and distinguish newly observed evidence from repeated evidence. Labels may be revised when later turns provide credible context, but the revision must retain the prior label, rationale, and reviewer history.

A single harmless-looking turn can become safety-relevant in context, while a dramatic isolated phrase can be clarified as figurative or quoted. Multi-turn data must not encourage the classifier to assume facts absent from the conversation.

Turn-level semantic signals describe evidence supported by that turn. `cumulativeState` preserves established cross-turn facts, history, unknowns, and transitions. The top-level safety annotation represents the final established conversation assessment; when it carries semantic signals, they are relevant to that final state rather than only the final turn or an automatic union of all historical evidence.

Retraction, joking, masking, and minimization are contextual evidence that can change certainty or later interpretation, but they do not automatically erase established evidence or convert explicit ideation into indirect ideation. Concrete preparation toward self-harm or suicide remains deferred: the current corpus has no independently adjudicated preparation examples, and no preparation signal is introduced in this phase.

## 11. Conversation Trajectory Intelligence

Conversation Trajectory Intelligence is qualitative forecasting, not certainty. XLAI may estimate plausible directions such as clarification, productive discussion, repair, reconciliation, compromise, boundary establishment, defensiveness, misunderstanding, withdrawal, escalation, retaliation, relationship rupture, workplace consequence, safety escalation, or uncertain outcome.

The trajectory likelihood rubric is intentionally non-calibrated:

- `low`: possible but weakly supported, with stronger alternatives;
- `moderate`: plausible and supported, but contingent and not dominant;
- `high`: strongly supported and currently the most plausible direction, while remaining non-deterministic;
- `unknown`: insufficient evidence to judge relative plausibility.

There is no percentage mapping, no probability bands, and no calibrated interpretation. Trajectory likelihood is qualitative plausibility, not a model confidence value, not a risk probability, and not a policy signal.

Trajectory analysis must never claim certainty about future human behavior. It is a future schema and coaching annotation dimension, not a safety enforcement mechanism during the initial corpus phases.

## 12. Recipient Perspective Intelligence

The corpus may represent how another person might interpret a message while preserving uncertainty. Preferred language is equivalent to: “They may experience this as accusatory.”

Annotations must not define certainty-equivalent behavior such as: “They definitely feel attacked.” Recipient perspective is an interpretation of possible impact, not mind reading, a diagnosis, or evidence that overrides the user’s account.

## 13. Strengths and Vulnerability Factors

Strengths and vulnerability factors are interaction-level observations, not permanent personality labels. Potential strengths include willingness to repair, accountability, emotional awareness, empathy, direct communication, patience, healthy boundaries, ability to pause, and willingness to listen.

Potential vulnerability factors include emotional overload, fear-driven communication, rejection sensitivity, impulsive messaging, reassurance seeking, avoidance, unclear boundaries, blame patterns, and difficulty expressing needs.

These observations must be tied to available interaction evidence and time-bounded context. Diagnostic personality labeling is not permitted.

## 14. Supportive Honesty Principle

XLAI is on the user’s side without automatically taking the user’s position.

XLAI should support the user’s safety, agency, dignity, long-term interests, communication goals, clarity, and informed decision-making. It must still be willing to tell the user when their interpretation lacks evidence, their communication may be unfair, their behavior may be contributing to the issue, the other person may have a reasonable perspective, or the planned response may worsen the situation.

This principle must remain practical and respectful. It does not authorize blame, diagnosis, moral judgment, or minimizing a credible safety concern.

## 15. Perspective-Taking

Corpus design should distinguish the user’s stated perspective, the recipient’s possible perspective, and the annotator’s uncertainty. It should preserve multiple plausible readings when evidence is incomplete and identify what additional information would discriminate between them.

Perspective-taking must not turn a possible recipient interpretation into a factual claim about the recipient’s feelings or intentions.

## 16. Anticipatory Coaching

Anticipatory Coaching may identify likely tradeoffs, possible interpretations, and safer options before a message is sent. It should help the user consider consequences, timing, boundaries, and what information is missing.

It must remain probabilistic and user-controlled. It must not become a safety enforcement mechanism during the initial corpus phases, and it must not override the deterministic Safety Engine or existing stop behavior.

## 17. Human-Like Coaching Requirements

Future corpus labels should reward language that is direct, grounded, respectful, non-diagnostic, and useful. Coaching should acknowledge uncertainty, avoid therapy or clinician framing, avoid overpromising outcomes, avoid encouraging escalation, and preserve the user’s control.

For safety-sensitive cases, supportive human communication may still be appropriate, but it must follow existing safety policy and practical next-step guidance rather than normal message optimization.

## 18. Safety-Level Adaptation

Corpus annotations may describe how tone, pacing, resource visibility, and coaching posture should adapt by level. Levels 0-2 may support normal coaching with increasing calmness and de-escalation. Levels 3-5 may still receive supportive, human, respectful communication.

However, the existing safety policy remains authoritative: Levels 3-5 must block normal coaching/rewrite/send behavior and return the existing deterministic safety response path. This corpus work must not restore normal behavior, change regex rules, modify response contracts, or alter route enforcement.

## 19. Future Semantic Classifier Contract

A future semantic classifier output is documented conceptually as follows; no classifier is implemented here:

```json
{
  "category": "existing_safety_category_key",
  "level": 0,
  "confidence": 0.0,
  "semanticSignals": []
}
```

`category` must use an existing Knowledge Base key. `level` must preserve 0-5 semantics. `confidence` must be bounded from 0 to 1. `semanticSignals` must describe evidence without replacing deterministic matched signals or policy.

## 20. Shadow Mode

Shadow mode must follow these rules:

- deterministic safety enforcement remains authoritative;
- semantic classifications run internally only;
- semantic results do not affect users;
- deterministic and semantic outputs are compared;
- disagreements are logged;
- false positives are reviewed;
- false negatives are reviewed;
- confidence is calibrated before controlled enforcement.

Shadow mode must not change external API payloads, route behavior, resource handling, or the current blocking path.

## 21. Evaluation Separation

Training, development, QA, calibration, and gold evaluation data must be separated by purpose and access. A case used to tune prompts, rules, labels, or thresholds must not silently serve as an unbiased final evaluation case.

Evaluation should report category and level performance, false positives, false negatives, uncertainty, near-miss behavior, multi-turn behavior, and communication-risk leakage separately. Safety performance must not be hidden inside general communication-quality metrics.

## 22. Synthetic Data Rules

Synthetic data may expand coverage of rare, ambiguous, and safety-sensitive situations, but it must be clearly marked as synthetic and must not be presented as lived experience. Generation must avoid copying identifiable real conversations, preserve realistic uncertainty, include negative and near-miss cases, and be reviewed for harmful stereotypes or accidental policy changes.

Synthetic records cannot establish policy. They remain subordinate to the Knowledge Base and the existing safety architecture.

## 23. Gold Standard Requirements

Gold cases require a written rationale grounded in observable evidence, the exact existing category key, level, urgency where applicable, and a clear explanation of why nearby categories or near-miss interpretations do or do not apply.

Ambiguous cases should support adjudicated alternatives or an explicit unresolved status. Gold labels must be versioned, reviewable, and protected from accidental changes caused by classifier output.

## 24. Data Provenance and Privacy

Every case must record provenance at an appropriate level: synthetic, authored, consented and de-identified, transformed, or other approved source type. Personal identifiers, secrets, unnecessary location details, and identifying relationship details must be removed or generalized.

Access, retention, redaction, and review practices must follow project privacy requirements. Corpus data must not be used to infer identities, diagnose people, or expose private conversations.

## 25. Versioning

Corpus, annotation ontology, gold labels, and evaluation splits must have independent versions with recorded compatibility to the Safety Knowledge Base policy version. Changes to category interpretation, annotation guidance, or gold labels require a changelog and review rationale.

A corpus version cannot silently alter live policy. Any future integration must preserve deterministic precedence until controlled enforcement has been explicitly approved.

## 26. Planned Directory Structure

The completed foundation includes this specification, the README, schemas, ontology, governance documentation, and development-only corpus validation. Future corpus data and evaluation work remain planned separately:

```text
safety-corpus/
├── README.md
├── specification/
│   └── SAFETY_CORPUS_SPEC.md
├── schema/
├── ontology/
├── governance/
├── tools/
├── synthetic/
├── evaluation/
├── qa/
└── analysis/
```

Completed foundation work: corpus specification, schemas, ontology, governance, and Schema v0.1.1 review/certainty separation. Production corpus records, evaluation corpus, corpus QA, semantic classifier, shadow-mode execution, disagreement analysis, calibration, and controlled semantic enforcement are not yet completed. No production corpus records, evaluation datasets, classifier code, or runtime integration are created by this phase.

## 27. Development Sequence

The planned development sequence is:

1. Safety Corpus Specification
2. Corpus Schema
3. Annotation Ontology
4. Quality and Governance Standard
5. Initial Synthetic Corpus
6. Evaluation Corpus
7. Corpus QA
8. Semantic Classifier Shadow Mode
9. Deterministic/Semantic Disagreement Analysis
10. Confidence Calibration
11. Controlled Semantic Enforcement

Conversation Trajectory Intelligence, Recipient Perspective Intelligence, strengths and vulnerability reasoning, and Anticipatory Coaching should be represented in future schema and corpus design. During the initial corpus phases, they must remain coaching and evaluation dimensions, not safety enforcement mechanisms.
