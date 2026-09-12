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

function normalizeConversationId(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return isValidUuid(normalized) ? normalized : null;
}

function readOwnedMessages({ pool, ownerUserId, conversationId, limit = 200, order = "DESC" } = {}) {
  if (!pool || typeof pool.query !== "function") return serviceUnavailable();

  const safeOwnerUserId = typeof ownerUserId === "string" ? ownerUserId.trim() : "";
  const safeConversationId = normalizeConversationId(conversationId);
  if (!safeOwnerUserId || !safeConversationId) {
    return invalidConversation();
  }

  const safeOrder = String(order).toUpperCase() === "ASC" ? "ASC" : "DESC";
  return pool.query(
    `
      SELECT
        m.id,
        m.conversation_id,
        m.conversation_uuid,
        m.user_id,
        m.original_text,
        m.final_text,
        m.pre_send_emotion,
        m.intensity_score,
        m.was_pause_taken,
        m.used_suggestion,
        m.action_taken,
        m.pause_reason,
        m.risks,
        m.intent_guess,
        m.coach_mode,
        m.created_at_timestamp
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_uuid
      WHERE m.conversation_uuid = $1
        AND c.owner_user_id = $2
      ORDER BY m.created_at_timestamp ${safeOrder}
      LIMIT $3;
    `,
    [safeConversationId, safeOwnerUserId, limit]
  )
    .then((result) => {
      const messages = result.rows || [];
      return messages.length > 0 ? { ok: true, status: 200, messages } : notFound();
    })
    .catch(() => serviceUnavailable());
}

function insertOwnedMessage({
  pool,
  ownerUserId,
  conversationId,
  originalText = null,
  finalText,
  preSendEmotion = null,
  intensityScore = null,
  wasPauseTaken = false,
  usedSuggestion = false,
  actionTaken = null,
  pauseReason = null,
  risks = null,
  intentGuess = null,
  coachMode = null,
  communicationFields = {},
} = {}) {
  if (!pool || typeof pool.query !== "function") return Promise.resolve(serviceUnavailable());

  const safeOwnerUserId = typeof ownerUserId === "string" ? ownerUserId.trim() : "";
  const safeConversationId = normalizeConversationId(conversationId);
  if (!safeOwnerUserId || !safeConversationId || !finalText) {
    return Promise.resolve(invalidConversation());
  }

  const fields = communicationFields || {};
  return pool.query(
    `
      INSERT INTO messages (
        conversation_id,
        conversation_uuid,
        user_id,
        original_text,
        final_text,
        pre_send_emotion,
        intensity_score,
        was_pause_taken,
        used_suggestion,
        action_taken,
        pause_reason,
        risks,
        intent_guess,
        coach_mode,
        communication_intent_label,
        communication_intent_confidence,
        communication_emotion_primary,
        communication_emotion_intensity,
        communication_relationship_type,
        communication_relationship_confidence,
        communication_recipient_reaction,
        communication_strategy_mode,
        communication_strategy_approach,
        communication_risks,
        communication_max_risk_severity
      )
      SELECT
        c.id,
        c.id,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13,
        $14,
        $15,
        $16,
        $17,
        $18,
        $19,
        $20,
        $21,
        $22,
        $23,
        $24
      FROM conversations c
      WHERE c.id = $1
        AND c.owner_user_id = $2
      RETURNING
        id,
        conversation_id,
        conversation_uuid,
        user_id,
        original_text,
        final_text,
        pre_send_emotion,
        intensity_score,
        was_pause_taken,
        used_suggestion,
        action_taken,
        pause_reason,
        risks,
        intent_guess,
        coach_mode,
        communication_intent_label,
        communication_intent_confidence,
        communication_emotion_primary,
        communication_emotion_intensity,
        communication_relationship_type,
        communication_relationship_confidence,
        communication_recipient_reaction,
        communication_strategy_mode,
        communication_strategy_approach,
        communication_risks,
        communication_max_risk_severity,
        created_at_timestamp;
    `,
    [
      safeConversationId,
      safeOwnerUserId,
      originalText || null,
      finalText,
      preSendEmotion || null,
      typeof intensityScore === "number" ? intensityScore : null,
      !!wasPauseTaken,
      !!usedSuggestion,
      actionTaken || null,
      pauseReason || null,
      Array.isArray(risks) ? risks : null,
      intentGuess || null,
      coachMode || null,
      fields.communicationIntentLabel || null,
      typeof fields.communicationIntentConfidence === "number" ? fields.communicationIntentConfidence : null,
      fields.communicationEmotionPrimary || null,
      typeof fields.communicationEmotionIntensity === "number" ? fields.communicationEmotionIntensity : null,
      fields.communicationRelationshipType || null,
      typeof fields.communicationRelationshipConfidence === "number" ? fields.communicationRelationshipConfidence : null,
      fields.communicationRecipientReaction || null,
      fields.communicationStrategyMode || null,
      fields.communicationStrategyApproach || null,
      Array.isArray(fields.communicationRisks) ? fields.communicationRisks : null,
      typeof fields.communicationMaxRiskSeverity === "number" ? fields.communicationMaxRiskSeverity : null,
    ]
  )
    .then((result) => result.rows && result.rows[0]
      ? { ok: true, status: 201, message: result.rows[0] }
      : notFound())
    .catch(() => serviceUnavailable());
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
  readOwnedMessages,
  insertOwnedMessage,
};
