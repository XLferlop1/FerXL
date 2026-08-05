"use strict";

function asTrimmedString(value) {
  if (value == null) return "";
  return String(value).trim();
}

function firstNonEmpty(values) {
  for (const value of values) {
    const normalized = asTrimmedString(value);
    if (normalized) return normalized;
  }
  return "";
}

function normalizeRoute(route) {
  const raw = asTrimmedString(route);
  if (!raw) return "";
  const withoutQuery = raw.split("?")[0] || "";
  return withoutQuery.trim();
}

function collectText(body, candidates) {
  const sources = [];
  const fragments = [];

  for (const field of candidates) {
    const value = asTrimmedString(body && body[field]);
    if (!value) continue;
    sources.push(field);
    fragments.push(value);
  }

  return {
    text: fragments.join("\n"),
    textSources: sources,
  };
}

function classifyByRoute(route) {
  if (route === "/api/send") {
    return {
      contextType: "messaging_send",
      channel: "messaging",
      requestedAction: "send_message",
      textFields: ["finalText", "originalText", "pauseReason"],
    };
  }

  if (route === "/api/rephrase") {
    return {
      contextType: "messaging_rephrase",
      channel: "messaging",
      requestedAction: "rephrase_message",
      textFields: ["text", "draft"],
    };
  }

  if (route === "/api/analyze-intensity") {
    return {
      contextType: "coaching_analysis",
      channel: "coach",
      requestedAction: "analyze_intensity",
      textFields: ["text", "draft"],
    };
  }

  if (route === "/api/coach-interactions") {
    return {
      contextType: "coach_interaction",
      channel: "coach",
      requestedAction: "store_coach_interaction",
      textFields: ["coachQuestionText", "coachResponseText", "rewriteText"],
    };
  }

  if (route === "/api/journal-entries") {
    return {
      contextType: "journal_entry",
      channel: "journal",
      requestedAction: "journal_entry",
      textFields: ["entryText"],
    };
  }

  return {
    contextType: "unknown",
    channel: "unknown",
    requestedAction: "unknown",
    textFields: ["text", "draft", "finalText", "originalText", "coachQuestionText", "entryText"],
  };
}

function buildContextEnvelope({ route, body, query } = {}) {
  const safeBody = body && typeof body === "object" ? body : {};
  const safeQuery = query && typeof query === "object" ? query : {};

  const normalizedRoute = normalizeRoute(route);
  const classified = classifyByRoute(normalizedRoute);
  const textPayload = collectText(safeBody, classified.textFields);

  const userId =
    firstNonEmpty([
      safeBody.userId,
      safeBody.user_id,
      safeQuery.userId,
      safeQuery.user_id,
    ]) || null;

  const conversationId =
    firstNonEmpty([
      safeBody.conversationId,
      safeBody.conversation_id,
      safeQuery.conversation,
      safeQuery.conversationId,
      safeQuery.conversation_id,
    ]) || null;

  return {
    contextType: classified.contextType,
    route: normalizedRoute || "unknown",
    text: textPayload.text,
    textSources: textPayload.textSources,
    channel: classified.channel,
    requestedAction: classified.requestedAction,
    userId,
    conversationId,
  };
}

module.exports = {
  buildContextEnvelope,
};
