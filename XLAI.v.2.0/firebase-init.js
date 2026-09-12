// firebase-init.js
// Firebase browser auth bootstrap for XLAI.
// This intentionally does not fabricate secrets or auto-sign-in.

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

const firebaseConfig = window.XLAI_FIREBASE_CONFIG || null;
const authListeners = new Set();
let authState = { status: "pending", user: null, error: null };

function notifyAuthState(next) {
  authState = { ...authState, ...next };
  for (const listener of authListeners) {
    try {
      listener(authState);
    } catch (_) {
      // Ignore listener failures; auth state is still reported.
    }
  }
}

function getCurrentUser() {
  return authState && authState.auth && authState.auth.currentUser ? authState.auth.currentUser : null;
}

function ensureFirebaseConfig() {
  if (!firebaseConfig || typeof firebaseConfig !== "object") {
    const error = new Error("Firebase web configuration is missing. Set window.XLAI_FIREBASE_CONFIG with apiKey, authDomain, projectId, appId before enabling Google auth.");
    error.code = "config_missing";
    throw error;
  }

  const required = ["apiKey", "authDomain", "projectId", "appId"];
  const missing = required.filter((key) => !firebaseConfig[key]);
  if (missing.length > 0) {
    const error = new Error(`Firebase web config is incomplete. Missing: ${missing.join(", ")}.`);
    error.code = "config_missing";
    throw error;
  }
}

const userReady = new Promise((resolve) => {
  const finalize = (state) => {
    notifyAuthState(state);
    resolve(state);
  };

  try {
    ensureFirebaseConfig();
  } catch (error) {
    finalize({ status: "config_missing", user: null, error: error.message });
    return;
  }

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const signInWithGoogleHandler = async () => {
    const provider = new GoogleAuthProvider();
    return signInWithPopup(auth, provider);
  };

  notifyAuthState({ status: "initializing", auth, user: null, error: null });

  onAuthStateChanged(
    auth,
    (user) => {
      const nextState = user
        ? { status: "signed_in", auth, user, error: null }
        : { status: "signed_out", auth, user: null, error: null };
      finalize(nextState);
    },
    (err) => {
      finalize({ status: "auth_error", auth, user: null, error: err && err.message ? err.message : "Authentication failed." });
    }
  );

  const authApi = {
    app,
    auth,
    getCurrentUser,
    signInWithGoogle: signInWithGoogleHandler,
    signOut: async () => signOut(auth),
    userReady,
    onAuthStateChange: (listener) => {
      authListeners.add(listener);
      listener(authState);
      return () => authListeners.delete(listener);
    },
    authenticatedFetch: async (url, options = {}) => {
      const currentUser = auth.currentUser;
      if (!currentUser || typeof currentUser.getIdToken !== "function") {
        const error = new Error("Authentication required. Please sign in with Google.");
        error.code = "authentication_required";
        throw error;
      }

      const token = await currentUser.getIdToken();
      const requestOptions = { ...options };
      const headers = new Headers(requestOptions.headers || {});
      headers.set("Authorization", `Bearer ${token}`);
      requestOptions.headers = headers;
      return window.fetch(url, requestOptions);
    },
  };

  window.xlaiAuth = authApi;
  window.XLAI_USER_ID = undefined;
  delete window.XLAI_USER_ID;
});

if (!window.xlaiAuth) {
  window.xlaiAuth = {
    auth: null,
    app: null,
    getCurrentUser,
    signInWithGoogle: async () => {
      const error = new Error("Firebase web configuration is missing. Set window.XLAI_FIREBASE_CONFIG before sign-in.");
      error.code = "config_missing";
      throw error;
    },
    signOut: async () => {},
    userReady,
    onAuthStateChange: (listener) => {
      authListeners.add(listener);
      listener(authState);
      return () => authListeners.delete(listener);
    },
    authenticatedFetch: async (url, options = {}) => {
      const error = new Error("Authentication required. Firebase web configuration is missing.");
      error.code = "config_missing";
      throw error;
    },
  };
  delete window.XLAI_USER_ID;
}