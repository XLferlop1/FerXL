#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"

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
  -d '{"text":"I am really frustrated you ignored me","tone":"low-key","coachMode":"soft"}')'"
echo "$ANALYZE_RESP" | cat
echo

echo "4) POST /api/send (writes to DB)"
SEND_RESP="$(curl -sS -X POST "$BASE_URL/api/send" \
  -H "Content-Type: application/json" \
  -d '{"conversationId":"smoke","userId":"demo_user","originalText":"I am really frustrated you ignored me","finalText":"I felt hurt when I didn’t hear back.","preSendEmotion":"frustrated","intensityScore":0.6,"wasPauseTaken":false,"usedSuggestion":true}')"
echo "$SEND_RESP" | cat
echo

echo "5) GET /api/messages?conversationId=smoke (verify data returns)"
curl -sS "$BASE_URL/api/messages?conversationId=smoke" | cat
echo

echo "✅ Smoke test finished."