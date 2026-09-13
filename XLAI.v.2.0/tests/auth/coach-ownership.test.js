"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createOwnedCoachInteraction,
  listOwnedCoachInteractions,
} = require("../../auth/coachOwnership.js");

const ownerA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ownerB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const conversationA = "11111111-1111-4111-8111-111111111111";
const conversationB = "22222222-2222-4222-8222-222222222222";
const missingConversation = "33333333-3333-4333-8333-333333333333";

function createPool(row, calls = []) {
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      assert.match(sql, /INSERT INTO coach_interactions/i);
      assert.match(sql, /FROM conversations c/i);
      assert.match(sql, /c\.id = \$1[\s\S]+c\.owner_user_id = \$2/i);
      return { rows: row ? [row] : [] };
    },
  };
}

function listPool({ conversationRows = [], interactionRows = [], calls = [] } = {}) {
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/FROM conversations/i.test(sql)) {
        assert.match(sql, /c\.owner_user_id = \$2|owner_user_id = \$2/i);
        return { rows: conversationRows };
      }
      assert.match(sql, /JOIN conversations c/i);
      assert.match(sql, /ci\.conversation_uuid = \$1/i);
      assert.match(sql, /c\.owner_user_id = \$2/i);
      return { rows: interactionRows };
    },
  };
}

function interaction(ownerUserId, conversationUuid, id = 1) {
  return {
    id,
    owner_user_id: ownerUserId,
    conversation_uuid: conversationUuid,
    conversation_id: conversationUuid,
    user_id: null,
    coach_question_text: "How can I say this clearly?",
    created_at_timestamp: "2026-09-13T00:00:00.000Z",
  };
}

test("User A creates in User A conversation", async () => {
  const result = await createOwnedCoachInteraction({
    pool: createPool(interaction(ownerA, conversationA)),
    ownerUserId: ownerA,
    conversationUuid: conversationA,
    coachQuestionText: "How can I say this clearly?",
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, 201);
  assert.equal(result.interaction.conversation_uuid, conversationA);
});

test("User B creates in User B conversation", async () => {
  const result = await createOwnedCoachInteraction({
    pool: createPool(interaction(ownerB, conversationB)),
    ownerUserId: ownerB,
    conversationUuid: conversationB,
    coachQuestionText: "Help me reflect.",
  });
  assert.equal(result.interaction.conversation_uuid, conversationB);
});

test("User A cannot create in User B conversation", async () => {
  const result = await createOwnedCoachInteraction({
    pool: createPool(null),
    ownerUserId: ownerA,
    conversationUuid: conversationB,
    coachQuestionText: "Blocked",
  });
  assert.deepEqual(result, { ok: false, status: 404, error: "conversation_not_found" });
});

test("User B cannot create in User A conversation", async () => {
  const result = await createOwnedCoachInteraction({
    pool: createPool(null),
    ownerUserId: ownerB,
    conversationUuid: conversationA,
    coachQuestionText: "Blocked",
  });
  assert.deepEqual(result, { ok: false, status: 404, error: "conversation_not_found" });
});

test("foreign and nonexistent creates have identical neutral results", async () => {
  const foreign = await createOwnedCoachInteraction({ pool: createPool(null), ownerUserId: ownerA, conversationUuid: conversationB, coachQuestionText: "Blocked" });
  const missing = await createOwnedCoachInteraction({ pool: createPool(null), ownerUserId: ownerA, conversationUuid: missingConversation, coachQuestionText: "Blocked" });
  assert.deepEqual(foreign, missing);
});

test("userId cannot alter coach ownership", async () => {
  const calls = [];
  const result = await createOwnedCoachInteraction({ pool: createPool(interaction(ownerA, conversationA), calls), ownerUserId: ownerA, conversationUuid: conversationA, userId: ownerB, coachQuestionText: "A question" });
  assert.equal(result.interaction.conversation_uuid, conversationA);
  assert.equal(result.interaction.user_id, null);
  assert.equal(calls[0].params[1], ownerA);
});

test("user_id cannot alter coach ownership", async () => {
  const calls = [];
  const result = await createOwnedCoachInteraction({ pool: createPool(interaction(ownerA, conversationA), calls), ownerUserId: ownerA, conversationUuid: conversationA, user_id: ownerB, coachQuestionText: "A question" });
  assert.equal(result.interaction.user_id, null);
  assert.equal(calls[0].params[1], ownerA);
});

test("owner_user_id is not accepted as a trusted helper owner", async () => {
  const result = await createOwnedCoachInteraction({ pool: createPool(interaction(ownerA, conversationA)), ownerUserId: ownerA, owner_user_id: ownerB, conversationUuid: conversationA, coachQuestionText: "A question" });
  assert.equal(result.interaction.conversation_uuid, conversationA);
});

test("ownerUserId is not accepted as a trusted helper owner", async () => {
  const result = await createOwnedCoachInteraction({ pool: createPool(interaction(ownerA, conversationA)), ownerUserId: ownerA, ownerUserId: ownerA, conversationUuid: conversationA, coachQuestionText: "A question" });
  assert.equal(result.interaction.conversation_uuid, conversationA);
});

test("new coach row stores user_id as NULL", async () => {
  const result = await createOwnedCoachInteraction({ pool: createPool(interaction(ownerA, conversationA)), ownerUserId: ownerA, conversationUuid: conversationA, coachQuestionText: "A question" });
  assert.equal(result.interaction.user_id, null);
});

test("new coach row stores authoritative conversation_uuid", async () => {
  const result = await createOwnedCoachInteraction({ pool: createPool(interaction(ownerA, conversationA)), ownerUserId: ownerA, conversationUuid: conversationA, coachQuestionText: "A question" });
  assert.equal(result.interaction.conversation_uuid, conversationA);
});

test("legacy conversation_id cannot independently authorize a write", async () => {
  const calls = [];
  const result = await createOwnedCoachInteraction({ pool: createPool(null, calls), ownerUserId: ownerA, conversationUuid: "legacy-thread", conversationId: conversationA, coachQuestionText: "Blocked" });
  assert.deepEqual(result, { ok: false, status: 400, error: "invalid_coach_request" });
  assert.equal(calls.length, 0);
});

test("User A lists User A coach rows", async () => {
  const result = await listOwnedCoachInteractions({ pool: listPool({ conversationRows: [{ id: conversationA }], interactionRows: [interaction(ownerA, conversationA)] }), ownerUserId: ownerA, conversationUuid: conversationA });
  assert.equal(result.ok, true);
  assert.equal(result.interactions.length, 1);
});

test("User B lists User B coach rows", async () => {
  const result = await listOwnedCoachInteractions({ pool: listPool({ conversationRows: [{ id: conversationB }], interactionRows: [interaction(ownerB, conversationB)] }), ownerUserId: ownerB, conversationUuid: conversationB });
  assert.equal(result.interactions[0].conversation_uuid, conversationB);
});

test("User A cannot list User B coach rows", async () => {
  const result = await listOwnedCoachInteractions({ pool: listPool(), ownerUserId: ownerA, conversationUuid: conversationB });
  assert.deepEqual(result, { ok: false, status: 404, error: "conversation_not_found" });
});

test("User B cannot list User A coach rows", async () => {
  const result = await listOwnedCoachInteractions({ pool: listPool(), ownerUserId: ownerB, conversationUuid: conversationA });
  assert.deepEqual(result, { ok: false, status: 404, error: "conversation_not_found" });
});

test("NULL conversation_uuid rows are excluded", async () => {
  const result = await listOwnedCoachInteractions({ pool: listPool({ conversationRows: [{ id: conversationA }], interactionRows: [] }), ownerUserId: ownerA, conversationUuid: conversationA });
  assert.deepEqual(result, { ok: true, status: 200, interactions: [] });
});

test("legacy conversation_id cannot recover a NULL bridge row", async () => {
  const result = await listOwnedCoachInteractions({ pool: listPool({ conversationRows: [{ id: conversationA }], interactionRows: [] }), ownerUserId: ownerA, conversationUuid: conversationA });
  assert.equal(result.interactions.length, 0);
});

test("owned conversation with no coach rows returns empty success", async () => {
  const result = await listOwnedCoachInteractions({ pool: listPool({ conversationRows: [{ id: conversationA }], interactionRows: [] }), ownerUserId: ownerA, conversationUuid: conversationA });
  assert.deepEqual(result, { ok: true, status: 200, interactions: [] });
});

test("foreign conversation list returns neutral not-found", async () => {
  const result = await listOwnedCoachInteractions({ pool: listPool(), ownerUserId: ownerA, conversationUuid: conversationB });
  assert.deepEqual(result, { ok: false, status: 404, error: "conversation_not_found" });
});

test("nonexistent conversation list returns the same neutral not-found", async () => {
  const result = await listOwnedCoachInteractions({ pool: listPool(), ownerUserId: ownerA, conversationUuid: missingConversation });
  assert.deepEqual(result, { ok: false, status: 404, error: "conversation_not_found" });
});

test("malformed UUID is rejected", async () => {
  const result = await listOwnedCoachInteractions({ pool: listPool(), ownerUserId: ownerA, conversationUuid: "not-a-uuid" });
  assert.deepEqual(result, { ok: false, status: 400, error: "invalid_coach_request" });
});

test("database create failure fails closed", async () => {
  const result = await createOwnedCoachInteraction({ pool: { async query() { throw new Error("write unavailable"); } }, ownerUserId: ownerA, conversationUuid: conversationA, coachQuestionText: "A question" });
  assert.deepEqual(result, { ok: false, status: 503, error: "coach_service_unavailable" });
});

test("database list/ownership failure fails closed", async () => {
  const result = await listOwnedCoachInteractions({ pool: { async query() { throw new Error("read unavailable"); } }, ownerUserId: ownerA, conversationUuid: conversationA });
  assert.deepEqual(result, { ok: false, status: 503, error: "coach_service_unavailable" });
});
