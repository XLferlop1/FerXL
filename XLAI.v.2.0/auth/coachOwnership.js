"use strict";

function serviceUnavailable() {
  return { ok: false, status: 503, error: "coach_service_unavailable" };
}

function invalidConversation() {
  return { ok: false, status: 400, error: "invalid_coach_request" };
}

function notFound() {
  return { ok: false, status: 404, error: "conversation_not_found" };
}

function isValidUuid(value) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

function normalizeUuid(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return isValidUuid(normalized) ? normalized : null;
}

function normalizeOwner(value) {
  return typeof value === "string" ? value.trim() : "";
}

function createOwnedCoachInteraction({
  pool,
  ownerUserId,
  conversationUuid,
  coachQuestionText,
  coachResponseText = null,
  intentGuess = null,
  intentType = null,
  rewriteText = null,
  insightText = null,
  principleText = null,
  intensityScore = null,
  intensityLabel = null,
  risks = null,
  coachMode = null,
  communicationFields = {},
} = {}) {
  if (!pool || typeof pool.query !== "function") return Promise.resolve(serviceUnavailable());

  const safeOwnerUserId = normalizeOwner(ownerUserId);
  const safeConversationUuid = normalizeUuid(conversationUuid);
  const safeQuestion = typeof coachQuestionText === "string" ? coachQuestionText.trim() : "";
  if (!safeOwnerUserId || !safeConversationUuid || !safeQuestion) {
    return Promise.resolve(invalidConversation());
  }

  const fields = communicationFields || {};
  return pool.query(
    `
      INSERT INTO coach_interactions (
        conversation_uuid,
        conversation_id,
        user_id,
        coach_question_text,
        coach_response_text,
        intent_guess,
        intent_type,
        rewrite_text,
        insight_text,
        principle_text,
        intensity_score,
        intensity_label,
        risks,
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
        c.id::text,
        NULL,
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
      RETURNING *;
    `,
    [
      safeConversationUuid,
      safeOwnerUserId,
      safeQuestion,
      coachResponseText,
      intentGuess,
      intentType,
      rewriteText,
      insightText,
      principleText,
      typeof intensityScore === "number" ? intensityScore : null,
      intensityLabel,
      Array.isArray(risks) ? risks : null,
      coachMode,
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
      ? { ok: true, status: 201, interaction: result.rows[0] }
      : notFound())
    .catch(() => serviceUnavailable());
}

function listOwnedCoachInteractions({ pool, ownerUserId, conversationUuid } = {}) {
  if (!pool || typeof pool.query !== "function") return Promise.resolve(serviceUnavailable());

  const safeOwnerUserId = normalizeOwner(ownerUserId);
  const safeConversationUuid = normalizeUuid(conversationUuid);
  if (!safeOwnerUserId || !safeConversationUuid) {
    return Promise.resolve(invalidConversation());
  }

  return pool.query(
    `
      SELECT id
      FROM conversations
      WHERE id = $1
        AND owner_user_id = $2;
    `,
    [safeConversationUuid, safeOwnerUserId]
  )
    .then((conversationResult) => {
      if (!conversationResult.rows || conversationResult.rows.length === 0) return notFound();
      return pool.query(
        `
          SELECT
            ci.id,
            ci.conversation_uuid,
            ci.conversation_id,
            ci.user_id,
            ci.coach_question_text,
            ci.coach_response_text,
            ci.intent_guess,
            ci.intent_type,
            ci.rewrite_text,
            ci.insight_text,
            ci.principle_text,
            ci.intensity_score,
            ci.intensity_label,
            ci.risks,
            ci.coach_mode,
            ci.communication_intent_label,
            ci.communication_intent_confidence,
            ci.communication_emotion_primary,
            ci.communication_emotion_intensity,
            ci.communication_relationship_type,
            ci.communication_relationship_confidence,
            ci.communication_recipient_reaction,
            ci.communication_strategy_mode,
            ci.communication_strategy_approach,
            ci.communication_risks,
            ci.communication_max_risk_severity,
            ci.created_at_timestamp
          FROM coach_interactions ci
          JOIN conversations c
            ON c.id = ci.conversation_uuid
          WHERE ci.conversation_uuid = $1
            AND c.owner_user_id = $2
          ORDER BY ci.created_at_timestamp DESC
          LIMIT 100;
        `,
        [safeConversationUuid, safeOwnerUserId]
      );
    })
    .then((result) => result && result.ok === false
      ? result
      : ({ ok: true, status: 200, interactions: result.rows || [] }))
    .catch(() => serviceUnavailable());
}

module.exports = {
  createOwnedCoachInteraction,
  listOwnedCoachInteractions,
};
