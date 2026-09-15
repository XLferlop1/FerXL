"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const { isTextLengthValid, MAX_USER_TEXT_LENGTH } = require("../../security/inputLimits.js");
const { createRateLimiter } = require("../../security/rateLimiter.js");

const ROOT = path.resolve(__dirname, "..", "..");
const PORT = Number(process.env.CORS_ABUSE_TEST_PORT || 3400);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const TRUSTED_ORIGIN = "https://trusted.example.test";
const UNKNOWN_ORIGIN = "https://unknown.example.test";
const USER_A_ID = "77777777-7777-4777-8777-777777777777";
const FAKE_ADMIN_SHIM = path.resolve(ROOT, "tests", "auth", "fake-firebase-admin-sdk.js");
const FAKE_PG_SHIM = path.resolve(ROOT, "tests", "contracts", "fake-pg.js");

let server;
let conversationId;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(maxAttempts = 120) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok && (await response.text()) === "healthy") return;
    } catch (error) {
      // Retry until the child process is listening.
    }
    await sleep(100);
  }
  throw new Error("CORS/abuse test server did not become healthy in time.");
}

function startServer() {
  const env = {
    ...process.env,
    PORT: String(PORT),
    DATABASE_URL: "postgres://contract-test-only",
    ALLOWED_ORIGINS: TRUSTED_ORIGIN,
    XLAI_RATE_LIMIT_HIGH_COST_MAX: "3",
    XLAI_RATE_LIMIT_WRITE_MAX: "30",
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ` : ""}--require ${FAKE_ADMIN_SHIM} --require ${FAKE_PG_SHIM}`,
  };

  return spawn("node", ["server.js"], {
    cwd: ROOT,
    env,
    stdio: "ignore",
  });
}

async function request(route, options = {}) {
  const response = await fetch(`${BASE_URL}${route}`, options);
  const body = await response.text();
  return { response, body };
}

function jsonRequest(token, route, body, headers = {}) {
  return request(route, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test.before(async () => {
  server = startServer();
  await waitForHealth();

  const created = await jsonRequest("TOKEN_A", "/api/conversations", { title: "P1.2B test conversation" });
  assert.equal(created.response.status, 201);
  conversationId = JSON.parse(created.body).conversation.id;
});

test.after(() => {
  if (server && !server.killed) server.kill("SIGTERM");
});

test("CORS allows the trusted origin and supports bearer preflight", async () => {
  const trusted = await request("/api/health", { headers: { Origin: TRUSTED_ORIGIN } });
  assert.equal(trusted.response.status, 200);
  assert.equal(trusted.response.headers.get("access-control-allow-origin"), TRUSTED_ORIGIN);
  assert.equal(trusted.response.headers.get("access-control-allow-credentials"), null);
  assert.notEqual(trusted.response.headers.get("access-control-allow-origin"), "*");

  const preflight = await request("/api/conversations", {
    method: "OPTIONS",
    headers: {
      Origin: TRUSTED_ORIGIN,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization,content-type",
    },
  });
  assert.equal(preflight.response.status, 204);
  assert.equal(preflight.response.headers.get("access-control-allow-origin"), TRUSTED_ORIGIN);
  assert.match(preflight.response.headers.get("access-control-allow-methods") || "", /POST/);
  assert.match(preflight.response.headers.get("access-control-allow-headers") || "", /Authorization/);
  assert.match(preflight.response.headers.get("access-control-allow-headers") || "", /Content-Type/);
});

test("unknown origins receive no permissive CORS authorization and no-origin requests remain usable", async () => {
  const unknown = await request("/api/health", { headers: { Origin: UNKNOWN_ORIGIN } });
  assert.equal(unknown.response.status, 200);
  assert.equal(unknown.response.headers.get("access-control-allow-origin"), null);

  const noOrigin = await request("/api/conversations");
  assert.equal(noOrigin.response.status, 401);
  assert.equal(noOrigin.response.headers.get("access-control-allow-origin"), null);
});

test("trusted-origin bearer requests remain authenticated", async () => {
  const response = await jsonRequest("TOKEN_A", "/api/messages", {
    conversation_uuid: conversationId,
    finalText: "Trusted origin message",
  }, { Origin: TRUSTED_ORIGIN });
  assert.equal(response.response.status, 200);
  assert.equal(response.response.headers.get("access-control-allow-origin"), TRUSTED_ORIGIN);
  assert.equal(JSON.parse(response.body).message.user_id, USER_A_ID);
});

test("authenticated high-cost limits are per-user and ignore spoofed identity fields", async () => {
  const safetyBody = { text: "I feel unsafe around you.", userId: "b7-test-firebase-user-b" };
  const firstA = await jsonRequest("TOKEN_A", "/api/analyze-intensity", safetyBody);
  const secondA = await jsonRequest("TOKEN_A", "/api/analyze-intensity", { text: "I feel unsafe around you." });
  const thirdA = await jsonRequest("TOKEN_A", "/api/analyze-intensity", { text: "I feel unsafe around you." });
  const limitedA = await jsonRequest("TOKEN_A", "/api/analyze-intensity", { text: "I feel unsafe around you.", user_id: "b7-test-firebase-user-b" });

  assert.equal(firstA.response.status, 200);
  assert.equal(secondA.response.status, 200);
  assert.equal(thirdA.response.status, 200);
  assert.equal(limitedA.response.status, 429);
  assert.deepEqual(JSON.parse(limitedA.body), { error: "rate_limited" });
  assert.equal(limitedA.response.headers.get("retry-after"), "60");

  const userB = await jsonRequest("TOKEN_B", "/api/analyze-intensity", { text: "I feel unsafe around you." });
  assert.equal(userB.response.status, 200);
});

test("rate limiter expiration and reset are bounded and deterministic", () => {
  let now = 0;
  const limiter = createRateLimiter({ windowMs: 1000, max: 1, maxEntries: 2, now: () => now });

  assert.equal(limiter.check("A").allowed, true);
  assert.equal(limiter.check("A").allowed, false);
  assert.equal(limiter.size(), 1);

  now = 1001;
  assert.equal(limiter.check("A").allowed, true);
  limiter.reset();
  assert.equal(limiter.size(), 0);
});

test("text-length boundary uses JavaScript string length", () => {
  const boundary = "x".repeat(MAX_USER_TEXT_LENGTH);
  const oversized = `${boundary}x`;
  assert.equal(isTextLengthValid(boundary), true);
  assert.equal(isTextLengthValid(oversized), false);
});

test("oversized text is rejected before expensive processing or persistence", async () => {
  const oversized = "x".repeat(MAX_USER_TEXT_LENGTH + 1);
  const cases = [
    ["/api/rephrase", { text: oversized }],
    ["/api/analyze-intensity", { text: "safe", context: { latestRefine: { rewrite: oversized } } }],
    ["/api/analyze-intensity", { text: oversized }],
    ["/api/send", { conversation_uuid: conversationId, finalText: oversized }],
    ["/api/messages", { conversation_uuid: conversationId, finalText: oversized }],
    ["/api/coach-interactions", { conversationId, coachQuestionText: oversized }],
    ["/api/journal-entries", { entryText: oversized }],
  ];

  for (const [route, body] of cases) {
    const response = await jsonRequest("TOKEN_B", route, body);
    assert.equal(response.response.status, 400, route);
    assert.deepEqual(JSON.parse(response.body), { error: "input_too_large" }, route);
  }
});
