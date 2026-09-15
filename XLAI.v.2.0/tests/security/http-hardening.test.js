"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..", "..");
const PORT = Number(process.env.HTTP_HARDENING_TEST_PORT || 3300);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const FAKE_ADMIN_SHIM = path.resolve(ROOT, "tests", "auth", "fake-firebase-admin-sdk.js");
const FAKE_PG_SHIM = path.resolve(ROOT, "tests", "contracts", "fake-pg.js");
const PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=()";

let server;

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
  throw new Error("HTTP hardening server did not become healthy in time.");
}

async function request(route, options = {}) {
  const response = await fetch(`${BASE_URL}${route}`, options);
  const body = await response.text();
  return { response, body };
}

function startServer() {
  const env = {
    ...process.env,
    PORT: String(PORT),
    DATABASE_URL: "postgres://contract-test-only",
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ` : ""}--require ${FAKE_ADMIN_SHIM} --require ${FAKE_PG_SHIM}`,
  };

  return spawn("node", ["server.js"], {
    cwd: ROOT,
    env,
    stdio: "ignore",
  });
}

test.before(async () => {
  server = startServer();
  await waitForHealth();
});

test.after(() => {
  if (server && !server.killed) server.kill("SIGTERM");
});

test("baseline security headers are present and framework disclosure is disabled", async () => {
  const { response } = await request("/health");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-powered-by"), null);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("permissions-policy"), PERMISSIONS_POLICY);
});

test("private API responses are no-store while public health remains available", async () => {
  const privateResponse = await request("/api/conversations");
  assert.equal(privateResponse.response.status, 401);
  assert.match(privateResponse.response.headers.get("cache-control") || "", /no-store/);
  assert.match(privateResponse.response.headers.get("cache-control") || "", /private/);

  const healthResponse = await request("/api/health");
  assert.equal(healthResponse.response.status, 200);
  assert.deepEqual(JSON.parse(healthResponse.body), { ok: true });
  assert.equal(healthResponse.response.headers.get("cache-control"), null);
});

test("valid JSON is accepted and auth still gates private routes", async () => {
  const response = await request("/api/conversations", {
    method: "POST",
    headers: {
      Authorization: "Bearer contract-test-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title: "P1.2A hardening test" }),
  });

  assert.equal(response.response.status, 201);
  assert.equal(JSON.parse(response.body).conversation.owner_user_id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.match(response.response.headers.get("cache-control") || "", /no-store/);
});

test("oversized JSON is rejected without exposing a stack trace", async () => {
  const response = await request("/api/conversations", {
    method: "POST",
    headers: {
      Authorization: "Bearer contract-test-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title: "x".repeat(110000) }),
  });

  assert.equal(response.response.status, 413);
  assert.doesNotMatch(response.body, /PayloadTooLargeError|at .*server\.js|node_modules/);
});

test("malformed JSON is rejected without crashing the server", async () => {
  const response = await request("/api/conversations", {
    method: "POST",
    headers: {
      Authorization: "Bearer contract-test-token",
      "Content-Type": "application/json",
    },
    body: "{ malformed",
  });

  assert.equal(response.response.status, 400);
  assert.doesNotMatch(response.body, /at .*server\.js|node_modules/);

  const health = await request("/health");
  assert.equal(health.response.status, 200);
  assert.equal(health.body, "healthy");
});

test("internal development routes remain gated", async () => {
  const response = await request("/api/db-health", {
    headers: { Authorization: "Bearer contract-test-token" },
  });

  assert.equal(response.response.status, 404);
  assert.deepEqual(JSON.parse(response.body), { error: "Not found" });
  assert.match(response.response.headers.get("cache-control") || "", /no-store/);
});
