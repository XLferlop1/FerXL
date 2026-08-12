# Safety

XLAI is not therapy, not medical advice, not legal advice, and not a crisis service.

## Safety rule

If the app detects high-risk safety language, it must stop normal coaching and return a deterministic safety response.

## Safety levels

- Level 0: normal coaching
- Level 1: emotional distress
- Level 2: high-conflict relationship crisis
- Level 3: possible abuse, coercion, stalking, or unsafe relationship dynamics
- Level 4: self-harm, suicide, or violence risk
- Level 5: emergency or immediate danger

## Stop behavior

- Levels 0-2: normal product behavior continues.
- Levels 3-5: XLAI blocks normal coaching/rewrite/send path and returns a deterministic safety response.

Blocked response shape:

```json
{
	"safety": {
		"level": 4,
		"label": "self-harm or violence risk",
		"shouldStopNormalCoaching": true,
		"reason": "Possible self-harm, suicide, or violence risk detected.",
		"matchedSignals": ["self_harm_or_suicide"],
		"resources": ["..."]
	},
	"coachingBlocked": true,
	"message": "XLAI paused normal coaching because this may involve self-harm or violence risk. Please seek immediate emergency or crisis support.",
	"suggestedRewrite": null
}
```

## What safety means here

- Protect users from harmful coaching in high-risk situations
- Avoid encouraging escalation
- Avoid language that frames the product as a counselor or clinician
- Use simple, grounded language without diagnosis or therapeutic framing

## Required behavior

- Detect crisis-adjacent language early
- Refuse normal coaching when risk is immediate
- Show clear safety resources and next-step guidance
- Keep the user’s control in place while being careful not to intensify harm

## Product voice constraints

- Do not diagnose people or relationships.
- Do not use therapy-language framing.
- Do not overpromise outcomes.
- Keep language practical, direct, and human.

## Non-goals

- Diagnosing mental health conditions
- Replacing human support
- Handling emergencies directly

## Implementation note

The baseline backend Safety Engine is implemented in `engine/safetyEngine.js` and integrated before normal generation in `POST /api/send`, `POST /api/rephrase`, and `POST /api/analyze-intensity`.

## Phase 2 status

- Implemented: centralized Safety Knowledge Base in `engine/safetyKnowledgeBase.js`
- Implemented: versioned safety taxonomy, urgency defaults, messaging policies, coach policies, near-miss guidance, and validation
- Implemented: internal-only Safety Decision Engine in `engine/safetyDecisionEngine.js`
- Not implemented yet: semantic classification
- Unchanged: current Safety Engine enforcement, route blocking behavior, external API response shapes

## Phase 3 status

- Implemented: `buildSafetyDecision(...)`, `validateSafetyDecision(...)`, and `getDecisionPolicyForContext(...)`
- Implemented: internal decision construction in `POST /api/send`, `POST /api/rephrase`, and `POST /api/analyze-intensity`
- Implemented: failure-isolated runtime wrapper (`buildSafetyDecisionSafe(...)`) so internal decision build/validation failures cannot fail route execution
- Unchanged: deterministic Safety Engine remains authoritative for live blocking and response paths
- Unchanged: decision output is internal-only and not included in external API payloads