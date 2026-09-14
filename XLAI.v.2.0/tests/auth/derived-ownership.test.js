"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  readOwnedBehaviorFeedback,
  readOwnedInteractionTimeline,
  readOwnedPatternSummary,
} = require("../../auth/derivedAnalyticsOwnership.js");

const ownerA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ownerB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const conversationA = "11111111-1111-4111-8111-111111111111";
const conversationB = "22222222-2222-4222-8222-222222222222";
const missingConversation = "33333333-3333-4333-8333-333333333333";

function createPool({
  conversations = [],
  messages = [],
  coachInteractions = [],
  shouldFail = false,
} = {}) {
  return {
    async query(sql, params = []) {
      if (shouldFail) {
        throw new Error("database unavailable");
      }

      if (/FROM conversations/i.test(sql) && /WHERE id = \$1/i.test(sql)) {
        const row = conversations.find(
          (c) => c.id === params[0] && c.owner_user_id === params[1]
        );
        return { rows: row ? [row] : [] };
      }

      if (/FROM messages m/i.test(sql) && /JOIN conversations c/i.test(sql)) {
        const rows = messages.filter((m) => {
          if (m.conversation_uuid !== params[0]) return false;
          return conversations.some(
            (c) => c.id === m.conversation_uuid && c.owner_user_id === params[1]
          );
        });
        return { rows };
      }

      if (/FROM coach_interactions ci/i.test(sql) && /JOIN conversations c/i.test(sql)) {
        const rows = coachInteractions.filter((ci) => {
          if (ci.conversation_uuid !== params[0]) return false;
          return conversations.some(
            (c) => c.id === ci.conversation_uuid && c.owner_user_id === params[1]
          );
        });
        return { rows };
      }

      return { rows: [] };
    },
  };
}

const fixtureConversations = [
  { id: conversationA, owner_user_id: ownerA },
  { id: conversationB, owner_user_id: ownerB },
];

const fixtureMessages = [
  {
    id: 1,
    conversation_uuid: conversationA,
    conversation_id: conversationA,
    user_id: ownerA,
    final_text: "Message A1",
    intensity_score: 0.8,
    pre_send_emotion: "frustrated",
    was_pause_taken: true,
    action_taken: "used_suggestion",
    risks: ["tension"],
    coach_mode: "soft",
    communication_intent_label: "express_hurt",
    communication_emotion_primary: "frustrated",
    communication_relationship_type: "partner",
    communication_strategy_mode: "soften",
    communication_max_risk_severity: 2,
    communication_risks: ["tension"],
    created_at_timestamp: "2026-09-12T10:00:00.000Z",
  },
  {
    id: 2,
    conversation_uuid: conversationB,
    conversation_id: conversationB,
    user_id: ownerB,
    final_text: "Message B1",
    intensity_score: 0.9,
    pre_send_emotion: "angry",
    was_pause_taken: false,
    action_taken: null,
    risks: ["escalation"],
    coach_mode: "direct",
    communication_intent_label: "confront",
    communication_emotion_primary: "angry",
    communication_relationship_type: "colleague",
    communication_strategy_mode: "direct",
    communication_max_risk_severity: 3,
    communication_risks: ["escalation"],
    created_at_timestamp: "2026-09-12T11:00:00.000Z",
  },
  {
    id: 3,
    conversation_uuid: null,
    conversation_id: conversationA,
    user_id: ownerA,
    final_text: "NULL bridge message",
    intensity_score: 0.95,
    pre_send_emotion: "furious",
    created_at_timestamp: "2026-09-12T12:00:00.000Z",
  },
];

const fixtureCoachInteractions = [
  {
    id: 10,
    conversation_uuid: conversationA,
    conversation_id: conversationA,
    user_id: ownerA,
    coach_question_text: "How do I soften this?",
    coach_response_text: "Try validating first.",
    intent_type: "de-escalate",
    created_at_timestamp: "2026-09-12T10:05:00.000Z",
  },
  {
    id: 20,
    conversation_uuid: conversationB,
    conversation_id: conversationB,
    user_id: ownerB,
    coach_question_text: "Should I respond now?",
    coach_response_text: "Wait five minutes.",
    intent_type: "pause",
    created_at_timestamp: "2026-09-12T11:05:00.000Z",
  },
  {
    id: 30,
    conversation_uuid: null,
    conversation_id: conversationA,
    user_id: ownerA,
    coach_question_text: "NULL bridge question",
    coach_response_text: "Unbridged response",
    intent_type: "draft_analysis",
    created_at_timestamp: "2026-09-12T12:05:00.000Z",
  },
];

// --- BEHAVIOR-FEEDBACK TESTS ---

test("1. A receives feedback from A-owned messages", async () => {
  const pool = createPool({ conversations: fixtureConversations, messages: fixtureMessages });
  const result = await readOwnedBehaviorFeedback({ pool, ownerUserId: ownerA, conversationId: conversationA });

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.feedback.sampleSize, 1);
  assert.equal(result.feedback.averageIntensity, 0.8);
  assert.equal(result.feedback.topEmotion, "frustrated");
});

test("2. B-owned messages do not contribute to A feedback", async () => {
  const pool = createPool({ conversations: fixtureConversations, messages: fixtureMessages });
  const result = await readOwnedBehaviorFeedback({ pool, ownerUserId: ownerA, conversationId: conversationA });

  assert.equal(result.feedback.sampleSize, 1);
  assert.equal(result.feedback.averageIntensity !== 0.85, true);
});

test("3. NULL-bridge messages do not contribute to feedback", async () => {
  const pool = createPool({ conversations: fixtureConversations, messages: fixtureMessages });
  const result = await readOwnedBehaviorFeedback({ pool, ownerUserId: ownerA, conversationId: conversationA });

  assert.equal(result.feedback.sampleSize, 1);
  assert.equal(result.feedback.topEmotion !== "furious", true);
});

test("4. legacy matching conversation_id cannot contribute to feedback without UUID bridge", async () => {
  const pool = createPool({ conversations: fixtureConversations, messages: fixtureMessages });
  const result = await readOwnedBehaviorFeedback({ pool, ownerUserId: ownerA, conversationId: conversationA });

  assert.equal(result.feedback.sampleSize, 1);
});

test("5. owned conversation with zero messages returns compatible empty feedback result", async () => {
  const emptyConv = "44444444-4444-4444-8444-444444444444";
  const pool = createPool({
    conversations: [{ id: emptyConv, owner_user_id: ownerA }],
    messages: [],
  });
  const result = await readOwnedBehaviorFeedback({ pool, ownerUserId: ownerA, conversationId: emptyConv });

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.feedback.sampleSize, 0);
  assert.equal(result.feedback.averageIntensity, null);
  assert.equal(result.feedback.topEmotion, null);
  assert.equal(result.feedback.riskLevel, "low");
});

test("6. foreign UUID returns neutral 404 for feedback", async () => {
  const pool = createPool({ conversations: fixtureConversations, messages: fixtureMessages });
  const result = await readOwnedBehaviorFeedback({ pool, ownerUserId: ownerA, conversationId: conversationB });

  assert.deepEqual(result, { ok: false, status: 404, error: "conversation_not_found" });
});

test("7. nonexistent UUID returns identical 404 for feedback", async () => {
  const pool = createPool({ conversations: fixtureConversations, messages: fixtureMessages });
  const result = await readOwnedBehaviorFeedback({ pool, ownerUserId: ownerA, conversationId: missingConversation });

  assert.deepEqual(result, { ok: false, status: 404, error: "conversation_not_found" });
});

test("8. malformed UUID returns 400 for feedback", async () => {
  const pool = createPool({ conversations: fixtureConversations, messages: fixtureMessages });
  const result = await readOwnedBehaviorFeedback({ pool, ownerUserId: ownerA, conversationId: "default" });

  assert.deepEqual(result, { ok: false, status: 400, error: "invalid_conversation" });
});

test("9. userId spoof does not broaden feedback scope", async () => {
  const pool = createPool({ conversations: fixtureConversations, messages: fixtureMessages });
  const result = await readOwnedBehaviorFeedback({ pool, ownerUserId: ownerA, conversationId: conversationA, userId: ownerB });

  assert.equal(result.ok, true);
  assert.equal(result.feedback.sampleSize, 1);
});

test("10. user_id spoof does not broaden feedback scope", async () => {
  const pool = createPool({ conversations: fixtureConversations, messages: fixtureMessages });
  const result = await readOwnedBehaviorFeedback({ pool, ownerUserId: ownerA, conversationId: conversationA, user_id: ownerB });

  assert.equal(result.ok, true);
  assert.equal(result.feedback.sampleSize, 1);
});

test("11. DB failure returns sanitized 503 for feedback", async () => {
  const pool = createPool({ shouldFail: true });
  const result = await readOwnedBehaviorFeedback({ pool, ownerUserId: ownerA, conversationId: conversationA });

  assert.deepEqual(result, { ok: false, status: 503, error: "conversation_service_unavailable" });
});

// --- INTERACTION-TIMELINE TESTS ---

test("12. A timeline includes A-owned messages", async () => {
  const pool = createPool({
    conversations: fixtureConversations,
    messages: fixtureMessages,
    coachInteractions: fixtureCoachInteractions,
  });
  const result = await readOwnedInteractionTimeline({ pool, ownerUserId: ownerA, conversationId: conversationA });

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.summary.messageEvents, 1);
  assert.equal(result.timeline.some((e) => e.id === "m_1"), true);
});

test("13. A timeline includes A-owned coach rows", async () => {
  const pool = createPool({
    conversations: fixtureConversations,
    messages: fixtureMessages,
    coachInteractions: fixtureCoachInteractions,
  });
  const result = await readOwnedInteractionTimeline({ pool, ownerUserId: ownerA, conversationId: conversationA });

  assert.equal(result.summary.coachEvents, 1);
  assert.equal(result.timeline.some((e) => e.id === "c_10"), true);
});

test("14. B-owned messages excluded from A timeline", async () => {
  const pool = createPool({
    conversations: fixtureConversations,
    messages: fixtureMessages,
    coachInteractions: fixtureCoachInteractions,
  });
  const result = await readOwnedInteractionTimeline({ pool, ownerUserId: ownerA, conversationId: conversationA });

  assert.equal(result.timeline.some((e) => e.id === "m_2"), false);
});

test("15. B-owned coach rows excluded from A timeline", async () => {
  const pool = createPool({
    conversations: fixtureConversations,
    messages: fixtureMessages,
    coachInteractions: fixtureCoachInteractions,
  });
  const result = await readOwnedInteractionTimeline({ pool, ownerUserId: ownerA, conversationId: conversationA });

  assert.equal(result.timeline.some((e) => e.id === "c_20"), false);
});

test("16. NULL-bridge messages excluded from timeline", async () => {
  const pool = createPool({
    conversations: fixtureConversations,
    messages: fixtureMessages,
    coachInteractions: fixtureCoachInteractions,
  });
  const result = await readOwnedInteractionTimeline({ pool, ownerUserId: ownerA, conversationId: conversationA });

  assert.equal(result.timeline.some((e) => e.id === "m_3"), false);
});

test("17. NULL-bridge coach rows excluded from timeline", async () => {
  const pool = createPool({
    conversations: fixtureConversations,
    messages: fixtureMessages,
    coachInteractions: fixtureCoachInteractions,
  });
  const result = await readOwnedInteractionTimeline({ pool, ownerUserId: ownerA, conversationId: conversationA });

  assert.equal(result.timeline.some((e) => e.id === "c_30"), false);
});

test("18. legacy matching message conversation_id cannot contribute to timeline", async () => {
  const pool = createPool({
    conversations: fixtureConversations,
    messages: fixtureMessages,
    coachInteractions: fixtureCoachInteractions,
  });
  const result = await readOwnedInteractionTimeline({ pool, ownerUserId: ownerA, conversationId: conversationA });

  assert.equal(result.summary.messageEvents, 1);
});

test("19. legacy matching coach conversation_id cannot contribute to timeline", async () => {
  const pool = createPool({
    conversations: fixtureConversations,
    messages: fixtureMessages,
    coachInteractions: fixtureCoachInteractions,
  });
  const result = await readOwnedInteractionTimeline({ pool, ownerUserId: ownerA, conversationId: conversationA });

  assert.equal(result.summary.coachEvents, 1);
});

test("20. owned-empty conversation returns empty timeline", async () => {
  const emptyConv = "44444444-4444-4444-8444-444444444444";
  const pool = createPool({
    conversations: [{ id: emptyConv, owner_user_id: ownerA }],
    messages: [],
    coachInteractions: [],
  });
  const result = await readOwnedInteractionTimeline({ pool, ownerUserId: ownerA, conversationId: emptyConv });

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.deepEqual(result.timeline, []);
  assert.deepEqual(result.summary, { totalEvents: 0, messageEvents: 0, coachEvents: 0 });
});

test("21. foreign UUID neutral 404 for timeline", async () => {
  const pool = createPool({
    conversations: fixtureConversations,
    messages: fixtureMessages,
    coachInteractions: fixtureCoachInteractions,
  });
  const result = await readOwnedInteractionTimeline({ pool, ownerUserId: ownerA, conversationId: conversationB });

  assert.deepEqual(result, { ok: false, status: 404, error: "conversation_not_found" });
});

test("22. nonexistent UUID identical 404 for timeline", async () => {
  const pool = createPool({
    conversations: fixtureConversations,
    messages: fixtureMessages,
    coachInteractions: fixtureCoachInteractions,
  });
  const result = await readOwnedInteractionTimeline({ pool, ownerUserId: ownerA, conversationId: missingConversation });

  assert.deepEqual(result, { ok: false, status: 404, error: "conversation_not_found" });
});

test("23. malformed UUID 400 for timeline", async () => {
  const pool = createPool({
    conversations: fixtureConversations,
    messages: fixtureMessages,
    coachInteractions: fixtureCoachInteractions,
  });
  const result = await readOwnedInteractionTimeline({ pool, ownerUserId: ownerA, conversationId: "not-a-uuid" });

  assert.deepEqual(result, { ok: false, status: 400, error: "invalid_conversation" });
});

test("24. DB failure sanitized 503 for timeline", async () => {
  const pool = createPool({ shouldFail: true });
  const result = await readOwnedInteractionTimeline({ pool, ownerUserId: ownerA, conversationId: conversationA });

  assert.deepEqual(result, { ok: false, status: 503, error: "conversation_service_unavailable" });
});

// --- PATTERN-SUMMARY TESTS ---

test("25. A-owned messages contribute to pattern summary", async () => {
  const pool = createPool({
    conversations: fixtureConversations,
    messages: fixtureMessages,
    coachInteractions: fixtureCoachInteractions,
  });
  const result = await readOwnedPatternSummary({ pool, ownerUserId: ownerA, conversationId: conversationA });

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.summary.totalMessages, 1);
  assert.equal(result.summary.averageIntensity, 0.8);
});

test("26. A-owned coach rows contribute to pattern summary", async () => {
  const pool = createPool({
    conversations: fixtureConversations,
    messages: fixtureMessages,
    coachInteractions: fixtureCoachInteractions,
  });
  const result = await readOwnedPatternSummary({ pool, ownerUserId: ownerA, conversationId: conversationA });

  assert.equal(result.summary.totalCoachInteractions, 1);
  assert.deepEqual(result.summary.coachIntentTypeCounts, { "de-escalate": 1 });
});

test("27. B-owned messages excluded from pattern summary", async () => {
  const pool = createPool({
    conversations: fixtureConversations,
    messages: fixtureMessages,
    coachInteractions: fixtureCoachInteractions,
  });
  const result = await readOwnedPatternSummary({ pool, ownerUserId: ownerA, conversationId: conversationA });

  assert.equal(result.summary.totalMessages, 1);
});

test("28. B-owned coach rows excluded from pattern summary", async () => {
  const pool = createPool({
    conversations: fixtureConversations,
    messages: fixtureMessages,
    coachInteractions: fixtureCoachInteractions,
  });
  const result = await readOwnedPatternSummary({ pool, ownerUserId: ownerA, conversationId: conversationA });

  assert.equal(result.summary.totalCoachInteractions, 1);
  assert.equal(result.summary.coachIntentTypeCounts.pause || 0, 0);
});

test("29. NULL-bridge message excluded from pattern summary", async () => {
  const pool = createPool({
    conversations: fixtureConversations,
    messages: fixtureMessages,
    coachInteractions: fixtureCoachInteractions,
  });
  const result = await readOwnedPatternSummary({ pool, ownerUserId: ownerA, conversationId: conversationA });

  assert.equal(result.summary.totalMessages, 1);
});

test("30. NULL-bridge coach row excluded from pattern summary", async () => {
  const pool = createPool({
    conversations: fixtureConversations,
    messages: fixtureMessages,
    coachInteractions: fixtureCoachInteractions,
  });
  const result = await readOwnedPatternSummary({ pool, ownerUserId: ownerA, conversationId: conversationA });

  assert.equal(result.summary.totalCoachInteractions, 1);
  assert.equal(result.summary.coachIntentTypeCounts.draft_analysis || 0, 0);
});

test("31. legacy matching conversation_id cannot contribute to pattern summary", async () => {
  const pool = createPool({
    conversations: fixtureConversations,
    messages: fixtureMessages,
    coachInteractions: fixtureCoachInteractions,
  });
  const result = await readOwnedPatternSummary({ pool, ownerUserId: ownerA, conversationId: conversationA });

  assert.equal(result.summary.totalMessages, 1);
});

test("32. spoofed userId cannot broaden pattern summary aggregate", async () => {
  const pool = createPool({
    conversations: fixtureConversations,
    messages: fixtureMessages,
    coachInteractions: fixtureCoachInteractions,
  });
  const result = await readOwnedPatternSummary({ pool, ownerUserId: ownerA, conversationId: conversationA, userId: ownerB });

  assert.equal(result.summary.totalMessages, 1);
});

test("33. owned-empty conversation returns compatible empty summary", async () => {
  const emptyConv = "44444444-4444-4444-8444-444444444444";
  const pool = createPool({
    conversations: [{ id: emptyConv, owner_user_id: ownerA }],
    messages: [],
    coachInteractions: [],
  });
  const result = await readOwnedPatternSummary({ pool, ownerUserId: ownerA, conversationId: emptyConv });

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.summary.totalMessages, 0);
  assert.equal(result.summary.totalCoachInteractions, 0);
  assert.deepEqual(result.insights, ["No messages yet to analyze patterns."]);
});

test("34. foreign UUID neutral 404 for pattern summary", async () => {
  const pool = createPool({
    conversations: fixtureConversations,
    messages: fixtureMessages,
    coachInteractions: fixtureCoachInteractions,
  });
  const result = await readOwnedPatternSummary({ pool, ownerUserId: ownerA, conversationId: conversationB });

  assert.deepEqual(result, { ok: false, status: 404, error: "conversation_not_found" });
});

test("35. nonexistent UUID identical 404 for pattern summary", async () => {
  const pool = createPool({
    conversations: fixtureConversations,
    messages: fixtureMessages,
    coachInteractions: fixtureCoachInteractions,
  });
  const result = await readOwnedPatternSummary({ pool, ownerUserId: ownerA, conversationId: missingConversation });

  assert.deepEqual(result, { ok: false, status: 404, error: "conversation_not_found" });
});

test("36. malformed UUID 400 for pattern summary", async () => {
  const pool = createPool({
    conversations: fixtureConversations,
    messages: fixtureMessages,
    coachInteractions: fixtureCoachInteractions,
  });
  const result = await readOwnedPatternSummary({ pool, ownerUserId: ownerA, conversationId: "not-a-uuid" });

  assert.deepEqual(result, { ok: false, status: 400, error: "invalid_conversation" });
});

test("37. DB failure sanitized 503 for pattern summary", async () => {
  const pool = createPool({ shouldFail: true });
  const result = await readOwnedPatternSummary({ pool, ownerUserId: ownerA, conversationId: conversationA });

  assert.deepEqual(result, { ok: false, status: 503, error: "conversation_service_unavailable" });
});
