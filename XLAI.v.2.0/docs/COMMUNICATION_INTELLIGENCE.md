# Communication Intelligence

XLAI is not just a text rewriter. Its core value is communication intelligence: understanding what the user is trying to say, how it may land, and what kind of response is most appropriate before anything is sent.

## What the intelligence layer looks at

- Emotional intensity
- Escalation risk
- Blame-heavy wording
- Workplace risk
- Passive or shutdown language
- Clarity of the ask
- Likely recipient reaction
- Whether the message is a rewrite request or a coaching question

## Engine v1 (deterministic rule-based)

Communication Intelligence Engine v1 is centralized under `engine/` and runs with deterministic rules before OpenAI generation in non-blocked flows.

Modules:

- `engine/communicationEngine.js` (orchestrator)
- `engine/intentEngine.js`
- `engine/emotionEngine.js`
- `engine/relationshipEngine.js`
- `engine/riskEngine.js`
- `engine/recipientImpactEngine.js`
- `engine/coachingStrategyEngine.js`
- `engine/communicationContract.js`

### Supported labels

Intent labels:

- `clarify`
- `apologize`
- `set_boundary`
- `express_feeling`
- `request_action`
- `disagree`
- `repair_conflict`
- `professional_update`
- `unknown`

Emotion labels:

- `calm`
- `frustrated`
- `angry`
- `hurt`
- `anxious`
- `confused`
- `overwhelmed`
- `neutral`

Relationship types:

- `partner`
- `family`
- `friend`
- `coworker`
- `manager`
- `employee`
- `customer`
- `unknown`

Risk types:

- `escalation`
- `blame_heavy`
- `unclear_ask`
- `dismissive_tone`
- `overly_passive`
- `workplace_risk`
- `emotional_overload`

## What the coach should do

- Coach before generating
- Preserve the user’s intent
- Reduce unnecessary conflict
- Keep the message authentic and human
- Offer wording the user can actually send

## Coaching modes

- Soft: lighter guidance and lower friction
- Direct: stronger, more explicit coaching
- Professional: workplace-aware, concise, and neutral

## Intelligence principles

- Diagnose communication problems, not people
- Focus on outcomes and recipient impact
- Give the user a choice, not an automated decision
- Build understanding before rewriting

## Runtime order

1. Safety Engine executes first.
2. If Safety blocks (`level 3-5`), normal coaching/rewrite flow remains blocked.
3. If not blocked, deterministic Communication Intelligence runs in `POST /api/send`, `POST /api/rephrase`, and `POST /api/analyze-intensity` before generation/persistence logic.
4. Existing response fields remain intact; communication analysis is additive and backward-compatible.

## Roadmap direction

The intelligence layer should continue to improve in intent detection, relationship context, recipient impact prediction, and pattern recognition while remaining privacy-first and user-controlled.