# XL AI (XLAI) — Communication Coach App

## What this is
XL AI is an app that helps you communicate better. You type what you want to say, and XL AI helps you rewrite it so it sounds clearer, calmer, and more respectful—without changing what you meant.

This is built to help with everyday conversations (partner, family, coworkers, friends), especially when things feel tense.

## What XL AI does
- **Rephrase messages:** turns a rough or emotional message into something clearer and less aggressive.
- **Tone check:** warns you if your message sounds angry, blaming, insulting, or likely to start a fight.
- **Suggest better wording:** offers alternative sentences you can copy and send.
- **Coach modes:**
  - **Soft mode:** gentle suggestions, low friction.
  - **High mode:** stronger coaching and can require a short pause before sending if the message is heated.

## What XL AI is NOT
- Not therapy
- Not medical advice
- Not a crisis service
- Not legal advice

If the app detects talk about self-harm, violence, abuse, or emergencies, it should stop normal coaching and show safety resources instead.

## The main goal (so we don’t get lost)
**Help people pause, rewrite, and communicate with emotional intelligence—before they send a message they regret.**

Everything we build should support this goal.

## How the app works (simple)
1. You write a message.
2. XL AI analyzes the tone.
3. XL AI suggests a better version (rephrase).
4. You choose what to send (you stay in control).

## Privacy rules (core principle)
- The app should be **privacy-first**.
- Messages should **not be kept forever**.
- No using user messages to train models unless the user **clearly opts in**.

## Current MVP features
- Chat-style UI
- Rephrase button
- Tone/analyzer feedback
- Coach mode toggle (Soft / High)
- Basic safety refusal + resources
- Health endpoint for server checks

## API (basic idea)
- `GET /health` → returns “healthy”
- `POST /api/message` → sends a user message and returns:
  - the coached response
  - any tone flags
  - a suggested rewrite (when needed)

## Local setup (basic)
1. Install dependencies:
   - `npm install`
2. Start the server:
   - `npm start`
3. Open the app in the browser and test sending messages.

## Definition of Done (MVP is “working” when)
- You can type a message and get a response every time.
- Rephrase works and produces useful rewrites.
- Tone warnings show up when messages are heated.
- Soft/High coach mode changes the behavior.
- Safety cases trigger a refusal + resources.
- Privacy rules are followed by default.

## Owner
Built by Fernando Lopez.