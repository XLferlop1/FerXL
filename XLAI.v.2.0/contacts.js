// contacts.js
// Handles clicking a conversation on the home screen and opening chat.html

document.addEventListener("DOMContentLoaded", () => {
  const rows = document.querySelectorAll(".conversation-row");

  rows.forEach((row) => {
    row.addEventListener("click", () => {
      const conversationId = row.dataset.conversationId || "demo";
      const contactName = row.dataset.contactName || "XL AI Coach";

      const params = new URLSearchParams({
        conversationId,
        contactName
      });

      window.location.href = `chat.html?${params.toString()}`;
    });
  });
});