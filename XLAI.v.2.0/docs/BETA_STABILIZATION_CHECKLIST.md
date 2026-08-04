# XLAI Beta Stabilization Checklist

Date: 2026-06-28  
Scope: Beta stabilization only (no new features)

## 1) Current Beta Readiness Summary

Current state indicates a strong beta candidate, but not production-ready.

- Core backend + frontend coaching flows are implemented and testable.
- Safety blocking paths are implemented for high-risk inputs.
- Privacy/retention status + cleanup endpoints exist and are smoke-covered.
- Communication Intelligence (deterministic) is integrated and additive.
- CI workflow exists and is now named `.github/workflows/ci.yml`.
- Workspace currently contains broad, mixed-scope changes (large diff footprint).

Not complete (must not be overclaimed):

- Auth and user identity hardening are not complete.
- Deployment hardening is not complete.
- Personalization, memory, model training controls, voice, and VLM are not complete.

## 2) Repository Status Snapshot (Major Modified Areas)

Based on current workspace status, the largest modified areas are:

- Backend/runtime: `server.js`
- Frontend: `public/chat.js`, `public/chat.html`, `public/style.css`, `public/eq-log.js`, `public/eq-log.html`, new Insights/Journal frontend files
- Engines: new `engine/*` modules (safety/privacy/communication/contracts)
- Validation assets: `script/smoke.sh`, `tests/contracts/*`
- CI and docs: `.github/workflows/ci.yml`, `docs/*`
- Multiple phase and QA report files added at repo/app root

Stabilization implication:

- Treat current workspace as a large mixed change-set requiring split/triage before beta sign-off.

## 3) Required Checks Before Beta

- Freeze feature scope (bug fixes and stabilization only).
- Ensure CI workflow file path is stable: `.github/workflows/ci.yml`.
- Run local validation in order:
	- `npm run check:syntax`
	- `npm run smoke` (with app healthy)
	- `npm run test:contracts`
- Confirm no contract warnings in server logs for core routes.
- Confirm smoke exits cleanly and validates safety/privacy cases.
- Confirm no hidden fatal lint/runtime errors in browser console for primary flows.
- Verify docs and CI expectations match actual behavior.

## 4) Manual Browser Testing Checklist

Chat and coach baseline:

- Load chat surface successfully.
- Send a normal message flow end-to-end.
- Use Refine (simple + deep path) and verify expected UI response.
- Use Coach interaction and confirm response rendering remains coherent.
- Validate conversation switching, history loading, and message ordering.

Safety-aware UX:

- Level 3/4/5 safety-trigger prompts show blocked behavior in UI.
- Blocked rewrite/send paths do not present normal “apply rewrite” behavior.
- UI handles missing communication/safety payload sections gracefully.

Insights/journal surfaces:

- Insights loads timeline, summary cards, and tables without crashing.
- Journal save/load paths work and status messages are understandable.

## 5) Mobile/Tablet UI Checklist

- Verify primary pages on small viewport (phone portrait).
- Verify primary pages on tablet width.
- Check composer usability (input height, send/refine visibility, scrolling behavior).
- Check coach panel readability and interaction without overflow breakage.
- Check timeline/table sections for horizontal overflow handling.
- Confirm no blocking UI overlap with sticky headers/menus.

## 6) Safety Testing Checklist

API behavior checks:

- `POST /api/analyze-intensity` normal input: not blocked.
- `POST /api/analyze-intensity` coercion/abuse-like input: blocked with safety payload.
- `POST /api/rephrase` self-harm input: blocked with safety payload.
- `POST /api/send` emergency input: blocked with safety payload.

UI behavior checks:

- Blocked payload surfaces clear safety messaging.
- No normal rewrite/send actions exposed when blocked.
- Crisis resources are present and understandable in blocked responses.

## 7) Privacy/Retention Testing Checklist

- `GET /api/privacy-status` returns retention policy and cleanup targets.
- `POST /api/privacy-cleanup` returns `ok: true` in beta/debug mode.
- Verify cleanup does not delete fresh records unexpectedly.
- Verify retention windows are consistent across `messages`, `coach_interactions`, `journal_entries`.
- Confirm logs do not expose sensitive user content unnecessarily.

## 8) Communication Intelligence Testing Checklist

- Verify `communication` object appears for non-blocked core routes:
	- `/api/analyze-intensity`
	- `/api/rephrase`
	- `/api/send`
- Validate intent/emotion/relationship/risks fields are structurally present.
- Validate additive persistence fields appear in message/coach analytics paths.
- Verify pattern summary includes communication aggregate fields.
- Confirm deterministic logic does not break baseline coaching output shape.

## 9) Insights Testing Checklist

- Validate `GET /api/interaction-timeline` data renders correctly.
- Validate `GET /api/pattern-summary` cards and metrics populate.
- Validate coach interaction history table renders safely with empty/non-empty datasets.
- Validate timeline filters (all/message/coach) behave correctly.
- Validate no fatal errors when one endpoint is unavailable.

## 10) CI/PR Validation Checklist

- Confirm `.github/workflows/ci.yml` exists and is the only CI workflow path used for this validation setup.
- Confirm syntax job runs on PR/push.
- Confirm integration job remains secret-gated (`CI_DATABASE_URL`, `CI_OPENAI_API_KEY`).
- Confirm steps include `npm ci`, syntax, smoke, contract tests.
- Confirm failure artifact upload for server logs is intact.
- Confirm local command parity with CI steps.

## 11) Known Remaining Technical Risks

- Large mixed-scope workspace diff increases regression and review risk.
- Overlapping/legacy API surfaces still exist (route consolidation pending).
- CI integration job depends on secrets and may be skipped in some repos/forks.
- Potential schema/contract drift risk as additive fields evolve.
- Frontend complexity in chat surface raises risk of UI regressions across states.

## 12) Known Product/UX Risks

- Coach output consistency can vary by context and mode.
- Safety transitions may feel abrupt without additional UX polish.
- Dense UI surfaces (chat/coach/insights) can overwhelm first-time users.
- Mobile readability may degrade for table-heavy insights sections.
- No finalized onboarding/auth posture for beta user segmentation.

## 13) What Should NOT Be Added Before Beta

- No new product surfaces.
- No new AI modalities (voice, VLM, multimodal expansion).
- No new memory/personalization systems.
- No model training pipeline changes.
- No auth architecture expansion during stabilization unless blocking.
- No broad refactors unrelated to beta blockers.

## 14) Recommended Commit/PR Split Plan (For Current Large Workspace)

Recommended split to reduce risk and improve review quality:

1. CI + docs-only PR
- `.github/workflows/ci.yml`
- `docs/CONTRIBUTING.md`
- stabilization/checklist docs only

2. Engine foundation PR
- `engine/*` (safety/privacy/communication/contracts)
- no frontend/UI changes in this PR

3. Backend integration PR
- `server.js`
- API contract alignment and persistence wiring only

4. Frontend UX PR
- `public/chat.*`, `public/style.css`, insights/journal frontend files
- no backend/schema changes in this PR

5. Validation assets PR
- `script/smoke.sh`
- `tests/contracts/*`
- related test harness files only

6. Historical reports/docs PR
- phase and QA report markdown files
- kept separate from executable changes

## 15) Final Beta Launch Gate

Beta launch can proceed only if all are true:

- Syntax, smoke, and contract tests pass locally.
- CI syntax job passes on PR.
- Integration CI job passes where secrets are configured.
- Manual browser checklist completed on desktop + mobile/tablet.
- Safety, privacy/retention, communication intelligence, and insights checklists all pass.
- No unresolved P0/P1 defects in core chat/coach/send/refine/safety paths.
- Scope freeze is respected (no new features added).

If any gate fails, beta launch is blocked and stabilization continues.
