# Contributing

Thanks for helping improve XLAI.

## Before you change anything

- Preserve working features unless a change clearly replaces them
- Keep the communication-coach mission intact
- Read the relevant product docs first
- Favor small, reversible changes

## Development setup

1. Install dependencies with `npm install`
2. Start the app with `npm start`
3. Use the browser and local APIs to verify changes

## Code standards

- Keep the UI coaching-first and user-controlled
- Do not add new behavior that overwrites drafts without user action
- Keep safety and privacy considerations explicit
- Avoid hardcoding personal or production identities

## Testing

- Run the app and verify the chat, coach, journal, and insights flows
- Check the server logs for API errors
- Verify message send, refine, and retention behaviors
- Run smoke checks when changing backend routes

Local validation commands:

- `npm run check:syntax`
- `npm run smoke` (with the app running locally on port 3000)
- `npm run test:contracts`

GitHub Actions CI:

- Syntax validation always runs on pushes and pull requests.
- Smoke and contract validation run when non-production CI secrets are configured for `CI_DATABASE_URL` and `CI_OPENAI_API_KEY`.

## Documentation

- Update the docs when product behavior changes
- Keep README concise and use it as the pointer to documentation

## Review expectations

- Do not delete existing working code unless the replacement is proven
- Prefer compatibility-preserving changes
- Call out safety, privacy, and data-retention implications in reviews