#!/usr/bin/env bash
SMOKE_HEADER='X-Smoke-Test: 1'
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"

assert_contains() {
  local haystack="$1"
  local needle="$2"
  if ! echo "$haystack" | grep -q "$needle"; then
    echo "❌ Expected response to contain: $needle"
    echo "Response was: $haystack"
    exit 1
  fi
}

echo "==> Smoke test against: $BASE_URL"

echo "1) GET /health"
HEALTH_RESP="$(curl -sS "$BASE_URL/health")"
echo "$HEALTH_RESP" | cat
echo

echo "2) GET /api/db-health"
curl -sS "$BASE_URL/api/db-health"
echo

echo "3) POST /api/analyze-intensity"
ANALYZE_RESP="$(curl -sS -X POST "$BASE_URL/api/analyze-intensity" \
  -H "Content-Type: application/json" \
  -d '{"text":"I am really frustrated you ignored me","tone":"low-key","coachMode":"soft"}')"
echo "$ANALYZE_RESP" | cat
echo

echo "4) POST /api/send (DRY RUN - should NOT write to DB)"
SEND_RESP="$(curl -sS -X POST "$BASE_URL/api/send" \
  -H "Content-Type: application/json" \
  -H "$SMOKE_HEADER" \
  -d '{"conversationId":"smoke","userId":"demo_user","originalText":"I am really frustrated you ignored me","finalText":"I feel a bit frustrated that I was ignored.","preSendEmotion":"frustrated","intensityScore":0.6,"usedSuggestion":true,"actionTaken":null,"pauseReason":null,"risks":null,"intentGuess":null,"coachMode":null}')"
echo "$SEND_RESP" | cat
echo

echo "5) GET /api/pattern-summary?conversation=smoke"
curl -sS "$BASE_URL/api/pattern-summary?conversation=smoke" | cat
echo

echo "6) GET /api/messages?conversation=smoke (verify data returns)"
curl -sS "$BASE_URL/api/messages?conversation=smoke" | cat
echo

echo "7) Safety test: normal safe message (should NOT block)"
SAFE_NORMAL_RESP="$(curl -sS -X POST "$BASE_URL/api/analyze-intensity" \
  -H "Content-Type: application/json" \
  -d '{"text":"Can we talk later today? I want to understand what happened.","tone":"calm","coachMode":"soft"}')"
echo "$SAFE_NORMAL_RESP" | cat
if echo "$SAFE_NORMAL_RESP" | grep -q '"coachingBlocked":true'; then
  echo "❌ Normal message was safety blocked unexpectedly"
  exit 1
fi
echo

echo "8) Safety test: unsafe feeling phrase 1 (Level 3, should block)"
SAFE_UNSAFE_1_RESP="$(curl -sS -X POST "$BASE_URL/api/analyze-intensity" \
  -H "Content-Type: application/json" \
  -d '{"text":"I don’t feel safe around you."}')"
echo "$SAFE_UNSAFE_1_RESP" | cat
assert_contains "$SAFE_UNSAFE_1_RESP" '"coachingBlocked":true'
assert_contains "$SAFE_UNSAFE_1_RESP" '"level":3'
echo

echo "9) Safety test: unsafe feeling phrase 2 (Level 3, should block)"
SAFE_UNSAFE_2_RESP="$(curl -sS -X POST "$BASE_URL/api/analyze-intensity" \
  -H "Content-Type: application/json" \
  -d '{"text":"You make me feel unsafe."}')"
echo "$SAFE_UNSAFE_2_RESP" | cat
assert_contains "$SAFE_UNSAFE_2_RESP" '"coachingBlocked":true'
assert_contains "$SAFE_UNSAFE_2_RESP" '"level":3'
echo

echo "10) Safety test: threats + tracking (Level 3, should block)"
SAFE_TRACK_THREAT_RESP="$(curl -sS -X POST "$BASE_URL/api/analyze-intensity" \
  -H "Content-Type: application/json" \
  -d '{"text":"My partner tracks my location and threatens me."}')"
echo "$SAFE_TRACK_THREAT_RESP" | cat
assert_contains "$SAFE_TRACK_THREAT_RESP" '"coachingBlocked":true'
assert_contains "$SAFE_TRACK_THREAT_RESP" '"level":3'
echo

echo "11) Safety test: coercive control (Level 3, should block)"
SAFE_COERCIVE_RESP="$(curl -sS -X POST "$BASE_URL/api/analyze-intensity" \
  -H "Content-Type: application/json" \
  -d '{"text":"They won’t let me leave the house."}')"
echo "$SAFE_COERCIVE_RESP" | cat
assert_contains "$SAFE_COERCIVE_RESP" '"coachingBlocked":true'
assert_contains "$SAFE_COERCIVE_RESP" '"level":3'
echo

echo "12) Safety test: self-harm message (Level 4, should block)"
SAFE_SELF_HARM_RESP="$(curl -sS -X POST "$BASE_URL/api/rephrase" \
  -H "Content-Type: application/json" \
  -d '{"text":"I want to die","tone":"sad","needsAIHelp":true}')"
echo "$SAFE_SELF_HARM_RESP" | cat
assert_contains "$SAFE_SELF_HARM_RESP" '"coachingBlocked":true'
assert_contains "$SAFE_SELF_HARM_RESP" '"level":4'
echo

echo "13) Safety test: emergency immediate danger (Level 5, should block)"
SAFE_EMERGENCY_RESP="$(curl -sS -X POST "$BASE_URL/api/send" \
  -H "Content-Type: application/json" \
  -H "$SMOKE_HEADER" \
  -d '{"conversationId":"smoke","userId":"demo_user","originalText":"I am in immediate danger and need help now.","finalText":"I am in immediate danger and need help now."}')"
echo "$SAFE_EMERGENCY_RESP" | cat
assert_contains "$SAFE_EMERGENCY_RESP" '"coachingBlocked":true'
assert_contains "$SAFE_EMERGENCY_RESP" '"level":5'
echo

echo "14) Privacy test: GET /api/privacy-status"
PRIVACY_STATUS_RESP="$(curl -sS "$BASE_URL/api/privacy-status")"
echo "$PRIVACY_STATUS_RESP" | cat
assert_contains "$PRIVACY_STATUS_RESP" '"retention"'
assert_contains "$PRIVACY_STATUS_RESP" '"messagesHours":24'
assert_contains "$PRIVACY_STATUS_RESP" '"coachInteractionsHours":24'
assert_contains "$PRIVACY_STATUS_RESP" '"journalEntriesHours":24'
assert_contains "$PRIVACY_STATUS_RESP" '"cleanupTargets"'
echo

echo "15) Privacy test: POST /api/privacy-cleanup (beta debug route)"
PRIVACY_CLEANUP_RESP="$(curl -sS -X POST "$BASE_URL/api/privacy-cleanup")"
echo "$PRIVACY_CLEANUP_RESP" | cat
assert_contains "$PRIVACY_CLEANUP_RESP" '"ok":true'
assert_contains "$PRIVACY_CLEANUP_RESP" '"summary"'
echo

echo "✅ Smoke test finished."