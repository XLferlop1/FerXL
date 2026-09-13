"use strict";

function serviceUnavailable() {
  return { ok: false, status: 503, error: "journal_service_unavailable" };
}

function invalidRequest() {
  return { ok: false, status: 400, error: "invalid_journal_request" };
}

function normalizeOwner(value) {
  return typeof value === "string" ? value.trim() : "";
}

function createOwnedJournalEntry({
  pool,
  ownerUserId,
  conversationId = null,
  entryText,
  retainUntilTimestamp = null,
  mood = null,
  reflection = {},
} = {}) {
  if (!pool || typeof pool.query !== "function") {
    return Promise.resolve(serviceUnavailable());
  }

  const safeOwnerUserId = normalizeOwner(ownerUserId);
  const safeEntryText = typeof entryText === "string" ? entryText.trim() : "";
  if (!safeOwnerUserId || !safeEntryText) {
    return Promise.resolve(invalidRequest());
  }

  return pool.query(
    `
      INSERT INTO journal_entries (
        owner_user_id,
        conversation_id,
        user_id,
        entry_text,
        retain_until_timestamp,
        mood,
        main_emotion,
        possible_trigger,
        communication_pattern,
        reflection_takeaway,
        suggested_next_step
      )
      VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *;
    `,
    [
      safeOwnerUserId,
      conversationId || null,
      safeEntryText,
      retainUntilTimestamp,
      mood || null,
      reflection.main_emotion || null,
      reflection.possible_trigger || null,
      reflection.communication_pattern || null,
      reflection.reflection_takeaway || null,
      reflection.suggested_next_step || null,
    ]
  )
    .then((result) => {
      const entry = result.rows && result.rows[0];
      return entry ? { ok: true, status: 201, entry } : serviceUnavailable();
    })
    .catch(() => serviceUnavailable());
}

function listOwnedJournalEntries({ pool, ownerUserId, conversationId = null, limit = 50 } = {}) {
  if (!pool || typeof pool.query !== "function") {
    return Promise.resolve(serviceUnavailable());
  }

  const safeOwnerUserId = normalizeOwner(ownerUserId);
  if (!safeOwnerUserId) {
    return Promise.resolve(invalidRequest());
  }

  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  return pool.query(
    `
      SELECT
        id,
        owner_user_id,
        conversation_id,
        user_id,
        entry_text,
        mood,
        main_emotion,
        possible_trigger,
        communication_pattern,
        reflection_takeaway,
        suggested_next_step,
        retain_until_timestamp,
        created_at_timestamp
      FROM journal_entries
      WHERE owner_user_id = $1
        AND ($2::text IS NULL OR conversation_id = $2)
      ORDER BY created_at_timestamp DESC
      LIMIT $3;
    `,
    [safeOwnerUserId, conversationId || null, safeLimit]
  )
    .then((result) => ({ ok: true, status: 200, entries: result.rows || [] }))
    .catch(() => serviceUnavailable());
}

module.exports = {
  createOwnedJournalEntry,
  listOwnedJournalEntries,
};
