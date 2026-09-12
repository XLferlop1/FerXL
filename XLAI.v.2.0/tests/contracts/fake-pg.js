"use strict";

const Module = require("module");

const ACTIVE_USER = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  firebase_uid: "contract-test-user",
  status: "active",
};

class FakePool {
  async query(sql) {
    if (/INSERT INTO internal_users/i.test(sql)) {
      return { rows: [ACTIVE_USER], rowCount: 1 };
    }

    if (/UPDATE internal_users/i.test(sql)) {
      return { rows: [], rowCount: 1 };
    }

    // Keep legacy send/persistence contracts skipped; B3 route contracts do not
    // need a broad in-memory database implementation.
    if (/SELECT id, created_at_timestamp FROM messages/i.test(sql)) {
      throw new Error("fake contract pool does not implement persistence queries");
    }

    return { rows: [], rowCount: 0 };
  }

  async end() {}
}

const fakePg = { Pool: FakePool };
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "pg") {
    return fakePg;
  }
  return originalLoad.call(this, request, parent, isMain);
};

module.exports = fakePg;