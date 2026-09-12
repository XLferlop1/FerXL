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
    this.messages = [];
    this.nextMessageId = 1;
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

    if (/FROM conversations/i.test(sql) && /WHERE id = \$1/i.test(sql)) {
      const conversation = this.conversations.find((row) => row.id === params[0] && row.owner_user_id === params[1]);
      return { rows: conversation ? [conversation] : [], rowCount: conversation ? 1 : 0 };
    }

    if (/INSERT INTO messages/i.test(sql) && /FROM conversations/i.test(sql)) {
      const conversation = this.conversations.find((row) => row.id === params[0] && row.owner_user_id === params[1]);
      if (!conversation) return { rows: [], rowCount: 0 };

      const message = {
        id: this.nextMessageId++,
        conversation_id: conversation.id,
        conversation_uuid: conversation.id,
        user_id: params[1],
        original_text: params[2],
        final_text: params[3],
        pre_send_emotion: params[4],
        intensity_score: params[5],
        was_pause_taken: params[6],
        used_suggestion: params[7],
        action_taken: params[8],
        pause_reason: params[9],
        risks: params[10],
        intent_guess: params[11],
        coach_mode: params[12],
        created_at_timestamp: "2026-09-12T00:00:00.000Z",
      };
      this.messages.push(message);
      this.record({ type: "message_insert", message });
      return { rows: [message], rowCount: 1 };
    }

    if (/FROM messages m/i.test(sql) && /JOIN conversations c/i.test(sql)) {
      const rows = this.messages.filter((row) => row.conversation_uuid === params[0]
        && this.conversations.some((conversation) => conversation.id === row.conversation_uuid && conversation.owner_user_id === params[1]));
      return { rows, rowCount: rows.length };
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