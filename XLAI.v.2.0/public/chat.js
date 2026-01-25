// chat.js
// XL AI · Front-end “brain” controller for chat.html

"use strict";

/**
 * ---- Global state ----
 */
let currentConversationId = "alex";      // later this can come from URL/user auth
let currentUserId = "demo_user";        // placeholder user
let currentTone = "calm";               // calm | professional | low-key
let currentEmotion = null;              // calm | anxious | frustrated | sad | hopeful
let analyzerOn = true;                  // toggle via Analyzer button

// Pause modal state
let pendingRawText = "";
let pendingSuggestion = "";
let pendingIntensity = null;
let pauseTakenFlag = false;
// usedSuggestionFlag is defined below with other tracking vars

// For logging “original vs final”
// New explicit draft / suggestion tracking (MVP fields)
let draftOriginalText = null; // captures what user typed before applying suggestion
let lastSuggestionText = null; // last suggestion string
let usedSuggestionFlag = false; // whether user applied suggestion
let lastIntensityScore = null; // numeric intensity score
let wasPauseTaken = false; // if message was sent from pause modal
let lastIntensityInfo = null;

let currentCoachMode = "soft"; // soft | high
let rewriteStrength = "low"; // low | medium | high
/**
 * ---- DOM lookups ----
 */
const coachModeSoftBtn = document.getElementById("coachModeSoftBtn");
const coachModeHighBtn = document.getElementById("coachModeHighBtn");
const coachModeLabel = document.getElementById("coachModeLabel");

const chatHistoryContainer = document.getElementById("chatHistory");
const deliverButton = document.getElementById("deliverButton");

// Tone + suggestion controls
const toneButtons = Array.from(document.querySelectorAll("[data-tone-btn]"));
const currentToneLabel = document.getElementById("currentToneLabel");
const clearSuggestionButton = document.getElementById("clearSuggestionButton");
const rephraseButton = document.getElementById("rephraseButton");
const rephraseButtonTop = document.getElementById("rephraseButtonTop");

// Emotion controls
const emotionButtons = Array.from(document.querySelectorAll("[data-emotion-btn]"));

// Analyzer + coach
const analyzerToggle = document.getElementById("analyzerToggle");
const analyzerToggleBtn = document.getElementById("analyzerToggleBtn");
const analyzerStatusChip = document.getElementById("analyzerStatusChip");
const analyzerStatusLabel = document.getElementById("analyzerStatusLabel");

const coachRiskChip = document.getElementById("coachRiskChip");
const coachHintText = document.getElementById("coachHintText");
const refreshCoachButton = document.getElementById("refreshCoachButton");

// Pause modal
const pauseModal = document.getElementById("pauseModal");
const pauseIntensityLabel = document.getElementById("pauseIntensityLabel");
const pauseUseSuggestionButton = document.getElementById("pauseUseSuggestionButton");
const pauseSendAnywayButton = document.getElementById("pauseSendAnywayButton");
const pauseCancelButton = document.getElementById("pauseCancelButton");

const messageInput = document.getElementById("messageInput");
const useSuggestionBtn = document.getElementById("useSuggestionBtn");

// (Removed programmatic strength pill — top REPHRASE button present in DOM)

if (useSuggestionBtn) {
  useSuggestionBtn.addEventListener("click", () => {
    const suggestionText = document.getElementById("aiSuggestionText")?.textContent || "";
    if (!suggestionText) return;
    if (messageInput) {
      // capture what user had typed before overwriting
      draftOriginalText = messageInput.value || draftOriginalText || "";
      lastSuggestionText = suggestionText;
      messageInput.value = suggestionText;
    }
    usedSuggestionFlag = true;
  });
}

// Keep usedSuggestionFlag true once user applied suggestion (even if they edit it)
if (messageInput) {
  messageInput.addEventListener("input", () => {
    // if user typed something new after applying suggestion, still count as used
    if (usedSuggestionFlag && lastSuggestionText) {
      // leave usedSuggestionFlag true
      return;
    }
  });
}

console.log("✅ chat.js loaded");
document.addEventListener("DOMContentLoaded", () => {
  const badge = document.createElement("div");
  badge.textContent = "JS OK";
  badge.style.cssText = "position:fixed;top:10px;right:10px;z-index:99999;background:#7c5cff;color:white;padding:6px 10px;border-radius:10px;font-weight:700;font-size:12px;";
  document.body.appendChild(badge);
});
/**
 * ---- Helpers: UI ----
 */
function setCoachMode(mode) {
  currentCoachMode = mode === "high" ? "high" : "soft";

  if (coachModeLabel) coachModeLabel.textContent = currentCoachMode.toUpperCase();
  if (coachModeSoftBtn) coachModeSoftBtn.classList.toggle("is-active", currentCoachMode === "soft");
  if (coachModeHighBtn) coachModeHighBtn.classList.toggle("is-active", currentCoachMode === "high");
}

function savePrefs() {
  const prefs = {
    tone: currentTone,
    emotion: currentEmotion,
    analyzerOn,
    coachMode: currentCoachMode,
  };
  localStorage.setItem("xl_prefs", JSON.stringify(prefs));
}

function loadPrefs() {
  try {
    const raw = localStorage.getItem("xl_prefs");
    if (!raw) return;
    const prefs = JSON.parse(raw);

    if (prefs.tone) currentTone = prefs.tone;
    if ("emotion" in prefs) currentEmotion = prefs.emotion;
    if (typeof prefs.analyzerOn === "boolean") analyzerOn = prefs.analyzerOn;
    if (prefs.coachMode) currentCoachMode = prefs.coachMode;
  } catch (e) {}
}

function addBubble(text, role = "user") {
  if (!chatHistoryContainer) return;

  const div = document.createElement("div");
  div.className = `xl-bubble ${role === "ai" ? "xl-bubble-ai" : "xl-bubble-user"}`;
  div.textContent = text;

  chatHistoryContainer.appendChild(div);
  chatHistoryContainer.scrollTop = chatHistoryContainer.scrollHeight;
}

function setTone(tone) {
  currentTone = tone;
  if (currentToneLabel) {
    currentToneLabel.textContent = tone.toUpperCase();
  }
  toneButtons.forEach((btn) => {
    const btnTone = btn.getAttribute("data-tone");
    if (btnTone === tone) {
      btn.classList.add("is-active");
    } else {
      btn.classList.remove("is-active");
    }
  });
}

function setEmotion(emotion) {
  currentEmotion = emotion;
  emotionButtons.forEach((btn) => {
    const btnEmotion = btn.getAttribute("data-emotion");
    if (btnEmotion === emotion) {
      btn.classList.add("is-active");
    } else {
      btn.classList.remove("is-active");
    }
  });
}

function updateAnalyzerUI() {
  const label = document.getElementById("analyzerStatusLabel");
  const text = analyzerOn ? "ON" : "OFF";

  if (label) label.textContent = text;

  if (analyzerToggleBtn) {
    analyzerToggleBtn.classList.toggle("is-on", analyzerOn);
  }
}

function openPauseModal(intensityInfo, suggestion, rawText) {
  pendingRawText = rawText;
  pendingSuggestion = suggestion || rawText;
  pendingIntensity = intensityInfo;

  if (pauseIntensityLabel && intensityInfo && typeof intensityInfo.intensity === "number") {
    const score = intensityInfo.intensity;
    let label = "high intensity";
    if (score < 0.4) label = "low intensity";
    else if (score < 0.7) label = "high intensity";
    pauseIntensityLabel.textContent = label;
  }

  pauseTakenFlag = true;
  if (pauseModal) pauseModal.classList.remove("hidden");
}

function closePauseModal() {
  if (pauseModal) pauseModal.classList.add("hidden");
  pendingRawText = "";
  pendingSuggestion = "";
  pendingIntensity = null;
  pauseTakenFlag = false;
}

/**
 * ---- Helpers: Network calls ----
 */

// Call analyzer to get intensity + suggestion
async function analyzeText(rawText) {
  const text = (rawText || "").trim();
  if (!text) return;

  try {
    const res = await fetch("/api/analyze-intensity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        tone: currentTone,
        emotion: currentEmotion,
        rewriteStrength: rewriteStrength,
        conversationId: currentConversationId,
        userId: currentUserId,
      }),
    });

    const data = await res.json();
    console.log("[XL AI] /api/analyze-intensity result:", data);

    const intensityInfo = data.intensity || {};
    const suggestion = data.suggestion || "";

    // Track draft / suggestion state for logging and send behavior
    try {
      draftOriginalText = (messageInput && messageInput.value) ? messageInput.value : draftOriginalText;
    } catch (e) {}
    lastSuggestionText = suggestion || null;
    usedSuggestionFlag = false;
    lastIntensityScore = typeof intensityInfo.intensity === "number" ? intensityInfo.intensity : null;

    // Save intensity so /api/send can log it
    lastIntensityInfo = {
      intensity:
        typeof intensityInfo.intensity === "number"
          ? intensityInfo.intensity
          : null,
      label: intensityInfo.label || null,
    };

    // Update the little intensity chip / label
    const intensityLabelEl = document.getElementById("intensityLabel");
    if (intensityLabelEl) {
      intensityLabelEl.textContent = lastIntensityInfo.label || "low";
    }

    // Show the AI suggestion row
    const suggestionBox = document.getElementById("aiSuggestionText");
    const suggestionRow = document.getElementById("aiSuggestionRow");
    if (suggestion && suggestionBox && suggestionRow) {
      suggestionBox.textContent = suggestion;
      suggestionRow.style.display = "block";
    }
    if (suggestion) {
  addBubble(suggestion, "ai");
}

    // Refresh EQ coach summary
    await refreshEqCoach();
    return { intensity: lastIntensityInfo, suggestion };
  } catch (err) {
    console.error("[XL AI] /api/analyze-intensity error:", err);
  }
}

// Save message + metadata to DB
async function sendMessageToServer(originalText, finalText, intensityInfo, wasPauseTaken, usedSuggestion) {
  const payload = {
    conversationId: currentConversationId,
    originalText,
    finalText,
    emotion: currentEmotion,
    intensityScore:
      intensityInfo && typeof intensityInfo.intensity === "number"
        ? intensityInfo.intensity
        : null,
    wasPauseTaken: !!wasPauseTaken,
    usedSuggestion: !!usedSuggestion,
    userId: currentUserId,
  };

  console.log("[XL AI] /api/send payload:", payload);

  const res = await fetch("/api/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("[XL AI] /api/send failed:", res.status, errText);
    throw new Error("send failed");
  }

  const data = await res.json();
  console.log("[XL AI] /api/send success:", data);
  return data;
}

// Pull behavior feedback for the right-hand coach card
async function refreshEqCoach() {
  try {
    const url = `/api/behavior-feedback?conversation=${encodeURIComponent(
      currentConversationId
    )}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error("[XL AI] /api/behavior-feedback error status:", res.status);
      return;
    }
    const data = await res.json();
    console.log("[XL AI] /api/behavior-feedback:", data);

    const fb = data.feedback;
    if (!fb || !coachRiskChip || !coachHintText) return;

    // riskLevel chip
    const risk = fb.riskLevel || "low";
    let chipLabel = "Low intensity";
    if (risk === "medium") chipLabel = "Medium intensity";
    else if (risk === "high") chipLabel = "High intensity";

    coachRiskChip.textContent = chipLabel;

    // coach hint
    if (fb.coachHint) {
      coachHintText.textContent = fb.coachHint;
    }
  } catch (err) {
    console.error("[XL AI] refreshEqCoach error:", err);
  }
}

// Load previous messages into the history panel
async function loadHistory() {
  try {
    const url = `/api/history?conversation=${encodeURIComponent(
      currentConversationId
    )}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error("[XL AI] /api/history error status:", res.status);
      return;
    }
    const data = await res.json();
    console.log("[XL AI] /api/history:", data);

  if (!Array.isArray(data.messages)) return;
  chatHistoryContainer.innerHTML = "";
  data.messages.forEach((msg) => {
  const text = msg.final_text || msg.original_text || "";
  if (!text) return;
  const displayText = msg.used_suggestion ? `${text} ✓` : text;
  addBubble(displayText, "user");
});

  } catch (err) {
    console.error("[XL AI] loadHistory error:", err);
  }
}
  
/**
 * ---- Core flow: Deliver click ----
 */

/** 
 * ---- Core flow: Deliver click ----
 */

async function handleDeliverClick() {
  if (!messageInput) return;
  const raw = messageInput.value.trim();
  if (!raw) return;
deliverButton.disabled = true;
deliverButton.textContent = "WORKING...";
  // finalText is what's in the input now; originalText should be the
  // pre-suggestion text if the user clicked "USE THIS VERSION".
  const finalText = raw;
  // privacy-first: only store originalText if a suggestion was used
  const originalText = usedSuggestionFlag ? draftOriginalText || null : null;

  // Use lastIntensityInfo (from prior REPHRASE) for pause decisions; do not re-run analyzer here
  try {
    const intensityInfo = lastIntensityInfo;

    if (intensityInfo && typeof intensityInfo.intensity === "number") {
      const score = intensityInfo.intensity;
      if (currentCoachMode === "soft" && score >= 0.85) {
        openPauseModal(intensityInfo, lastSuggestionText || finalText, raw);
        return;
      }
      if (currentCoachMode === "high" && score >= 0.7) {
        openPauseModal(intensityInfo, lastSuggestionText || finalText, raw);
        return;
      }
    }

    // Send: final_text must be what's currently in the textbox. original_text per privacy rule above.
    await sendMessageToServer(originalText, finalText, lastIntensityInfo, false, usedSuggestionFlag);
    // Refresh the chat history panel so Conversation History updates immediately
    await loadHistory();
    await refreshEqCoach();
  } catch (err) {
    console.error("[XL AI] handleDeliverClick error:", err);
  } finally {
    // Reset state so the next message is fresh
    usedSuggestionFlag = false;
    lastIntensityInfo = null;
    draftOriginalText = null;
    lastSuggestionText = null;
    lastIntensityScore = null;
    deliverButton.disabled = false;
    deliverButton.textContent = "DELIVER";
    // Clear the input and focus so UI is ready for a new message
    if (messageInput) {
      messageInput.value = "";
      messageInput.focus();
    }
  }
}

/**
 * ---- Pause modal button handlers ----
 */

async function handlePauseUseSuggestion() {
  if (!pendingRawText) {
    closePauseModal();
    return;
  }

  const originalText = pendingRawText;
  const finalText = pendingSuggestion || pendingRawText;
  usedSuggestionFlag = true;

  // Replace last bubble with the rephrased version for UX clarity
  if (chatHistoryContainer && chatHistoryContainer.lastElementChild) {
    chatHistoryContainer.lastElementChild.textContent = finalText;
  }

  try {
    await sendMessageToServer(
      originalText,
      finalText,
      pendingIntensity,
      true,
      true
    );
    await loadHistory();
    await refreshEqCoach();
  } catch (err) {
    console.error("[XL AI] handlePauseUseSuggestion error:", err);
  } finally {
    closePauseModal();
    pauseTakenFlag = true;
    usedSuggestionFlag = false;
    lastIntensityInfo = null;
    draftOriginalText = null;
    lastSuggestionText = null;
  }
}

async function handlePauseSendAnyway() {
  if (!pendingRawText) {
    closePauseModal();
    return;
  }

  const originalText = pendingRawText;
  const finalText = pendingRawText;
  usedSuggestionFlag = false;

  try {
    await sendMessageToServer(
      originalText,
      finalText,
      pendingIntensity,
      true,
      false
    );
    await loadHistory();
    await refreshEqCoach();
  } catch (err) {
    console.error("[XL AI] handlePauseSendAnyway error:", err);
  } finally {
    closePauseModal();
    pauseTakenFlag = true;
    usedSuggestionFlag = false;
    lastIntensityInfo = null;
    draftOriginalText = null;
    lastSuggestionText = null;
  }
}

function handlePauseCancel() {
  // User changed their mind; keep nothing logged
  closePauseModal();
}

/**
 * ---- Event wiring ----
 */

function wireEvents() {
  // Tone buttons
  toneButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tone = btn.getAttribute("data-tone") || "calm";
      setTone(tone);
    });
  });

  // Emotion buttons
  emotionButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const emotion = btn.getAttribute("data-emotion") || null;
      setEmotion(emotion);
    });
  });

  // Clear suggestion just clears the input
  if (clearSuggestionButton) {
    clearSuggestionButton.addEventListener("click", () => {
      // Clear the displayed AI suggestion, reset suggestion-related state
      const suggestionBox = document.getElementById("aiSuggestionText");
      const suggestionRow = document.getElementById("aiSuggestionRow");
      if (suggestionBox) suggestionBox.textContent = "";
      if (suggestionRow) suggestionRow.style.display = "none";
      lastSuggestionText = "";
      usedSuggestionFlag = false;
      // Do NOT clear the textarea; preserve what the user typed
    });
  }

  // REPHRASE: call analyzer for a suggestion but do NOT persist to DB
  async function doRephraseClick() {
    const raw = (messageInput && messageInput.value) ? messageInput.value.trim() : "";
    if (!raw) return;
    try {
      console.log("[XL AI] Rephrase requested (top/side).");
      await analyzeText(raw);
      // ensure we do not mark suggestion as used until user clicks USE THIS VERSION
      usedSuggestionFlag = false;
    } catch (e) {
      console.error("[XL AI] Rephrase error:", e);
    }
  }

  if (rephraseButton) rephraseButton.addEventListener("click", doRephraseClick);
  if (rephraseButtonTop) rephraseButtonTop.addEventListener("click", doRephraseClick);

  // Coach refresh button now resets the UI to start a new message
  if (refreshCoachButton) {
    refreshCoachButton.addEventListener("click", () => {
      // clear input and suggestion UI, reset flags
      if (messageInput) {
        messageInput.value = "";
        messageInput.focus();
      }
      const suggestionBox = document.getElementById("aiSuggestionText");
      const suggestionRow = document.getElementById("aiSuggestionRow");
      if (suggestionBox) suggestionBox.textContent = "";
      if (suggestionRow) suggestionRow.style.display = "none";
      lastSuggestionText = null;
      usedSuggestionFlag = false;
      draftOriginalText = null;
      lastIntensityInfo = null;
      console.log("[XL AI] Reset UI to start a new message.");
    });
  }

  // Pause modal buttons
  if (pauseUseSuggestionButton) {
    pauseUseSuggestionButton.addEventListener("click", () => {
      handlePauseUseSuggestion();
    });
  }
  if (pauseSendAnywayButton) {
    pauseSendAnywayButton.addEventListener("click", () => {
      handlePauseSendAnyway();
    });
  }
  if (pauseCancelButton) {
    pauseCancelButton.addEventListener("click", () => {
      handlePauseCancel();
    });
  }


  if (coachModeSoftBtn) coachModeSoftBtn.addEventListener("click", () => setCoachMode("soft"));
  if (coachModeHighBtn) coachModeHighBtn.addEventListener("click", () => setCoachMode("high"));

  // Deliver button wiring
  if (deliverButton) {
    deliverButton.addEventListener("click", () => {
      handleDeliverClick();
    });
  }

}
// Analyzer on/off
if (analyzerToggleBtn) {
  analyzerToggleBtn.addEventListener("click", () => {
    analyzerOn = !analyzerOn;
    console.log("[XL AI] Analyzer toggled:", analyzerOn ? "ON" : "OFF");
    updateAnalyzerUI();
  });
}

/**
 * ---- Boot ----
  */

function bootstrap() {
  loadPrefs();
  setTone(currentTone);
  updateAnalyzerUI();
  setEmotion(null);
  wireEvents();
  loadHistory();
  refreshEqCoach();
  setCoachMode("soft");
}
  bootstrap();