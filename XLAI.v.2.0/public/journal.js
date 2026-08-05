"use strict";

(function () {
  const betaConfig = window.XL_BETA_CONFIG || {};
  const conversationId = betaConfig.defaultConversationId || "default";
  const userId = betaConfig.userId || "beta_default_user";

  const entryInput = document.getElementById("journalEntryInput");
  const moodSelect = document.getElementById("journalMood");
  const saveBtn = document.getElementById("journalSaveBtn");
  const refreshBtn = document.getElementById("journalRefreshBtn");
  const statusEl = document.getElementById("journalStatus");
  const entriesListEl = document.getElementById("journalEntriesList");
  const latestAnalysisCard = document.getElementById("journalLatestAnalysis");
  const latestAnalysisContent = document.getElementById("journalAnalysisContent");
  const journalUserBadge = document.getElementById("journalUserBadge");

  if (journalUserBadge) {
    journalUserBadge.textContent = `User: ${userId}`;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDate(ts) {
    if (!ts) return "";
    try {
      return new Date(ts).toLocaleString();
    } catch (_) {
      return "";
    }
  }

  function renderAnalysis(entry) {
    if (!latestAnalysisCard || !latestAnalysisContent || !entry) return;

    latestAnalysisContent.innerHTML = `
      <div class="xl-journal-analysis-item">
        <p class="xl-label">Main Emotion</p>
        <p>${escapeHtml(entry.main_emotion || "-")}</p>
      </div>
      <div class="xl-journal-analysis-item">
        <p class="xl-label">Possible Trigger</p>
        <p>${escapeHtml(entry.possible_trigger || "-")}</p>
      </div>
      <div class="xl-journal-analysis-item">
        <p class="xl-label">Communication Pattern</p>
        <p>${escapeHtml(entry.communication_pattern || "-")}</p>
      </div>
      <div class="xl-journal-analysis-item">
        <p class="xl-label">Reflection Takeaway</p>
        <p>${escapeHtml(entry.reflection_takeaway || "-")}</p>
      </div>
      <div class="xl-journal-analysis-item">
        <p class="xl-label">Suggested Next Step</p>
        <p>${escapeHtml(entry.suggested_next_step || "-")}</p>
      </div>
    `;

    latestAnalysisCard.classList.remove("hidden");
  }

  function renderEntries(entries) {
    if (!entriesListEl) return;

    if (!Array.isArray(entries) || entries.length === 0) {
      entriesListEl.innerHTML = "<p class=\"xl-subtitle\">No journal entries yet. Start with one reflection today.</p>";
      return;
    }

    entriesListEl.innerHTML = entries
      .map((entry) => {
        return `
          <article class="xl-journal-entry-card">
            <div class="xl-journal-entry-head">
              <span class="xl-chip">${escapeHtml(entry.mood || "no mood")}</span>
              <span class="xl-subtitle">${escapeHtml(formatDate(entry.created_at_timestamp))}</span>
            </div>
            <p class="xl-journal-entry-text">${escapeHtml(entry.entry_text || "")}</p>
            <div class="xl-journal-entry-grid">
              <div><strong>Main emotion:</strong> ${escapeHtml(entry.main_emotion || "-")}</div>
              <div><strong>Possible trigger:</strong> ${escapeHtml(entry.possible_trigger || "-")}</div>
              <div><strong>Pattern:</strong> ${escapeHtml(entry.communication_pattern || "-")}</div>
              <div><strong>Takeaway:</strong> ${escapeHtml(entry.reflection_takeaway || "-")}</div>
              <div><strong>Next step:</strong> ${escapeHtml(entry.suggested_next_step || "-")}</div>
            </div>
          </article>
        `;
      })
      .join("");
  }

  async function loadEntries() {
    if (!entriesListEl) return;
    entriesListEl.innerHTML = "<p class=\"xl-subtitle\">Loading entries...</p>";

    try {
      const res = await fetch(`/api/journal-entries?conversation=${encodeURIComponent(conversationId)}&limit=50`);
      const data = await res.json();
      renderEntries(data.entries || []);
    } catch (err) {
      console.error("[XL AI] load journal entries error:", err);
      entriesListEl.innerHTML = "<p class=\"xl-subtitle\">Could not load entries right now.</p>";
    }
  }

  async function saveEntry() {
    if (!entryInput || !saveBtn) return;
    const entryText = String(entryInput.value || "").trim();
    const mood = moodSelect ? moodSelect.value : "";

    if (!entryText) {
      if (statusEl) statusEl.textContent = "Write a short reflection before saving.";
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";
    if (statusEl) statusEl.textContent = "";

    try {
      const res = await fetch("/api/journal-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          userId,
          entryText,
          mood,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data?.entry) {
        throw new Error(data?.error || "Failed to save entry");
      }

      renderAnalysis(data.entry);
      entryInput.value = "";
      if (moodSelect) moodSelect.value = "";
      if (statusEl) statusEl.textContent = "Entry saved.";
      await loadEntries();
    } catch (err) {
      console.error("[XL AI] save journal entry error:", err);
      if (statusEl) statusEl.textContent = "Could not save entry right now.";
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Entry";
    }
  }

  if (saveBtn) {
    saveBtn.addEventListener("click", saveEntry);
  }

  if (refreshBtn) {
    refreshBtn.addEventListener("click", loadEntries);
  }

  loadEntries();
})();
