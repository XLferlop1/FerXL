// beta-config.js
// Shared beta identity and default conversation settings for frontend surfaces.

(function () {
  const params = new URLSearchParams(window.location.search);
  const fallbackUserId = "beta_default_user";
  const fallbackConversationId = "default";

  const userId = params.get("userId") || fallbackUserId;
  const defaultConversationId =
    params.get("conversation") || params.get("conversationId") || fallbackConversationId;

  const config = Object.freeze({
    userId,
    defaultConversationId,
    userBadgeText: `User: ${userId}`,
  });

  window.XL_BETA_CONFIG = config;
})();
