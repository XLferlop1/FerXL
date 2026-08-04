# Architecture

XLAI is a full-stack web app built around a coaching-first messaging flow.

## Main pieces

- Frontend: HTML, CSS, and JavaScript in `public/`
- Backend: Node.js + Express in `server.js`
- Database: PostgreSQL on Neon
- AI: OpenAI API

## Frontend surfaces

- Chat and coaching UI: `public/chat.html` and `public/chat.js`
- Insights dashboard: `public/insights.html` and `public/insights.js`
- Journal: `public/journal.html` and `public/journal.js`
- Styling: `public/style.css`

## Core runtime flow

1. User writes a draft message.
2. The local analyzer evaluates tone, risk, intent, and communication pattern.
3. The coach renders guidance and suggested rewrites.
4. The user chooses whether to refine or send.
5. The backend persists messages and coaching history.

## Backend responsibilities

- Serve the app and static assets
- Expose health and data APIs
- Persist messages, coach interactions, and journal entries
- Call OpenAI for coaching and rephrase generation
- Maintain message retention policies

## Data model overview

- `messages`: sent chat messages and metadata
- `coach_interactions`: coach questions, responses, and intent summaries
- `journal_entries`: personal reflection entries and analyzer output

## Current architectural constraint

The app is still using hardcoded development identities in some places, which is acceptable for the current beta but should be replaced with real auth/user state before production release.