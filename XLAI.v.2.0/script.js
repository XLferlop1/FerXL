// script.js
// XL AI v2.4 - front-end with:
// - Suggestion box + tone modes
// - Messaging API
// - E2EE-ready encrypt/decrypt hooks (currently NO real encryption)

// === Grab elements from the page ===
const chatBox = document.getElementById("chat-box");
const messageInput = document.getElementById("message-input");
const sendButton = document.getElementById("send-button");
const toneButtons = document.querySelectorAll(".tone-button");

// Suggestion panel elements
const suggestionText = document.getElementById("suggestion-text");
const suggestionToneLabel = document.getElementById(
  "suggestion-tone-label"
);
const applySuggestionButton =
  document.getElementById("apply-suggestion");
const clearSuggestionButton =
  document.getElementById("clear-suggestion");

// TEMP: fake users + single conversation
const currentUserId = "user_A";
const otherUserId = "user_B";
const conversationId = "conversation_1";

// ======================================================================
// E2EE HOOKS (NO REAL ENCRYPTION YET)
// ======================================================================

async function encryptMessage(plainText) {
  // TODO later: replace with real encryption using Web Crypto.
  return plainText;
}

async function decryptMessage(ciphertext) {
  // TODO later: replace with real decryption.
  return ciphertext;
}

// ======================================================================
// UI HELPERS
// ======================================================================

function addMessage(text, senderId) {
  const row = document.createElement("div");
  const isCurrentUser = senderId === currentUserId;

  row.classList.add("message-row", isCurrentUser ? "user" : "ai");

  const bubble = document.createElement("div");
  bubble.classList.add("bubble");
  bubble.textContent = text;

  row.appendChild(bubble);
  chatBox.appendChild(row);

  chatBox.scrollTop = chatBox.scrollHeight;
}

async function getRephraseFromServer(original, tone) {
  const response = await fetch("/api/rephrase", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: original, tone }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `Server error: ${response.status} ${response.statusText} ${errorBody}`
    );
  }

  const data = await response.json();
  return data.suggestion;
}

function showSuggestion(text, toneLabel) {
  suggestionText.textContent = text;
  suggestionToneLabel.textContent =
    toneLabel || "Suggested version";
}

function clearSuggestion() {
  suggestionText.textContent =
    "AI suggestions will appear here after you pick Calm / Professional / Low-key.";
  suggestionToneLabel.textContent = "Suggested version";
}

// ======================================================================
// MESSAGE API HELPERS
// ======================================================================

async function sendMessageToServer(plainText) {
  const ciphertext = await encryptMessage(plainText);

  const body = {
    conversationId,
    senderId: currentUserId,
    recipientId: otherUserId,
    ciphertext,
  };

  const response = await fetch("/api/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `Message send failed: ${response.status} ${response.statusText} ${errorBody}`
    );
  }

  const data = await response.json();
  return data.message;
}

async function loadConversation() {
  const response = await fetch(
    `/api/messages?conversationId=${encodeURIComponent(conversationId)}`
  );

  if (!response.ok) {
    console.error("Failed to load conversation", response.status);
    return;
  }

  const data = await response.json();
  chatBox.innerHTML = "";

  for (const msg of data.messages) {
    const sender =
      msg.senderId === currentUserId ? currentUserId : otherUserId;

    const plainText = await decryptMessage(msg.ciphertext);
    addMessage(plainText, sender);
  }
}

// Load messages on page load
loadConversation().catch((err) =>
  console.error("Failed to load conversation", err)
);

// ======================================================================
// UI HANDLERS
// ======================================================================

// Send as-is
sendButton.addEventListener("click", async () => {
  const text = messageInput.value.trim();
  if (!text) return;

  addMessage(text, currentUserId);
  messageInput.value = "";
  clearSuggestion();

  try {
    await sendMessageToServer(text);
  } catch (err) {
    console.error(err);
  }
});

// Tone buttons
toneButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const toneKey = button.dataset.tone || "calm";
    const original = messageInput.value.trim();
    if (!original) return;

    showSuggestion("Thinking with XL AI…", toneKey);

    try {
      const rephrased = await getRephraseFromServer(original, toneKey);

      let toneLabel = "Suggested version";
      if (toneKey === "calm") toneLabel = "Calm suggestion";
      else if (toneKey === "professional")
        toneLabel = "Professional suggestion";
      else if (toneKey === "lowkey") toneLabel = "Low-key suggestion";

      showSuggestion(rephrased, toneLabel);
    } catch (error) {
      console.error("XL AI front-end error:", error);
      showSuggestion(
        "Sorry, I had trouble reaching XL AI right now. Please try again.",
        "Error"
      );
    }
  });
});

// Suggestion actions
applySuggestionButton.addEventListener("click", () => {
  const text = suggestionText.textContent.trim();
  if (!text) return;
  messageInput.value = text;
  messageInput.focus();
});

clearSuggestionButton.addEventListener("click", () => {
  clearSuggestion();
});

// Enter = Calm suggestion
messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    const defaultTone = "calm";
    const original = messageInput.value.trim();
    if (!original) return;

    showSuggestion("Thinking with XL AI…", "Calm");

    getRephraseFromServer(original, defaultTone)
      .then((rephrased) => {
        showSuggestion(rephrased, "Calm suggestion");
      })
      .catch((error) => {
        console.error("XL AI front-end error:", error);
        showSuggestion(
          "Sorry, I had trouble reaching XL AI right now. Please try again.",
          "Error"
        );
      });
  }
});