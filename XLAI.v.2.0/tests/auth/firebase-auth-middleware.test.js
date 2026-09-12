const test = require("node:test");
const assert = require("node:assert/strict");

const { createFirebaseAuthMiddleware } = require("../../auth/firebaseAuthMiddleware.js");

function createResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function createRequest(authorization, extras = {}) {
  return {
    headers: authorization === undefined ? {} : { authorization },
    ...extras,
  };
}

async function runMiddleware({ authorization, auth, requestExtras } = {}) {
  const req = createRequest(authorization, requestExtras);
  const res = createResponse();
  let nextCalls = 0;
  const middleware = createFirebaseAuthMiddleware({ getAuth: () => auth });

  await middleware(req, res, () => {
    nextCalls += 1;
  });

  return { req, res, nextCalls };
}

test("missing Authorization header returns 401", async () => {
  const result = await runMiddleware();

  assert.equal(result.res.statusCode, 401);
  assert.deepEqual(result.res.body, { error: "unauthorized" });
  assert.equal(result.nextCalls, 0);
});

test("Basic scheme is rejected", async () => {
  const result = await runMiddleware({ authorization: "Basic credentials" });

  assert.equal(result.res.statusCode, 401);
  assert.equal(result.nextCalls, 0);
});

test("Bearer with an empty token is rejected", async () => {
  const result = await runMiddleware({ authorization: "Bearer   " });

  assert.equal(result.res.statusCode, 401);
  assert.equal(result.nextCalls, 0);
});

test("malformed Authorization headers are rejected", async () => {
  for (const authorization of ["Bearer", "Bearer token extra", "Token token", "Bearer\ttoken extra"]) {
    const result = await runMiddleware({ authorization });
    assert.equal(result.res.statusCode, 401, authorization);
    assert.equal(result.nextCalls, 0, authorization);
  }
});

test("valid Bearer token verifies once and establishes trusted uid", async () => {
  let verifyCalls = 0;
  const token = "verified-token-value";
  const auth = {
    verifyIdToken(receivedToken) {
      verifyCalls += 1;
      assert.equal(receivedToken, token);
      return Promise.resolve({ uid: "verified-user", email: "ignored@example.com" });
    },
  };

  const result = await runMiddleware({
    authorization: `Bearer ${token}`,
    auth,
    requestExtras: { body: { userId: "client-body-user" }, query: { userId: "client-query-user" } },
  });

  assert.equal(verifyCalls, 1);
  assert.deepEqual(result.req.user, { uid: "verified-user" });
  assert.equal(result.nextCalls, 1);
  assert.equal(result.res.statusCode, null);
});

test("verifyIdToken rejection returns sanitized 401 without the raw token", async () => {
  const token = "secret-token-value";
  const result = await runMiddleware({
    authorization: `Bearer ${token}`,
    auth: { verifyIdToken: async () => { throw new Error(`invalid token ${token}`); } },
  });

  assert.equal(result.res.statusCode, 401);
  assert.deepEqual(result.res.body, { error: "unauthorized" });
  assert.equal(JSON.stringify(result.res.body).includes(token), false);
  assert.equal(result.nextCalls, 0);
});

test("auth infrastructure failure returns sanitized 503", async () => {
  const result = await (async () => {
    const req = createRequest("Bearer valid-token");
    const res = createResponse();
    let nextCalls = 0;
    const middleware = createFirebaseAuthMiddleware({
      getAuth: () => { throw new Error("private_key=super-secret configuration failure"); },
    });
    await middleware(req, res, () => { nextCalls += 1; });
    return { req, res, nextCalls };
  })();

  assert.equal(result.res.statusCode, 503);
  assert.deepEqual(result.res.body, { error: "authentication_unavailable" });
  assert.equal(JSON.stringify(result.res.body).includes("super-secret"), false);
  assert.equal(result.nextCalls, 0);
});

test("missing verifier is treated as authentication infrastructure failure", async () => {
  const result = await runMiddleware({ authorization: "Bearer token", auth: {} });

  assert.equal(result.res.statusCode, 503);
  assert.deepEqual(result.res.body, { error: "authentication_unavailable" });
  assert.equal(result.nextCalls, 0);
});

test("verified token without a uid is rejected", async () => {
  const result = await runMiddleware({
    authorization: "Bearer token",
    auth: { verifyIdToken: async () => ({ email: "not-an-identity" }) },
  });

  assert.equal(result.res.statusCode, 401);
  assert.equal(result.nextCalls, 0);
});

test("middleware factory instances use independent fake verifiers", async () => {
  const firstAuth = { verifyIdToken: async () => ({ uid: "first-user" }) };
  const secondAuth = { verifyIdToken: async () => ({ uid: "second-user" }) };
  const first = createFirebaseAuthMiddleware({ getAuth: () => firstAuth });
  const second = createFirebaseAuthMiddleware({ getAuth: () => secondAuth });
  const firstReq = createRequest("Bearer first");
  const secondReq = createRequest("Bearer second");

  await first(firstReq, createResponse(), () => {});
  await second(secondReq, createResponse(), () => {});

  assert.equal(firstReq.user.uid, "first-user");
  assert.equal(secondReq.user.uid, "second-user");
});