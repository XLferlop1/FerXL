"use strict";

const Module = require("module");
const fs = require("fs");

const ACTIVE_USER = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  firebase_uid: "contract-test-user",
  status: "active",
};

class FakePool {
  constructor() {
    this.conversations = [];
  }

  record(event) {
    if (!process.env.FAKE_PG_TRACE_FILE) return;
    fs.appendFileSync(process.env.FAKE_PG_TRACE_FILE, `${JSON.stringify(event)}\n`);
  }

  async query(sql, params = []) {
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

    if (/INSERT INTO conversations/i.test(sql)) {
      const conversation = {
        id: params[0],
        owner_user_id: params[1],
        title: params[2],
        created_at: "2026-09-12T00:00:00.000Z",
      };
      this.conversations.push(conversation);
      this.record({ type: "conversation_insert", conversation });
      return { rows: [conversation], rowCount: 1 };
    }

    if (/FROM conversations/i.test(sql) && /WHERE owner_user_id = \$1/i.test(sql)) {
      return { rows: this.conversations.filter((row) => row.owner_user_id === params[0]) };
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