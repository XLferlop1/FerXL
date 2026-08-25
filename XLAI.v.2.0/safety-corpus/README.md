# XLAI Safety Corpus

The XLAI Safety Corpus is the documentation and future data foundation for labeled safety examples, semantic classification examples, edge cases, near misses, multi-turn conversations, gold evaluation data, classifier QA, disagreement analysis, calibration data, and future semantic classifier development.

It is not a replacement for the live Safety Knowledge Base, a runtime classifier, an evaluation dataset, a JSON schema, a source of safety policy, or a mechanism for changing enforcement.

`engine/safetyKnowledgeBase.js` remains the authoritative source for safety categories, levels, urgency, category definitions, messaging policy, coach policy, resource tags, and near-miss guidance. The corpus design is specified in [specification/SAFETY_CORPUS_SPEC.md](specification/SAFETY_CORPUS_SPEC.md).

Planned sequence:

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

Current runtime safety behavior is unchanged. No routes, enforcement rules, response contracts, model calls, or existing engine files are modified by this foundation.

## Behavioral Context Boundary

The corpus may represent an observed `behavioralBaseline` or `interactionProfile` only from conversation/history available to XLAI. These are time-bounded records of observable patterns such as message style, humor frequency, directness, reassurance seeking, repair attempts, withdrawal, escalation, boundaries, recurring themes, and interaction loops. They are not psychological profiles, diagnoses, motives, or permanent personality labels.

Baseline deviation is `unknown` or `insufficient_evidence` when there is not enough prior material. Humor, sarcasm, exaggeration, emojis, retraction, or minimization is contextual evidence: it neither dismisses a safety signal nor proves concealed harmful intent. Recurrence can increase relevance but cannot establish harmful intent or a safety category by frequency alone.

Evidence about the user’s stated feelings, goals, fears, observations, and actions is usually stronger than evidence about a recipient’s internal state. Recipient annotations must separate observed or user-reported behavior, plausible interpretations, possible responses, and unknowns. These corpus structures do not authorize production storage of long-term behavioral or psychological profiles.
