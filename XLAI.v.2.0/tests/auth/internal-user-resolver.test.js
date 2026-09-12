const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const http = require("node:http");

const { createInternalUserResolver } = require("../../auth/internalUserResolver.js");
const { createInternalDevGate } = require("../../auth/internalDevGate.js");
const { createFirebaseAuthMiddleware } = require("../../auth/firebaseAuthMiddleware.js");

function request(app, path, options = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const req = http.request({
        hostname: address.address,
        port: address.port,
        path,
        method: options.method || "GET",
        headers: options.headers || {},
      }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          server.close(() => resolve({ statusCode: res.statusCode, body }));
        });
      });
      req.on("error", (error) => server.close(() => reject(error)));
      if (options.body) req.write(options.body);
      req.end();
    });
    server.on("error", reject);
  });
}

function createResolverApp(pool, options = {}) {
  const app = express();
  app.use((req, res, next) => {
    req.user = { uid: options.firebaseUid || "firebase-active" };
    next();
  });
  const resolver = createInternalUserResolver({
    getPool: () => pool,
    generateId: options.generateId || (() => "11111111-1111-4111-8111-111111111111"),
  });
  let handlerUser = null;
  app.get("/private", resolver, (req, res) => {
    handlerUser = req.xlaiUser;
    res.json({ ok: true, user: req.xlaiUser });
  });
  return { app, getHandlerUser: () => handlerUser };
}

function activeRow(id = "22222222-2222-4222-8222-222222222222", firebaseUid = "firebase-active") {
  return { id, firebase_uid: firebaseUid, status: "active" };
}

test("active internal user resolves from Firebase UID and establishes trusted req.xlaiUser", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("INSERT INTO internal_users")) return { rows: [activeRow()] };
      return { rows: [] };
    },
  };
  const route = createResolverApp(pool);
  const result = await request(route.app, "/private?userId=client-user", {
    headers: { authorization: "Bearer unused-by-this-unit-test" },
  });

  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body).user, {
    id: "22222222-2222-4222-8222-222222222222",
    firebaseUid: "firebase-active",
    status: "active",
  });
  assert.equal(route.getHandlerUser().firebaseUid, "firebase-active");
  assert.equal(calls[0].params[1], "firebase-active");
  assert.match(calls[0].sql, /ON CONFLICT \(firebase_uid\) DO NOTHING/i);
  assert.match(calls[1].sql, /UPDATE internal_users/i);
});

test("unknown Firebase UID is created as pending with a server-generated UUID and denied", async () => {
  const generated = "33333333-3333-4333-8333-333333333333";
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ id: generated, firebase_uid: "new-firebase-user", status: "pending" }] };
    },
  };
  const route = createResolverApp(pool, { generateId: () => generated, firebaseUid: "new-firebase-user" });
  const result = await request(route.app, "/private", {
    headers: { authorization: "Bearer unused-by-this-unit-test" },
  });

  assert.equal(result.statusCode, 403);
  assert.equal(result.body, '{"error":"access_pending"}');
  assert.equal(route.getHandlerUser(), null);
  assert.match(calls[0].sql, /VALUES \(\$1, \$2, 'pending'\)/i);
  assert.equal(calls[0].params[0], generated);
  assert.equal(calls[0].params[1], "new-firebase-user");
});

test("pending and disabled users receive distinct sanitized denials", async () => {
  for (const status of ["pending", "disabled"]) {
    const pool = {
      async query() {
        return { rows: [{ id: "44444444-4444-4444-8444-444444444444", firebase_uid: "firebase-active", status }] };
      },
    };
    const route = createResolverApp(pool);
    const result = await request(route.app, "/private", {
      headers: { authorization: "Bearer unused-by-this-unit-test" },
    });
    assert.equal(result.statusCode, 403);
    assert.equal(result.body, JSON.stringify({ error: status === "pending" ? "access_pending" : "access_denied" }));
  }
});

test("database failure fails closed without exposing internal details", async () => {
  const route = createResolverApp({
    async query() {
      throw new Error("database credentials and SQL details");
    },
  });
  const result = await request(route.app, "/private", {
    headers: { authorization: "Bearer unused-by-this-unit-test" },
  });
  assert.equal(result.statusCode, 503);
  assert.equal(result.body, '{"error":"identity_resolution_unavailable"}');
});

test("duplicate creation conflict falls back to selecting the existing user", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("INSERT INTO internal_users")) return { rows: [] };
      if (sql.includes("SELECT id, firebase_uid, status")) return { rows: [activeRow("55555555-5555-4555-8555-555555555555", "firebase-active")] };
      return { rows: [] };
    },
  };
  const route = createResolverApp(pool);
  const result = await request(route.app, "/private", {
    headers: { authorization: "Bearer unused-by-this-unit-test" },
  });
  assert.equal(result.statusCode, 200);
  assert.equal(JSON.parse(result.body).user.id, "55555555-5555-4555-8555-555555555555");
  assert.equal(calls.length, 3);
  assert.match(calls[1].sql, /SELECT id, firebase_uid, status/i);
});

test("missing or malformed req.user.uid cannot resolve", async () => {
  const resolver = createInternalUserResolver({ getPool: () => ({ query: async () => { throw new Error("must not query"); } }) });
  for (const req of [{}, { user: {} }, { user: { uid: "" } }, { user: { uid: 42 } }]) {
    const response = { statusCode: null, body: null };
    const res = {
      status(code) { response.statusCode = code; return this; },
      json(body) { response.body = body; return this; },
    };
    await resolver(req, res, () => assert.fail("invalid identity reached handler"));
    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.body, { error: "unauthorized" });
  }
});

test("pending users cannot reach internal-dev handlers, while active users still require the dev gate", async () => {
  let handlerCalls = 0;
  const pendingPool = {
    async query() {
      return { rows: [{ id: "66666666-6666-4666-8666-666666666666", firebase_uid: "pending-user", status: "pending" }] };
    },
  };
  const pendingApp = express();
  pendingApp.use((req, res, next) => { req.user = { uid: "pending-user" }; next(); });
  pendingApp.get("/internal", createInternalUserResolver({ getPool: () => pendingPool }), createInternalDevGate({ enabled: true }), (req, res) => {
    handlerCalls += 1;
    res.json({ ok: true });
  });
  const pendingResult = await request(pendingApp, "/internal", { headers: { authorization: "Bearer token" } });
  assert.equal(pendingResult.statusCode, 403);

  const activePool = { async query(sql) {
    if (sql.includes("UPDATE internal_users")) return { rows: [] };
    return { rows: [activeRow("77777777-7777-4777-8777-777777777777", "active-user")] };
  } };
  const activeApp = express();
  activeApp.use((req, res, next) => { req.user = { uid: "active-user" }; next(); });
  activeApp.get("/internal", createInternalUserResolver({ getPool: () => activePool }), createInternalDevGate({ enabled: false }), (req, res) => {
    handlerCalls += 1;
    res.json({ ok: true });
  });
  const activeResult = await request(activeApp, "/internal", { headers: { authorization: "Bearer token" } });
  assert.equal(activeResult.statusCode, 404);
  assert.equal(activeResult.body, '{"error":"Not found"}');
  assert.equal(handlerCalls, 0);
});

test("client identity and status fields cannot affect resolution", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [activeRow("88888888-8888-4888-8888-888888888888", "firebase-active")] };
    },
  };
  const route = createResolverApp(pool);
  const result = await request(route.app, "/private?userId=attacker&status=active&owner_user_id=attacker", {
    method: "GET",
    headers: {
      authorization: "Bearer unused-by-this-unit-test",
      "x-user-id": "attacker",
    },
  });
  assert.equal(result.statusCode, 200);
  assert.equal(JSON.parse(result.body).user.firebaseUid, "firebase-active");
  assert.equal(calls[0].params[1], "firebase-active");
});

test("Firebase auth, internal resolution, and public health retain their intended boundaries", async () => {
  const pool = {
    async query(sql) {
      if (sql.includes("UPDATE internal_users")) return { rows: [] };
      return { rows: [activeRow("99999999-9999-4999-8999-999999999999", "integration-user")] };
    },
  };
  const app = express();
  const firebaseAuth = createFirebaseAuthMiddleware({
    getAuth: () => ({ verifyIdToken: async () => ({ uid: "integration-user" }) }),
  });
  const resolver = createInternalUserResolver({ getPool: () => pool });
  let handlerCalls = 0;
  app.get("/health", (req, res) => res.status(200).send("healthy"));
  app.get("/private", firebaseAuth, resolver, (req, res) => {
    handlerCalls += 1;
    res.json({ user: req.xlaiUser });
  });

  const health = await request(app, "/health");
  const missingAuth = await request(app, "/private");
  const authenticated = await request(app, "/private", { headers: { authorization: "Bearer valid-token" } });

  assert.equal(health.statusCode, 200);
  assert.equal(missingAuth.statusCode, 401);
  assert.equal(authenticated.statusCode, 200);
  assert.equal(JSON.parse(authenticated.body).user.id, "99999999-9999-4999-8999-999999999999");
  assert.equal(handlerCalls, 1);
});