# Roadmap

XLAI is currently a strong beta. The remaining work is mostly about hardening the product, improving intelligence, and making the system feel more complete and trustworthy.

## Completed direction

- Chat-based communication coaching
- Rephrase and refine flow
- Tone and risk analysis
- Journal
- Insights dashboard
- Conversation history

## Highest-priority next work

1. Expand Safety Engine beyond baseline keyword detection (regional resources, escalation tuning, abuse-specific pathways)
2. Full privacy retention policy across all stored records
3. Real user identity and auth instead of beta config defaults
4. More reliable test and smoke tooling, including endpoint contract checks
5. Better product documentation and API stability
6. Consolidate overlapping beta routes (`/api/send`, `/api/messages`, `/api/history`) into a clearer long-term contract
7. Add automated API surface verification to prevent docs/runtime drift

## Contract testing status

- Implemented: lightweight runtime response contract hardening for `POST /api/analyze-intensity`, `POST /api/rephrase`, `POST /api/send`, and safety-blocked payloads.
- Implemented: automated endpoint contract tests via `npm run test:contracts`.
- In progress: broader API surface verification beyond the current core coaching routes.

## Safety status

- Baseline production-safe Safety Engine is implemented.
- Deterministic safety blocking is active in `POST /api/send`, `POST /api/rephrase`, and `POST /api/analyze-intensity`.
- Levels 3-5 bypass normal coaching/rewrite generation and return safety responses with resources.

## Intelligence roadmap

- Relationship detection
- Intent detection
- Recipient impact prediction
- Pattern recognition improvements
- More context-aware coaching
- Better personalization with explicit opt-in

## Product roadmap

- Cleaner onboarding
- Conversation management improvements
- Stronger mobile polish
- Improved coach feedback loop
- Optional user-controlled personalization settings

## Release goal

The next major milestone should be a production-hardened Communication Intelligence Platform with clear safety, privacy, and identity boundaries.