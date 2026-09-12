"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createOwnedConversation,
  listOwnedConversations,
  getOwnedConversation,
} = require("../../auth/conversationOwnership.js");

test("active user creates a conversation owned by the server-authenticated user", async () => {
  const ownerUserId = "11111111-1111-4111-8111-111111111111";
  const generatedId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return {
        rows: [{
          id: params[0],
          owner_user_id: params[1],
          title: params[2],
          created_at: "2026-09-12T00:00:00.000Z",
        }],
      };
    },
  };

  const result = await createOwnedConversation({
    pool,
    ownerUserId,
    title: "Daily check-in",
    generateId: () => generatedId,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 201);
  assert.equal(result.conversation.id, generatedId);
  assert.equal(result.conversation.owner_user_id, ownerUserId);
  assert.equal(result.conversation.title, "Daily check-in");
  assert.equal(calls[0].params[0], generatedId);
  assert.equal(calls[0].params[1], ownerUserId);
  assert.equal(calls[0].params[2], "Daily check-in");
});

test("helper rejects client-supplied resource and persisted owner identifiers", async () => {
  const ownerUserId = "22222222-2222-4222-8222-222222222222";
  const rejectedFields = [
    { id: "11111111-1111-4111-8111-111111111111" },
    { conversationId: "22222222-2222-4222-8222-222222222222" },
    { conversation_id: "33333333-3333-4333-8333-333333333333" },
    { conversation_uuid: "44444444-4444-4444-8444-444444444444" },
    { owner_user_id: "55555555-5555-4555-8555-555555555555" },
    { clientOwnerUserId: "99999999-9999-4999-8999-999999999999" },
    { clientConversationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
  ];

  for (const payload of rejectedFields) {
    const result = await createOwnedConversation({
      pool: { async query() { throw new Error("must not query"); } },
      ownerUserId,
      title: "safe title",
      ...payload,
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.equal(result.error, "invalid_conversation_request");
  }
});

test("legacy client userId/user_id cannot alter the server-owned owner", async () => {
  const ownerUserId = "77777777-7777-4777-8777-777777777777";
  const generatedId = "88888888-8888-4888-8888-888888888888";
  const pool = {
    async query(sql, params) {
      return {
        rows: [{ id: params[0], owner_user_id: params[1], title: params[2], created_at: "2026-09-12T00:00:00.000Z" }],
      };
    },
  };

  const result = await createOwnedConversation({
    pool,
    ownerUserId,
    title: "transitional title",
    generateId: () => generatedId,
    userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    user_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  });

  assert.equal(result.ok, true);
  assert.equal(result.conversation.owner_user_id, ownerUserId);
  assert.equal(result.conversation.id, generatedId);
  assert.equal(result.conversation.owner_user_id !== "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", true);
  assert.equal(result.conversation.owner_user_id !== "cccccccc-cccc-4ccc-8ccc-cccccccccccc", true);
});

test("listing conversations is scoped to the authenticated owner only", async () => {
  const ownerUserId = "33333333-3333-4333-8333-333333333333";
  const pool = {
    async query(sql, params) {
      assert.equal(params[0], ownerUserId);
      return {
        rows: [
          {
            id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            owner_user_id: ownerUserId,
            title: "Owned thread",
            created_at: "2026-09-12T00:00:00.000Z",
          },
        ],
      };
    },
  };

  const result = await listOwnedConversations({ pool, ownerUserId });
  assert.equal(result.ok, true);
  assert.equal(result.conversations.length, 1);
  assert.equal(result.conversations[0].conversation_id, "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
  assert.equal(result.conversations[0].display_name, "Owned thread");
});

test("getOwnedConversation returns only the authenticated user’s conversation", async () => {
  const ownerUserId = "44444444-4444-4444-8444-444444444444";
  const pool = {
    async query(sql, params) {
      assert.equal(params[0], "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
      assert.equal(params[1], ownerUserId);
      return {
        rows: [{
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          owner_user_id: ownerUserId,
          title: "my conversation",
          created_at: "2026-09-12T00:00:00.000Z",
        }],
      };
    },
  };

  const result = await getOwnedConversation({
    pool,
    ownerUserId,
    conversationId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  });

  assert.equal(result.ok, true);
  assert.equal(result.conversation.id, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
  assert.equal(result.conversation.owner_user_id, ownerUserId);
});

test("foreign and unknown conversations resolve to the same neutral not-found result", async () => {
  const ownerUserId = "55555555-5555-4555-8555-555555555555";
  const pool = {
    async query() {
      return { rows: [] };
    },
  };

  const missing = await getOwnedConversation({ pool, ownerUserId, conversationId: "ffffffff-ffff-4fff-8fff-ffffffffffff" });
  const foreign = await getOwnedConversation({ pool, ownerUserId, conversationId: "00000000-0000-4000-8000-000000000000" });

  assert.equal(missing.ok, false);
  assert.equal(foreign.ok, false);
  assert.equal(missing.status, 404);
  assert.equal(foreign.status, 404);
  assert.equal(missing.error, "conversation_not_found");
  assert.equal(foreign.error, "conversation_not_found");
});

test("two-user isolation and anti-enumeration remain strict", async () => {
  const ownerA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const ownerB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const conversationA = "11111111-1111-4111-8111-111111111111";
  const conversationB = "22222222-2222-4222-8222-222222222222";
  const randomUuid = "33333333-3333-4333-8333-333333333333";

  const poolA = {
    async query(sql, params) {
      if (sql.includes("WHERE owner_user_id = $1")) {
        return { rows: [{ id: conversationA, owner_user_id: ownerA, title: "A thread", created_at: "2026-09-12T00:00:00.000Z" }] };
      }
      if (sql.includes("WHERE id = $1 AND owner_user_id = $2")) {
        if (params[0] === conversationA && params[1] === ownerA) {
          return { rows: [{ id: conversationA, owner_user_id: ownerA, title: "A thread", created_at: "2026-09-12T00:00:00.000Z" }] };
        }
        return { rows: [] };
      }
      return { rows: [] };
    },
  };

  const poolB = {
    async query(sql, params) {
      if (sql.includes("WHERE owner_user_id = $1")) {
        return { rows: [{ id: conversationB, owner_user_id: ownerB, title: "B thread", created_at: "2026-09-12T00:00:00.000Z" }] };
      }
      if (sql.includes("WHERE id = $1 AND owner_user_id = $2")) {
        if (params[0] === conversationB && params[1] === ownerB) {
          return { rows: [{ id: conversationB, owner_user_id: ownerB, title: "B thread", created_at: "2026-09-12T00:00:00.000Z" }] };
        }
        return { rows: [] };
      }
      return { rows: [] };
    },
  };

  const aList = await listOwnedConversations({ pool: poolA, ownerUserId: ownerA });
  const bList = await listOwnedConversations({ pool: poolB, ownerUserId: ownerB });
  const aSeesB = await getOwnedConversation({ pool: poolA, ownerUserId: ownerA, conversationId: conversationB });
  const bSeesA = await getOwnedConversation({ pool: poolB, ownerUserId: ownerB, conversationId: conversationA });
  const aMissing = await getOwnedConversation({ pool: poolA, ownerUserId: ownerA, conversationId: randomUuid });

  assert.equal(aList.ok, true);
  assert.equal(aList.conversations.length, 1);
  assert.equal(aList.conversations[0].conversation_id, conversationA);
  assert.equal(bList.ok, true);
  assert.equal(bList.conversations.length, 1);
  assert.equal(bList.conversations[0].conversation_id, conversationB);
  assert.equal(aSeesB.ok, false);
  assert.equal(aSeesB.status, 404);
  assert.equal(bSeesA.ok, false);
  assert.equal(bSeesA.status, 404);
  assert.equal(aMissing.ok, false);
  assert.equal(aMissing.status, 404);
  assert.equal(aMissing.error, "conversation_not_found");
});

test("malformed UUID and database failures fail closed", async () => {
  const ownerUserId = "66666666-6666-4666-8666-666666666666";

  const invalid = await getOwnedConversation({
    pool: { async query() { throw new Error("must not query"); } },
    ownerUserId,
    conversationId: "not-a-uuid",
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.status, 400);
  assert.equal(invalid.error, "invalid_conversation");

  const outage = await listOwnedConversations({
    pool: { async query() { throw new Error("db outage"); } },
    ownerUserId,
  });
  assert.equal(outage.ok, false);
  assert.equal(outage.status, 503);
  assert.equal(outage.error, "conversation_service_unavailable");
});
