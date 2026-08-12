"use strict";

(async function () {
  const betaConfig = window.XL_BETA_CONFIG || {};
  const conversationId = betaConfig.defaultConversationId || "default";
  const userId = betaConfig.userId || "beta_default_user";

  const patternEl = document.getElementById("insightsPatternSummary");
  const behaviorEl = document.getElementById("insightsBehavior");
  const historyEl = document.getElementById("insightsHistoryTable");
  const coachSummaryEl = document.getElementById("insightsCoachSummary");
  const coachHistoryEl = document.getElementById("insightsCoachHistoryTable");
  const timelineEl = document.getElementById("insightsTimelineTable");
  const timelineCountEl = document.getElementById("insightsTimelineCount");
  const insightsUserBadge = document.getElementById("insightsUserBadge");
  const timelineFilterButtons = Array.from(document.querySelectorAll("[data-timeline-filter]"));

  if (insightsUserBadge) {
    insightsUserBadge.textContent = `User: ${userId}`;
  }

  let allTimelineEvents = [];
  let activeTimelineFilter = "all";

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderPatternSummary(data) {
    const insights = data?.insights || [];
    const nextBest = data?.nextBestSuggestion || "";
    const stats = data?.summary || {};

    const list = insights.length
      ? `<ul>${insights.map((i) => `<li>${i}</li>`).join("")}</ul>`
      : "<p>No patterns yet.</p>";

    patternEl.innerHTML = `
      ${list}
      ${nextBest ? `<p><strong>Next suggestion:</strong> ${nextBest}</p>` : ""}
      <p><strong>Total messages:</strong> ${stats.totalMessages || 0}</p>
      <p><strong>Total coach interactions:</strong> ${stats.totalCoachInteractions || 0}</p>
      ${stats.topCommunicationIntent ? `<p><strong>Top communication intent:</strong> ${escapeHtml(stats.topCommunicationIntent)}</p>` : ""}
      ${stats.topCommunicationEmotion ? `<p><strong>Top communication emotion:</strong> ${escapeHtml(stats.topCommunicationEmotion)}</p>` : ""}
      ${stats.topCommunicationRelationship ? `<p><strong>Top communication relationship:</strong> ${escapeHtml(stats.topCommunicationRelationship)}</p>` : ""}
      ${stats.topCommunicationStrategyMode ? `<p><strong>Top communication strategy mode:</strong> ${escapeHtml(stats.topCommunicationStrategyMode)}</p>` : ""}
      ${typeof stats.averageCommunicationMaxRiskSeverity === "number" ? `<p><strong>Avg communication max risk severity:</strong> ${stats.averageCommunicationMaxRiskSeverity.toFixed(2)}</p>` : ""}
    `;
  }

  function renderBehavior(data) {
    const feedback = data?.feedback || {};
    behaviorEl.innerHTML = `
      <p><strong>Coach hint:</strong> ${feedback.coachHint || "No hint yet."}</p>
      <p><strong>Average intensity:</strong> ${typeof feedback.avgIntensity === "number" ? feedback.avgIntensity.toFixed(2) : "n/a"}</p>
      <p><strong>Risk level:</strong> ${feedback.riskLevel || "n/a"}</p>
    `;
  }

  function renderHistory(data) {
    const messages = (data?.messages || []).slice(0, 30);
    if (!messages.length) {
      historyEl.innerHTML = '<tr><td colspan="5">No message history yet.</td></tr>';
      return;
    }

    historyEl.innerHTML = messages
      .map((m) => {
        const created = m.created_at_timestamp || m.created_at || "";
        const time = created ? new Date(created).toLocaleString() : "";
        const finalText = (m.final_text || m.original_text || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const intensity = typeof m.intensity_score === "number" ? m.intensity_score.toFixed(2) : "";
        const intent = m.intent_guess || "";
        const risks = Array.isArray(m.risks) ? m.risks.join(", ") : "";

        return `
          <tr>
            <td>${time}</td>
            <td>${finalText}</td>
            <td>${intensity}</td>
            <td>${intent}</td>
            <td>${risks}</td>
          </tr>
        `;
      })
      .join("");
  }

  function renderCoachSummary(data) {
    const summary = data?.summary || {};
    const byIntent = summary.byIntentType || {};
    const intentLines = Object.keys(byIntent).length
      ? `<ul>${Object.entries(byIntent)
          .map(([k, v]) => `<li><strong>${k}</strong>: ${v}</li>`)
          .join("")}</ul>`
      : "<p>No coach interactions yet.</p>";

    coachSummaryEl.innerHTML = `
      <p><strong>Total coach interactions:</strong> ${summary.totalCoachInteractions || 0}</p>
      ${intentLines}
    `;
  }

  function renderCoachHistory(data) {
    const interactions = (data?.interactions || []).slice(0, 30);
    if (!interactions.length) {
      coachHistoryEl.innerHTML = '<tr><td colspan="5">No coach interactions yet.</td></tr>';
      return;
    }

    coachHistoryEl.innerHTML = interactions
      .map((i) => {
        const created = i.created_at_timestamp || "";
        const time = created ? new Date(created).toLocaleString() : "";
        const question = (i.coach_question_text || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const intentType = i.intent_type || "";
        const response = (i.coach_response_text || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const rewrite = (i.rewrite_text || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");

        return `
          <tr>
            <td>${time}</td>
            <td>${question}</td>
            <td>${intentType}</td>
            <td>${response}</td>
            <td>${rewrite}</td>
          </tr>
        `;
      })
      .join("");
  }

  function getFilteredTimelineEvents() {
    if (activeTimelineFilter === "all") return allTimelineEvents;
    return allTimelineEvents.filter((event) => event.source === activeTimelineFilter);
  }

  function updateTimelineFilterUI() {
    timelineFilterButtons.forEach((btn) => {
      const value = btn.getAttribute("data-timeline-filter") || "all";
      btn.classList.toggle("is-active", value === activeTimelineFilter);
    });
  }

  function renderTimelineRows(events) {
    if (!events.length) {
      timelineEl.innerHTML = '<tr><td colspan="5">No timeline events for this filter yet.</td></tr>';
      return;
    }

    timelineEl.innerHTML = events
      .map((event) => {
        const time = event.timestamp ? new Date(event.timestamp).toLocaleString() : "";
        const source = escapeHtml(event.source || "");
        const eventType = escapeHtml(event.eventType || "");
        const preview = escapeHtml(event.preview || "");
        const context = event.context || {};

        const contextParts = [];
        if (context.intentType) contextParts.push(`intent: ${escapeHtml(context.intentType)}`);
        if (context.intentGuess) contextParts.push(`guess: ${escapeHtml(context.intentGuess)}`);
        if (typeof context.rewriteUsed === "boolean") contextParts.push(`rewrite used: ${context.rewriteUsed ? "yes" : "no"}`);
        if (typeof context.hasRewrite === "boolean") contextParts.push(`has rewrite: ${context.hasRewrite ? "yes" : "no"}`);

        const contextText = contextParts.join(" · ") || "-";

        return `
          <tr>
            <td>${time}</td>
            <td>${source}</td>
            <td>${eventType}</td>
            <td>${preview}</td>
            <td>${contextText}</td>
          </tr>
        `;
      })
      .join("");
  }

  function renderTimeline(data) {
    allTimelineEvents = data?.timeline || [];
    const events = getFilteredTimelineEvents();
    if (timelineCountEl) {
      const total = allTimelineEvents.length;
      const label = activeTimelineFilter === "all" ? "all" : activeTimelineFilter;
      timelineCountEl.textContent = `${events.length} of ${total} (${label})`;
    }
    updateTimelineFilterUI();
    renderTimelineRows(events);
  }

  timelineFilterButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const value = btn.getAttribute("data-timeline-filter") || "all";
      if (!["all", "message", "coach"].includes(value)) return;
      activeTimelineFilter = value;
      renderTimeline({ timeline: allTimelineEvents });
    });
  });

  try {
    const [patternRes, behaviorRes, historyRes, coachRes, timelineRes] = await Promise.all([
      fetch(`/api/pattern-summary?conversation=${encodeURIComponent(conversationId)}&userId=${encodeURIComponent(userId)}`),
      fetch(`/api/behavior-feedback?conversation=${encodeURIComponent(conversationId)}&userId=${encodeURIComponent(userId)}`),
      fetch(`/api/messages?conversation=${encodeURIComponent(conversationId)}&userId=${encodeURIComponent(userId)}`),
      fetch(`/api/coach-interactions?conversation=${encodeURIComponent(conversationId)}&userId=${encodeURIComponent(userId)}`),
      fetch(`/api/interaction-timeline?conversation=${encodeURIComponent(conversationId)}&userId=${encodeURIComponent(userId)}&limit=120`),
    ]);

    const patternData = patternRes.ok ? await patternRes.json() : {};
    const behaviorData = behaviorRes.ok ? await behaviorRes.json() : {};
    const historyData = historyRes.ok ? await historyRes.json() : {};
    const coachData = coachRes.ok ? await coachRes.json() : {};
    const timelineData = timelineRes.ok ? await timelineRes.json() : {};

    renderPatternSummary(patternData);
    renderBehavior(behaviorData);
    renderHistory(historyData);
    renderCoachSummary(coachData);
    renderCoachHistory(coachData);
    renderTimeline(timelineData);
  } catch (error) {
    patternEl.textContent = "Could not load insights.";
    behaviorEl.textContent = "Could not load feedback.";
    historyEl.innerHTML = '<tr><td colspan="5">Could not load history.</td></tr>';
    if (coachSummaryEl) coachSummaryEl.textContent = "Could not load coach usage.";
    if (coachHistoryEl) coachHistoryEl.innerHTML = '<tr><td colspan="5">Could not load coach interaction history.</td></tr>';
    if (timelineEl) timelineEl.innerHTML = '<tr><td colspan="5">Could not load timeline.</td></tr>';
    if (timelineCountEl) timelineCountEl.textContent = "Unavailable";
    console.error("[XL AI] insights load error:", error);
  }
})();
