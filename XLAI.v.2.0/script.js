// script.js
// XL AI v3C + Home Screen + Live previews:
// - Home screen with contacts list
// - Chat screen (neon coach)
// - Tone-aware AI suggestions
// - Messaging API with DEMO AES-GCM encryption
// - Home uses /api/last-messages for real previews

// === Grab elements from the page ===
const homeScreen = document.getElementById("home-screen");
const chatScreen = document.getElementById("chat-screen");
const contactListEl = document.getElementById("contact-list");
const backToHomeButton = document.getElementById("back-to-home");
const chatContactNameEl = document.getElementById("chat-contact-name");
const chatContactStatusEl =
  document.getElementById("chat-contact-status");

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

// ======================================================================
// USERS / CONTACTS / CONVERSATIONS
// ======================================================================

const currentUserId = "user_A";

const contacts = [
  {
    id: "user_B",
    name: "Alex",
    status: "Online · using XL AI",
  },
  {
    id: "user_C",
    name: "Jordan",
    status: "Last seen 2 hours ago",
  },
  {
    id: "user_D",
    name: "Taylor",
    status: "Last seen yesterday",
  },
];

let activeContact = null;
let activeConversationId = null;

// Deterministic conversation id for a pair of users
function getConversationIdForPair(userA, userB) {
  const pair = [userA, userB].sort();
  return `conv_${pair[0]}_${pair[1]}`;
}

// Fetch last messages from server (for previews)
async function fetchLastMessages() {
  const res = await fetch("/api/last-messages");
  if (!res.ok) {
    console.error("Failed to load last messages:", res.status);
    return [];
  }
  const data = await res.json();
  return data.lastMessages || [];
}

// Render contact cards with live preview
async function renderContactList() {
  contactListEl.innerHTML = "Loading conversations…";

  let lastMessages = [];
  try {
    lastMessages = await fetchLastMessages();
  } catch (err) {
    console.error("Error fetching last messages:", err);
  }

  // Build a map convId -> last message (already encrypted)
  const lastByConv = new Map();
  for (const msg of lastMessages) {
    lastByConv.set(msg.conversationId, msg);
  }

  contactListEl.innerHTML = "";

  for (const contact of contacts) {
    const item = document.createElement("div");
    item.classList.add("contact-item");
    item.dataset.contactId = contact.id;

    const nameRow = document.createElement("div");
    nameRow.classList.add("contact-name-row");

    const nameEl = document.createElement("div");
    nameEl.classList.add("contact-name");
    nameEl.textContent = contact.name;

    const statusEl = document.createElement("div");
    statusEl.classList.add("contact-status");
    statusEl.textContent = contact.status;

    nameRow.appendChild(nameEl);
    nameRow.appendChild(statusEl);

    const previewEl = document.createElement("div");
    previewEl.classList.add("contact-preview");

    // Compute conversationId for this contact + current user
    const convId = getConversationIdForPair(currentUserId, contact.id);
    const lastMsg = lastByConv.get(convId);

    if (!lastMsg) {
      previewEl.textContent =
        "No recent messages. Tap to start with XL AI support.";
    } else {
      // Decrypt last ciphertext to show a short preview
      decryptMessage(lastMsg.ciphertext)
        .then((plain) => {
          const shortened =
            plain.length > 70 ? plain.slice(0, 67) + "…" : plain;
          previewEl.textContent = shortened;
        })
        .catch((err) => {
          console.error("Preview decrypt error:", err);
          previewEl.textContent = "[unable to decrypt preview]";
        });
    }

    item.appendChild(nameRow);
    item.appendChild(previewEl);

    item.addEventListener("click", () => {
      openConversation(contact.id);
    });

    contactListEl.appendChild(item);
  }
}

// Switch to chat screen for selected contact
async function openConversation(contactId) {
  const contact = contacts.find((c) => c.id === contactId);
  if (!contact) return;

  activeContact = contact;
  activeConversationId = getConversationIdForPair(
    currentUserId,
    contact.id
  );

  chatContactNameEl.textContent = contact.name;
  chatContactStatusEl.textContent = "Private coaching with XL AI";

  chatBox.innerHTML = "";
  addMessage(
    "Hey, I’m your XL AI coach. Type what you want to say to this person, then pick a tone for a calmer, more empathetic version.",
    "ai"
  );

  homeScreen.classList.add("hidden");
  chatScreen.classList.remove("hidden");

  try {
    await loadConversation();
  } catch (err) {
    console.error("Failed to load conversation:", err);
  }

  messageInput.focus();
}

// Back to home
backToHomeButton.addEventListener("click", async () => {
  chatScreen.classList.add("hidden");
  homeScreen.classList.remove("hidden");
  activeContact = null;
  activeConversationId = null;
  chatBox.innerHTML = "";
  clearSuggestion();

  // Refresh previews when you go back
  try {
    await renderContactList();
  } catch (err) {
    console.error("Error re-rendering contact list:", err);
  }
});

// ======================================================================
// DEMO E2EE LAYER (AES-GCM + PBKDF2)
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
    console.warn("Web Crypto not available; skipping demo encryption.");
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
    console.warn("No Web Crypto, returning plaintext (demo mode).");
    return plainText;
  }

  try {
    const key = await getDemoAesKey();
    if (!key) return plainText;

    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const data = textEncoder.encode(plainText);

    const encryptedBuffer = await window.crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
      },
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
    console.warn("No Web Crypto, returning ciphertext as-is (demo).");
    return ciphertextBase64;
  }

  try {
    const key = await getDemoAesKey();
    if (!key) return ciphertextBase64;

    const combined = base64ToBytes(ciphertextBase64);
    const iv = combined.slice(0, 12);
    const ciphertextBytes = combined.slice(12);

    const decryptedBuffer = await window.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
      },
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
// UI & API HELPERS
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
// MESSAGE API HELPERS (per active conversation)
// ======================================================================

async function sendMessageToServer(plainText) {
  if (!activeContact || !activeConversationId) {
    console.warn("No active conversation selected.");
    return;
  }

  const ciphertext = await encryptMessage(plainText);

  const body = {
    conversationId: activeConversationId,
    senderId: currentUserId,
    recipientId: activeContact.id,
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

  for (const msg of data.messages) {
    const sender =
      msg.senderId === currentUserId ? currentUserId : "ai";

    const plainText = await decryptMessage(msg.ciphertext);
    addMessage(plainText, sender);
  }
}

// ======================================================================
// UI HANDLERS
// ======================================================================

// Send as-is
sendButton.addEventListener("click", async () => {
  const text = messageInput.value.trim();
  if (!text) return;
  if (!activeContact || !activeConversationId) return;

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

// ======================================================================
// INITIALIZE
// ======================================================================

(async () => {
  homeScreen.classList.remove("hidden");
  chatScreen.classList.add("hidden");
  clearSuggestion();

  try {
    await renderContactList();
  } catch (err) {
    console.error("Error rendering contact list:", err);
  }
})();