const test = require("node:test");
const assert = require("node:assert/strict");

const { createFirebaseAuthClient } = require("../../public/auth-client.js");

test("signed-out users fail closed before authenticated fetch", async () => {
  const calls = [];
  const client = createFirebaseAuthClient({
    getCurrentUser: () => null,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200 };
    },
  });

  await assert.rejects(
    () => client.authenticatedFetch("/api/send", { method: "POST" }),
    (error) => error && error.code === "authentication_required"
      && /Please sign in with Google/i.test(error.message)
      && !String(error.message).includes("firebase-token")
  );
  assert.equal(calls.length, 0);
});

test("signed-in users get a Firebase ID token on authenticated fetch and keep headers safe", async () => {
  const calls = [];
  const client = createFirebaseAuthClient({
    getCurrentUser: () => ({
      uid: "abc123",
      getIdToken: async () => "firebase-token-123",
    }),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200 };
    },
  });

  const response = await client.authenticatedFetch("/api/rephrase", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer attacker-token" },
    body: JSON.stringify({ ok: true }),
  });

  assert.equal(response.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.get("Authorization"), "Bearer firebase-token-123");
  assert.equal(calls[0].options.headers.get("Content-Type"), "application/json");
  assert.equal(calls[0].options.body, JSON.stringify({ ok: true }));
});

test("getIdToken failure is surfaced without raw token leakage", async () => {
  const client = createFirebaseAuthClient({
    getCurrentUser: () => ({
      uid: "abc123",
      getIdToken: async () => {
        throw new Error("token refresh failed");
      },
    }),
  });

  await assert.rejects(
    () => client.getIdToken(),
    (error) => error && error.code === "authentication_required"
      && /Please sign in with Google/i.test(error.message)
      && !String(error.message).includes("token refresh failed")
      && !String(error.message).includes("firebase-token")
  );
});
