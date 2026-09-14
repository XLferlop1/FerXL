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
    this.conversations = [
      {
        id: "22222222-2222-4222-8222-222222222222",
        owner_user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        title: "Foreign conversation",
        created_at: "2026-09-12T00:00:00.000Z",
      },
    ];
    this.messages = [
      {
        id: 998,
        conversation_uuid: "22222222-2222-4222-8222-222222222222",
        conversation_id: "22222222-2222-4222-8222-222222222222",
        user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        original_text: "Foreign message text",
        final_text: "Foreign message text",
        pre_send_emotion: "frustrated",
        intensity_score: 0.9,
        created_at_timestamp: "2026-09-12T00:00:00.000Z",
      },
      {
        id: 999,
        conversation_uuid: null,
        conversation_id: "null-bridge-context",
        user_id: "legacy-user-a",
        original_text: "Legacy unbridged message",
        final_text: "Legacy unbridged message",
        pre_send_emotion: "angry",
        intensity_score: 0.95,
        created_at_timestamp: "2026-09-12T00:00:00.000Z",
      },
    ];
    this.nextMessageId = 1000;
    this.journalEntries = [{
      id: 900,
      owner_user_id: null,
      conversation_id: "null-owner-context",
      user_id: "legacy-user-a",
      entry_text: "Legacy unowned entry",
      created_at_timestamp: "2026-09-12T00:00:00.000Z",
    }];
    this.coachInteractions = [
      {
        id: 998,
        conversation_uuid: "22222222-2222-4222-8222-222222222222",
        conversation_id: "22222222-2222-4222-8222-222222222222",
        user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        coach_question_text: "Foreign coach question",
        created_at_timestamp: "2026-09-12T00:00:00.000Z",
      },
      {
        id: 999,
        conversation_uuid: null,
        conversation_id: "null-bridge-context",
        user_id: "legacy-user-a",
        coach_question_text: "Legacy unbridged coach question",
        created_at_timestamp: "2026-09-12T00:00:00.000Z",
      },
    ];
    this.nextCoachId = 1000;
    this.nextJournalId = 1;
  }

  record(event) {
    if (!process.env.FAKE_PG_TRACE_FILE) return;
    fs.appendFileSync(process.env.FAKE_PG_TRACE_FILE, `${JSON.stringify(event)}\n`);
  }

  async query(sql, params = []) {
    if (process.env.FAKE_PG_JOURNAL_FAILURE === "1" && /journal_entries/i.test(sql)) {
      throw new Error("fake journal database outage");
    }
    if (process.env.FAKE_PG_COACH_FAILURE === "1" && /coach_interactions/i.test(sql)) {
      throw new Error("fake coach database outage");
    }
    if (process.env.FAKE_PG_DERIVED_FAILURE === "1" && (/m\.conversation_uuid/i.test(sql) || /ci\.conversation_uuid/i.test(sql) || (/FROM conversations/i.test(sql) && /WHERE id = \$1/i.test(sql)))) {
      throw new Error("fake derived analytics database outage");
    }

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

      const legacyMessageAttack = {
        id: this.nextMessageId++,
        conversation_uuid: null,
        conversation_id: conversation.id,
        user_id: "legacy-user-a",
        original_text: "LEGACY_MESSAGE_ATTACK_MARKER",
        final_text: "LEGACY_MESSAGE_ATTACK_MARKER",
        pre_send_emotion: "panicked",
        intensity_score: 1,
        was_pause_taken: false,
        used_suggestion: false,
        action_taken: null,
        pause_reason: null,
        risks: [],
        intent_guess: null,
        coach_mode: null,
        created_at_timestamp: "2026-09-12T00:01:00.000Z",
      };
      this.messages.push(legacyMessageAttack);

      const legacyCoachAttack = {
        id: this.nextCoachId++,
        conversation_uuid: null,
        conversation_id: conversation.id,
        user_id: "legacy-user-a",
        coach_question_text: "LEGACY_COACH_ATTACK_MARKER",
        coach_response_text: "Legacy attack response",
        intent_guess: null,
        intent_type: "legacy_attack",
        rewrite_text: null,
        insight_text: null,
        principle_text: null,
        intensity_score: 1,
        intensity_label: "high",
        risks: [],
        coach_mode: "legacy",
        created_at_timestamp: "2026-09-12T00:02:00.000Z",
      };
      this.coachInteractions.push(legacyCoachAttack);

      this.record({ type: "conversation_insert", conversation });
      return { rows: [conversation], rowCount: 1 };
    }

    if (/INSERT INTO journal_entries/i.test(sql)) {
      const entry = {
        id: this.nextJournalId++,
        owner_user_id: params[0],
        conversation_id: params[1],
        user_id: null,
        entry_text: params[2],
        retain_until_timestamp: params[3],
        mood: params[4],
        main_emotion: params[5],
        possible_trigger: params[6],
        communication_pattern: params[7],
        reflection_takeaway: params[8],
        suggested_next_step: params[9],
        created_at_timestamp: "2026-09-12T00:00:00.000Z",
      };
      this.journalEntries.push(entry);
      this.record({ type: "journal_insert", entry });
      return { rows: [entry], rowCount: 1 };
    }

    if (/INSERT INTO coach_interactions/i.test(sql) && /FROM conversations/i.test(sql)) {
      const conversation = this.conversations.find((row) => row.id === params[0] && row.owner_user_id === params[1]);
      if (!conversation) return { rows: [], rowCount: 0 };

      const interaction = {
        id: this.nextCoachId++,
        conversation_uuid: conversation.id,
        conversation_id: conversation.id,
        user_id: null,
        coach_question_text: params[2],
        coach_response_text: params[3],
        intent_guess: params[4],
        intent_type: params[5],
        rewrite_text: params[6],
        insight_text: params[7],
        principle_text: params[8],
        intensity_score: params[9],
        intensity_label: params[10],
        risks: params[11],
        coach_mode: params[12],
        created_at_timestamp: "2026-09-13T00:00:00.000Z",
      };
      this.coachInteractions.push(interaction);
      this.record({ type: "coach_insert", interaction });
      return { rows: [interaction], rowCount: 1 };
    }

    if (/FROM coach_interactions ci/i.test(sql) && /JOIN conversations c/i.test(sql)) {
      const rows = this.coachInteractions.filter((row) => row.conversation_uuid === params[0]
        && this.conversations.some((conversation) => conversation.id === row.conversation_uuid && conversation.owner_user_id === params[1]));
      return { rows, rowCount: rows.length };
    }

    if (/FROM journal_entries/i.test(sql) && /WHERE owner_user_id = \$1/i.test(sql)) {
      const owner = params[0];
      const conversationId = params[1];
      const rows = this.journalEntries.filter((entry) => entry.owner_user_id === owner
        && (!conversationId || entry.conversation_id === conversationId));
      return { rows, rowCount: rows.length };
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