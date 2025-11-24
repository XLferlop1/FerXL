// chat.js
// XL AI Chat Page: loads one conversation, handles messages + AI rephrase

// ---- DOM elements ----
const chatBox = document.getElementById("chat-box");
const chatContactNameEl = document.getElementById("chat-contact-name");
const chatContactStatusEl = document.getElementById("chat-contact-status");
const backButton = document.getElementById("back-to-home");

const messageInput = document.getElementById("message-input");
const sendOriginalButton = document.getElementById("send-original-button");
const toneButtons = document.querySelectorAll(".tone-button");

const suggestionText = document.getElementById("suggestion-text");
const suggestionToneLabel = document.getElementById("suggestion-tone-label");
const applySuggestionButton = document.getElementById("apply-suggestion");
const clearSuggestionButton = document.getElementById("clear-suggestion");
const suggestionPanel = document.getElementById("suggestion-panel");

// ---- Conversation context ----
const params = new URLSearchParams(window.location.search);
const currentConversationId =
  params.get("conv") || "demo-conversation-1";
const currentUserId = "user_A"; // demo user for now
const demoRecipientId = "user_B";

const contactName = params.get("name") || "XL AI Coach";
chatContactNameEl.textContent = contactName;
chatContactStatusEl.textContent = "Private · 24h delete (beta)";

// ---- Navigation ----
if (backButton) {
  backButton.addEventListener("click", () => {
    window.location.href = "index.html";
  });
}

// ---- Helper: add a message bubble to the chat ----
function addMessage(text, sender = "user") {
  const row = document.createElement("div");
  row.classList.add("message-row");
  row.classList.add(sender === "user" ? "from-user" : "from-ai");

  const bubble = document.createElement("div");
  bubble.classList.add("bubble");
  bubble.textContent = text;

  row.appendChild(bubble);
  chatBox.appendChild(row);

  // scroll to bottom
  chatBox.scrollTop = chatBox.scrollHeight;
}

// ---- Helper: show / hide suggestion panel ----
function showSuggestionPanel(visible) {
  if (!suggestionPanel) return;
  if (visible) {
    suggestionPanel.classList.add("visible");
  } else {
    suggestionPanel.classList.remove("visible");
    suggestionText.textContent = "";
    suggestionToneLabel.textContent = "";
  }
}

// ---- SEND ORIGINAL MESSAGE (no AI rephrase) ----
if (sendOriginalButton) {
  sendOriginalButton.addEventListener("click", async () => {
    const text = messageInput.value.trim();
    if (!text) return;

    // 1) Show your original message in orange bubble
    addMessage(text, "user");

    // 2) Clear input
    messageInput.value = "";

    // 3) Send to backend so it gets stored in Neon (encrypted at server)
    try {
      await fetch("/api/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversationId: currentConversationId,
          senderId: currentUserId,
          recipientId: demoRecipientId,
          text,
        }),
      });
    } catch (err) {
      console.error("Error sending message to server", err);
      addMessage(
        "I had trouble saving that message. It’s still visible here, but might not be stored.",
        "ai"
      );
    }
  });
}

// Optional: Enter key = Send
if (messageInput) {
  messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (sendOriginalButton) {
        sendOriginalButton.click();
      }
    }
  });
}

// ---- AI REPHRASE (Calm / Professional / Low-key) ----
toneButtons.forEach((btn) => {
  btn.addEventListener("click", async () => {
    const text = messageInput.value.trim();
    if (!text) return;

    const tone = btn.dataset.tone || "calm";

    showSuggestionPanel(false);
    suggestionText.textContent = "Thinking of a calmer version…";
    suggestionToneLabel.textContent = tone;
    showSuggestionPanel(true);

    try {
      const response = await fetch("/api/rephrase", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text, tone }),
      });

      if (!response.ok) {
        throw new Error(`Rephrase failed: ${response.status}`);
      }

      const data = await response.json();
      const suggestion = data.rephrased || data.text || "";

      suggestionText.textContent = suggestion;
      suggestionToneLabel.textContent =
        tone.charAt(0).toUpperCase() + tone.slice(1);
    } catch (error) {
      console.error("Error calling rephrase endpoint", error);
      suggestionText.textContent =
        "I had trouble reaching XL AI right now. Please try again.";
    }
  });
});

// ---- Apply / Clear suggestion ----
if (applySuggestionButton) {
  applySuggestionButton.addEventListener("click", () => {
    const suggestion = suggestionText.textContent.trim();
    if (!suggestion) return;

    // Put suggestion into the input so user can edit or send
    messageInput.value = suggestion;
    messageInput.focus();
  });
}

if (clearSuggestionButton) {
  clearSuggestionButton.addEventListener("click", () => {
    showSuggestionPanel(false);
  });
}