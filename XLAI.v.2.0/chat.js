// chat.js
// XL AI Coach chat page: per-conversation history + emotion chips + AI rephrase + Predictive Pause

// ---------- DOM elements ----------
const chatBox = document.getElementById("chat-box");

const messageInput = document.getElementById("message-input");
const deliverButton = document.getElementById("deliver-button");

const toneButtons = document.querySelectorAll(".tone-button");
const suggestionTextEl = document.getElementById("suggestion-text");
const suggestionToneLabel = document.getElementById("suggestion-tone-label");
const applySuggestionButton = document.getElementById("apply-suggestion");
const clearSuggestionButton = document.getElementById("clear-suggestion");

// Emotion chips (support either .emotion-pill or .emotion-chip)
const emotionChips = document.querySelectorAll(".emotion-pill, .emotion-chip");

// Predictive Pause modal elements
const pauseModalEl = document.getElementById("pause-modal");
const pauseTimerEl = document.getElementById("pause-timer");
const pauseIntensityEl = document.getElementById("pause-intensity");
const pauseEmotionEl = document.getElementById("pause-emotion");
const pauseContinueBtn = document.getElementById("pause-continue");
const pauseRephraseBtn = document.getElementById("pause-rephrase");
const pauseCancelBtn = document.getElementById("pause-cancel");
const pauseMeterFillEl = document.getElementById("pause-meter-fill");

// ---------- Conversation context ----------
const urlParams = new URLSearchParams(window.location.search);
const conversationId = urlParams.get("conversation") || "alex"; // default to Alex

// LocalStorage key for this conversation
const STORAGE_KEY = `xlai_chat_${conversationId}`;

// ---------- State ----------
const currentUserId =
  (window.xlaiUserId) ||
  (window.xlaiAuth && window.xlaiAuth.currentUser && window.xlaiAuth.currentUser.uid) ||
  "dev-anon";
// In-memory list of bubbles for THIS conversation
// shape: { text, role: "user" | "coach", emotion: string | null }
let bubbles = [];

// Last AI suggestion (for the "Use suggestion" button)
let lastSuggestion = "";

// Current tone + emotion
let currentTone = "calm";
let currentEmotion = null;

// Pending message for the Predictive Pause flow
let pendingText = "";
let pendingTone = "calm";
let pendingEmotion = null;
let pauseSecondsRemaining = 15;
let pauseTimerId = null;
let lastIntensityInfo = null;

// ---------- Emotion chips behavior ----------
emotionChips.forEach((chip) => {
  chip.addEventListener("click", () => {
    // Clear existing active state
    emotionChips.forEach((c) => {
      c.classList.remove("emotion-pill--active");
      c.classList.remove("emotion-chip--active");
    });

    // Mark this chip as active
    chip.classList.add("emotion-pill--active");
    chip.classList.add("emotion-chip--active");

    currentEmotion = chip.dataset.emotion || null;
  });
});

// ---------- Helpers: bubbles + history ----------
// Save a delivered message to the backend (Neon)
async function saveMessageToServer(options) {
  const {
    conversationId,
    originalText,
    finalText,
    preSendEmotion,
    intensityScore = null,
    wasPauseTaken = false,
    usedSuggestion = false,
    isRepairAttempt = false,
  } = options;

  try {
    await fetch("/api/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversationId,
        originalText,
        finalText,
        preSendEmotion,
        intensityScore,
        wasPauseTaken,
        usedSuggestion,
        isRepairAttempt,
        // TODO: replace with real Firebase user id when we wire auth
        userId: "demo_user",
      }),
    });
  } catch (err) {
    console.error("XL AI /api/send error:", err);
    // We fail soft here so the user experience isn't blocked if logging fails.
  }
}
function renderBubble(bubble) {
  if (!chatBox) return;

  const div = document.createElement("div");
  div.classList.add("chat-bubble");

  if (bubble.role === "coach") {
    div.classList.add("bubble-coach");
  } else {
    div.classList.add("bubble-user");
  }

  div.textContent = bubble.text;
  chatBox.appendChild(div);

  chatBox.scrollTop = chatBox.scrollHeight;
}

function loadHistory() {
  if (!chatBox) return;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return;

    bubbles = data;
    chatBox.innerHTML = "";
    bubbles.forEach(renderBubble);
  } catch (err) {
    console.warn("Failed to load chat history:", err);
  }
}

function saveHistory() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bubbles));
  } catch (err) {
    console.warn("Failed to save chat history:", err);
  }
}

function addBubble(text, role) {
  const bubble = {
    text,
    role,
    emotion: currentEmotion || null,
  };

  bubbles.push(bubble);
  renderBubble(bubble);
  saveHistory();
}

// ---------- XL AI: intensity + rephrase calls ----------

async function analyzeIntensity(text) {
  try {
    const res = await fetch("/api/analyze-intensity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) {
      throw new Error("Bad response from /api/analyze-intensity");
    }

    const data = await res.json();
    const intensity =
      typeof data.intensity === "number" ? data.intensity : 0.0;
    const primaryEmotion =
      typeof data.primaryEmotion === "string"
        ? data.primaryEmotion
        : "unknown";

    return { intensity, primaryEmotion };
  } catch (err) {
    console.error("XL AI intensity error:", err);
    // Fail-safe: treat as calm so we don’t block the user
    return { intensity: 0.0, primaryEmotion: "unknown" };
  }
}

async function runRephrase(text, tone, emotion) {
  try {
    const res = await fetch("/api/rephrase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
        text,
        tone,
        conversationId: currentConversationId,
        preSendEmotion: emotion || currentEmotion || null,
        userId: currentUserId
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Rephrase API error:", errText);
      suggestionTextEl.textContent =
        "Sorry, XL AI couldn't generate a suggestion right now.";
      lastSuggestion = "";
      return;
    }

    const data = await res.json();
    const suggestion = (data && data.suggestion) || "";

    if (!suggestion) {
      suggestionTextEl.textContent =
        "Sorry, XL AI couldn't generate a suggestion right now.";
      lastSuggestion = "";
      return;
    }

    lastSuggestion = suggestion;
    suggestionTextEl.textContent = suggestion;

    // Show the suggestion as a coach bubble
    addBubble(suggestion, "coach");
  } catch (err) {
    console.error("XL AI /api/rephrase error:", err);
    suggestionTextEl.textContent =
      "Sorry, XL AI couldn't generate a suggestion right now.";
    lastSuggestion = "";
  }
}

// ---------- Predictive Pause modal ----------

function showPauseModal(info, text, tone, emotion) {
  pendingText = text;
  pendingTone = tone;
  pendingEmotion = emotion || null;
  lastIntensityInfo = info;

  const intensity = info.intensity || 0;
  const pct = Math.round(intensity * 100);

  if (pauseEmotionEl) {
    pauseEmotionEl.textContent = info.primaryEmotion || "intense";
  }
  if (pauseIntensityEl) {
    pauseIntensityEl.textContent = `${pct}%`;
  }
  if (pauseMeterFillEl) {
    pauseMeterFillEl.style.width = `${pct}%`;
  }

  pauseSecondsRemaining = 15;
  if (pauseTimerEl) {
    pauseTimerEl.textContent = `${pauseSecondsRemaining}s`;
  }

  if (pauseTimerId) {
    clearInterval(pauseTimerId);
  }

  if (pauseContinueBtn) {
    pauseContinueBtn.disabled = true;
  }

  pauseTimerId = setInterval(() => {
    pauseSecondsRemaining -= 1;

    if (pauseSecondsRemaining <= 0) {
      clearInterval(pauseTimerId);
      pauseTimerId = null;

      if (pauseTimerEl) {
        pauseTimerEl.textContent = "10s";
      }
      if (pauseContinueBtn) {
        pauseContinueBtn.disabled = false;
      }
    } else {
      if (pauseTimerEl) {
        pauseTimerEl.textContent = `${pauseSecondsRemaining}s`;
      }
    }
  }, 1000);

  if (pauseModalEl) {
    pauseModalEl.classList.remove("hidden");
  }
}

function hidePauseModal() {
  if (pauseTimerId) {
    clearInterval(pauseTimerId);
    pauseTimerId = null;
  }
  if (pauseModalEl) {
    pauseModalEl.classList.add("hidden");
  }

  pendingText = "";
  pendingTone = "calm";
  pendingEmotion = null;
  lastIntensityInfo = null;
}

// ---------- Core actions ----------

// Deliver button: add user bubble (no AI call)
// Deliver button: add user bubble + send to backend
function onDeliverClick() {
  const raw = messageInput.value.trim();
  if (!raw) return;

  // 1) Show it immediately in the UI
  addBubble(raw, "user");
  messageInput.value = "";

  // 2) Build payload for backend EQ logging
  const payload = {
    conversationId,                 // from URL (alex / jordan / taylor)
    originalText: raw,
    finalText: raw,                 // later this can be the rephrased text
    preSendEmotion: currentEmotion || null,
    intensityScore:
      lastIntensityInfo && typeof lastIntensityInfo.intensity === "number"
        ? lastIntensityInfo.intensity
        : null,
    wasPauseTaken: false,           // we'll wire true later from Predictive Pause
    usedSuggestion: false,          // will be true when we send AI suggestion
    isRepairAttempt: false,         // later: mark certain messages as “repair”
    userId: "xx",                   // will become Firebase userId in auth phase
  };

  fetch("/api/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch((err) => {
    console.error("XL AI /api/send error:", err);
  });
}

// Tone button: ask XL AI (with Predictive Pause)
async function onToneClick(tone) {
  const raw = messageInput.value || "";
  const text = raw.trim();

  if (!text) {
    suggestionTextEl.textContent =
      "Type what you really want to say first, then choose a tone.";
    return;
  }

  currentTone = tone.toLowerCase();

  // Update button visual state
  toneButtons.forEach((btn) => {
    const btnTone = (btn.dataset.tone || btn.textContent).toLowerCase();
    if (btnTone === currentTone) {
      btn.classList.add("tone-button-active");
    } else {
      btn.classList.remove("tone-button-active");
    }
  });

  // Update label
  if (tone === "calm") {
    suggestionToneLabel.textContent = "Tone: Calm";
  } else if (tone === "professional") {
    suggestionToneLabel.textContent = "Tone: Professional";
  } else {
    suggestionToneLabel.textContent = "Tone: Low-key";
  }

  suggestionTextEl.textContent = "Thinking...";

  // 1) Ask XL AI to rate intensity
  const info = await analyzeIntensity(text);
  const intensity = info.intensity ?? 0;

  // 2) If very intense, show pause instead of immediate rephrase
  if (intensity > 0.75) {
    showPauseModal(info, text, currentTone, currentEmotion);
    return;
  }

  // 3) Otherwise go straight to rephrase
  await runRephrase(text, currentTone, currentEmotion);
}

// Use suggestion: copy AI text into input
function onUseSuggestion() {
  if (!lastSuggestion) return;
  messageInput.value = lastSuggestion;
}

// Clear suggestion UI
function onClearSuggestion() {
  lastSuggestion = "";
  suggestionToneLabel.textContent = "";
  suggestionTextEl.textContent =
    "XL AI suggestions will appear here after you choose Calm, Professional, or Low-key.";
}

// ---------- Wire up events ----------

if (deliverButton) {
  deliverButton.addEventListener("click", onDeliverClick);
}

toneButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const tone = (btn.dataset.tone || btn.textContent).toLowerCase();
    onToneClick(tone);
  });
});

if (applySuggestionButton) {
  applySuggestionButton.addEventListener("click", onUseSuggestion);
}
if (clearSuggestionButton) {
  clearSuggestionButton.addEventListener("click", onClearSuggestion);
}

if (pauseCancelBtn) {
  pauseCancelBtn.addEventListener("click", () => {
    hidePauseModal();
  });
}
if (pauseRephraseBtn) {
  pauseRephraseBtn.addEventListener("click", async () => {
    hidePauseModal();
    if (!pendingText) return;
    await runRephrase(pendingText, pendingTone, pendingEmotion);
  });
}
if (pauseContinueBtn) {
  pauseContinueBtn.addEventListener("click", () => {
    hidePauseModal();
    if (!pendingText) return;
    addBubble(pendingText, "user");
    messageInput.value = "";
  });
}

// ---------- Init ----------
loadHistory();