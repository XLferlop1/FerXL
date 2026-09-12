"use strict";

const { randomUUID } = require("node:crypto");

function isValidUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

function serviceUnavailable() {
  return { ok: false, status: 503, error: "conversation_service_unavailable" };
}

function invalidConversation() {
  return { ok: false, status: 400, error: "invalid_conversation" };
}

function notFound() {
  return { ok: false, status: 404, error: "conversation_not_found" };
}

function createOwnedConversation({
  pool,
  ownerUserId,
  title,
  generateId = randomUUID,
  ...requestData
} = {}) {
  if (!pool || typeof pool.query !== "function") {
    return serviceUnavailable();
  }

  const safeOwnerUserId = typeof ownerUserId === "string" ? ownerUserId.trim() : "";
  if (!safeOwnerUserId) {
    return invalidConversation();
  }

  const disallowedIdentityFields = [
    requestData.id,
    requestData.conversationId,
    requestData.conversation_id,
    requestData.conversation_uuid,
    requestData.owner_user_id,
    requestData.ownerUserId,
    requestData.clientOwnerUserId,
    requestData.clientConversationId,
  ];

  if (disallowedIdentityFields.some((value) => value !== undefined && value !== null && value !== "")) {
    return { ok: false, status: 400, error: "invalid_conversation_request" };
  }

  const safeTitle = typeof title === "string" ? title.trim() : "";
  const normalizedTitle = safeTitle.length > 0 ? safeTitle.slice(0, 200) : null;
  const conversationIdValue = generateId();

  return pool.query(
    `
      INSERT INTO conversations (id, owner_user_id, title)
      VALUES ($1, $2, $3)
      RETURNING id, owner_user_id, title, created_at;
    `,
    [conversationIdValue, safeOwnerUserId, normalizedTitle]
  )
    .then((result) => {
      const row = result.rows && result.rows[0];
      if (!row || !row.id || row.owner_user_id !== safeOwnerUserId) {
        return serviceUnavailable();
      }
      return {
        ok: true,
        status: 201,
        conversation: {
          id: row.id,
          owner_user_id: row.owner_user_id,
          title: row.title || null,
          created_at: row.created_at || null,
        },
      };
    })
    .catch(() => serviceUnavailable());
}

function listOwnedConversations({ pool, ownerUserId } = {}) {
  if (!pool || typeof pool.query !== "function") {
    return serviceUnavailable();
  }

  const safeOwnerUserId = typeof ownerUserId === "string" ? ownerUserId.trim() : "";
  if (!safeOwnerUserId) {
    return invalidConversation();
  }

  return pool.query(
    `
      SELECT id, owner_user_id, title, created_at
      FROM conversations
      WHERE owner_user_id = $1
      ORDER BY created_at DESC, id DESC;
    `,
    [safeOwnerUserId]
  )
    .then((result) => ({
      ok: true,
      status: 200,
      conversations: (result.rows || []).map((row) => ({
        conversation_id: row.id,
        display_name: row.title || "Conversation",
        last_message_preview: "",
        last_message_at: row.created_at,
        owner_user_id: row.owner_user_id,
      })),
    }))
    .catch(() => serviceUnavailable());
}

function getOwnedConversation({ pool, ownerUserId, conversationId } = {}) {
  if (!pool || typeof pool.query !== "function") {
    return serviceUnavailable();
  }

  const safeOwnerUserId = typeof ownerUserId === "string" ? ownerUserId.trim() : "";
  if (!safeOwnerUserId) {
    return invalidConversation();
  }

  const safeConversationId = typeof conversationId === "string" ? conversationId.trim() : "";
  if (!isValidUuid(safeConversationId)) {
    return invalidConversation();
  }

  return pool.query(
    `
      SELECT id, owner_user_id, title, created_at
      FROM conversations
      WHERE id = $1
        AND owner_user_id = $2;
    `,
    [safeConversationId, safeOwnerUserId]
  )
    .then((result) => {
      const row = result.rows && result.rows[0];
      if (!row) {
        return notFound();
      }
      return {
        ok: true,
        status: 200,
        conversation: {
          id: row.id,
          owner_user_id: row.owner_user_id,
          title: row.title || null,
          created_at: row.created_at || null,
        },
      };
    })
    .catch(() => serviceUnavailable());
}

module.exports = {
  createOwnedConversation,
  listOwnedConversations,
  getOwnedConversation,
};
