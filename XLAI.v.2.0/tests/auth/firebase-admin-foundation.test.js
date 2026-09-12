const test = require("node:test");
const assert = require("node:assert/strict");

const firebaseAdmin = require("../../auth/firebaseAdmin.js");

function withFirebaseEnv(values, callback) {
  const previousEnv = { ...process.env };
  for (const name of [
    "GOOGLE_APPLICATION_CREDENTIALS",
    "FIREBASE_SERVICE_ACCOUNT",
    "FIREBASE_ADMIN_CREDENTIALS",
    "FIREBASE_PROJECT_ID",
  ]) {
    delete process.env[name];
  }
  Object.assign(process.env, values);

  try {
    return callback();
  } finally {
    for (const name of Object.keys(process.env)) {
      if (!(name in previousEnv)) {
        delete process.env[name];
      }
    }
    Object.assign(process.env, previousEnv);
  }
}

function createFakeAdmin() {
  const calls = [];
  const auth = { verifyIdToken: async () => ({ uid: "test-user" }) };
  const admin = {
    apps: [],
    credential: {
      cert(serviceAccount) {
        calls.push({ type: "cert", serviceAccount });
        return { serviceAccount };
      },
    },
    initializeApp(options) {
      calls.push({ type: "initializeApp", options });
      const app = { auth: () => auth };
      admin.apps.push(app);
      return app;
    },
  };
  return { admin, calls, auth };
}

function createIsolatedFoundation() {
  const fake = createFakeAdmin();
  return { ...fake, foundation: firebaseAdmin.__internal.createFirebaseAdminFoundation(fake.admin) };
}

test("server Firebase Admin module exposes the narrow production API", () => {
  assert.deepEqual(Object.keys(firebaseAdmin).sort(), [
    "__internal",
    "getFirebaseAdminAuth",
    "initializeFirebaseAdmin",
    "isFirebaseAdminConfigured",
  ]);
  assert.deepEqual(Object.keys(firebaseAdmin.__internal), ["createFirebaseAdminFoundation"]);
});

test("isolated foundations do not share state and each remains idempotent", () => {
  withFirebaseEnv({}, () => {
    const first = createIsolatedFoundation();
    const second = createIsolatedFoundation();
    const firstAuth = first.foundation.initializeFirebaseAdmin();

    assert.equal(first.foundation.initializeFirebaseAdmin(), firstAuth);
    assert.equal(first.foundation.getFirebaseAdminAuth(), firstAuth);
    assert.equal(first.calls.filter((call) => call.type === "initializeApp").length, 1);
    assert.notEqual(second.foundation.initializeFirebaseAdmin(), firstAuth);
    assert.equal(second.calls.filter((call) => call.type === "initializeApp").length, 1);
  });
});

test("managed ADC is attempted without explicit Firebase credential environment variables", () => {
  withFirebaseEnv({}, () => {
    const { calls, foundation } = createIsolatedFoundation();
    foundation.initializeFirebaseAdmin();

    assert.equal(foundation.isFirebaseAdminConfigured(), false);
    assert.deepEqual(calls, [{ type: "initializeApp", options: { projectId: undefined } }]);
  });
});

test("FIREBASE_SERVICE_ACCOUNT uses explicit certificate credentials", () => {
  withFirebaseEnv({
    FIREBASE_SERVICE_ACCOUNT: JSON.stringify({
      project_id: "service-project",
      private_key: "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----\n",
      client_email: "service@test.iam.gserviceaccount.com",
    }),
  }, () => {
    const { calls, foundation } = createIsolatedFoundation();
    foundation.initializeFirebaseAdmin();

    assert.equal(calls[0].type, "cert");
    assert.equal(calls[1].type, "initializeApp");
    assert.equal(calls[1].options.projectId, "service-project");
  });
});

test("malformed service-account JSON fails safely without secret values", () => {
  withFirebaseEnv({ FIREBASE_SERVICE_ACCOUNT: "{not-valid-json private_key=secret" }, () => {
    const { foundation } = createIsolatedFoundation();
    assert.throws(
      () => foundation.initializeFirebaseAdmin(),
      (error) => /malformed JSON/i.test(error.message)
        && !error.message.includes("secret")
        && !error.message.includes("FIREBASE_SERVICE_ACCOUNT")
    );
  });
});

test("conflicting service-account project and project hint fail closed", () => {
  withFirebaseEnv({
    FIREBASE_PROJECT_ID: "other-project",
    FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: "service-project" }),
  }, () => {
    const { calls, foundation } = createIsolatedFoundation();
    assert.throws(() => foundation.initializeFirebaseAdmin(), /project mismatch/i);
    assert.equal(calls.length, 0);
  });
});

test("deprecated FIREBASE_ADMIN_CREDENTIALS is rejected without leaking contents", () => {
  withFirebaseEnv({ FIREBASE_ADMIN_CREDENTIALS: '{"private_key":"secret"}' }, () => {
    const { foundation } = createIsolatedFoundation();
    assert.throws(
      () => foundation.initializeFirebaseAdmin(),
      (error) => /FIREBASE_ADMIN_CREDENTIALS.*supported/i.test(error.message)
        && !error.message.includes("secret")
    );
  });
});