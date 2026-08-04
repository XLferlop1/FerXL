# XLAI

XLAI is a Communication Intelligence Platform that coaches users before they send messages.

The app helps people pause, understand tone and intent, reduce conflict, and rewrite messages while keeping the user in control.

## What XLAI is

- Chat-based communication coach
- Tone and risk analyzer
- Message rewrite and refine assistant
- Journal and insights product surface
- Privacy-first communication tool

## What XLAI is not

- Not therapy
- Not medical advice
- Not legal advice
- Not a crisis service

When high-risk language is detected, XLAI stops normal coaching behavior and returns safety-focused responses and resources.

## Implemented engines

- Communication and AI coaching engine
- Safety Engine with deterministic blocking for high-risk levels
- Privacy and Retention Engine with centralized cleanup policy

## Privacy and retention summary

- Retention policy is centralized and documented in the Privacy docs.
- Default retention is 24 hours for messages, coach interactions, and journal entries.
- Journal entries can be explicitly retained longer when requested.
- No model training on user content unless explicit opt-in exists.

## API summary

README is intentionally concise.

For the complete and current API surface, use:
- [API documentation](XLAI.v.2.0/docs/API.md)

## Documentation

- [Documentation Index](XLAI.v.2.0/docs/README.md)
- [Product](XLAI.v.2.0/docs/PRODUCT.md)
- [Architecture](XLAI.v.2.0/docs/ARCHITECTURE.md)
- [API documentation](XLAI.v.2.0/docs/API.md)
- [Communication Intelligence](XLAI.v.2.0/docs/COMMUNICATION_INTELLIGENCE.md)
- [AI Engine](XLAI.v.2.0/docs/AI_ENGINE.md)
- [Safety](XLAI.v.2.0/docs/SAFETY.md)
- [Safety Classification Architecture](XLAI.v.2.0/docs/SAFETY_CLASSIFICATION_ARCHITECTURE.md)
- [Privacy](XLAI.v.2.0/docs/PRIVACY.md)
- [Roadmap](XLAI.v.2.0/docs/ROADMAP.md)
- [Current Checkpoint](XLAI.v.2.0/docs/CHECKPOINT_CURRENT_STATE.md)
- [Beta Stabilization Checklist](XLAI.v.2.0/docs/BETA_STABILIZATION_CHECKLIST.md)
- [Beta Readiness Report](XLAI.v.2.0/docs/BETA_READINESS_REPORT.md)
- [Design Principles](XLAI.v.2.0/docs/DESIGN_PRINCIPLES.md)
- [Contributing](XLAI.v.2.0/docs/CONTRIBUTING.md)

## Current status

XLAI is in beta with working chat, coaching, analysis, persistence, journal, insights, safety, and privacy-retention foundations. Remaining work is focused on production hardening, identity/auth, testing reliability, and next-step intelligence upgrades.