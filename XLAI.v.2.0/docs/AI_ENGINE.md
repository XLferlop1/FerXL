# AI Engine

XLAI uses OpenAI as the generation layer, but the app is designed so that the intelligence layer and product logic sit above raw generation.

## AI responsibilities

- Analyze draft messages
- Produce coaching summaries
- Generate rewrite suggestions
- Support different coaching modes
- Return structured output that the UI can render safely

## Important endpoints

- `POST /api/analyze-intensity`
- `POST /api/rephrase`

## Engine behavior

- The app first analyzes the draft locally and through backend coaching rules.
- For non-blocked requests, deterministic Communication Intelligence (rule-based) executes in `POST /api/send`, `POST /api/rephrase`, and `POST /api/analyze-intensity` before generation/persistence logic.
- Coaching should happen before generation, not after the fact.
- Rewrites should preserve meaning and intent.
- The engine should not silently replace the user’s message; the user must stay in control.

### Deterministic communication modules

- `communicationEngine.js` (orchestrator)
- `intentEngine.js`
- `emotionEngine.js`
- `relationshipEngine.js`
- `riskEngine.js`
- `recipientImpactEngine.js`
- `coachingStrategyEngine.js`
- `communicationContract.js`

## Output contract

The backend currently returns structured coaching data such as:

- natural coaching response
- suggested rewrite
- softer alternative
- short note or rationale
- risk/intensity metadata

## Guardrails

- Do not use therapy-like language as a substitute for coaching
- Do not remove authenticity from the user’s voice
- Do not over-soften serious conflict
- Keep output useful enough to send

## Reliability notes

The AI layer should degrade gracefully: if structured output fails, the app should still provide a safe fallback and preserve the user’s draft.