// firebase-init.js v2
// Centralized Firebase Auth for EQConnect / XLAI

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

// 🔐 1) PASTE YOUR CONFIG FROM FIREBASE CONSOLE HERE
const firebaseConfig = {
  // <-- replace everything inside with your own keys
    apiKey: "AIzaSyAfyrRZt-ejb2rZesxhmJYW5LdDVwMMVmE",
    authDomain: "xlai-3497b.firebaseapp.com",
    projectId: "xlai-3497b",
    storageBucket: "xlai-3497b.firebasestorage.app",
    messagingSenderId: "849831285122",
    appId: "1:849831285122:web:ed96186436b5f8df1bbf9b",
};

// 2) Initialize app + auth
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// 3) Small helper: a promise that resolves when we have a user
const userReady = new Promise((resolve, reject) => {
  onAuthStateChanged(
    auth,
    (user) => {
      if (user) {
        console.log("[XLAI] Firebase user ready:", user.uid);
        // expose globally for other scripts
        window.XLAI_USER_ID = user.uid;
        resolve(user);
      }
    },
    (err) => {
      console.error("[XLAI] Auth state error:", err);
      reject(err);
    }
  );
});

// 4) Kick off anonymous sign-in (first time users)
signInAnonymously(auth).catch((err) => {
  console.error("[XLAI] Anonymous sign-in failed:", err);
});

// 5) Expose a global hook that other files (chat.js, etc.) can wait on
window.xlaiAuth = {
  app,
  auth,
  userReady,
};