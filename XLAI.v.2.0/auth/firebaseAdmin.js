"use strict";

const realAdmin = require("firebase-admin");

function createFirebaseAdminFoundation(adminSdk) {
  let firebaseAuth = null;

  function readServiceAccount() {
    if (process.env.FIREBASE_ADMIN_CREDENTIALS) {
      throw new Error("FIREBASE_ADMIN_CREDENTIALS is no longer supported. Use FIREBASE_SERVICE_ACCOUNT instead.");
    }

    const rawValue = process.env.FIREBASE_SERVICE_ACCOUNT || "";
    if (!rawValue.trim()) {
      return null;
    }

    try {
      return JSON.parse(rawValue);
    } catch (_) {
      throw new Error("Firebase Admin service account configuration is malformed JSON.");
    }
  }

  function isFirebaseAdminConfigured() {
    return !!(process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_SERVICE_ACCOUNT);
  }

  function initializeFirebaseAdmin() {
    if (firebaseAuth) {
      return firebaseAuth;
    }

    try {
      const serviceAccount = readServiceAccount();
      const serviceAccountProjectId = serviceAccount && serviceAccount.project_id ? serviceAccount.project_id : undefined;
      const projectIdHint = process.env.FIREBASE_PROJECT_ID || undefined;

      if (serviceAccount && serviceAccountProjectId && projectIdHint && serviceAccountProjectId !== projectIdHint) {
        throw new Error("Firebase Admin project mismatch between FIREBASE_PROJECT_ID and service-account project_id.");
      }

      const app = serviceAccount
        ? adminSdk.initializeApp({
          credential: adminSdk.credential.cert(serviceAccount),
          projectId: serviceAccountProjectId || projectIdHint,
        })
        : adminSdk.initializeApp({ projectId: projectIdHint });
      firebaseAuth = app.auth();
      return firebaseAuth;
    } catch (error) {
      const rawMessage = error && error.message ? error.message : "Unknown Firebase Admin initialization error";
      const sanitizedMessage = rawMessage
        .replace(/(private_key|PRIVATE_KEY|service_account|GOOGLE_APPLICATION_CREDENTIALS|FIREBASE_SERVICE_ACCOUNT|FIREBASE_PROJECT_ID)/gi, "[redacted]");
      throw new Error(`Firebase Admin initialization failed: ${sanitizedMessage}`);
    }
  }

  return {
    initializeFirebaseAdmin,
    getFirebaseAdminAuth: () => firebaseAuth || initializeFirebaseAdmin(),
    isFirebaseAdminConfigured,
  };
}

const productionFoundation = createFirebaseAdminFoundation(realAdmin);

module.exports = {
  initializeFirebaseAdmin: productionFoundation.initializeFirebaseAdmin,
  getFirebaseAdminAuth: productionFoundation.getFirebaseAdminAuth,
  isFirebaseAdminConfigured: productionFoundation.isFirebaseAdminConfigured,
  __internal: { createFirebaseAdminFoundation },
};