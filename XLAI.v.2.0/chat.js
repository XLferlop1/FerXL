// chat.js
// XL AI Chat Page: loads one conversation, handles messages + AI rephrase

// ---- DOM elements ----
const chatBox = document.getElementById("chat-box");
const chatContactNameEl = document.getElementById("chat-contact-name");
const chatContactStatusEl = document.getElementById("chat-contact-status");

const messageInput = document.getElementById("message-input");
const sendButton = document.getElementById("send-button");
const toneButtons = document.querySelectorAll(".tone-button");

const suggestionText = document.getElementById("suggestion-text");
const suggestionToneLabel = document.getElementById("suggestion-tone-label");
const applySuggestionButton = document.getElementById("apply-suggestion");
const clearSuggestionButton = document.getElementById("clear-suggestion");

// ---- Conversation context ----
const currentUserId = "user_A"; // For now, same demo user

const params = new URLSearchParams(window.location.search);
const activeConversationId = params.get("conversationId");
const activeContactId = params.get("contactId");
const activeContactName = params.get("name") || "XL AI Contact";

if (!activeConversationId || !activeContactId) {
  chatContactStatusEl.textContent =
    "Missing conversation info. Go back and open from Home.";
} else {
  chatContactNameEl.textContent = activeContactName;
  chatContactStatusEl.textContent =
    "Private coaching with XL AI · messages auto-delete after 24h";
}

// ======================================================================
// DEMO E2EE LAYER (same as contacts, but used for send + receive here)
// ======================================================================

const DEMO_PASSPHRASE = "xlai-demo-passphrase-v1";
const DEMO_SALT_STRING = "xlai-demo-salt-v1";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

let demoKeyPromise = null;

async function getDemoAesKey() {
  if (!window.crypto || !window.crypto.subtle) {
    console.warn("Web Crypto not available; using plaintext (demo).");
    return null;
  }

  if (!demoKeyPromise) {
    demoKeyPromise = (async () => {
      const keyMaterial = await window.crypto.subtle.importKey(
        "raw",
        textEncoder.encode(DEMO_PASSPHRASE),
        "PBKDF2",
        false,
        ["deriveKey"]
      );

      const saltBytes = textEncoder.encode(DEMO_SALT_STRING);

      return window.crypto.subtle.deriveKey(
        {
          name: "PBKDF2",
          salt: saltBytes,
          iterations: 100000,
          hash: "SHA-256",
        },
        keyMaterial,
        {
          name: "AES-GCM",
          length: 256,
        },
        false,
        ["encrypt", "decrypt"]
      );
    })();
  }

  return demoKeyPromise;
}

async function encryptMessage(plainText) {
  if (!window.crypto || !window.crypto.subtle) {
    console.warn("No Web Crypto, sending plaintext (demo).");
    return plainText;
  }

  try {
    const key = await getDemoAesKey();
    if (!key) return plainText;

    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const data = textEncoder.encode(plainText);

    const encryptedBuffer = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      data
    );

    const encryptedBytes = new Uint8Array(encryptedBuffer);
    const combined = new Uint8Array(iv.length + encryptedBytes.length);
    combined.set(iv, 0);
    combined.set(encryptedBytes, iv.length);

    return bytesToBase64(combined);
  } catch (err) {
    console.error("encryptMessage demo error:", err);
    return plainText;
  }
}

async function decryptMessage(ciphertextBase64) {
  if (!window.crypto || !window.crypto.subtle) {
    return ciphertextBase64;
  }

  try {
    const key = await getDemoAesKey();
    if (!key) return ciphertextBase64;

    const combined = base64ToBytes(ciphertextBase64);
    const iv = combined.slice(0, 12);
    const ciphertextBytes = combined.slice(12);

    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertextBytes
    );

    return textDecoder.decode(decryptedBuffer);
  } catch (err) {
    console.error("decryptMessage demo error:", err);
    return "[decryption failed]";
  }
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

function showSuggestion(text, toneLabel) {
  suggestionText.textContent = text;
  suggestionToneLabel.textContent = toneLabel || "Suggested version";
}

function clearSuggestion() {
  suggestionText.textContent =
    "AI suggestions will appear here after you pick Calm / Professional / Low-key.";
  suggestionToneLabel.textContent = "Suggested version";
}

// ======================================================================
// API HELPERS
// ======================================================================

async function getRephraseFromServer(original, tone) {
  const response = await fetch("/api/rephrase", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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

async function sendMessageToServer(plainText) {
  if (!activeConversationId || !activeContactId) return;

  const ciphertext = await encryptMessage(plainText);

  const body = {
    conversationId: activeConversationId,
    senderId: currentUserId,
    recipientId: activeContactId,
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
  if (!activeConversationId) return;

  const response = await fetch(
    `/api/messages?conversationId=${encodeURIComponent(
      activeConversationId
    )}`
  );

  if (!response.ok) {
    console.error("Failed to load conversation", response.status);
    return;
  }

  const data = await response.json();

  chatBox.innerHTML = "";
  addMessage(
    "Hey, I’m your XL AI coach. Type what you want to say to this person, then pick a tone for a calmer, more empathetic version.",
    "ai"
  );

  for (const msg of data.messages) {
    const sender =
      msg.sender_id === currentUserId ? currentUserId : "ai";

    const plainText = await decryptMessage(msg.ciphertext);
    addMessage(plainText, sender);
  }
}

// ======================================================================
// EVENT HANDLERS
// ======================================================================

sendButton.addEventListener("click", async () => {
  const text = messageInput.value.trim();
  if (!text) return;
  if (!activeConversationId || !activeContactId) return;

  addMessage(text, currentUserId);
  messageInput.value = "";
  clearSuggestion();

  try {
    await sendMessageToServer(text);
  } catch (err) {
    console.error(err);
  }
});

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

applySuggestionButton.addEventListener("click", () => {
  const text = suggestionText.textContent.trim();
  if (!text) return;
  messageInput.value = text;
  messageInput.focus();
});

clearSuggestionButton.addEventListener("click", () => {
  clearSuggestion();
});

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

// ======================================================================
// INIT
// ======================================================================

if (activeConversationId && activeContactId) {
  loadConversation().catch((err) => {
    console.error("Error initializing chat:", err);
  });
}