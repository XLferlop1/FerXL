"use strict";

const { spawn } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const PORT = Number(process.env.TWO_USER_TEST_PORT || 3200);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const FAKE_ADMIN_SHIM = path.resolve(ROOT, "tests", "auth", "fake-firebase-admin-sdk.js");
const FAKE_PG_SHIM = path.resolve(ROOT, "tests", "contracts", "fake-pg.js");

const USER_A_ID = "77777777-7777-4777-8777-777777777777";
const USER_B_ID = "88888888-8888-4888-8888-888888888888";
const NONEXISTENT_CONV_ID = "99999999-9999-4999-8999-999999999999";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(maxAttempts = 120) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      const text = await response.text();
      if (response.ok && text.trim() === "healthy") {
        return;
      }
    } catch (error) {
      // Retry until server is up.
    }
    await sleep(250);
  }
  throw new Error("Server did not become healthy in time.");
}

function startServer() {
  const env = {
    ...process.env,
    PORT: String(PORT),
    DATABASE_URL: "postgres://contract-test-only",
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ` : ""}--require ${FAKE_ADMIN_SHIM} --require ${FAKE_PG_SHIM}`,
  };

  const child = spawn("node", ["server.js"], {
    cwd: ROOT,
    env,
    stdio: "ignore",
  });

  return child;
}

async function requestJson(token, route, options = {}) {
  const headers = {
    ...(options.headers || {}),
    ...(options.json !== false ? { "Content-Type": "application/json" } : {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE_URL}${route}`, {
    ...options,
    headers,
    body: options.body != null && typeof options.body !== "string"
      ? JSON.stringify(options.body)
      : options.body,
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }

  return { status: response.status, payload };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function run() {
  const child = startServer();
  const results = [];

  const runCase = async (name, fn) => {
    try {
      await fn();
      results.push({ name, status: "PASS" });
      console.log(`[two-user] PASS ${name}`);
    } catch (error) {
      results.push({ name, status: "FAIL", error: String(error.message || error) });
      console.error(`[two-user] FAIL ${name}: ${error.message}`);
    }
  };

  try {
    await waitForHealth();

    // 13. TOKEN VERIFIER BEHAVIOR
    await runCase("token verifier rejects unknown tokens", async () => {
      const res = await requestJson("UNKNOWN_TOKEN", "/api/conversations");
      assert(res.status === 401, `Expected 401 for unknown token, got ${res.status}`);
      assert(JSON.stringify(res.payload) === JSON.stringify({ error: "unauthorized" }), "Expected unauthorized error");
    });

    let convA1 = null;
    let convB1 = null;
    let convA2 = null;

    // 3. IDENTITY SWITCHING (1. TOKEN_A -> 2. TOKEN_B -> 3. TOKEN_A -> 4. TOKEN_B -> 5. TOKEN_A)
    await runCase("identity switch step 1: TOKEN_A creates conv A1 (owner A)", async () => {
      const res = await requestJson("TOKEN_A", "/api/conversations", {
        method: "POST",
        body: { title: "User A thread 1" },
      });
      assert(res.status === 201, `Expected 201, got ${res.status}`);
      assert(res.payload.conversation.owner_user_id === USER_A_ID, "Expected User A owner ID");
      convA1 = res.payload.conversation.id;
    });

    await runCase("identity switch step 2: TOKEN_B creates conv B1 (owner B)", async () => {
      const res = await requestJson("TOKEN_B", "/api/conversations", {
        method: "POST",
        body: { title: "User B thread 1" },
      });
      assert(res.status === 201, `Expected 201, got ${res.status}`);
      assert(res.payload.conversation.owner_user_id === USER_B_ID, "Expected User B owner ID");
      convB1 = res.payload.conversation.id;
    });

    await runCase("identity switch step 3: TOKEN_A lists conversations (sees only A)", async () => {
      const res = await requestJson("TOKEN_A", "/api/conversations");
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.payload.conversations.every((c) => c.owner_user_id === USER_A_ID), "All listed convs must belong to User A");
      assert(res.payload.conversations.some((c) => c.conversation_id === convA1), "Must include conv A1");
      assert(!res.payload.conversations.some((c) => c.conversation_id === convB1), "Must not include conv B1");
    });

    await runCase("identity switch step 4: TOKEN_B lists conversations (sees only B)", async () => {
      const res = await requestJson("TOKEN_B", "/api/conversations");
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.payload.conversations.every((c) => c.owner_user_id === USER_B_ID), "All listed convs must belong to User B");
      assert(res.payload.conversations.some((c) => c.conversation_id === convB1), "Must include conv B1");
      assert(!res.payload.conversations.some((c) => c.conversation_id === convA1), "Must not include conv A1");
    });

    await runCase("identity switch step 5: TOKEN_A creates conv A2 (owner A, no bleed)", async () => {
      const res = await requestJson("TOKEN_A", "/api/conversations", {
        method: "POST",
        body: { title: "User A thread 2" },
      });
      assert(res.status === 201, `Expected 201, got ${res.status}`);
      assert(res.payload.conversation.owner_user_id === USER_A_ID, "Expected User A owner ID");
      convA2 = res.payload.conversation.id;

      const listRes = await requestJson("TOKEN_A", "/api/conversations");
      assert(listRes.status === 200, `Expected 200, got ${listRes.status}`);
      assert(listRes.payload.conversations.every((c) => c.owner_user_id === USER_A_ID), "All listed convs must belong to User A");
      assert(listRes.payload.conversations.some((c) => c.conversation_id === convA1), "Must include conv A1");
      assert(listRes.payload.conversations.some((c) => c.conversation_id === convA2), "Must include conv A2");
      assert(!listRes.payload.conversations.some((c) => c.conversation_id === convB1), "Must not include conv B1");
    });

    // 4. POSITIVE CONTROLS
    // USER A positive controls
    await runCase("positive control A: message create and read", async () => {
      const postRes = await requestJson("TOKEN_A", "/api/messages", {
        method: "POST",
        body: { conversation_uuid: convA1, finalText: "Hello from User A in conv A1" },
      });
      assert(postRes.status === 200, `Expected 200, got ${postRes.status}`);
      assert(postRes.payload.message.user_id === USER_A_ID, "Expected User A ID on message");

      const readRes = await requestJson("TOKEN_A", `/api/messages?conversation=${encodeURIComponent(convA1)}`);
      assert(readRes.status === 200, `Expected 200, got ${readRes.status}`);
      assert(readRes.payload.messages.length >= 1, "Expected at least 1 message");
      assert(readRes.payload.messages[0].final_text === "Hello from User A in conv A1", "Expected message content match");

      const histRes = await requestJson("TOKEN_A", `/api/history?conversation=${encodeURIComponent(convA1)}`);
      assert(histRes.status === 200, `Expected 200, got ${histRes.status}`);
      assert(histRes.payload.messages.length >= 1, "Expected at least 1 message in history");
    });

    await runCase("positive control A: coach interaction create and read", async () => {
      const postRes = await requestJson("TOKEN_A", "/api/coach-interactions", {
        method: "POST",
        body: { conversationId: convA1, coachQuestionText: "User A coach question" },
      });
      assert(postRes.status === 201, `Expected 201, got ${postRes.status}`);

      const readRes = await requestJson("TOKEN_A", `/api/coach-interactions?conversation=${encodeURIComponent(convA1)}`);
      assert(readRes.status === 200, `Expected 200, got ${readRes.status}`);
      assert(readRes.payload.interactions.some((i) => i.coach_question_text === "User A coach question"), "Expected User A coach interaction");
    });

    await runCase("positive control A: journal entry create and read", async () => {
      const postRes = await requestJson("TOKEN_A", "/api/journal-entries", {
        method: "POST",
        body: { entryText: "User A journal entry", mood: "calm" },
      });
      assert(postRes.status === 201, `Expected 201, got ${postRes.status}`);
      assert(postRes.payload.entry.owner_user_id === USER_A_ID, "Expected User A owner on journal entry");

      const listRes = await requestJson("TOKEN_A", "/api/journal-entries");
      assert(listRes.status === 200, `Expected 200, got ${listRes.status}`);
      assert(listRes.payload.entries.some((e) => e.entry_text === "User A journal entry"), "Expected User A journal entry in list");
    });

    await runCase("positive control A: behavior-feedback, interaction-timeline, pattern-summary", async () => {
      const bfRes = await requestJson("TOKEN_A", `/api/behavior-feedback?conversation=${encodeURIComponent(convA1)}`);
      assert(bfRes.status === 200, `Expected 200 for behavior-feedback, got ${bfRes.status}`);
      assert(bfRes.payload.feedback, "Expected feedback object");

      const itRes = await requestJson("TOKEN_A", `/api/interaction-timeline?conversation=${encodeURIComponent(convA1)}`);
      assert(itRes.status === 200, `Expected 200 for interaction-timeline, got ${itRes.status}`);
      assert(Array.isArray(itRes.payload.timeline), "Expected timeline array");

      const psRes = await requestJson("TOKEN_A", `/api/pattern-summary?conversation=${encodeURIComponent(convA1)}`);
      assert(psRes.status === 200, `Expected 200 for pattern-summary, got ${psRes.status}`);
      assert(psRes.payload.summary, "Expected summary object");
    });

    // USER B positive controls
    await runCase("positive control B: message create and read", async () => {
      const postRes = await requestJson("TOKEN_B", "/api/messages", {
        method: "POST",
        body: { conversation_uuid: convB1, finalText: "Hello from User B in conv B1" },
      });
      assert(postRes.status === 200, `Expected 200, got ${postRes.status}`);
      assert(postRes.payload.message.user_id === USER_B_ID, "Expected User B ID on message");

      const readRes = await requestJson("TOKEN_B", `/api/messages?conversation=${encodeURIComponent(convB1)}`);
      assert(readRes.status === 200, `Expected 200, got ${readRes.status}`);
      assert(readRes.payload.messages.length >= 1, "Expected at least 1 message");
      assert(readRes.payload.messages[0].final_text === "Hello from User B in conv B1", "Expected message content match");

      const histRes = await requestJson("TOKEN_B", `/api/history?conversation=${encodeURIComponent(convB1)}`);
      assert(histRes.status === 200, `Expected 200, got ${histRes.status}`);
      assert(histRes.payload.messages.length >= 1, "Expected at least 1 message in history");
    });

    await runCase("positive control B: coach interaction create and read", async () => {
      const postRes = await requestJson("TOKEN_B", "/api/coach-interactions", {
        method: "POST",
        body: { conversationId: convB1, coachQuestionText: "User B coach question" },
      });
      assert(postRes.status === 201, `Expected 201, got ${postRes.status}`);

      const readRes = await requestJson("TOKEN_B", `/api/coach-interactions?conversation=${encodeURIComponent(convB1)}`);
      assert(readRes.status === 200, `Expected 200, got ${readRes.status}`);
      assert(readRes.payload.interactions.some((i) => i.coach_question_text === "User B coach question"), "Expected User B coach interaction");
    });

    await runCase("positive control B: journal entry create and read", async () => {
      const postRes = await requestJson("TOKEN_B", "/api/journal-entries", {
        method: "POST",
        body: { entryText: "User B journal entry", mood: "hopeful" },
      });
      assert(postRes.status === 201, `Expected 201, got ${postRes.status}`);
      assert(postRes.payload.entry.owner_user_id === USER_B_ID, "Expected User B owner on journal entry");

      const listRes = await requestJson("TOKEN_B", "/api/journal-entries");
      assert(listRes.status === 200, `Expected 200, got ${listRes.status}`);
      assert(listRes.payload.entries.some((e) => e.entry_text === "User B journal entry"), "Expected User B journal entry in list");
    });

    await runCase("positive control B: behavior-feedback, interaction-timeline, pattern-summary", async () => {
      const bfRes = await requestJson("TOKEN_B", `/api/behavior-feedback?conversation=${encodeURIComponent(convB1)}`);
      assert(bfRes.status === 200, `Expected 200 for behavior-feedback, got ${bfRes.status}`);
      assert(bfRes.payload.feedback, "Expected feedback object");

      const itRes = await requestJson("TOKEN_B", `/api/interaction-timeline?conversation=${encodeURIComponent(convB1)}`);
      assert(itRes.status === 200, `Expected 200 for interaction-timeline, got ${itRes.status}`);
      assert(Array.isArray(itRes.payload.timeline), "Expected timeline array");

      const psRes = await requestJson("TOKEN_B", `/api/pattern-summary?conversation=${encodeURIComponent(convB1)}`);
      assert(psRes.status === 200, `Expected 200 for pattern-summary, got ${psRes.status}`);
      assert(psRes.payload.summary, "Expected summary object");
    });

    // 5. USER A -> USER B ATTACK MATRIX (A1 - A10)
    await runCase("attack A1: TOKEN_A read conversation B via /api/history", async () => {
      const res = await requestJson("TOKEN_A", `/api/history?conversation=${encodeURIComponent(convB1)}`);
      assert(res.status === 404, `Expected 404, got ${res.status}`);
      assert(JSON.stringify(res.payload) === JSON.stringify({ error: "conversation_not_found" }), "Expected neutral conversation_not_found");
    });

    await runCase("attack A2: TOKEN_A read messages from conversation B", async () => {
      const res = await requestJson("TOKEN_A", `/api/messages?conversation=${encodeURIComponent(convB1)}`);
      assert(res.status === 404, `Expected 404, got ${res.status}`);
      assert(JSON.stringify(res.payload) === JSON.stringify({ error: "conversation_not_found" }), "Expected neutral conversation_not_found");
    });

    await runCase("attack A3: TOKEN_A create message in conversation B", async () => {
      const res = await requestJson("TOKEN_A", "/api/messages", {
        method: "POST",
        body: { conversation_uuid: convB1, finalText: "ATTACK_A3_UNAUTHORIZED_MESSAGE" },
      });
      assert(res.status === 404, `Expected 404, got ${res.status}`);
      assert(JSON.stringify(res.payload) === JSON.stringify({ error: "conversation_not_found" }), "Expected neutral conversation_not_found");
    });

    await runCase("attack A4: TOKEN_A read coach interactions from conversation B", async () => {
      const res = await requestJson("TOKEN_A", `/api/coach-interactions?conversation=${encodeURIComponent(convB1)}`);
      assert(res.status === 404, `Expected 404, got ${res.status}`);
      assert(JSON.stringify(res.payload) === JSON.stringify({ error: "conversation_not_found" }), "Expected neutral conversation_not_found");
    });

    await runCase("attack A5: TOKEN_A create coach interaction in conversation B", async () => {
      const res = await requestJson("TOKEN_A", "/api/coach-interactions", {
        method: "POST",
        body: { conversationId: convB1, coachQuestionText: "ATTACK_A5_UNAUTHORIZED_COACH" },
      });
      assert(res.status === 404, `Expected 404, got ${res.status}`);
      assert(JSON.stringify(res.payload) === JSON.stringify({ error: "conversation_not_found" }), "Expected neutral conversation_not_found");
    });

    await runCase("attack A6: TOKEN_A request behavior-feedback for conversation B", async () => {
      const res = await requestJson("TOKEN_A", `/api/behavior-feedback?conversation=${encodeURIComponent(convB1)}`);
      assert(res.status === 404, `Expected 404, got ${res.status}`);
      assert(JSON.stringify(res.payload) === JSON.stringify({ error: "conversation_not_found" }), "Expected neutral conversation_not_found");
    });

    await runCase("attack A7: TOKEN_A request interaction-timeline for conversation B", async () => {
      const res = await requestJson("TOKEN_A", `/api/interaction-timeline?conversation=${encodeURIComponent(convB1)}`);
      assert(res.status === 404, `Expected 404, got ${res.status}`);
      assert(JSON.stringify(res.payload) === JSON.stringify({ error: "conversation_not_found" }), "Expected neutral conversation_not_found");
    });

    await runCase("attack A8: TOKEN_A request pattern-summary for conversation B", async () => {
      const res = await requestJson("TOKEN_A", `/api/pattern-summary?conversation=${encodeURIComponent(convB1)}`);
      assert(res.status === 404, `Expected 404, got ${res.status}`);
      assert(JSON.stringify(res.payload) === JSON.stringify({ error: "conversation_not_found" }), "Expected neutral conversation_not_found");
    });

    await runCase("attack A9: TOKEN_A attempt to expose User B journal data", async () => {
      const resAll = await requestJson("TOKEN_A", "/api/journal-entries");
      assert(resAll.status === 200, `Expected 200, got ${resAll.status}`);
      assert(!resAll.payload.entries.some((e) => e.owner_user_id === USER_B_ID), "User A must not see User B entries");
      assert(!resAll.payload.entries.some((e) => e.entry_text === "User B journal entry"), "User A must not see User B content");

      const resFiltered = await requestJson("TOKEN_A", `/api/journal-entries?conversation=${encodeURIComponent(convB1)}`);
      assert(resFiltered.status === 200, `Expected 200, got ${resFiltered.status}`);
      assert(resFiltered.payload.entries.length === 0, "Filtered on foreign conversation must return empty array");
    });

    await runCase("attack A10: TOKEN_A attempt identity spoof fields", async () => {
      // Disallowed fields on conversation creation
      for (const field of ["owner_user_id", "ownerUserId"]) {
        const res = await requestJson("TOKEN_A", "/api/conversations", {
          method: "POST",
          body: { [field]: USER_B_ID, title: "Spoofed owner conv" },
        });
        assert(res.status === 400, `Expected 400 for ${field}, got ${res.status}`);
        assert(JSON.stringify(res.payload) === JSON.stringify({ error: "invalid_conversation_request" }), "Expected invalid_conversation_request");
      }

      // Legacy fields on conversation creation (ignored, owned by A)
      for (const field of ["userId", "user_id"]) {
        const res = await requestJson("TOKEN_A", "/api/conversations", {
          method: "POST",
          body: { [field]: USER_B_ID, title: `Ignored legacy ${field}` },
        });
        assert(res.status === 201, `Expected 201 for ${field}, got ${res.status}`);
        assert(res.payload.conversation.owner_user_id === USER_A_ID, "Must be assigned to User A");
      }

      // Disallowed fields on journal creation
      for (const field of ["owner_user_id", "ownerUserId"]) {
        const res = await requestJson("TOKEN_A", "/api/journal-entries", {
          method: "POST",
          body: { [field]: USER_B_ID, entryText: "Spoofed journal" },
        });
        assert(res.status === 400, `Expected 400 for ${field}, got ${res.status}`);
        assert(JSON.stringify(res.payload) === JSON.stringify({ error: "invalid_journal_request" }), "Expected invalid_journal_request");
      }

      // Legacy fields on journal creation (ignored, owned by A)
      for (const field of ["userId", "user_id"]) {
        const res = await requestJson("TOKEN_A", "/api/journal-entries", {
          method: "POST",
          body: { [field]: USER_B_ID, entryText: `Journal with legacy ${field}` },
        });
        assert(res.status === 201, `Expected 201 for ${field}, got ${res.status}`);
        assert(res.payload.entry.owner_user_id === USER_A_ID, "Must be assigned to User A");
        assert(res.payload.entry.user_id === null, "Legacy user_id must be null");
      }
    });

    // 6. USER B -> USER A ATTACK MATRIX (B1 - B10)
    await runCase("attack B1: TOKEN_B read conversation A via /api/history", async () => {
      const res = await requestJson("TOKEN_B", `/api/history?conversation=${encodeURIComponent(convA1)}`);
      assert(res.status === 404, `Expected 404, got ${res.status}`);
      assert(JSON.stringify(res.payload) === JSON.stringify({ error: "conversation_not_found" }), "Expected neutral conversation_not_found");
    });

    await runCase("attack B2: TOKEN_B read messages from conversation A", async () => {
      const res = await requestJson("TOKEN_B", `/api/messages?conversation=${encodeURIComponent(convA1)}`);
      assert(res.status === 404, `Expected 404, got ${res.status}`);
      assert(JSON.stringify(res.payload) === JSON.stringify({ error: "conversation_not_found" }), "Expected neutral conversation_not_found");
    });

    await runCase("attack B3: TOKEN_B create message in conversation A", async () => {
      const res = await requestJson("TOKEN_B", "/api/messages", {
        method: "POST",
        body: { conversation_uuid: convA1, finalText: "ATTACK_B3_UNAUTHORIZED_MESSAGE" },
      });
      assert(res.status === 404, `Expected 404, got ${res.status}`);
      assert(JSON.stringify(res.payload) === JSON.stringify({ error: "conversation_not_found" }), "Expected neutral conversation_not_found");
    });

    await runCase("attack B4: TOKEN_B read coach interactions from conversation A", async () => {
      const res = await requestJson("TOKEN_B", `/api/coach-interactions?conversation=${encodeURIComponent(convA1)}`);
      assert(res.status === 404, `Expected 404, got ${res.status}`);
      assert(JSON.stringify(res.payload) === JSON.stringify({ error: "conversation_not_found" }), "Expected neutral conversation_not_found");
    });

    await runCase("attack B5: TOKEN_B create coach interaction in conversation A", async () => {
      const res = await requestJson("TOKEN_B", "/api/coach-interactions", {
        method: "POST",
        body: { conversationId: convA1, coachQuestionText: "ATTACK_B5_UNAUTHORIZED_COACH" },
      });
      assert(res.status === 404, `Expected 404, got ${res.status}`);
      assert(JSON.stringify(res.payload) === JSON.stringify({ error: "conversation_not_found" }), "Expected neutral conversation_not_found");
    });

    await runCase("attack B6: TOKEN_B request behavior-feedback for conversation A", async () => {
      const res = await requestJson("TOKEN_B", `/api/behavior-feedback?conversation=${encodeURIComponent(convA1)}`);
      assert(res.status === 404, `Expected 404, got ${res.status}`);
      assert(JSON.stringify(res.payload) === JSON.stringify({ error: "conversation_not_found" }), "Expected neutral conversation_not_found");
    });

    await runCase("attack B7: TOKEN_B request interaction-timeline for conversation A", async () => {
      const res = await requestJson("TOKEN_B", `/api/interaction-timeline?conversation=${encodeURIComponent(convA1)}`);
      assert(res.status === 404, `Expected 404, got ${res.status}`);
      assert(JSON.stringify(res.payload) === JSON.stringify({ error: "conversation_not_found" }), "Expected neutral conversation_not_found");
    });

    await runCase("attack B8: TOKEN_B request pattern-summary for conversation A", async () => {
      const res = await requestJson("TOKEN_B", `/api/pattern-summary?conversation=${encodeURIComponent(convA1)}`);
      assert(res.status === 404, `Expected 404, got ${res.status}`);
      assert(JSON.stringify(res.payload) === JSON.stringify({ error: "conversation_not_found" }), "Expected neutral conversation_not_found");
    });

    await runCase("attack B9: TOKEN_B attempt to expose User A journal data", async () => {
      const resAll = await requestJson("TOKEN_B", "/api/journal-entries");
      assert(resAll.status === 200, `Expected 200, got ${resAll.status}`);
      assert(!resAll.payload.entries.some((e) => e.owner_user_id === USER_A_ID), "User B must not see User A entries");
      assert(!resAll.payload.entries.some((e) => e.entry_text === "User A journal entry"), "User B must not see User A content");

      const resFiltered = await requestJson("TOKEN_B", `/api/journal-entries?conversation=${encodeURIComponent(convA1)}`);
      assert(resFiltered.status === 200, `Expected 200, got ${resFiltered.status}`);
      assert(resFiltered.payload.entries.length === 0, "Filtered on foreign conversation must return empty array");
    });

    await runCase("attack B10: TOKEN_B attempt identity spoof fields", async () => {
      // Disallowed fields on conversation creation
      for (const field of ["owner_user_id", "ownerUserId"]) {
        const res = await requestJson("TOKEN_B", "/api/conversations", {
          method: "POST",
          body: { [field]: USER_A_ID, title: "Spoofed owner conv by B" },
        });
        assert(res.status === 400, `Expected 400 for ${field}, got ${res.status}`);
        assert(JSON.stringify(res.payload) === JSON.stringify({ error: "invalid_conversation_request" }), "Expected invalid_conversation_request");
      }

      // Legacy fields on conversation creation (ignored, owned by B)
      for (const field of ["userId", "user_id"]) {
        const res = await requestJson("TOKEN_B", "/api/conversations", {
          method: "POST",
          body: { [field]: USER_A_ID, title: `Ignored legacy ${field} by B` },
        });
        assert(res.status === 201, `Expected 201 for ${field}, got ${res.status}`);
        assert(res.payload.conversation.owner_user_id === USER_B_ID, "Must be assigned to User B");
      }

      // Disallowed fields on journal creation
      for (const field of ["owner_user_id", "ownerUserId"]) {
        const res = await requestJson("TOKEN_B", "/api/journal-entries", {
          method: "POST",
          body: { [field]: USER_A_ID, entryText: "Spoofed journal by B" },
        });
        assert(res.status === 400, `Expected 400 for ${field}, got ${res.status}`);
        assert(JSON.stringify(res.payload) === JSON.stringify({ error: "invalid_journal_request" }), "Expected invalid_journal_request");
      }

      // Legacy fields on journal creation (ignored, owned by B)
      for (const field of ["userId", "user_id"]) {
        const res = await requestJson("TOKEN_B", "/api/journal-entries", {
          method: "POST",
          body: { [field]: USER_A_ID, entryText: `Journal with legacy ${field} by B` },
        });
        assert(res.status === 201, `Expected 201 for ${field}, got ${res.status}`);
        assert(res.payload.entry.owner_user_id === USER_B_ID, "Must be assigned to User B");
        assert(res.payload.entry.user_id === null, "Legacy user_id must be null");
      }
    });

    // 7. MESSAGE WRITE NON-PERSISTENCE PROOF (Re-read verification)
    await runCase("message write non-persistence: unauthorized A->B write is not in B's messages", async () => {
      const res = await requestJson("TOKEN_B", `/api/messages?conversation=${encodeURIComponent(convB1)}`);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const leaked = res.payload.messages.some((m) => m.final_text === "ATTACK_A3_UNAUTHORIZED_MESSAGE");
      assert(!leaked, "Unauthorized A->B message must not be persisted in B's conversation");
    });

    await runCase("message write non-persistence: unauthorized B->A write is not in A's messages", async () => {
      const res = await requestJson("TOKEN_A", `/api/messages?conversation=${encodeURIComponent(convA1)}`);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const leaked = res.payload.messages.some((m) => m.final_text === "ATTACK_B3_UNAUTHORIZED_MESSAGE");
      assert(!leaked, "Unauthorized B->A message must not be persisted in A's conversation");
    });

    // 8. COACH WRITE NON-PERSISTENCE PROOF (Re-read verification)
    await runCase("coach write non-persistence: unauthorized A->B coach interaction is not in B's coach list", async () => {
      const res = await requestJson("TOKEN_B", `/api/coach-interactions?conversation=${encodeURIComponent(convB1)}`);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const leaked = res.payload.interactions.some((i) => i.coach_question_text === "ATTACK_A5_UNAUTHORIZED_COACH");
      assert(!leaked, "Unauthorized A->B coach interaction must not be persisted in B's coach list");
    });

    await runCase("coach write non-persistence: unauthorized B->A coach interaction is not in A's coach list", async () => {
      const res = await requestJson("TOKEN_A", `/api/coach-interactions?conversation=${encodeURIComponent(convA1)}`);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      const leaked = res.payload.interactions.some((i) => i.coach_question_text === "ATTACK_B5_UNAUTHORIZED_COACH");
      assert(!leaked, "Unauthorized B->A coach interaction must not be persisted in A's coach list");
    });

    // 11. ENUMERATION RESISTANCE (Foreign valid UUID vs Nonexistent valid UUID)
    const conversationEndpoints = [
      { name: "messages read", method: "GET", route: (id) => `/api/messages?conversation=${encodeURIComponent(id)}` },
      { name: "history read", method: "GET", route: (id) => `/api/history?conversation=${encodeURIComponent(id)}` },
      { name: "coach list", method: "GET", route: (id) => `/api/coach-interactions?conversation=${encodeURIComponent(id)}` },
      { name: "behavior feedback", method: "GET", route: (id) => `/api/behavior-feedback?conversation=${encodeURIComponent(id)}` },
      { name: "interaction timeline", method: "GET", route: (id) => `/api/interaction-timeline?conversation=${encodeURIComponent(id)}` },
      { name: "pattern summary", method: "GET", route: (id) => `/api/pattern-summary?conversation=${encodeURIComponent(id)}` },
      {
        name: "message post",
        method: "POST",
        route: () => "/api/messages",
        body: (id) => ({ conversation_uuid: id, finalText: "Enum test" }),
      },
      {
        name: "coach post",
        method: "POST",
        route: () => "/api/coach-interactions",
        body: (id) => ({ conversationId: id, coachQuestionText: "Enum test" }),
      },
      {
        name: "send post",
        method: "POST",
        route: () => "/api/send",
        body: (id) => ({ conversation_uuid: id, finalText: "Enum test" }),
      },
    ];

    for (const ep of conversationEndpoints) {
      await runCase(`enumeration resistance on ${ep.name}: foreign vs nonexistent produce identical 404`, async () => {
        const foreignRes = await requestJson("TOKEN_A", ep.route(convB1), {
          method: ep.method,
          body: ep.body ? ep.body(convB1) : undefined,
        });

        const missingRes = await requestJson("TOKEN_A", ep.route(NONEXISTENT_CONV_ID), {
          method: ep.method,
          body: ep.body ? ep.body(NONEXISTENT_CONV_ID) : undefined,
        });

        assert(foreignRes.status === 404, `Foreign expected 404, got ${foreignRes.status}`);
        assert(missingRes.status === 404, `Missing expected 404, got ${missingRes.status}`);
        assert(
          JSON.stringify(foreignRes.payload) === JSON.stringify(missingRes.payload),
          `Payloads must be identical. Foreign: ${JSON.stringify(foreignRes.payload)}, Missing: ${JSON.stringify(missingRes.payload)}`
        );
        assert(
          JSON.stringify(foreignRes.payload) === JSON.stringify({ error: "conversation_not_found" }),
          `Expected conversation_not_found error, got ${JSON.stringify(foreignRes.payload)}`
        );
      });
    }

  } finally {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }

  const failed = results.filter((r) => r.status === "FAIL");
  const passed = results.filter((r) => r.status === "PASS");

  console.log("\n[two-user] Summary");
  console.log(`Total: ${results.length} | Passed: ${passed.length} | Failed: ${failed.length}`);
  results.forEach((r) => {
    const details = r.error ? ` :: ${r.error}` : "";
    console.log(`- ${r.status} ${r.name}${details}`);
  });

  if (failed.length > 0) {
    process.exitCode = 1;
    return;
  }

  console.log("[two-user] PASS all two-user adversarial isolation assertions completed successfully.");
}

run().catch((error) => {
  console.error("[two-user] Fatal error:", error);
  process.exit(1);
});
