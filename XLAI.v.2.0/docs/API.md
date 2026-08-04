# API

This is the current public API surface of XLAI.

## Health

- `GET /health` - returns `healthy`
- `GET /api/health` - returns JSON health status
- `GET /api/db-health` - verifies database connectivity (beta diagnostics)
- `GET /api/privacy-status` - returns centralized privacy retention and cleanup status
- `POST /api/privacy-cleanup` - force a retention cleanup run (beta/debug only, non-production)

## Messaging and coaching

- `POST /api/send` - persist a sent message
- `POST /api/rephrase` - generate a rewrite suggestion
- `POST /api/analyze-intensity` - analyze a draft and return coaching data
- `GET /api/behavior-feedback` - compute coaching hint + intensity/risk summary for a conversation

### Safety Engine behavior

The backend runs the Safety Engine before normal generation in:

- `POST /api/send`
- `POST /api/rephrase`
- `POST /api/analyze-intensity`

Safety levels:

- `0` normal coaching
- `1` emotional distress
- `2` high-conflict relationship crisis
- `3` possible abuse/coercion/stalking/unsafe dynamics
- `4` self-harm/suicide/violence risk
- `5` emergency/immediate danger

For levels `3-5`, normal behavior is blocked and the API returns deterministic safety JSON:

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

### Communication Intelligence Engine behavior

For non-blocked requests, deterministic Communication Intelligence runs before OpenAI generation in:

- `POST /api/send`
- `POST /api/analyze-intensity`
- `POST /api/rephrase`

It is additive and backward-compatible: existing response fields are preserved.

Optional response field (when available):

```json
{
	"communication": {
		"intent": {
			"label": "request_action",
			"confidence": 0.8,
			"explanation": "Contains clear action request phrasing."
		},
		"emotion": {
			"primary": "frustrated",
			"intensity": 0.62,
			"explanation": "Detected frustrated cues in wording."
		},
		"relationship": {
			"type": "coworker",
			"confidence": 0.78,
			"explanation": "Detected coworker-related context."
		},
		"risks": [
			{
				"type": "blame_heavy",
				"severity": "high",
				"explanation": "Absolute or accusatory wording may trigger defensiveness."
			}
		],
		"recipientImpact": {
			"likelyReaction": "Recipient may become defensive and focus on rebuttal.",
			"explanation": "Blame-heavy wording often triggers argument loops."
		},
		"coachingStrategy": {
			"mode": "soft",
			"approach": "Keep tone supportive, avoid blame, and end with a clear request.",
			"userLesson": "Soft tone and explicit asks reduce conflict and improve understanding."
		}
	}
}
```

### Response contract validation

XLAI now includes lightweight response contract hardening for core coaching routes:

- `POST /api/analyze-intensity`
- `POST /api/rephrase`
- `POST /api/send`
- Safety-blocked payloads used by those routes

Implementation details:

- Runtime checks are defined in `engine/responseContracts.js`.
- Route handlers run non-breaking contract checks before returning JSON.
- If a payload drifts from contract shape, the server logs a warning instead of changing behavior.
- Automated endpoint contract tests run via `npm run test:contracts`.

Contract tests complement smoke coverage; they do not replace `script/smoke.sh`.

## Conversation data

- `GET /api/conversations` - list conversations
- `GET /api/messages` - fetch messages for a conversation (`conversation` query param required)
- `POST /api/messages` - save a message record
- `GET /api/history` - legacy/compat history read for a conversation

### Communication Intelligence persistence (additive)

For non-blocked normal persistence flows, XLAI now stores a summary of deterministic Communication Intelligence in existing tables:

- `messages`
- `coach_interactions` (when communication data is provided by caller)

Persisted summary fields:

- `communication_intent_label`
- `communication_intent_confidence`
- `communication_emotion_primary`
- `communication_emotion_intensity`
- `communication_relationship_type`
- `communication_relationship_confidence`
- `communication_recipient_reaction`
- `communication_strategy_mode`
- `communication_strategy_approach`
- `communication_risks`
- `communication_max_risk_severity`

Notes:

- This persistence is additive and backward-compatible.
- Safety-blocked flows continue to bypass normal persistence.
- No raw user text is stored in these new communication summary fields.

## Coach analytics

- `POST /api/coach-interactions` - store coach usage data
- `GET /api/coach-interactions` - fetch coach interaction history
- `GET /api/interaction-timeline` - unified timeline of messages and coach events
- `GET /api/pattern-summary` - summarize communication patterns

`GET /api/pattern-summary` now also includes additive communication summary metrics in `summary` when available:

- `topCommunicationIntent`
- `topCommunicationEmotion`
- `topCommunicationRelationship`
- `topCommunicationStrategyMode`
- `averageCommunicationMaxRiskSeverity`
- `communicationRiskCounts`

## Journal

- `POST /api/journal-entries` - create a journal entry
	- Optional field: `retainUntil` (ISO timestamp). If set, journal entry is retained until that time.
- `GET /api/journal-entries` - list journal entries

## Privacy status shape

`GET /api/privacy-status` returns:

```json
{
	"retention": {
		"messagesHours": 24,
		"coachInteractionsHours": 24,
		"journalEntriesHours": 24
	},
	"lastCleanupAt": "2026-01-01T00:00:00.000Z",
	"cleanupTargets": ["messages", "coach_interactions", "journal_entries"]
}
```

## Notes

- The API is beta-oriented and may continue to evolve.
- Response shapes are designed for the current UI surfaces and coaching flow.
- Some endpoints are intentionally overlapping in beta (`/api/send` and `/api/messages` write paths) and should be consolidated during hardening.