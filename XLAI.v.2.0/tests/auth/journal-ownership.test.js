"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createOwnedJournalEntry,
  listOwnedJournalEntries,
} = require("../../auth/journalOwnership.js");

const ownerA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ownerB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function createPool(row, calls = []) {
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      assert.match(sql, /owner_user_id/i);
      assert.match(sql, /journal_entries/i);
      return { rows: row ? [row] : [] };
    },
  };
}

function listPool(rows, calls = []) {
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      assert.match(sql, /WHERE owner_user_id = \$1/i);
      assert.match(sql, /conversation_id = \$2/i);
      return { rows };
    },
  };
}

function entry(ownerUserId, conversationId = "context-a", id = 1) {
  return {
    id,
    owner_user_id: ownerUserId,
    conversation_id: conversationId,
    user_id: null,
    entry_text: "Private reflection",
    retain_until_timestamp: "2026-09-20T00:00:00.000Z",
    created_at_timestamp: "2026-09-12T00:00:00.000Z",
  };
}

test("User A creates a journal entry owned by User A", async () => {
  const result = await createOwnedJournalEntry({
    pool: createPool(entry(ownerA)),
    ownerUserId: ownerA,
    entryText: "Private reflection",
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, 201);
  assert.equal(result.entry.owner_user_id, ownerA);
});

test("User B creates a journal entry owned by User B", async () => {
  const result = await createOwnedJournalEntry({
    pool: createPool(entry(ownerB)),
    ownerUserId: ownerB,
    entryText: "Private reflection",
  });
  assert.equal(result.entry.owner_user_id, ownerB);
});

test("body userId cannot force User B ownership", async () => {
  const calls = [];
  const result = await createOwnedJournalEntry({ pool: createPool(entry(ownerA), calls), ownerUserId: ownerA, userId: ownerB, entryText: "A entry" });
  assert.equal(result.entry.owner_user_id, ownerA);
  assert.equal(calls[0].params[0], ownerA);
});

test("body user_id cannot force User B ownership", async () => {
  const calls = [];
  const result = await createOwnedJournalEntry({ pool: createPool(entry(ownerA), calls), ownerUserId: ownerA, user_id: ownerB, entryText: "A entry" });
  assert.equal(result.entry.owner_user_id, ownerA);
  assert.equal(calls[0].params[0], ownerA);
});

test("client owner_user_id is not accepted by the trusted helper contract", async () => {
  const result = await createOwnedJournalEntry({ pool: createPool(entry(ownerA)), ownerUserId: ownerA, owner_user_id: ownerB, entryText: "A entry" });
  assert.equal(result.entry.owner_user_id, ownerA);
});

test("client ownerUserId is not accepted by the trusted helper contract", async () => {
  const result = await createOwnedJournalEntry({ pool: createPool(entry(ownerA)), ownerUserId: ownerA, ownerUserId: ownerA, entryText: "A entry" });
  assert.equal(result.entry.owner_user_id, ownerA);
});

test("User A lists only User A entries", async () => {
  const result = await listOwnedJournalEntries({ pool: listPool([entry(ownerA)]), ownerUserId: ownerA });
  assert.equal(result.ok, true);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].owner_user_id, ownerA);
});

test("User B lists only User B entries", async () => {
  const result = await listOwnedJournalEntries({ pool: listPool([entry(ownerB)]), ownerUserId: ownerB });
  assert.equal(result.entries[0].owner_user_id, ownerB);
});

test("User A conversation filter narrows User A rows", async () => {
  const calls = [];
  const result = await listOwnedJournalEntries({ pool: listPool([entry(ownerA, "context-a")], calls), ownerUserId: ownerA, conversationId: "context-a" });
  assert.equal(result.entries.length, 1);
  assert.equal(calls[0].params[0], ownerA);
  assert.equal(calls[0].params[1], "context-a");
});

test("conversation filter cannot expose User B rows", async () => {
  const result = await listOwnedJournalEntries({ pool: listPool([]), ownerUserId: ownerA, conversationId: "context-b" });
  assert.deepEqual(result.entries, []);
});

test("NULL-owner rows are excluded from the list result", async () => {
  const result = await listOwnedJournalEntries({ pool: listPool([]), ownerUserId: ownerA });
  assert.equal(result.entries.length, 0);
});

test("NULL-owner row matching legacy user_id remains excluded", async () => {
  const result = await listOwnedJournalEntries({ pool: listPool([]), ownerUserId: ownerA, conversationId: "legacy-user-a" });
  assert.equal(result.entries.length, 0);
});

test("NULL-owner row matching legacy conversation_id remains excluded", async () => {
  const result = await listOwnedJournalEntries({ pool: listPool([]), ownerUserId: ownerA, conversationId: "legacy-conversation-a" });
  assert.equal(result.entries.length, 0);
});

test("legacy userId cannot broaden list scope", async () => {
  const calls = [];
  const result = await listOwnedJournalEntries({ pool: listPool([entry(ownerA)], calls), ownerUserId: ownerA, userId: ownerB });
  assert.equal(result.entries[0].owner_user_id, ownerA);
  assert.equal(calls[0].params[0], ownerA);
});

test("legacy user_id cannot broaden list scope", async () => {
  const calls = [];
  const result = await listOwnedJournalEntries({ pool: listPool([entry(ownerA)], calls), ownerUserId: ownerA, user_id: ownerB });
  assert.equal(result.entries[0].owner_user_id, ownerA);
  assert.equal(calls[0].params[0], ownerA);
});

test("empty owned list succeeds with an empty result", async () => {
  const result = await listOwnedJournalEntries({ pool: listPool([]), ownerUserId: ownerA });
  assert.deepEqual(result, { ok: true, status: 200, entries: [] });
});

test("owner-scoped database read failure fails closed", async () => {
  const result = await listOwnedJournalEntries({
    pool: { async query() { throw new Error("read unavailable"); } },
    ownerUserId: ownerA,
  });
  assert.deepEqual(result, { ok: false, status: 503, error: "journal_service_unavailable" });
});

test("owner-scoped database create failure fails closed", async () => {
  const result = await createOwnedJournalEntry({
    pool: { async query() { throw new Error("write unavailable"); } },
    ownerUserId: ownerA,
    entryText: "A entry",
  });
  assert.deepEqual(result, { ok: false, status: 503, error: "journal_service_unavailable" });
});

test("creation stores authenticated owner despite conflicting legacy identities", async () => {
  const calls = [];
  const result = await createOwnedJournalEntry({
    pool: createPool(entry(ownerA), calls),
    ownerUserId: ownerA,
    userId: ownerB,
    user_id: ownerB,
    conversationId: "context-b",
    entryText: "A entry",
  });
  assert.equal(result.entry.owner_user_id, ownerA);
  assert.equal(calls[0].params[0], ownerA);
  assert.equal(calls[0].params[2], "A entry");
});

test("retention metadata applies to the newly created owned row", async () => {
  const calls = [];
  const result = await createOwnedJournalEntry({
    pool: createPool(entry(ownerA), calls),
    ownerUserId: ownerA,
    entryText: "Retained entry",
    retainUntilTimestamp: "2026-10-01T00:00:00.000Z",
  });
  assert.equal(result.entry.owner_user_id, ownerA);
  assert.equal(calls[0].params[3], "2026-10-01T00:00:00.000Z");
});
