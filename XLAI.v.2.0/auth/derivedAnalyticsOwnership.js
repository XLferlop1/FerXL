"use strict";

const { getOwnedConversation } = require("./conversationOwnership.js");

function serviceUnavailable() {
  return { ok: false, status: 503, error: "conversation_service_unavailable" };
}

function labelFromScore(score) {
  if (score == null || Number.isNaN(score)) return "low";
  if (score < 0.4) return "low";
  if (score < 0.7) return "medium";
  return "high";
}

function shortPreview(text, maxLen = 140) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  return raw.length > maxLen ? `${raw.slice(0, maxLen - 1)}...` : raw;
}

function readOwnedBehaviorFeedback({ pool, ownerUserId, conversationId } = {}) {
  if (!pool || typeof pool.query !== "function") return Promise.resolve(serviceUnavailable());

  return Promise.resolve(getOwnedConversation({ pool, ownerUserId, conversationId }))
    .then((ownership) => {
      if (!ownership.ok) return ownership;

      const safeConversationUuid = ownership.conversation.id;

      return pool.query(
        `
          SELECT
            m.intensity_score,
            m.pre_send_emotion,
            m.created_at_timestamp
          FROM messages m
          JOIN conversations c ON c.id = m.conversation_uuid
          WHERE m.conversation_uuid = $1
            AND c.owner_user_id = $2
          ORDER BY m.created_at_timestamp DESC
          LIMIT 50;
        `,
        [safeConversationUuid, ownerUserId]
      ).then((result) => {
        const rows = result.rows || [];
        const recent = rows.filter((r) => r.intensity_score != null);

        let avg = null;
        if (recent.length > 0) {
          const sum = recent.reduce(
            (acc, r) => acc + Number(r.intensity_score || 0),
            0
          );
          avg = sum / recent.length;
        }

        const riskLevel = labelFromScore(avg);

        const emotionCounts = {};
        for (const r of rows) {
          if (!r.pre_send_emotion) continue;
          const e = String(r.pre_send_emotion).toLowerCase();
          emotionCounts[e] = (emotionCounts[e] || 0) + 1;
        }
        let topEmotion = null;
        let topCount = 0;
        for (const [e, count] of Object.entries(emotionCounts)) {
          if (count > topCount) {
            topCount = count;
            topEmotion = e;
          }
        }

        let coachHint = "Your recent messages look fairly steady.";
        if (riskLevel === "high") {
          coachHint =
            "Tension looks high. Try slowing down, naming how you feel, and asking one curious question instead of defending.";
        } else if (riskLevel === "medium") {
          coachHint =
            "There’s some emotional charge here. Consider one validating sentence before sharing your side.";
        }

        return {
          ok: true,
          status: 200,
          feedback: {
            riskLevel,
            averageIntensity: avg,
            topEmotion,
            coachHint,
            sampleSize: rows.length,
          },
        };
      });
    })
    .catch(() => serviceUnavailable());
}

function readOwnedInteractionTimeline({ pool, ownerUserId, conversationId, limit = 120 } = {}) {
  if (!pool || typeof pool.query !== "function") return Promise.resolve(serviceUnavailable());

  const safeLimit = Math.max(1, Math.min(Number(limit) || 120, 300));

  return Promise.resolve(getOwnedConversation({ pool, ownerUserId, conversationId }))
    .then((ownership) => {
      if (!ownership.ok) return ownership;

      const safeConversationUuid = ownership.conversation.id;

      return Promise.all([
        pool.query(
          `
            SELECT
              m.id,
              m.conversation_id,
              m.conversation_uuid,
              m.user_id,
              m.final_text,
              m.original_text,
              m.used_suggestion,
              m.intent_guess,
              m.risks,
              m.created_at_timestamp
            FROM messages m
            JOIN conversations c ON c.id = m.conversation_uuid
            WHERE m.conversation_uuid = $1
              AND c.owner_user_id = $2
            ORDER BY m.created_at_timestamp DESC
            LIMIT $3;
          `,
          [safeConversationUuid, ownerUserId, safeLimit]
        ),
        pool.query(
          `
            SELECT
              ci.id,
              ci.conversation_id,
              ci.conversation_uuid,
              ci.user_id,
              ci.coach_question_text,
              ci.coach_response_text,
              ci.intent_type,
              ci.intent_guess,
              ci.rewrite_text,
              ci.insight_text,
              ci.principle_text,
              ci.created_at_timestamp
            FROM coach_interactions ci
            JOIN conversations c ON c.id = ci.conversation_uuid
            WHERE ci.conversation_uuid = $1
              AND c.owner_user_id = $2
            ORDER BY ci.created_at_timestamp DESC
            LIMIT $3;
          `,
          [safeConversationUuid, ownerUserId, safeLimit]
        ),
      ]).then(([messagesResult, coachResult]) => {
        const messageEvents = (messagesResult.rows || []).map((row) => ({
          id: `m_${row.id}`,
          timestamp: row.created_at_timestamp,
          source: "message",
          eventType: "message_sent",
          conversationId: row.conversation_id || row.conversation_uuid,
          userId: row.user_id,
          preview: shortPreview(row.final_text || row.original_text || ""),
          context: {
            intentGuess: row.intent_guess || null,
            rewriteUsed: !!row.used_suggestion,
            risks: Array.isArray(row.risks) ? row.risks : [],
          },
        }));

        const coachEvents = (coachResult.rows || []).map((row) => ({
          id: `c_${row.id}`,
          timestamp: row.created_at_timestamp,
          source: "coach",
          eventType: "coach_interaction",
          conversationId: row.conversation_id || row.conversation_uuid,
          userId: row.user_id,
          preview: shortPreview(row.coach_question_text || ""),
          context: {
            intentType: row.intent_type || null,
            intentGuess: row.intent_guess || null,
            hasRewrite: !!row.rewrite_text,
            coachResponsePreview: shortPreview(row.coach_response_text || "", 110),
            rewritePreview: shortPreview(row.rewrite_text || "", 110),
            insightPreview: shortPreview(row.insight_text || "", 90),
            principlePreview: shortPreview(row.principle_text || "", 90),
          },
        }));

        const timeline = [...messageEvents, ...coachEvents]
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
          .slice(0, safeLimit);

        return {
          ok: true,
          status: 200,
          timeline,
          summary: {
            totalEvents: timeline.length,
            messageEvents: messageEvents.length,
            coachEvents: coachEvents.length,
          },
        };
      });
    })
    .catch(() => serviceUnavailable());
}

function readOwnedPatternSummary({ pool, ownerUserId, conversationId } = {}) {
  if (!pool || typeof pool.query !== "function") return Promise.resolve(serviceUnavailable());

  return Promise.resolve(getOwnedConversation({ pool, ownerUserId, conversationId }))
    .then((ownership) => {
      if (!ownership.ok) return ownership;

      const safeConversationUuid = ownership.conversation.id;

      return Promise.all([
        pool.query(
          `
            SELECT
              m.intensity_score,
              m.was_pause_taken,
              m.action_taken,
              m.risks,
              m.coach_mode,
              m.communication_intent_label,
              m.communication_emotion_primary,
              m.communication_relationship_type,
              m.communication_strategy_mode,
              m.communication_max_risk_severity,
              m.communication_risks
            FROM messages m
            JOIN conversations c ON c.id = m.conversation_uuid
            WHERE m.conversation_uuid = $1
              AND c.owner_user_id = $2
            ORDER BY m.created_at_timestamp DESC
            LIMIT 100;
          `,
          [safeConversationUuid, ownerUserId]
        ),
        pool.query(
          `
            SELECT ci.intent_type
            FROM coach_interactions ci
            JOIN conversations c ON c.id = ci.conversation_uuid
            WHERE ci.conversation_uuid = $1
              AND c.owner_user_id = $2
            ORDER BY ci.created_at_timestamp DESC
            LIMIT 100;
          `,
          [safeConversationUuid, ownerUserId]
        ),
      ]).then(([messagesResult, coachResult]) => {
        const rows = messagesResult.rows || [];
        const coachRows = coachResult.rows || [];

        const coachIntentTypeCounts = {};
        coachRows.forEach((r) => {
          const key = r.intent_type || "unknown";
          coachIntentTypeCounts[key] = (coachIntentTypeCounts[key] || 0) + 1;
        });

        const totalMessages = rows.length;
        if (totalMessages === 0) {
          return {
            ok: true,
            status: 200,
            summary: {
              totalMessages: 0,
              averageIntensity: null,
              pauseCount: 0,
              pauseRate: 0,
              actionFrequencies: {},
              topRisk: null,
              rewriteAcceptanceRate: 0,
              sentAnywayRate: 0,
              mostCommonCoachMode: null,
              topCommunicationIntent: null,
              topCommunicationEmotion: null,
              topCommunicationRelationship: null,
              topCommunicationStrategyMode: null,
              averageCommunicationMaxRiskSeverity: null,
              communicationRiskCounts: {},
              totalCoachInteractions: coachRows.length,
              coachIntentTypeCounts,
            },
            insights: ["No messages yet to analyze patterns."],
            nextBestSuggestion: "Keep practicing mindful communication.",
          };
        }

        const intensities = rows.map((r) => r.intensity_score).filter((i) => i != null);
        const averageIntensity = intensities.length > 0 ? intensities.reduce((a, b) => a + b, 0) / intensities.length : null;

        const pauseCount = rows.filter((r) => r.was_pause_taken).length;
        const pauseRate = totalMessages > 0 ? pauseCount / totalMessages : 0;

        const actionFrequencies = {};
        rows.forEach((r) => {
          const action = r.action_taken;
          if (action) actionFrequencies[action] = (actionFrequencies[action] || 0) + 1;
        });

        const allRisks = rows.flatMap((r) => r.risks || []).filter((risk) => risk);
        const riskCounts = {};
        allRisks.forEach((risk) => { riskCounts[risk] = (riskCounts[risk] || 0) + 1; });
        const topRisk = Object.keys(riskCounts).sort((a, b) => riskCounts[b] - riskCounts[a])[0] || null;

        const rewriteAcceptanceRate = pauseCount > 0 ? rows.filter((r) => r.was_pause_taken && r.action_taken === "used_suggestion").length / pauseCount : 0;
        const sentAnywayRate = pauseCount > 0 ? rows.filter((r) => r.was_pause_taken && r.action_taken === "sent_anyway").length / pauseCount : 0;

        const coachModes = rows.map((r) => r.coach_mode).filter((m) => m);
        const modeCounts = {};
        coachModes.forEach((mode) => { modeCounts[mode] = (modeCounts[mode] || 0) + 1; });
        const mostCommonCoachMode = Object.keys(modeCounts).sort((a, b) => modeCounts[b] - modeCounts[a])[0] || null;

        const countMostCommon = (values = []) => {
          const counts = {};
          values.filter(Boolean).forEach((value) => {
            const key = String(value);
            counts[key] = (counts[key] || 0) + 1;
          });
          const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || null;
          return { top, counts };
        };

        const topIntentSummary = countMostCommon(rows.map((r) => r.communication_intent_label));
        const topEmotionSummary = countMostCommon(rows.map((r) => r.communication_emotion_primary));
        const topRelationshipSummary = countMostCommon(rows.map((r) => r.communication_relationship_type));
        const topStrategyModeSummary = countMostCommon(rows.map((r) => r.communication_strategy_mode));

        const maxRiskSeverityValues = rows
          .map((r) => r.communication_max_risk_severity)
          .filter((v) => typeof v === "number");
        const averageCommunicationMaxRiskSeverity = maxRiskSeverityValues.length
          ? maxRiskSeverityValues.reduce((a, b) => a + b, 0) / maxRiskSeverityValues.length
          : null;

        const communicationRiskCounts = {};
        rows
          .flatMap((r) => (Array.isArray(r.communication_risks) ? r.communication_risks : []))
          .filter(Boolean)
          .forEach((riskType) => {
            const key = String(riskType);
            communicationRiskCounts[key] = (communicationRiskCounts[key] || 0) + 1;
          });

        const insights = [];
        let nextBestSuggestion = "Keep practicing mindful communication.";

        const modeStyle = mostCommonCoachMode === "soft" ? "gentle" : mostCommonCoachMode === "direct" ? "clear" : "balanced";

        if (pauseRate > 0.5 && rewriteAcceptanceRate > 0.7) {
          insights.push(`You're thoughtfully pausing and often embracing AI suggestions — this ${modeStyle} approach is building strong communication habits.`);
        } else if (pauseRate > 0.5 && sentAnywayRate > 0.5) {
          insights.push("You pause frequently but prefer your original wording, showing confidence in your voice while being mindful.");
        } else if (pauseRate < 0.2 && averageIntensity > 0.6) {
          insights.push("Your messages carry emotional intensity, and you send quickly — consider brief pauses to ensure your intent comes through clearly.");
          nextBestSuggestion = "Try a 5-second pause before sending intense messages.";
        } else if (pauseRate < 0.2) {
          insights.push("You tend to send messages without pausing, which can be efficient but might miss opportunities for reflection.");
          nextBestSuggestion = "Experiment with pausing on messages that feel important.";
        }

        if (averageIntensity && averageIntensity > 0.6 && topRisk) {
          insights.push(`Your communication often has higher intensity, with "${topRisk}" being a common risk — this awareness can help you navigate challenges.`);
        } else if (averageIntensity && averageIntensity < 0.4) {
          insights.push("Your messages tend to be calm and measured, which helps maintain positive interactions.");
        }

        if (rewriteAcceptanceRate > 0.7) {
          insights.push("You frequently accept AI rephrasing, showing openness to refining your communication style.");
        } else if (rewriteAcceptanceRate < 0.3 && sentAnywayRate > 0.5) {
          insights.push("You prefer sticking with your original messages even after pauses, valuing authenticity in your expression.");
          nextBestSuggestion = "Consider reviewing AI suggestions as optional inspiration rather than requirements.";
        }

        while (insights.length < 2) {
          if (mostCommonCoachMode) {
            insights.push(`Your preference for ${mostCommonCoachMode} coaching suggests you value ${modeStyle} guidance in communication.`);
          } else {
            insights.push("Your communication patterns are developing well with consistent use of the app.");
          }
        }
        if (insights.length > 4) insights.splice(4);

        if (pauseRate < 0.3 && averageIntensity > 0.5) {
          nextBestSuggestion = "Practice pausing on emotionally charged messages to improve clarity.";
        } else if (rewriteAcceptanceRate < 0.4 && pauseRate > 0.4) {
          nextBestSuggestion = "When pausing, try experimenting with AI suggestions to see what resonates.";
        } else if (sentAnywayRate > 0.6) {
          nextBestSuggestion = "Reflect on why you often send anyway — it might reveal strong communication instincts.";
        }

        return {
          ok: true,
          status: 200,
          summary: {
            totalMessages,
            averageIntensity,
            pauseCount,
            pauseRate,
            actionFrequencies,
            topRisk,
            rewriteAcceptanceRate,
            sentAnywayRate,
            mostCommonCoachMode,
            topCommunicationIntent: topIntentSummary.top,
            topCommunicationEmotion: topEmotionSummary.top,
            topCommunicationRelationship: topRelationshipSummary.top,
            topCommunicationStrategyMode: topStrategyModeSummary.top,
            averageCommunicationMaxRiskSeverity,
            communicationRiskCounts,
            totalCoachInteractions: coachRows.length,
            coachIntentTypeCounts,
          },
          insights,
          nextBestSuggestion,
        };
      });
    })
    .catch(() => serviceUnavailable());
}

module.exports = {
  readOwnedBehaviorFeedback,
  readOwnedInteractionTimeline,
  readOwnedPatternSummary,
};
