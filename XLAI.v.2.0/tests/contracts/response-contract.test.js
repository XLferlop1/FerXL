"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  validateAnalyzeIntensityResponse,
  validateRephraseResponse,
  validateSendResponse,
  validateSafetyBlockedResponse,
} = require("../../engine/responseContracts");
const { buildContextEnvelope } = require("../../engine/contextRouter");
const {
  SAFETY_POLICY_VERSION,
  SAFETY_CATEGORIES,
  getSafetyCategory,
  listSafetyCategories,
  validateSafetyKnowledgeBase,
} = require("../../engine/safetyKnowledgeBase");
const {
  DECISION_VERSION,
  buildSafetyDecision,
  validateSafetyDecision,
  getDecisionPolicyForContext,
} = require("../../engine/safetyDecisionEngine");
const { buildSafetyDecisionSafe } = require("../../engine/safetyDecisionRuntime");

const PORT = Number(process.env.CONTRACT_TEST_PORT || 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ROOT = path.resolve(__dirname, "..", "..");
const FAKE_ADMIN_SHIM = path.resolve(ROOT, "tests", "auth", "fake-firebase-admin-sdk.js");
const FAKE_PG_SHIM = path.resolve(ROOT, "tests", "contracts", "fake-pg.js");
const TEST_AUTH_HEADERS = { Authorization: "Bearer contract-test-token" };
const FAKE_PG_TRACE_FILE = path.join(os.tmpdir(), `xlai-contract-pg-${process.pid}.jsonl`);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(baseUrl = BASE_URL, maxAttempts = 80) {
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      const text = await res.text();
      if (res.ok && text.trim() === "healthy") {
        return;
      }
    } catch (error) {
      // Retry until server is up.
    }
    await sleep(250);
  }
  throw new Error("Server did not become healthy in time.");
}

function startServer(port = PORT, options = {}) {
  const env = {
    ...process.env,
    PORT: String(port),
    DATABASE_URL: "postgres://contract-test-only",
    FAKE_PG_TRACE_FILE,
    ...(options.journalDbFailure ? { FAKE_PG_JOURNAL_FAILURE: "1" } : {}),
    ...(options.coachDbFailure ? { FAKE_PG_COACH_FAILURE: "1" } : {}),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ` : ""}--require ${FAKE_ADMIN_SHIM} --require ${FAKE_PG_SHIM}`,
  };

  const child = spawn("node", ["server.js"], {
    cwd: ROOT,
    env,
    stdio: "ignore",
  });

  return child;
}

async function requestJournalDbFailure() {
  const port = PORT + 1;
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = startServer(port, { journalDbFailure: true });
  try {
    await waitForHealth(baseUrl);
    const responses = await Promise.all([
      fetch(`${baseUrl}/api/journal-entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...TEST_AUTH_HEADERS },
        body: JSON.stringify({ entryText: "Database failure" }),
      }),
      fetch(`${baseUrl}/api/journal-entries`, { headers: TEST_AUTH_HEADERS }),
    ]);
    return Promise.all(responses.map(async (response) => ({
      status: response.status,
      payload: await response.json(),
    })));
  } finally {
    if (!child.killed) child.kill("SIGTERM");
  }
}

async function requestCoachDbFailure() {
  const port = PORT + 2;
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = startServer(port, { coachDbFailure: true });
  try {
    await waitForHealth(baseUrl);
    const response = await fetch(`${baseUrl}/api/coach-interactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...TEST_AUTH_HEADERS },
      body: JSON.stringify({ conversationId: "11111111-1111-4111-8111-111111111111", coachQuestionText: "Database failure" }),
    });
    return { status: response.status, payload: await response.json() };
  } finally {
    if (!child.killed) child.kill("SIGTERM");
  }
}

async function postJson(route, body, headers = {}, options = {}) {
  const requestHeaders = {
    "Content-Type": "application/json",
    ...TEST_AUTH_HEADERS,
    ...headers,
  };
  if (options.authenticated === false) {
    delete requestHeaders.Authorization;
  }

  const res = await fetch(`${BASE_URL}${route}`, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(body),
  });

  let payload = null;
  try {
    payload = await res.json();
  } catch (error) {
    payload = null;
  }

  return { status: res.status, payload };
}

function conversationInsertCount() {
  if (!fs.existsSync(FAKE_PG_TRACE_FILE)) return 0;
  return fs.readFileSync(FAKE_PG_TRACE_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((event) => event.type === "conversation_insert").length;
}

function messageInsertCount() {
  if (!fs.existsSync(FAKE_PG_TRACE_FILE)) return 0;
  return fs.readFileSync(FAKE_PG_TRACE_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((event) => event.type === "message_insert").length;
}

function journalInsertCount() {
  if (!fs.existsSync(FAKE_PG_TRACE_FILE)) return 0;
  return fs.readFileSync(FAKE_PG_TRACE_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((event) => event.type === "journal_insert").length;
}

function coachInsertCount() {
  if (!fs.existsSync(FAKE_PG_TRACE_FILE)) return 0;
  return fs.readFileSync(FAKE_PG_TRACE_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((event) => event.type === "coach_insert").length;
}

async function getJson(route) {
  const res = await fetch(`${BASE_URL}${route}`, { headers: TEST_AUTH_HEADERS });
  let payload = null;
  try {
    payload = await res.json();
  } catch (error) {
    payload = null;
  }
  return { status: res.status, payload };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function ensureValid(name, result) {
  if (!result.ok) {
    throw new Error(`${name} contract errors:\n- ${result.errors.join("\n- ")}`);
  }
}

async function run() {
  const server = startServer();
  const results = [];

  const runCase = async (name, fn) => {
    try {
      await fn();
      results.push({ name, status: "PASS" });
      console.log(`[contracts] PASS ${name}`);
    } catch (error) {
      results.push({ name, status: "FAIL", error: String(error.message || error) });
      console.error(`[contracts] FAIL ${name}: ${error.message}`);
    }
  };

  try {
    fs.rmSync(FAKE_PG_TRACE_FILE, { force: true });
    await waitForHealth();

    let ownedConversationId = null;
    let coachConversationId = null;

    await runCase("coach creation assigns canonical owned conversation", async () => {
      const before = coachInsertCount();
      const result = await postJson("/api/coach-interactions", {
        conversationId: "not-a-uuid",
        coachQuestionText: "This should be rejected",
      });
      assert(result.status === 400, `Expected malformed coach UUID 400 but got ${result.status}`);
      assert(coachInsertCount() === before, "Malformed coach request must not insert");
    });

    await runCase("journal creation assigns the authenticated owner", async () => {
      const before = journalInsertCount();
      const result = await postJson("/api/journal-entries", {
        conversationId: "journal-context-a",
        userId: "client-user-b",
        entryText: "Private journal entry",
        mood: "calm",
      });

      assert(result.status === 201, `Expected 201 but got ${result.status}`);
      assert(result.payload && result.payload.ok === true, "Expected successful journal creation");
      assert(result.payload.entry.owner_user_id === "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "Expected authenticated owner");
      assert(result.payload.entry.user_id === null, "Expected legacy user_id to remain null");
      assert(journalInsertCount() === before + 1, "Expected one journal insert");
    });

    await runCase("coach creation succeeds for owned canonical conversation", async () => {
      const conversation = await postJson("/api/conversations", { title: "Coach contract conversation" });
      assert(conversation.status === 201, `Expected conversation 201 but got ${conversation.status}`);
      coachConversationId = conversation.payload.conversation.id;
      const result = await postJson("/api/coach-interactions", {
        conversationId: coachConversationId,
        coachQuestionText: "How can I say this clearly?",
        coachResponseText: "Try a direct request.",
      });

      assert(result.status === 201, `Expected coach 201 but got ${result.status}`);
      assert(result.payload && result.payload.ok === true, "Expected successful coach creation");
      assert(coachInsertCount() >= 1, "Expected coach insert trace");
    });

    await runCase("coach creation ignores client userId identity", async () => {
      const result = await postJson("/api/coach-interactions", {
        conversationId: coachConversationId,
        userId: "client-user-b",
        coachQuestionText: "Question with client userId",
      });

      assert(result.status === 201, `Expected coach 201 but got ${result.status}`);
      assert(result.payload && result.payload.ok === true, "Expected successful coach creation");

      const listRes = await getJson(`/api/coach-interactions?conversation=${encodeURIComponent(coachConversationId)}`);
      assert(listRes.status === 200, `Expected coach list 200 but got ${listRes.status}`);
      const created = listRes.payload.interactions.find((item) => item.coach_question_text === "Question with client userId");
      assert(created, "Expected created interaction in list");
      assert(created.user_id === null, "Expected user_id to remain null");
      assert(created.conversation_uuid === coachConversationId, "Expected canonical owned conversation UUID");
    });

    await runCase("coach creation ignores client user_id identity", async () => {
      const result = await postJson("/api/coach-interactions", {
        conversationId: coachConversationId,
        user_id: "client-user-b",
        coachQuestionText: "Question with client user_id",
      });

      assert(result.status === 201, `Expected coach 201 but got ${result.status}`);
      assert(result.payload && result.payload.ok === true, "Expected successful coach creation");

      const listRes = await getJson(`/api/coach-interactions?conversation=${encodeURIComponent(coachConversationId)}`);
      assert(listRes.status === 200, `Expected coach list 200 but got ${listRes.status}`);
      const created = listRes.payload.interactions.find((item) => item.coach_question_text === "Question with client user_id");
      assert(created, "Expected created interaction in list");
      assert(created.user_id === null, "Expected user_id to remain null");
      assert(created.conversation_uuid === coachConversationId, "Expected canonical owned conversation UUID");
    });

    await runCase("coach list succeeds for owned conversation", async () => {
      const result = await getJson(`/api/coach-interactions?conversation=${encodeURIComponent(coachConversationId || "not-a-uuid")}`);
      assert(result.status === 200, `Expected coach list 200 but got ${result.status}`);
      assert(result.payload && result.payload.ok === true, "Expected coach list response");
      assert(result.payload.interactions.length >= 1, "Expected owned coach interaction");
      assert(result.payload.interactions[0].conversation_uuid === coachConversationId, "Expected canonical owned conversation UUID");
      assert(result.payload.interactions[0].user_id === null, "Expected user_id to be null on new writes");
    });

    await runCase("coach list succeeds for owned conversation with zero interactions", async () => {
      const emptyConv = await postJson("/api/conversations", { title: "Empty coach conversation" });
      assert(emptyConv.status === 201, `Expected 201 but got ${emptyConv.status}`);
      const emptyId = emptyConv.payload.conversation.id;

      const result = await getJson(`/api/coach-interactions?conversation=${encodeURIComponent(emptyId)}`);
      assert(result.status === 200, `Expected coach list 200 but got ${result.status}`);
      assert(result.payload && result.payload.ok === true, "Expected coach list response");
      assert(Array.isArray(result.payload.interactions) && result.payload.interactions.length === 0, "Expected empty interactions array");
    });

    await runCase("coach list excludes foreign coach fixtures", async () => {
      const result = await getJson(`/api/coach-interactions?conversation=${encodeURIComponent(coachConversationId)}`);
      assert(result.status === 200, `Expected coach list 200 but got ${result.status}`);
      const foreignFound = result.payload.interactions.some((item) => item.id === 998 || item.coach_question_text === "Foreign coach question");
      assert(!foreignFound, "Expected foreign coach fixture to be excluded");
    });

    await runCase("coach list excludes NULL-bridge coach fixtures", async () => {
      const nullBridgeConv = await postJson("/api/conversations", { title: "NULL bridge test conversation" });
      assert(nullBridgeConv.status === 201, `Expected 201 but got ${nullBridgeConv.status}`);

      const result = await getJson(`/api/coach-interactions?conversation=${encodeURIComponent(nullBridgeConv.payload.conversation.id)}`);
      assert(result.status === 200, `Expected coach list 200 but got ${result.status}`);
      const nullBridgeFound = result.payload.interactions.some((item) => item.id === 999 || item.coach_question_text === "Legacy unbridged coach question");
      assert(!nullBridgeFound, "Expected NULL-bridge coach fixture to be excluded");
    });

    for (const field of ["owner_user_id", "ownerUserId"]) {
      await runCase(`coach creation rejects client field ${field}`, async () => {
        const before = coachInsertCount();
        const result = await postJson("/api/coach-interactions", {
          [field]: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          conversationId: "11111111-1111-4111-8111-111111111111",
          coachQuestionText: "Rejected owner",
        });
        assert(result.status === 400, `${field}: expected 400 but got ${result.status}`);
        assert(JSON.stringify(result.payload) === JSON.stringify({ error: "invalid_coach_request" }), `${field}: expected sanitized error`);
        assert(coachInsertCount() === before, `${field}: expected zero coach inserts`);
      });
    }

    await runCase("foreign coach conversation returns neutral not-found", async () => {
      const result = await postJson("/api/coach-interactions", { conversationId: "22222222-2222-4222-8222-222222222222", coachQuestionText: "Blocked" });
      assert(result.status === 404, `Expected 404 but got ${result.status}`);
      assert(JSON.stringify(result.payload) === JSON.stringify({ error: "conversation_not_found" }), "Expected neutral coach not-found");
    });

    await runCase("nonexistent coach conversation matches foreign not-found", async () => {
      const result = await postJson("/api/coach-interactions", { conversationId: "33333333-3333-4333-8333-333333333333", coachQuestionText: "Blocked" });
      assert(result.status === 404, `Expected 404 but got ${result.status}`);
      assert(JSON.stringify(result.payload) === JSON.stringify({ error: "conversation_not_found" }), "Expected neutral coach not-found");
    });

    await runCase("foreign coach list returns neutral not-found", async () => {
      const result = await getJson("/api/coach-interactions?conversation=22222222-2222-4222-8222-222222222222");
      assert(result.status === 404, `Expected 404 but got ${result.status}`);
      assert(JSON.stringify(result.payload) === JSON.stringify({ error: "conversation_not_found" }), "Expected neutral coach list not-found");
    });

    await runCase("nonexistent coach list matches foreign not-found", async () => {
      const result = await getJson("/api/coach-interactions?conversation=33333333-3333-4333-8333-333333333333");
      assert(result.status === 404, `Expected 404 but got ${result.status}`);
      assert(JSON.stringify(result.payload) === JSON.stringify({ error: "conversation_not_found" }), "Expected neutral coach list not-found");
    });

    await runCase("malformed coach list conversation UUID is rejected", async () => {
      const result = await getJson("/api/coach-interactions?conversation=default");
      assert(result.status === 400, `Expected 400 but got ${result.status}`);
      assert(JSON.stringify(result.payload) === JSON.stringify({ error: "invalid_coach_request" }), "Expected sanitized invalid coach request");
    });

    await runCase("unauthenticated coach creation is rejected", async () => {
      const result = await postJson("/api/coach-interactions", { conversationId: "11111111-1111-4111-8111-111111111111", coachQuestionText: "Unauthenticated" }, {}, { authenticated: false });
      assert(result.status === 401, `Expected 401 but got ${result.status}`);
      assert(JSON.stringify(result.payload) === JSON.stringify({ error: "unauthorized" }), "Expected unauthorized response");
    });

    await runCase("unauthenticated coach list is rejected", async () => {
      const result = await fetch(`${BASE_URL}/api/coach-interactions?conversation=11111111-1111-4111-8111-111111111111`);
      const payload = await result.json();
      assert(result.status === 401, `Expected 401 but got ${result.status}`);
      assert(JSON.stringify(payload) === JSON.stringify({ error: "unauthorized" }), "Expected unauthorized response");
    });

    await runCase("coach database failure returns sanitized 503", async () => {
      const result = await requestCoachDbFailure();
      assert(result.status === 503, `Expected 503 but got ${result.status}`);
      assert(JSON.stringify(result.payload) === JSON.stringify({ error: "coach_service_unavailable" }), "Expected sanitized coach failure");
    });

    await runCase("journal creation ignores legacy user_id identity", async () => {
      const result = await postJson("/api/journal-entries", {
        user_id: "client-user-b",
        entryText: "Legacy identity journal entry",
      });

      assert(result.status === 201, `Expected 201 but got ${result.status}`);
      assert(result.payload.entry.owner_user_id === "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "Expected authenticated owner");
      assert(result.payload.entry.user_id === null, "Expected legacy user_id to remain null");
    });

    for (const field of ["owner_user_id", "ownerUserId"]) {
      await runCase(`journal creation rejects client field ${field}`, async () => {
        const before = journalInsertCount();
        const result = await postJson("/api/journal-entries", { [field]: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", entryText: "Rejected owner" });

        assert(result.status === 400, `${field}: expected 400 but got ${result.status}`);
        assert(JSON.stringify(result.payload) === JSON.stringify({ error: "invalid_journal_request" }), `${field}: expected sanitized request error`);
        assert(journalInsertCount() === before, `${field}: expected zero journal inserts`);
      });
    }

    await runCase("owned journal list returns only authenticated owner rows", async () => {
      const result = await getJson("/api/journal-entries");
      assert(result.status === 200, `Expected 200 but got ${result.status}`);
      assert(result.payload && result.payload.ok === true, "Expected successful journal list");
      assert(result.payload.entries.length === 2, "Expected two authenticated-owner entries");
      assert(result.payload.entries.every((entry) => entry.owner_user_id === "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), "Expected owner-scoped rows");
    });

    await runCase("journal conversation filter narrows authenticated owner rows", async () => {
      const result = await getJson("/api/journal-entries?conversation=journal-context-a");
      assert(result.status === 200, `Expected 200 but got ${result.status}`);
      assert(result.payload.entries.length === 1, "Expected one matching context row");
      assert(result.payload.entries[0].owner_user_id === "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "Expected authenticated owner row");
    });

    await runCase("journal NULL-owner fixture is excluded", async () => {
      const result = await getJson("/api/journal-entries?conversation=null-owner-context");
      assert(result.status === 200, `Expected 200 but got ${result.status}`);
      assert(result.payload.entries.length === 0, "Expected NULL-owner rows to remain inaccessible");
    });

    await runCase("unauthenticated journal creation is rejected", async () => {
      const before = journalInsertCount();
      const result = await postJson("/api/journal-entries", { entryText: "Unauthenticated" }, {}, { authenticated: false });
      assert(result.status === 401, `Expected 401 but got ${result.status}`);
      assert(JSON.stringify(result.payload) === JSON.stringify({ error: "unauthorized" }), "Expected sanitized unauthorized response");
      assert(journalInsertCount() === before, "Expected zero journal inserts");
    });

    await runCase("unauthenticated journal list is rejected", async () => {
      const res = await fetch(`${BASE_URL}/api/journal-entries`);
      const payload = await res.json();
      assert(res.status === 401, `Expected 401 but got ${res.status}`);
      assert(JSON.stringify(payload) === JSON.stringify({ error: "unauthorized" }), "Expected sanitized unauthorized response");
    });

    await runCase("journal database failures return sanitized 503 responses", async () => {
      const [createFailure, listFailure] = await requestJournalDbFailure();
      assert(createFailure.status === 503, `Expected journal create 503 but got ${createFailure.status}`);
      assert(listFailure.status === 503, `Expected journal list 503 but got ${listFailure.status}`);
      assert(JSON.stringify(createFailure.payload) === JSON.stringify({ error: "journal_service_unavailable" }), "Expected sanitized create failure");
      assert(JSON.stringify(listFailure.payload) === JSON.stringify({ error: "journal_service_unavailable" }), "Expected sanitized list failure");
    });

    await runCase("conversation route creates an authenticated owned conversation", async () => {
      const before = conversationInsertCount();
      const { status, payload } = await postJson("/api/conversations", { title: "Test conversation" });

      assert(status === 201, `Expected 201 but got ${status}`);
      assert(payload && payload.ok === true, "Expected successful conversation response");
      assert(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.conversation.id), "Expected server UUID");
      assert(payload.conversation.owner_user_id === "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "Expected active internal owner");
      assert(conversationInsertCount() === before + 1, "Expected exactly one conversation insert");
      ownedConversationId = payload.conversation.id;
    });

    await runCase("owned message write and reads use the conversation UUID", async () => {
      const before = messageInsertCount();
      const write = await postJson("/api/messages", {
        conversation_uuid: ownedConversationId,
        conversation_id: "legacy-untrusted-id",
        userId: "client-user-b",
        finalText: "Owned message",
      });

      assert(write.status === 200, `Expected 200 but got ${write.status}`);
      assert(write.payload && write.payload.ok === true, "Expected successful message write");
      assert(write.payload.message.conversation_uuid === ownedConversationId, "Expected UUID bridge");
      assert(write.payload.message.user_id === "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "Expected server owner identity");
      assert(messageInsertCount() === before + 1, "Expected one owned message insert");

      const messages = await getJson(`/api/messages?conversation=${encodeURIComponent(ownedConversationId)}&order=asc`);
      assert(messages.status === 200, `Expected messages 200 but got ${messages.status}`);
      assert(messages.payload.messages.length === 1, "Expected one owned message");

      const history = await getJson(`/api/history?conversation=${encodeURIComponent(ownedConversationId)}`);
      assert(history.status === 200, `Expected history 200 but got ${history.status}`);
      assert(history.payload.messages.length === 1, "Expected one owned history message");
    });

    await runCase("owned send uses the owner-scoped message insert", async () => {
      const before = messageInsertCount();
      const result = await postJson("/api/send", {
        conversation_uuid: ownedConversationId,
        userId: "client-user-b",
        finalText: "Owned send",
        originalText: "Owned send",
      });

      assert(result.status === 200, `Expected 200 but got ${result.status}`);
      assert(result.payload && result.payload.ok === true, "Expected successful send");
      assert(messageInsertCount() === before + 1, "Expected one owned send insert");
    });

    for (const route of [
      `/api/messages?conversation=33333333-3333-4333-8333-333333333333`,
      `/api/history?conversation=33333333-3333-4333-8333-333333333333`,
    ]) {
      await runCase(`owned read rejects nonexistent conversation on ${route.split("?")[0]}`, async () => {
        const result = await getJson(route);
        assert(result.status === 404, `Expected 404 but got ${result.status}`);
        assert(JSON.stringify(result.payload) === JSON.stringify({ error: "conversation_not_found" }), "Expected neutral not-found response");
      });
    }

    await runCase("message write rejects nonexistent conversation without insertion", async () => {
      const before = messageInsertCount();
      const result = await postJson("/api/messages", {
        conversation_uuid: "33333333-3333-4333-8333-333333333333",
        finalText: "Should not persist",
      });

      assert(result.status === 404, `Expected 404 but got ${result.status}`);
      assert(JSON.stringify(result.payload) === JSON.stringify({ error: "conversation_not_found" }), "Expected neutral not-found response");
      assert(messageInsertCount() === before, "Expected zero message inserts");
    });

    await runCase("send rejects nonexistent conversation before private persistence", async () => {
      const before = messageInsertCount();
      const result = await postJson("/api/send", {
        conversation_uuid: "33333333-3333-4333-8333-333333333333",
        finalText: "Should not persist",
      });

      assert(result.status === 404, `Expected 404 but got ${result.status}`);
      assert(JSON.stringify(result.payload) === JSON.stringify({ error: "conversation_not_found" }), "Expected neutral not-found response");
      assert(messageInsertCount() === before, "Expected zero message inserts");
    });

    await runCase("send foreign ownership fails before safety or persistence", async () => {
      const before = messageInsertCount();
      const result = await postJson("/api/send", {
        conversation_uuid: "22222222-2222-4222-8222-222222222222",
        originalText: "I am in immediate danger and need help now.",
        finalText: "I am in immediate danger and need help now.",
      });

      assert(result.status === 404, `Expected 404 but got ${result.status}`);
      assert(JSON.stringify(result.payload) === JSON.stringify({ error: "conversation_not_found" }), "Expected ownership denial before downstream processing");
      assert(messageInsertCount() === before, "Foreign send must not write");
    });

    await runCase("send nonexistent ownership fails before safety or persistence", async () => {
      const before = messageInsertCount();
      const result = await postJson("/api/send", {
        conversation_uuid: "33333333-3333-4333-8333-333333333333",
        originalText: "I am in immediate danger and need help now.",
        finalText: "I am in immediate danger and need help now.",
      });

      assert(result.status === 404, `Expected 404 but got ${result.status}`);
      assert(JSON.stringify(result.payload) === JSON.stringify({ error: "conversation_not_found" }), "Expected neutral ownership denial");
      assert(messageInsertCount() === before, "Nonexistent send must not write");
    });

    await runCase("send owned conversation validates ownership before safety processing", async () => {
      const before = messageInsertCount();
      const result = await postJson("/api/send", {
        conversation_uuid: ownedConversationId,
        originalText: "I am in immediate danger and need help now.",
        finalText: "I am in immediate danger and need help now.",
      });

      assert(result.status === 200, `Expected 200 but got ${result.status}`);
      assert(result.payload && result.payload.coachingBlocked === true, "Expected owned request to reach safety processing");
      assert(messageInsertCount() === before, "Safety-blocked owned send must not persist a normal message");
    });

    await runCase("malformed message conversation UUID is rejected", async () => {
      const result = await getJson("/api/messages?conversation=not-a-uuid");
      assert(result.status === 400, `Expected 400 but got ${result.status}`);
      assert(JSON.stringify(result.payload) === JSON.stringify({ error: "invalid_conversation" }), "Expected sanitized invalid conversation response");
    });

    for (const [field, value] of [
      ["id", "11111111-1111-4111-8111-111111111111"],
      ["conversationId", "22222222-2222-4222-8222-222222222222"],
      ["conversation_id", "33333333-3333-4333-8333-333333333333"],
      ["conversation_uuid", "44444444-4444-4444-8444-444444444444"],
      ["owner_user_id", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
      ["ownerUserId", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
    ]) {
      await runCase(`conversation route rejects client field ${field}`, async () => {
        const before = conversationInsertCount();
        const { status, payload } = await postJson("/api/conversations", { [field]: value });

        assert(status === 400, `${field}: expected 400 but got ${status}`);
        assert(JSON.stringify(payload) === JSON.stringify({ error: "invalid_conversation_request" }), `${field}: expected sanitized invalid request`);
        assert(conversationInsertCount() === before, `${field}: rejected request must not insert`);
      });
    }

    for (const field of ["userId", "user_id"]) {
      await runCase(`conversation route ignores legacy ${field}`, async () => {
        const before = conversationInsertCount();
        const { status, payload } = await postJson("/api/conversations", {
          title: "Legacy identity test",
          [field]: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        });

        assert(status === 201, `${field}: expected 201 but got ${status}`);
        assert(payload.conversation.owner_user_id === "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", `${field}: must not influence owner`);
        assert(conversationInsertCount() === before + 1, `${field}: expected one conversation insert`);
      });
    }

    await runCase("unauthenticated conversation creation is rejected before insertion", async () => {
      const before = conversationInsertCount();
      const { status, payload } = await postJson("/api/conversations", { title: "Unauthenticated" }, {}, { authenticated: false });

      assert(status === 401, `Expected 401 but got ${status}`);
      assert(JSON.stringify(payload) === JSON.stringify({ error: "unauthorized" }), "Expected sanitized unauthorized response");
      assert(conversationInsertCount() === before, "Unauthenticated request must not insert");
    });

    for (const queryField of ["userId", "user_id"]) {
      await runCase(`conversation list ignores legacy query ${queryField}`, async () => {
        const { status, payload } = await getJson(`/api/conversations?${queryField}=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`);

        assert(status === 200, `${queryField}: expected 200 but got ${status}`);
        assert(payload && payload.ok === true, `${queryField}: expected successful list response`);
        assert(payload.conversations.length >= 1, `${queryField}: expected authenticated owner conversations`);
        assert(payload.conversations.every((conversation) => conversation.owner_user_id === "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), `${queryField}: expected authenticated owner only`);
      });
    }

    await runCase("safety knowledge base exposes policy version", async () => {
      assert(typeof SAFETY_POLICY_VERSION === "string", "Expected SAFETY_POLICY_VERSION to be a string");
      assert(SAFETY_POLICY_VERSION.length > 0, "Expected non-empty SAFETY_POLICY_VERSION");
    });

    await runCase("safety knowledge base contains all required category keys", async () => {
      const requiredKeys = [
        "none",
        "emotional_distress",
        "conflict_crisis",
        "unsafe_relationship_dynamics",
        "abuse_or_coercion",
        "stalking_or_tracking",
        "threats_or_intimidation",
        "coercive_control_or_isolation",
        "home_danger",
        "self_harm_or_suicide",
        "violence_risk",
        "immediate_danger",
      ];

      requiredKeys.forEach((key) => {
        assert(Object.prototype.hasOwnProperty.call(SAFETY_CATEGORIES, key), `Missing safety category key: ${key}`);
        assert(getSafetyCategory(key), `Expected getSafetyCategory('${key}') to return a category`);
      });

      assert(listSafetyCategories().length === requiredKeys.length, "Expected exact required category count");
    });

    await runCase("safety knowledge base validation passes", async () => {
      const result = validateSafetyKnowledgeBase();
      assert(result.ok === true, `Expected validation to pass: ${result.errors.join(" | ")}`);
    });

    await runCase("level 3+ messaging policies pause and block normal send", async () => {
      const categories = listSafetyCategories().filter((category) => category.level >= 3);

      categories.forEach((category) => {
        assert(category.messagingPolicy.allowNormalSend === false, `${category.key} should block normal send`);
        assert(category.messagingPolicy.shouldPauseSend === true, `${category.key} should pause send`);
        assert(category.messagingPolicy.persistAsNormalMessage === false, `${category.key} should not persist as normal message`);
      });
    });

    await runCase("level 3+ coach policies disable normal rewrite apply", async () => {
      const categories = listSafetyCategories().filter((category) => category.level >= 3);

      categories.forEach((category) => {
        assert(category.coachPolicy.allowNormalCoaching === false, `${category.key} should disable normal coaching`);
        assert(category.coachPolicy.allowRewriteApply === false, `${category.key} should disable rewrite apply`);
        assert(category.coachPolicy.useSafetyGuidance === true, `${category.key} should use safety guidance`);
      });
    });

    await runCase("level 0 allows normal send and coaching", async () => {
      const category = getSafetyCategory("none");
      assert(category.messagingPolicy.allowNormalSend === true, "Level 0 should allow normal send");
      assert(category.messagingPolicy.shouldPauseSend === false, "Level 0 should not pause send");
      assert(category.coachPolicy.allowNormalCoaching === true, "Level 0 should allow normal coaching");
      assert(category.coachPolicy.allowRewriteApply === true, "Level 0 should allow rewrite apply");
    });

    await runCase("decision engine level 0 deterministic allows policies", async () => {
      const decision = buildSafetyDecision({
        contextEnvelope: { contextType: "messaging_send", channel: "messaging" },
        deterministicResult: {
          level: 0,
          label: "normal coaching",
          shouldStopNormalCoaching: false,
          reason: "No critical safety signals detected.",
          matchedSignals: [],
        },
        semanticResult: null,
        policyVersion: SAFETY_POLICY_VERSION,
      });

      assert(decision.decisionVersion === DECISION_VERSION, "Expected valid decision version");
      assert(decision.category === "none", `Expected none category, got ${decision.category}`);
      assert(decision.messagingPolicy.allowNormalSend === true, "Expected allowNormalSend true at level 0");
      assert(decision.coachPolicy.allowNormalCoaching === true, "Expected allowNormalCoaching true at level 0");
      ensureValid("decision level 0", validateSafetyDecision(decision));
    });

    await runCase("decision engine level 3 deterministic blocks messaging and coaching", async () => {
      const decision = buildSafetyDecision({
        contextEnvelope: { contextType: "messaging_rephrase", channel: "messaging" },
        deterministicResult: {
          level: 3,
          label: "possible abuse or coercion",
          shouldStopNormalCoaching: true,
          reason: "Possible abuse, coercion, stalking, or unsafe relationship dynamics detected.",
          matchedSignals: ["abuse_or_coercion"],
        },
        semanticResult: null,
        policyVersion: SAFETY_POLICY_VERSION,
      });

      assert(decision.level === 3, "Expected level 3");
      assert(decision.source === "deterministic", "Expected deterministic source");
      assert(decision.messagingPolicy.allowNormalSend === false, "Expected blocked normal send");
      assert(decision.messagingPolicy.persistAsNormalMessage === false, "Expected blocked normal persistence");
      assert(decision.coachPolicy.allowNormalCoaching === false, "Expected blocked normal coaching");
      assert(decision.coachPolicy.allowRewriteApply === false, "Expected blocked rewrite apply");
      ensureValid("decision level 3", validateSafetyDecision(decision));
    });

    await runCase("decision engine preserves deterministic precedence for level 4 and level 5", async () => {
      const semanticAttempt = {
        category: "none",
        confidence: 0.99,
        level: 0,
        semanticSignals: ["semantic_low_risk"],
      };

      const level4Decision = buildSafetyDecision({
        contextEnvelope: { contextType: "coaching_analysis", channel: "coach" },
        deterministicResult: {
          level: 4,
          label: "self-harm or violence risk",
          shouldStopNormalCoaching: true,
          reason: "Possible self-harm, suicide, or violence risk detected.",
          matchedSignals: ["self_harm_or_suicide"],
        },
        semanticResult: semanticAttempt,
        policyVersion: SAFETY_POLICY_VERSION,
      });

      const level5Decision = buildSafetyDecision({
        contextEnvelope: { contextType: "messaging_send", channel: "messaging" },
        deterministicResult: {
          level: 5,
          label: "emergency immediate danger",
          shouldStopNormalCoaching: true,
          reason: "Immediate danger or emergency language detected.",
          matchedSignals: ["emergency_immediate_danger"],
        },
        semanticResult: semanticAttempt,
        policyVersion: SAFETY_POLICY_VERSION,
      });

      assert(level4Decision.level === 4, "Expected deterministic level 4 to win");
      assert(level4Decision.source === "deterministic", "Expected deterministic source at level 4");
      assert(level4Decision.shouldStopNormalCoaching === true, "Expected stop for level 4");

      assert(level5Decision.level === 5, "Expected deterministic level 5 to win");
      assert(level5Decision.source === "deterministic", "Expected deterministic source at level 5");
      assert(level5Decision.shouldStopNormalCoaching === true, "Expected stop for level 5");
    });

    await runCase("decision engine handles null semantic safely", async () => {
      const decision = buildSafetyDecision({
        contextEnvelope: { contextType: "coaching_analysis", channel: "coach" },
        deterministicResult: {
          level: 2,
          label: "high-conflict relationship crisis",
          shouldStopNormalCoaching: false,
          reason: "High-conflict relationship language detected.",
          matchedSignals: ["high_conflict_relationship"],
        },
        semanticResult: null,
        policyVersion: SAFETY_POLICY_VERSION,
      });

      assert(decision.trace.semanticCategory === null, "Expected null semanticCategory");
      assert(decision.trace.semanticConfidence === null, "Expected null semanticConfidence");
      ensureValid("decision null semantic", validateSafetyDecision(decision));
    });

    await runCase("decision engine unknown category fallback is safe", async () => {
      const decision = buildSafetyDecision({
        contextEnvelope: { contextType: "messaging_send", channel: "messaging" },
        deterministicResult: {
          level: 3,
          label: "unmapped label",
          shouldStopNormalCoaching: true,
          reason: "Possible abuse, coercion, stalking, or unsafe relationship dynamics detected.",
          matchedSignals: [],
        },
        semanticResult: {
          category: "unknown_future_category",
          confidence: 0.8,
        },
        policyVersion: SAFETY_POLICY_VERSION,
      });

      assert(decision.category === "unsafe_relationship_dynamics", `Expected safe fallback category, got ${decision.category}`);
      assert(decision.messagingPolicy.allowNormalSend === false, "Expected blocked normal send on fallback level 3");
      assert(decision.coachPolicy.allowNormalCoaching === false, "Expected blocked normal coaching on fallback level 3");
      ensureValid("decision unknown category fallback", validateSafetyDecision(decision));
    });

    await runCase("decision engine keeps messaging and coach policies distinct", async () => {
      const policy = getDecisionPolicyForContext({
        contextEnvelope: { contextType: "messaging_send", channel: "messaging" },
        categoryKey: "conflict_crisis",
        fallbackLevel: 2,
      });

      assert(policy.messagingPolicy.allowNormalSend === true, "Expected messaging allowNormalSend true");
      assert(policy.messagingPolicy.shouldPauseSend === true, "Expected messaging shouldPauseSend true");
      assert(policy.coachPolicy.allowNormalCoaching === true, "Expected coach allowNormalCoaching true");
      assert(policy.coachPolicy.useSafetyGuidance === true, "Expected coach useSafetyGuidance true");
      assert(
        Object.prototype.hasOwnProperty.call(policy.messagingPolicy, "persistAsNormalMessage"),
        "Expected messaging-only policy field persistAsNormalMessage"
      );
      assert(
        Object.prototype.hasOwnProperty.call(policy.coachPolicy, "allowRewriteApply"),
        "Expected coach-only policy field allowRewriteApply"
      );
    });

    await runCase("decision engine output contains no raw user text", async () => {
      const rawText = "My private sentence should never appear in decision metadata.";
      const decision = buildSafetyDecision({
        contextEnvelope: {
          contextType: "messaging_send",
          channel: "messaging",
          text: rawText,
          route: "/api/send",
        },
        deterministicResult: {
          level: 0,
          label: "normal coaching",
          shouldStopNormalCoaching: false,
          reason: "No critical safety signals detected.",
          matchedSignals: [],
        },
        semanticResult: null,
        policyVersion: SAFETY_POLICY_VERSION,
      });

      assert(!Object.prototype.hasOwnProperty.call(decision, "text"), "Decision must not expose raw text field");
      const serialized = JSON.stringify(decision);
      assert(!serialized.includes(rawText), "Decision serialization must not include raw text contents");
    });

    await runCase("invalid decision object fails validation", async () => {
      const decision = buildSafetyDecision({
        contextEnvelope: { contextType: "messaging_send", channel: "messaging" },
        deterministicResult: {
          level: 3,
          label: "possible abuse or coercion",
          shouldStopNormalCoaching: true,
          reason: "Possible abuse, coercion, stalking, or unsafe relationship dynamics detected.",
          matchedSignals: ["abuse_or_coercion"],
        },
        semanticResult: null,
        policyVersion: SAFETY_POLICY_VERSION,
      });

      const invalid = {
        ...decision,
        source: "invalid-source",
        trace: {
          ...decision.trace,
          policyVersion: "",
        },
      };

      const result = validateSafetyDecision(invalid);
      assert(result.ok === false, "Expected invalid decision validation to fail");
      assert(result.errors.length > 0, "Expected validation errors for invalid decision");
    });

    await runCase("decision runtime helper isolates build exceptions", async () => {
      const result = buildSafetyDecisionSafe({
        route: "/api/analyze-intensity",
        contextEnvelope: { contextType: "coaching_analysis", channel: "coach" },
        deterministicResult: {
          level: 2,
          label: "high-conflict relationship crisis",
          shouldStopNormalCoaching: false,
          reason: "High-conflict relationship language detected.",
          matchedSignals: ["high_conflict_relationship"],
        },
        semanticResult: null,
        policyVersion: SAFETY_POLICY_VERSION,
        buildDecision: () => {
          throw new Error("forced_build_failure");
        },
      });

      assert(result.ok === false, "Expected helper to report non-ok when build fails");
      assert(result.decision === null, "Expected null decision when build fails");
      assert(result.validation && result.validation.ok === false, "Expected failed validation summary when build fails");
      assert(
        Array.isArray(result.validation.errors) &&
          result.validation.errors.some((entry) => String(entry).includes("decision_build_exception")),
        "Expected build exception marker in validation errors"
      );
    });

    await runCase("decision runtime helper isolates validation exceptions", async () => {
      const result = buildSafetyDecisionSafe({
        route: "/api/rephrase",
        contextEnvelope: { contextType: "messaging_rephrase", channel: "messaging" },
        deterministicResult: {
          level: 1,
          label: "emotional distress",
          shouldStopNormalCoaching: false,
          reason: "Emotional distress language detected.",
          matchedSignals: ["emotional_distress"],
        },
        semanticResult: null,
        policyVersion: SAFETY_POLICY_VERSION,
        validateDecision: () => {
          throw new Error("forced_validation_failure");
        },
      });

      assert(result.ok === true, "Expected helper to keep decision result when validation throws");
      assert(result.decision && typeof result.decision === "object", "Expected decision object when build succeeds");
      assert(result.validation && result.validation.ok === false, "Expected validation summary to fail when validator throws");
      assert(
        Array.isArray(result.validation.errors) &&
          result.validation.errors.some((entry) => String(entry).includes("decision_validation_exception")),
        "Expected validation exception marker in validation errors"
      );
    });

    await runCase("context router maps /api/send to messaging_send", async () => {
      const context = buildContextEnvelope({
        route: "/api/send",
        body: {
          finalText: "Can we talk later?",
          userId: "contract_tester",
          conversationId: "contract_suite",
        },
      });

      assert(context.contextType === "messaging_send", `Expected messaging_send but got ${context.contextType}`);
      assert(context.channel === "messaging", `Expected messaging channel but got ${context.channel}`);
      assert(context.route === "/api/send", `Expected /api/send route but got ${context.route}`);
    });

    await runCase("context router maps /api/rephrase to messaging_rephrase", async () => {
      const context = buildContextEnvelope({
        route: "/api/rephrase",
        body: {
          text: "Rephrase this message",
        },
      });

      assert(
        context.contextType === "messaging_rephrase",
        `Expected messaging_rephrase but got ${context.contextType}`
      );
      assert(context.channel === "messaging", `Expected messaging channel but got ${context.channel}`);
      assert(context.route === "/api/rephrase", `Expected /api/rephrase route but got ${context.route}`);
    });

    await runCase("context router maps /api/analyze-intensity to coaching_analysis", async () => {
      const context = buildContextEnvelope({
        route: "/api/analyze-intensity",
        body: {
          text: "How should I say this?",
          draft: "You always ignore me",
        },
      });

      assert(context.contextType === "coaching_analysis", `Expected coaching_analysis but got ${context.contextType}`);
      assert(context.channel === "coach", `Expected coach channel but got ${context.channel}`);
      assert(
        context.route === "/api/analyze-intensity",
        `Expected /api/analyze-intensity route but got ${context.route}`
      );
    });

    await runCase("context router maps unknown route safely", async () => {
      const context = buildContextEnvelope({
        route: "/api/not-a-real-route",
        body: {
          text: "hello",
        },
      });

      assert(context.contextType === "unknown", `Expected unknown but got ${context.contextType}`);
      assert(context.channel === "unknown", `Expected unknown channel but got ${context.channel}`);
      assert(context.requestedAction === "unknown", `Expected unknown action but got ${context.requestedAction}`);
    });

    let dbConnected = false;
    try {
      const dbRes = await fetch(`${BASE_URL}/api/db-health`, { headers: TEST_AUTH_HEADERS });
      const dbPayload = await dbRes.json();
      dbConnected = !!(dbPayload && dbPayload.connected === true);
    } catch (error) {
      dbConnected = false;
    }

    await runCase("analyze-intensity non-blocked contract", async () => {
      const { status, payload } = await postJson("/api/analyze-intensity", {
        text: "Can we talk later today? I want to understand what happened.",
        tone: "calm",
        coachMode: "soft",
      });

      assert(status === 200, `Expected 200 but got ${status}`);
      ensureValid("/api/analyze-intensity", validateAnalyzeIntensityResponse(payload));
      assert(payload.coachingBlocked !== true, "Expected non-blocked analyze-intensity response");
      assert(payload.safetyDecision === undefined, "Decision metadata must not be exposed externally");
    });

    await runCase("analyze-intensity safety-blocked contract", async () => {
      const { status, payload } = await postJson("/api/analyze-intensity", {
        text: "I don’t feel safe around you.",
      });

      assert(status === 200, `Expected 200 but got ${status}`);
      ensureValid("safety-blocked", validateSafetyBlockedResponse(payload));
      assert(payload.coachingBlocked === true, "Expected coachingBlocked true");
      assert(payload.safety && payload.safety.level >= 3, "Expected safety level 3+ for unsafe feeling phrase");
    });

    await runCase("analyze-intensity unsafe phrase blocks (you make me feel unsafe)", async () => {
      const { status, payload } = await postJson("/api/analyze-intensity", {
        text: "You make me feel unsafe.",
      });

      assert(status === 200, `Expected 200 but got ${status}`);
      ensureValid("safety-blocked", validateSafetyBlockedResponse(payload));
      assert(payload.coachingBlocked === true, "Expected coachingBlocked true");
      assert(payload.safety && payload.safety.level >= 3, "Expected safety level 3+ for unsafe phrase");
    });

    await runCase("analyze-intensity abuse-concern phrase blocks", async () => {
      const { status, payload } = await postJson("/api/analyze-intensity", {
        text: "I think I’m being abused.",
      });

      assert(status === 200, `Expected 200 but got ${status}`);
      ensureValid("safety-blocked", validateSafetyBlockedResponse(payload));
      assert(payload.coachingBlocked === true, "Expected coachingBlocked true");
      assert(payload.safety && payload.safety.level >= 3, "Expected safety level 3+ for abuse-concern phrase");
    });

    await runCase("rephrase non-blocked contract", async () => {
      const { status, payload } = await postJson("/api/rephrase", {
        text: "You always ignore me",
        tone: "frustrated",
        needsAIHelp: true,
        stateOfMind: "hurt",
        intent: "express hurt",
        risk: "high",
        confidence: 0.8,
      });

      assert(status === 200, `Expected 200 but got ${status}`);
      ensureValid("/api/rephrase", validateRephraseResponse(payload));
      assert(payload.coachingBlocked !== true, "Expected non-blocked rephrase response");
      assert(payload.safetyDecision === undefined, "Decision metadata must not be exposed externally");
    });

    await runCase("rephrase safety-blocked contract", async () => {
      const { status, payload } = await postJson("/api/rephrase", {
        text: "I want to die",
        tone: "sad",
        needsAIHelp: true,
      });

      assert(status === 200, `Expected 200 but got ${status}`);
      ensureValid("safety-blocked", validateSafetyBlockedResponse(payload));
      assert(payload.coachingBlocked === true, "Expected coachingBlocked true");
    });

    if (dbConnected) {
      await runCase("send dry-run non-blocked contract", async () => {
        const { status, payload } = await postJson(
          "/api/send",
          {
            conversationId: "contract_suite",
            userId: "contract_tester",
            originalText: "Can we align on this tomorrow morning?",
            finalText: "Can we align on this tomorrow morning?",
            preSendEmotion: "calm",
            intensityScore: 0.2,
          },
          {
            "X-Smoke-Test": "1",
          }
        );

        assert(status === 200, `Expected 200 but got ${status}`);
        ensureValid("/api/send", validateSendResponse(payload));
        assert(payload.dry_run === true, "Expected dry_run true in smoke send response");
        assert(payload.safetyDecision === undefined, "Decision metadata must not be exposed externally");
      });

      await runCase("send safety-blocked contract", async () => {
        const { status, payload } = await postJson(
          "/api/send",
          {
            conversationId: "contract_suite",
            userId: "contract_tester",
            originalText: "I am in immediate danger and need help now.",
            finalText: "I am in immediate danger and need help now.",
          },
          {
            "X-Smoke-Test": "1",
          }
        );

        assert(status === 200, `Expected 200 but got ${status}`);
        ensureValid("safety-blocked", validateSafetyBlockedResponse(payload));
      });

      await runCase("send partner threatening/tracking safety-blocked contract", async () => {
        const { status, payload } = await postJson(
          "/api/send",
          {
            conversationId: "contract_suite",
            userId: "contract_tester",
            originalText: "My partner tracks my location and threatens me.",
            finalText: "My partner tracks my location and threatens me.",
          },
          {
            "X-Smoke-Test": "1",
          }
        );

        assert(status === 200, `Expected 200 but got ${status}`);
        ensureValid("safety-blocked", validateSafetyBlockedResponse(payload));
        assert(payload.coachingBlocked === true, "Expected coachingBlocked true");
        assert(payload.safety && payload.safety.level >= 3, "Expected safety level 3+ for abuse/coercion phrase");
      });

      await runCase("send coercive-control safety-blocked contract", async () => {
        const { status, payload } = await postJson(
          "/api/send",
          {
            conversationId: "contract_suite",
            userId: "contract_tester",
            originalText: "They won’t let me leave the house.",
            finalText: "They won’t let me leave the house.",
          },
          {
            "X-Smoke-Test": "1",
          }
        );

        assert(status === 200, `Expected 200 but got ${status}`);
        ensureValid("safety-blocked", validateSafetyBlockedResponse(payload));
        assert(payload.coachingBlocked === true, "Expected coachingBlocked true");
        assert(payload.safety && payload.safety.level >= 3, "Expected safety level 3+ for coercive-control phrase");
      });

      await runCase("communication persistence appears in pattern-summary", async () => {
        const conversationId = "contract_ci_persist";
        const { status: sendStatus, payload: sendPayload } = await postJson("/api/send", {
          conversationId,
          userId: "contract_tester",
          originalText: "I feel ignored when messages are missed.",
          finalText: "I feel ignored when messages are missed. Can we agree on a check-in time?",
          preSendEmotion: "frustrated",
          intensityScore: 0.55,
          wasPauseTaken: true,
          usedSuggestion: true,
          actionTaken: "used_suggestion",
        });

        assert(sendStatus === 200, `Expected 200 but got ${sendStatus}`);
        ensureValid("/api/send", validateSendResponse(sendPayload));
        assert(sendPayload.coachingBlocked !== true, "Expected non-blocked send response");

        const { status: summaryStatus, payload: summaryPayload } = await getJson(
          `/api/pattern-summary?conversation=${encodeURIComponent(conversationId)}`
        );
        assert(summaryStatus === 200, `Expected 200 but got ${summaryStatus}`);
        assert(summaryPayload && summaryPayload.summary, "Expected summary object in pattern summary response");
        assert(
          Object.prototype.hasOwnProperty.call(summaryPayload.summary, "topCommunicationIntent"),
          "Expected additive communication summary field: topCommunicationIntent"
        );
        assert(
          Object.prototype.hasOwnProperty.call(summaryPayload.summary, "communicationRiskCounts"),
          "Expected additive communication summary field: communicationRiskCounts"
        );
      });
    } else {
      results.push({ name: "send route contracts", status: "SKIP", note: "fake contract pool does not implement persistence queries" });
      console.log("[contracts] SKIP send route contracts (fake contract pool does not implement persistence queries)");
    }
  } finally {
    if (!server.killed) {
      server.kill("SIGTERM");
    }
  }

  const failed = results.filter((r) => r.status === "FAIL");
  const skipped = results.filter((r) => r.status === "SKIP");

  console.log("\n[contracts] Summary");
  results.forEach((r) => {
    const details = r.error ? ` :: ${r.error}` : r.note ? ` :: ${r.note}` : "";
    console.log(`- ${r.status} ${r.name}${details}`);
  });

  if (failed.length > 0) {
    process.exitCode = 1;
    return;
  }

  if (skipped.length > 0) {
    console.log("[contracts] Completed with skips.");
  } else {
    console.log("[contracts] All contract tests passed.");
  }
}

run().catch((error) => {
  console.error("[contracts] Fatal error:", error);
  process.exit(1);
});
