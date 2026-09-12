"use strict";

const Module = require("module");
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
          verifyIdToken: async () => ({ uid: "contract-test-user" }),
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