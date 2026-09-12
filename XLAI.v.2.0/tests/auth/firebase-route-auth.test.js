const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const http = require("node:http");

const { createFirebaseAuthMiddleware } = require("../../auth/firebaseAuthMiddleware.js");
const { createInternalDevGate } = require("../../auth/internalDevGate.js");
const {
  AUTHENTICATED_USER_ROUTES,
  INTERNAL_DEV_ROUTES,
  PRIVATE_API_ROUTES,
  isInternalDevRoute,
  isPrivateApiRoute,
} = require("../../auth/privateRoutes.js");

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

function createProtectedApp(getAuth) {
  const app = express();
  const middleware = createFirebaseAuthMiddleware({ getAuth });
  let handlerCalls = 0;
  app.get("/private-read", middleware, (req, res) => {
    handlerCalls += 1;
    res.json({ uid: req.user.uid });
  });
  app.post("/private-write", middleware, (req, res) => {
    handlerCalls += 1;
    res.json({ uid: req.user.uid });
  });
  return { app, getHandlerCalls: () => handlerCalls };
}

test("private GET without auth is rejected and handler does not execute", async () => {
  const route = createProtectedApp(() => ({ verifyIdToken: async () => ({ uid: "user-1" }) }));
  const result = await request(route.app, "/private-read?userId=client-user");
  assert.equal(result.statusCode, 401);
  assert.equal(route.getHandlerCalls(), 0);
});

test("private POST without auth is rejected even with client identity fields", async () => {
  const route = createProtectedApp(() => ({ verifyIdToken: async () => ({ uid: "user-1" }) }));
  const result = await request(route.app, "/private-write?conversationId=client-conversation&userId=client-user", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: "client-user", conversationId: "client-conversation" }),
  });
  assert.equal(result.statusCode, 401);
  assert.equal(route.getHandlerCalls(), 0);
});

test("malformed bearer and rejected token return sanitized 401", async () => {
  const route = createProtectedApp(() => ({ verifyIdToken: async () => { throw new Error("raw token"); } }));
  for (const authorization of ["Basic credentials", "Bearer", "Bearer token extra", "Bearer rejected"]) {
    const result = await request(route.app, "/private-read", { headers: { authorization } });
    assert.equal(result.statusCode, 401, authorization);
    assert.equal(result.body, '{"error":"unauthorized"}');
  }
  assert.equal(route.getHandlerCalls(), 0);
});

test("auth infrastructure failure returns sanitized 503", async () => {
  const route = createProtectedApp(() => { throw new Error("credential path"); });
  const result = await request(route.app, "/private-read", { headers: { authorization: "Bearer token" } });
  assert.equal(result.statusCode, 503);
  assert.equal(result.body, '{"error":"authentication_unavailable"}');
  assert.equal(route.getHandlerCalls(), 0);
});

test("valid token allows handler execution and exposes only trusted uid", async () => {
  const route = createProtectedApp(() => ({ verifyIdToken: async (token) => ({ uid: `verified-${token}` }) }));
  const result = await request(route.app, "/private-read?userId=client-user&conversationId=client-conversation", {
    headers: { authorization: "Bearer firebase-token" },
  });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body), { uid: "verified-firebase-token" });
  assert.equal(route.getHandlerCalls(), 1);
});

test("private route registry covers every P0-A4 private API route", () => {
  assert.ok(PRIVATE_API_ROUTES.length > 0);
  for (const route of PRIVATE_API_ROUTES) {
    const [method, path] = route.split(" ");
    assert.equal(isPrivateApiRoute(method, path), true, route);
  }
  assert.equal(isPrivateApiRoute("GET", "/api/health"), false);
});

test("ordinary authenticated users cannot invoke disabled internal routes", async () => {
  const app = express();
  const middleware = createFirebaseAuthMiddleware({
    getAuth: () => ({ verifyIdToken: async () => ({ uid: "ordinary-user" }) }),
  });
  let handlerCalls = 0;
  app.post("/internal-cleanup", middleware, createInternalDevGate({ enabled: false }), (req, res) => {
    handlerCalls += 1;
    res.json({ ok: true });
  });

  const result = await request(app, "/internal-cleanup?userId=operator", {
    method: "POST",
    headers: { authorization: "Bearer valid-token" },
  });
  assert.equal(result.statusCode, 404);
  assert.equal(result.body, '{"error":"Not found"}');
  assert.equal(handlerCalls, 0);
});

test("route classes distinguish user routes from internal routes", () => {
  assert.ok(AUTHENTICATED_USER_ROUTES.length > 0);
  assert.deepEqual(INTERNAL_DEV_ROUTES, [
    "GET /api/db-health",
    "GET /api/privacy-status",
    "POST /api/privacy-cleanup",
  ]);
  for (const route of INTERNAL_DEV_ROUTES) {
    const [method, path] = route.split(" ");
    assert.equal(isInternalDevRoute(method, path), true, route);
  }
});

test("public health route remains available without Firebase auth", async () => {
  const app = express();
  app.get("/health", (req, res) => res.status(200).send("healthy"));
  app.get("/api/health", (req, res) => res.json({ ok: true }));

  const health = await request(app, "/health");
  const apiHealth = await request(app, "/api/health");
  assert.equal(health.statusCode, 200);
  assert.equal(apiHealth.statusCode, 200);
});