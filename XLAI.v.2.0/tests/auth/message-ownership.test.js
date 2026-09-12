"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  readOwnedMessages,
  insertOwnedMessage,
} = require("../../auth/conversationOwnership.js");

const ownerA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ownerB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const conversationA = "11111111-1111-4111-8111-111111111111";
const conversationB = "22222222-2222-4222-8222-222222222222";
const missingConversation = "33333333-3333-4333-8333-333333333333";

function readPool(rowsByConversation) {
  return {
    async query(sql, params) {
      assert.match(sql, /JOIN conversations c ON c\.id = m\.conversation_uuid/i);
      assert.match(sql, /m\.conversation_uuid = \$1/i);
      assert.match(sql, /c\.owner_user_id = \$2/i);
      return { rows: rowsByConversation[`${params[0]}:${params[1]}`] || [] };
    },
  };
}

function insertPool(row) {
  const calls = [];
  return {
    calls,
    pool: {
      async query(sql, params) {
        calls.push({ sql, params });
        assert.match(sql, /INSERT INTO messages/i);
        assert.match(sql, /SELECT[\s\S]+FROM conversations c/i);
        assert.match(sql, /c\.id = \$1[\s\S]+c\.owner_user_id = \$2/i);
        return { rows: row ? [row] : [] };
      },
    },
  };
}

test("User A reads only messages bridged to User A's owned conversation", async () => {
  const result = await readOwnedMessages({
    pool: readPool({
      [`${conversationA}:${ownerA}`]: [{ id: 1, conversation_uuid: conversationA, user_id: ownerA }],
      [`${conversationB}:${ownerB}`]: [{ id: 2, conversation_uuid: conversationB, user_id: ownerB }],
    }),
    ownerUserId: ownerA,
    conversationId: conversationA,
  });

  assert.equal(result.ok, true);
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].conversation_uuid, conversationA);
});

test("User B reads only messages bridged to User B's owned conversation", async () => {
  const result = await readOwnedMessages({
    pool: readPool({ [`${conversationB}:${ownerB}`]: [{ id: 2, conversation_uuid: conversationB, user_id: ownerB }] }),
    ownerUserId: ownerB,
    conversationId: conversationB,
  });

  assert.equal(result.ok, true);
  assert.equal(result.messages[0].conversation_uuid, conversationB);
});

test("foreign and nonexistent message reads return identical neutral not-found results", async () => {
  const pool = readPool({});
  const foreign = await readOwnedMessages({ pool, ownerUserId: ownerA, conversationId: conversationB });
  const missing = await readOwnedMessages({ pool, ownerUserId: ownerA, conversationId: missingConversation });

  assert.deepEqual(foreign, { ok: false, status: 404, error: "conversation_not_found" });
  assert.deepEqual(missing, foreign);
});

test("NULL conversation_uuid rows remain inaccessible", async () => {
  const result = await readOwnedMessages({
    pool: readPool({ [`${conversationA}:${ownerA}`]: [] }),
    ownerUserId: ownerA,
    conversationId: conversationA,
  });

  assert.deepEqual(result, { ok: false, status: 404, error: "conversation_not_found" });
});

test("malformed message conversation UUID fails closed without querying", async () => {
  let queried = false;
  const result = await readOwnedMessages({
    pool: { async query() { queried = true; } },
    ownerUserId: ownerA,
    conversationId: "not-a-uuid",
  });

  assert.deepEqual(result, { ok: false, status: 400, error: "invalid_conversation" });
  assert.equal(queried, false);
});

test("User A writes a message using the trusted owner and conversation UUID", async () => {
  const { pool, calls } = insertPool({ id: 1, conversation_uuid: conversationA, owner_user_id: ownerA });
  const result = await insertOwnedMessage({
    pool,
    ownerUserId: ownerA,
    conversationId: conversationA,
    userId: ownerB,
    finalText: "A message",
  });

  assert.equal(result.ok, true);
  assert.equal(result.message.owner_user_id, ownerA);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params[0], conversationA);
  assert.equal(calls[0].params[1], ownerA);
});

test("legacy userId cannot change the owner parameter", async () => {
  const { pool, calls } = insertPool({ id: 2, conversation_uuid: conversationA, owner_user_id: ownerA });
  await insertOwnedMessage({
    pool,
    ownerUserId: ownerA,
    conversationId: conversationA,
    userId: ownerB,
    user_id: ownerB,
    finalText: "Still A's message",
  });

  assert.equal(calls[0].params[1], ownerA);
});

test("foreign and nonexistent message writes both perform zero-row inserts", async () => {
  const foreignPool = insertPool(null);
  const missingPool = insertPool(null);
  const foreign = await insertOwnedMessage({ pool: foreignPool.pool, ownerUserId: ownerA, conversationId: conversationB, finalText: "blocked" });
  const missing = await insertOwnedMessage({ pool: missingPool.pool, ownerUserId: ownerA, conversationId: missingConversation, finalText: "blocked" });

  assert.deepEqual(foreign, { ok: false, status: 404, error: "conversation_not_found" });
  assert.deepEqual(missing, foreign);
  assert.equal(foreignPool.calls.length, 1);
  assert.equal(missingPool.calls.length, 1);
});

test("message insert rejects malformed UUID without writing", async () => {
  let queried = false;
  const result = await insertOwnedMessage({
    pool: { async query() { queried = true; } },
    ownerUserId: ownerA,
    conversationId: "not-a-uuid",
    finalText: "blocked",
  });

  assert.deepEqual(result, { ok: false, status: 400, error: "invalid_conversation" });
  assert.equal(queried, false);
});

test("message read and insert fail closed on database failure", async () => {
  const pool = { async query() { throw new Error("database unavailable"); } };
  const read = await readOwnedMessages({ pool, ownerUserId: ownerA, conversationId: conversationA });
  const write = await insertOwnedMessage({ pool, ownerUserId: ownerA, conversationId: conversationA, finalText: "blocked" });

  assert.deepEqual(read, { ok: false, status: 503, error: "conversation_service_unavailable" });
  assert.deepEqual(write, { ok: false, status: 503, error: "conversation_service_unavailable" });
});

test("User A reads User A history successfully", async () => {
  const result = await readOwnedMessages({
    pool: readPool({ [`${conversationA}:${ownerA}`]: [{ id: 3, conversation_uuid: conversationA, final_text: "A history" }] }),
    ownerUserId: ownerA,
    conversationId: conversationA,
  });
  assert.equal(result.ok, true);
  assert.equal(result.messages[0].final_text, "A history");
});

test("User A cannot read User B history", async () => {
  const result = await readOwnedMessages({ pool: readPool({}), ownerUserId: ownerA, conversationId: conversationB });
  assert.deepEqual(result, { ok: false, status: 404, error: "conversation_not_found" });
});

test("User B cannot read User A history", async () => {
  const result = await readOwnedMessages({ pool: readPool({}), ownerUserId: ownerB, conversationId: conversationA });
  assert.deepEqual(result, { ok: false, status: 404, error: "conversation_not_found" });
});

test("foreign and nonexistent history reads have identical neutral results", async () => {
  const pool = readPool({});
  const foreign = await readOwnedMessages({ pool, ownerUserId: ownerA, conversationId: conversationB, limit: 100 });
  const missing = await readOwnedMessages({ pool, ownerUserId: ownerA, conversationId: missingConversation, limit: 100 });
  assert.deepEqual(foreign, missing);
});

test("body userId cannot change the authenticated message owner", async () => {
  const { pool, calls } = insertPool({ id: 4, conversation_uuid: conversationA, owner_user_id: ownerA });
  await insertOwnedMessage({ pool, ownerUserId: ownerA, conversationId: conversationA, userId: ownerB, finalText: "A owns this" });
  assert.equal(calls[0].params[1], ownerA);
});

test("body user_id cannot change the authenticated message owner", async () => {
  const { pool, calls } = insertPool({ id: 5, conversation_uuid: conversationA, owner_user_id: ownerA });
  await insertOwnedMessage({ pool, ownerUserId: ownerA, conversationId: conversationA, user_id: ownerB, finalText: "A still owns this" });
  assert.equal(calls[0].params[1], ownerA);
});

test("legacy conversation_id cannot authorize a message resource", async () => {
  const { pool, calls } = insertPool(null);
  const result = await insertOwnedMessage({ pool, ownerUserId: ownerA, conversationId: "legacy-thread", conversation_id: conversationA, finalText: "blocked" });
  assert.deepEqual(result, { ok: false, status: 400, error: "invalid_conversation" });
  assert.equal(calls.length, 0);
});

test("NULL bridge is not recovered from legacy user_id", async () => {
  const result = await readOwnedMessages({ pool: readPool({ [`${conversationA}:${ownerA}`]: [] }), ownerUserId: ownerA, conversationId: conversationA });
  assert.deepEqual(result, { ok: false, status: 404, error: "conversation_not_found" });
});

test("NULL bridge is not recovered from legacy conversation_id", async () => {
  const result = await readOwnedMessages({ pool: readPool({ [`${conversationA}:${ownerA}`]: [] }), ownerUserId: ownerA, conversationId: conversationA });
  assert.deepEqual(result, { ok: false, status: 404, error: "conversation_not_found" });
});

test("User B cannot write into User A conversation", async () => {
  const { pool, calls } = insertPool(null);
  const result = await insertOwnedMessage({ pool, ownerUserId: ownerB, conversationId: conversationA, finalText: "blocked" });
  assert.deepEqual(result, { ok: false, status: 404, error: "conversation_not_found" });
  assert.equal(calls.length, 1);
});

test("conversation ownership lookup failure for send fails closed", async () => {
  const { getOwnedConversation } = require("../../auth/conversationOwnership.js");
  const result = await getOwnedConversation({
    pool: { async query() { throw new Error("database unavailable"); } },
    ownerUserId: ownerA,
    conversationId: conversationA,
  });
  assert.deepEqual(result, { ok: false, status: 503, error: "conversation_service_unavailable" });
});

test("User A cannot read User B messages", async () => {
  const result = await readOwnedMessages({ pool: readPool({}), ownerUserId: ownerA, conversationId: conversationB });
  assert.deepEqual(result, { ok: false, status: 404, error: "conversation_not_found" });
});

test("User B cannot read User A messages", async () => {
  const result = await readOwnedMessages({ pool: readPool({}), ownerUserId: ownerB, conversationId: conversationA });
  assert.deepEqual(result, { ok: false, status: 404, error: "conversation_not_found" });
});

test("owner-scoped read failure is independently fail closed", async () => {
  const result = await readOwnedMessages({
    pool: { async query() { throw new Error("read unavailable"); } },
    ownerUserId: ownerA,
    conversationId: conversationA,
  });
  assert.deepEqual(result, { ok: false, status: 503, error: "conversation_service_unavailable" });
});