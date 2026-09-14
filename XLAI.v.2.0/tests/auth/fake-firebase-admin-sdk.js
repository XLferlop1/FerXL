"use strict";

const Module = require("module");

const TOKEN_TO_UID = Object.freeze({
  "contract-test-token": "contract-test-user",
  "TOKEN_A": "b7-test-firebase-user-a",
  "TOKEN_B": "b7-test-firebase-user-b",
});

const fakeAdmin = {
  apps: [],
  credential: {
    cert() {
      return {};
    },
  },
  initializeApp() {
    return {
      auth() {
        return {
          verifyIdToken: async (token) => {
            const uid = TOKEN_TO_UID[token];
            if (!uid) {
              throw new Error("invalid token");
            }
            return { uid };
          },
        };
      },
    };
  },
};

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "firebase-admin") {
    return fakeAdmin;
  }
  return originalLoad.call(this, request, parent, isMain);
};

module.exports = fakeAdmin;