// contacts.js
// XL AI Home Page: loads contacts + last message previews from backend

const contactListEl = document.getElementById("contact-list");

// For now this is your "logged-in" user (ties into Neon seed data)
const currentUserId = "user_A";

// ---- DEMO E2EE HELPERS (for decrypting previews only) ----
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
    console.warn("Web Crypto not available; previews will be ciphertext.");
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
        ["decrypt"]
      );
    })();
  }

  return demoKeyPromise;
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
    console.error("Preview decrypt error:", err);
    return "[decryption failed]";
  }
}

// ---- API calls ----

async function fetchContacts() {
  const res = await fetch(
    `/api/contacts?userId=${encodeURIComponent(currentUserId)}`
  );
  if (!res.ok) {
    throw new Error("Failed to fetch contacts: " + res.status);
  }
  const data = await res.json();
  return data.contacts || [];
}

async function fetchLastMessages() {
  const res = await fetch("/api/last-messages");
  if (!res.ok) {
    throw new Error("Failed to fetch last messages: " + res.status);
  }
  const data = await res.json();
  return data.lastMessages || [];
}

// ---- Render contact cards ----

async function renderContactList() {
  contactListEl.textContent = "Loading conversations…";

  let contacts = [];
  let lastMessages = [];

  try {
    contacts = await fetchContacts();
  } catch (err) {
    console.error(err);
    contactListEl.textContent =
      "Could not load contacts. Please refresh.";
    return;
  }

  try {
    lastMessages = await fetchLastMessages();
  } catch (err) {
    console.error(err);
  }

  const lastByConv = new Map();
  for (const msg of lastMessages) {
    const convId = msg.conversation_id || msg.conversationId;
    lastByConv.set(convId, msg);
  }

  contactListEl.innerHTML = "";

  contacts.forEach((contact) => {
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
    statusEl.textContent = contact.status || "Using XL AI";

    nameRow.appendChild(nameEl);
    nameRow.appendChild(statusEl);

    const previewEl = document.createElement("div");
    previewEl.classList.add("contact-preview");

    const convId = contact.conversationId;
    const lastMsg = lastByConv.get(convId);

    if (!lastMsg) {
      previewEl.textContent =
        "No recent messages. Tap to start with XL AI support.";
    } else {
      decryptMessage(lastMsg.ciphertext)
        .then((plain) => {
          const truncated =
            plain.length > 70 ? plain.slice(0, 67) + "…" : plain;
          previewEl.textContent = truncated;
        })
        .catch((err) => {
          console.error(err);
          previewEl.textContent = "[unable to decrypt preview]";
        });
    }

    item.appendChild(nameRow);
    item.appendChild(previewEl);

    item.addEventListener("click", () => {
      const url =
        "chat.html" +
        `?conversationId=${encodeURIComponent(contact.conversationId)}` +
        `&contactId=${encodeURIComponent(contact.id)}` +
        `&name=${encodeURIComponent(contact.name)}`;

      window.location.href = url;
    });

    contactListEl.appendChild(item);
  });
}

// ---- Init ----

renderContactList().catch((err) => {
  console.error("Error initializing contacts:", err);
  contactListEl.textContent = "Error loading conversations.";
});