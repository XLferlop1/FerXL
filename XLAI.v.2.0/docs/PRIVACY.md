# Privacy

Privacy is a core product principle in XLAI.

## Privacy principles

- Privacy-first by default
- User ownership of conversation data
- No model training on user conversations unless the user clearly opts in
- Minimize retention whenever possible
- Keep the user in control of what is stored and what is sent

## Current implementation direction

- Privacy retention is centralized in `engine/privacyEngine.js`
- Automatic cleanup applies to all core user-generated product records:
	- `messages`
	- `coach_interactions`
	- `journal_entries`
- Default retention is 24 hours for messages, coach interactions, and journal entries
- Journal entries can be explicitly retained longer when `retainUntil` is provided on create
- Cleanup runs safely at startup, on an hourly schedule, and opportunistically on write paths
- User content is not used for model training in this beta

## Retention policy (beta)

```json
{
	"retention": {
		"messagesHours": 24,
		"coachInteractionsHours": 24,
		"journalEntriesHours": 24
	}
}
```

Journal-specific behavior:

- If `retainUntil` is omitted, a journal entry follows the 24-hour default policy.
- If `retainUntil` is provided, the entry is preserved until that timestamp.

## What still needs to be completed

- Replace hardcoded development identities with real account/user context
- Make the training opt-in model explicit in product UI and settings
- Document encryption expectations clearly at deployment time
- Add authenticated controls for per-user retention preferences and export/delete flows

## Privacy promise

The user should never feel like the app owns their communication. XLAI should behave like a coach and a tool, not a surveillance system.