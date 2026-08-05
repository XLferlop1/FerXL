// chat.js
// XL AI · Front-end “brain” controller for chat.html

"use strict";

/**
 * ---- Global state ----
 */
let currentConversationId = null;        // synced to selectedConversationId on selection
let selectedConversationId = null;        // the conversation currently open in Chats
let conversations = [];                   // cached list from /api/conversations
let chatMessages = [];                    // cached messages for selected thread
const betaConfig = window.XL_BETA_CONFIG || {};
let currentUserId = betaConfig.userId || "beta_default_user"; // placeholder user until login
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
let lastAnalysis = null;
let lastCoaching = null;
let lastActionTaken = null;
let lastPauseReason = null;

let currentCoachMode = "soft"; // soft | direct | professional
let rewriteStrength = "low"; // low | medium | high
let adaptiveThreshold = 0.8; // default, will be updated from API
let currentView = "chats"; // chats | coach | journal
let draftText = "";
let draftAnalysis = null;
let analysisTimeout = null;
let isAnalyzing = false;
let draftAnalysisVersion = 0;
const DRAFT_ANALYSIS_DEBOUNCE_MS = 380;
let selectedEmotion = null;

// Phase 7: Store latest refine result for Coach context
let latestRefineResult = null;
let latestRefineSuggestion = null;
let isRefineSuggestionVisible = false;

// Phase 5: Anti-Repetition Memory (session only)
let recentGuidanceHistory = []; // stores last 5 guidance messages
const MAX_GUIDANCE_HISTORY = 5;

const VIEW_TO_INDEX = {
  coach: 0,
  chats: 1,
  journal: 2,
};
/**
 * ---- DOM lookups ----
 */
const shellViewport = document.getElementById("shellViewport");
const shellTrack = document.getElementById("shellTrack");
const navViewButtons = Array.from(document.querySelectorAll("[data-nav-view]"));
const menuViewButtons = Array.from(document.querySelectorAll("[data-menu-view]"));
const menuToggleBtn = document.getElementById("menuToggleBtn");
const appMenuOverlay = document.getElementById("appMenuOverlay");
const appMenuBackdrop = document.getElementById("appMenuBackdrop");
const closeMenuBtn = document.getElementById("closeMenuBtn");
const currentUserBadge = document.getElementById("currentUserBadge");

const coachToggleBtn = document.getElementById("coachToggleBtn");
const coachDrawer = document.getElementById("coachDrawer");
const coachChatThread = document.getElementById("coachChatThread");
const coachInput = document.getElementById("coachInput");
const coachSubmitBtn = document.getElementById("coachSubmitBtn");
const coachDraftCard = document.getElementById("coachDraftCard");
const coachResponseCard = document.getElementById("coachResponseCard");
const coachIntentLabel = document.getElementById("coachIntentLabel");
const coachQuickReadSection = document.getElementById("coachQuickReadSection");
const coachQuickReadText = document.getElementById("coachQuickReadText");
const coachWhatToDoSection = document.getElementById("coachWhatToDoSection");
const coachWhatToDoList = document.getElementById("coachWhatToDoList");
const coachWhatToSaySection = document.getElementById("coachWhatToSaySection");
const coachWhatToSayList = document.getElementById("coachWhatToSayList");
const coachWhenToUseEachSection = document.getElementById("coachWhenToUseEachSection");
const coachWhenToUseEachList = document.getElementById("coachWhenToUseEachList");
const coachResponseSecondary = document.getElementById("coachResponseSecondary");
const coachRisksSection = document.getElementById("coachRisksSection");
const coachRiskBadge = document.getElementById("coachRiskBadge");
const coachInsightSection = document.getElementById("coachInsightSection");
const coachInsightText = document.getElementById("coachInsightText");
const coachRewriteSection = document.getElementById("coachRewriteSection");
const coachRewriteText = document.getElementById("coachRewriteText");
const useRewriteBtn = document.getElementById("useRewriteBtn");
const coachPrincipleSection = document.getElementById("coachPrincipleSection");
const coachPrincipleText = document.getElementById("coachPrincipleText");

const inlineCoachNudge = document.getElementById("inlineCoachNudge");
const nudgeRisk = document.getElementById("nudgeRisk");
const nudgeInsight = document.getElementById("nudgeInsight");
const nudgeUseRewriteBtn = document.getElementById("nudgeUseRewriteBtn");
const nudgeWhyBtn = document.getElementById("nudgeWhyBtn");
const nudgeDismissBtn = document.getElementById("nudgeDismissBtn");

const emotionChips = document.getElementById("emotionChips");
const dismissEmotionChips = document.getElementById("dismissEmotionChips");

const coachModeSoftBtn = document.getElementById("coachModeSoftBtn");
const coachModeDirectBtn = document.getElementById("coachModeDirectBtn");
const coachModeProfessionalBtn = document.getElementById("coachModeProfessionalBtn");

const chatHistoryContainer = document.getElementById("chatHistory");
const emptyState = document.getElementById("emptyState");
const deliverButton = document.getElementById("deliverButton");

// Tone + suggestion controls
const toneButtons = Array.from(document.querySelectorAll("[data-tone-btn]"));
const currentToneLabel = document.getElementById("currentToneLabel");

// Emotion controls
const emotionButtons = Array.from(document.querySelectorAll("[data-emotion-btn]"));

// Analyzer + coach
const analyzerToggleBtn = document.getElementById("analyzerToggleBtn");
const analyzerStatusLabel = document.getElementById("analyzerStatusLabel");

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
const refineDraftBtn = document.getElementById("refineDraftBtn");
const insightsMenuLink = document.querySelector('a[href="/insights.html"]');
const refineSuggestionCard = document.getElementById("refineSuggestionCard");
const refineSuggestionText = document.getElementById("refineSuggestionText");
const refineSuggestionReason = document.getElementById("refineSuggestionReason");
const useRefineSuggestionBtn = document.getElementById("useRefineSuggestionBtn");
const dismissRefineSuggestionBtn = document.getElementById("dismissRefineSuggestionBtn");
const draftCoachBar = document.getElementById("draftCoachBar");
const draftCoachTone = document.getElementById("draftCoachTone");
const draftCoachSuggestion = document.getElementById("draftCoachSuggestion");
let composerHintEl = null;

const coachIntentToLabel = {
  coach_question: "Coach question",
  rewrite_request: "Rewrite request",
  draft_analysis: "Draft analysis",
  mixed: "Mixed",
};

// ---- Timestamp helpers ----

function isSameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatBubbleTime(isoString) {
  const d = new Date(isoString);
  if (isNaN(d)) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDateLabel(isoString) {
  const d = new Date(isoString);
  if (isNaN(d)) return "";
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (isSameDay(d, today)) return "Today";
  if (isSameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}

function formatConvoTimestamp(isoString) {
  const d = new Date(isoString);
  if (isNaN(d)) return "";
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (isSameDay(d, today)) return "Today";
  if (isSameDay(d, yesterday)) return "Yesterday";
  const diffDays = Math.floor((today - d) / (1000 * 60 * 60 * 24));
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

const DRAFT_ANALYZER_PATTERNS = {
  anger: [
    /\bi'?m\s+mad\s+at\s+you\b/,
    /\bi\s+am\s+mad\s+at\s+you\b/,
    /\bi'?m\s+angry\s+at\s+you\b/,
    /\bi\s+am\s+angry\s+at\s+you\b/,
    /\bi'?m\s+frustrated\s+with\b/,
    /\bi\s+am\s+frustrated\s+with\b/,
    /\bi'?m\s+upset\s+with\b/,
    /\bi\s+am\s+upset\s+with\b/,
    /\bi'?m\s+furious\b/,
    /\bi\s+am\s+furious\b/,
    /\bi'?m\s+livid\b/,
    /\bi\s+am\s+livid\b/,
    /\bmad\s+at\s+you\b/,
    /\bangry\s+at\s+you\b/,
    /\bfrustrated\s+with\b/,
  ],
  accusation: [
    /\byou\s+always\b/,
    /\byou\s+never\b/,
    /\byou\s+don'?t\s+care\b/,
    /\byou\s+(ignore|ignored|ignoring)\b/,
    /\byou\s+(shut\s+down|stonewall|withdrew)\b/,
    /\byou\s+betrayed\s+me\b/,
    /\byou\s+cheated\s+on\s+me\b/,
    /\byou\s+make\s+me\b/,
    /\bwhy\s+don'?t\s+you\b/,
  ],
  blame: [
    /\bit'?s\s+your\s+fault\b/,
    /\byou\s+caused\b/,
    /\byou\s+ruined\b/,
    /\byou\s+made\s+this\b/,
    /\bbecause\s+of\s+you\b/,
  ],
  absolutes: [
    /\balways\b/,
    /\bnever\b/,
    /\bevery\s+time\b/,
    /\bnothing\b/,
    /\beverything\b/,
  ],
  dismissal: [
    /\bwhatever\b/,
    /\bfine\.?$/,
    /\bforget\s+it\b/,
    /\bdo\s+whatever\b/,
    /\bif\s+you\s+say\s+so\b/,
  ],
  contempt: [
    /\bi\s+hate\s+you\b/,
    /\byou'?re\s+(ridiculous|pathetic|selfish|awful)\b/,
    /\bstupid\b/,
    /\bdisgusting\b/,
  ],
  pain: [
    /\bi\s+feel\s+hurt\b/,
    /\bi'?m\s+hurt\b/,
    /\bi\s+am\s+hurt\b/,
    /\bi'?m\s+hurt\s+by\b/,
    /\bi\s+am\s+hurt\s+by\b/,
    /\bi\s+feel\s+disrespected\b/,
    /\bhurt\b/,
    /\bsad\b/,
    /\blonely\b/,
    /\brejected\b/,
    /\bdisappointed\b/,
    /\bdisrespected\b/,
    /\bignored\b/,
    /\boverlooked\b/,
    /\bdismissed\b/,
    /\bunheard\b/,
    /\bunseen\b/,
    /\bleft\s+out\b/,
    /\bnot\s+considered\b/,
    /\bnot\s+important\b/,
    /\bpushed\s+aside\b/,
    /\bbrushed\s+off\b/,
    /\bshut\s+down\b/,
    /\bdoesn'?t\s+feel\s+good\b/,
  ],
  betrayal: [
    /\bi\s+can'?t\s+believe\s+you\s+(would\s+)?cheat(?:ed|ing)?\s+on\s+me\b/,
    /\byou\s+cheat(?:ed|ing)?\s+on\s+me\b/,
    /\bcheat(?:ed|ing)?\s+on\s+me\b/,
    /\byou\s+betrayed\s+me\b/,
    /\bbetray(?:ed|al)?\b/,
    /\bbroke\s+my\s+trust\b/,
    /\bi\s+can'?t\s+trust\s+you\b/,
    /\byou\s+lied\s+to\s+me\b/,
  ],
  heartbreak: [
    /\bthis\s+broke\s+my\s+heart\b/,
    /\bbroke\s+my\s+heart\b/,
    /\bheartbroken\b/,
    /\bdevastated\b/,
    /\bcrushed\b/,
  ],
  anxiety: [
    /\bi'?m\s+not\s+sure\b/,
    /\bnot\s+sure\b/,
    /\bi\s+don'?t\s+know\s+how\s+to\s+say\s+this\b/,
    /\bi\s+don'?t\s+know\s+how\s+to\s+bring\s+this\s+up\b/,
    /\bbringing\s+this\s+up\b/,
    /\bworried\b/,
    /\banxious\b/,
    /\bnervous\b/,
    /\bafraid\b/,
    /\bscared\b/,
    /\boverthink(?:ing)?\b/,
    /\bwithout\s+making\s+things\s+worse\b/,
    /\bwalking\s+on\s+eggshells\b/,
  ],
  reassurance: [
    /\bare\s+we\s+okay\b/,
    /\bdo\s+you\s+still\s+care\b/,
    /\bi\s+just\s+want\s+us\s+to\s+be\s+okay\b/,
    /\bi\s+want\s+us\s+to\s+be\s+okay\b/,
    /\bdo\s+you\s+still\s+want\b/,
    /\bplease\s+tell\s+me\b/,
    /\bare\s+you\s+mad\s+at\s+me\b/,
    /\bare\s+you\s+upset\b/,
    /\bdid\s+i\s+do\s+something\b/,
    /\bare\s+you\s+okay\b/,
  ],
  repair: [
    /\bcan\s+we\s+talk\b/,
    /\bclear\s+something\s+up\b/,
    /\breset\b/,
    /\btalk\s+this\s+through\b/,
    /\bwork\s+through\s+this\b/,
    /\bfix\s+this\b/,
    /\breconnect\b/,
    /\bdon'?t\s+want\s+to\s+fight\b/,
    /\bwant\s+us\s+to\s+understand\b/,
  ],
  hopeful: [
    /\bhope\b/,
    /\bopen\b/,
    /\bconstructive\b/,
    /\bcalmly\b/,
    /\btogether\b/,
    /\bbetter\b/,
    /\bokay\b/,
  ],
  boundary: [
    /\bi\s+need\b/,
    /\bi\s+need\s+you\s+to\b/,
    /\bi\s+need\s+honesty\s+from\s+you\b/,
    /\bi\s+can'?t\b/,
    /\bi\s+won'?t\b/,
    /\bthat'?s\s+not\s+okay\b/,
    /\bplease\s+stop\b/,
    /\bbe\s+honest\s+with\s+me\b/,
  ],
  clarity: [
    /\bcan\s+we\b/,
    /\bcould\s+you\b/,
    /\bwould\s+you\b/,
    /\bi\s+want\s+to\b/,
    /\bi\s+need\s+to\b/,
    /\bhelp\s+me\s+understand\b/,
    /\bclear\s+something\s+up\b/,
  ],
  request: [
    /\bcould\s+you\b/,
    /\bcan\s+you\b/,
    /\bcan\s+we\b/,
    /\bwould\s+you\b/,
    /\bplease\b/,
    /\bi\s+need\s+you\s+to\b/,
    /\bwould\s+it\s+be\s+possible\b/,
  ],
  defensive: [
    /\bi\s+didn'?t\b/,
    /\bthat'?s\s+not\s+what\s+i\s+meant\b/,
    /\bi'?m\s+just\b/,
    /\bi\s+was\s+only\b/,
    /\bto\s+be\s+fair\b/,
    /\bit\s+wasn'?t\s+my\s+fault\b/,
  ],
  urgent: [
    /\bright\s+now\b/,
    /\basap\b/,
    /\bimmediately\b/,
    /\burgent\b/,
    /\bneed\s+to\s+know\s+now\b/,
    /\btoday\b/,
  ],
  overload: [
    /\boverwhelmed\b/,
    /\btoo\s+much\b/,
    /\bcan'?t\s+handle\b/,
    /\bexhausted\b/,
    /\bdrained\b/,
    /\bflooded\b/,
  ],
  ownership: [
    /\bi\s+feel\b/,
    /\bi\s+want\b/,
    /\bi\s+need\b/,
    /\bi'?m\b/,
    /\bi\s+am\b/,
    /\bi\s+would\s+like\b/,
    /\bi\s+care\b/,
  ],
  disappointment: [
    /\bi\s+feel\s+disappointed\b/,
    /\bi'?m\s+disappointed\b/,
    /\bi\s+am\s+disappointed\b/,
    /\bdisappointed\s+in\s+how\s+this\s+went\b/,
    /\blet\s+down\b/,
  ],
  distrust: [
    /\bi\s+can'?t\s+trust\s+you\b/,
    /\bi\s+don'?t\s+trust\s+you\b/,
    /\bdon'?t\s+trust\s+you\b/,
    /\btrust\s+is\s+broken\b/,
    /\bbe\s+honest\s+with\s+me\b/,
    /\bhonesty\b/,
  ],
  confrontation: [
    /\bi'?m\s+mad\s+at\s+you\b/,
    /\bi'?m\s+angry\s+at\s+you\b/,
    /\bi'?m\s+frustrated\s+with\b/,
    /\bwhat\s+you\s+did\b/,
    /\bhow\s+you\s+talk\s+to\s+me\b/,
    /\byou\s+betrayed\s+me\b/,
    /\byou\s+cheated\s+on\s+me\b/,
  ],
  reflective: [
    /\bi\s+realize\b/,
    /\bi\s+think\b/,
    /\bi\s+wonder\b/,
    /\bi\s+want\s+to\s+be\s+honest\b/,
    /\bmaybe\b/,
    /\bi\s+noticed\b/,
  ],
  collaboration: [
    /\bwe\b/,
    /\bus\b/,
    /\btogether\b/,
    /\bwith\s+you\b/,
  ],
  practical: [
    /\bare\s+you\s+free\b/,
    /\bwhat\s+time\b/,
    /\bwhen\s+can\s+we\b/,
    /\blater\b/,
    /\btomorrow\b/,
    /\bcan\s+you\s+send\b/,
  ],
  shutdown: [
    /\bwhatever\b/,
    /\bnvm\b/,
    /\bnever\s+mind\b/,
    /\bforget\s+it\b/,
    /\bdo\s+what\s+you\s+want\b/,
    /\bi'?m\s+done\b/,
    /\bfine\.?\s*$/,
    /\bif\s+that'?s\s+what\s+you\s+want\b/,
    /\bleave\s+it\b/,
    /\bit'?s\s+fine\b/,
    /\bdon'?t\s+worry\s+about\s+it\b/,
  ],
  professional: [
    /\bwork\b/,
    /\bteam\b/,
    /\bmanager\b/,
    /\bboss\b/,
    /\bshift\b/,
    /\bprofessional\b/,
    /\bunprofessional\b/,
    /\benvironment\b/,
    /\bworkplace\b/,
    /\bmeeting\b/,
    /\bproject\b/,
    /\bdeadline\b/,
    /\bworkflow\b/,
    /\bteam\s+environment\b/,
    /\benvironment\s+feels\b/,
  ],
  overExplaining: [
    /\bi\s+mean\b/,
    /\bi'?m\s+just\s+saying\b/,
    /\bwhat\s+i'?m\s+trying\s+to\s+say\b/,
    /\bto\s+clarify\b/,
    /\bwhat\s+i\s+meant\s+was\b/,
  ],
};

function countPatternHits(text, patterns) {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

function topScoredKey(scores, fallback) {
  let bestKey = fallback;
  let bestScore = Number.NEGATIVE_INFINITY;

  Object.entries(scores).forEach(([key, value]) => {
    if (value > bestScore) {
      bestScore = value;
      bestKey = key;
    }
  });

  return { key: bestKey, score: bestScore };
}

function secondBestScore(scores, winnerKey) {
  return Object.entries(scores)
    .filter(([key]) => key !== winnerKey)
    .reduce((best, [, value]) => Math.max(best, value), Number.NEGATIVE_INFINITY);
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatAnalysisLabel(value) {
  return String(value || "")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getToneSuggestion(context) {
  const {
    confidence,
    confidenceLabel,
    tone,
    intent,
    risk,
    stateOfMind,
    declaredEmotion,
    emotionMismatch,
    signals,
    social,
      } = context;

  if (emotionMismatch && declaredEmotion) {
    return `This may come across differently than you feel. Try leading with what happened first.`;
  }

  if (confidenceLabel === "low" || confidence < 0.46) {
    if (social.escalationRisk) {
      return "This may come across stronger than you want. Name what happened and what you need.";
    }
    return social.requestClarity
      ? "You're asking for something. Make it clear so they know how to respond."
      : "I may need more context. Add what happened or what you want next.";
  }

  if (signals.contempt > 0) {
    return "If you send it like this, they will likely react to the insult first, not your point. Remove the jab and name the issue.";
  }

  if (signals.betrayal > 0 || signals.distrust > 1) {
    return "This will likely land as a trust rupture. Name what broke trust and what repair you need next.";
  }

  if (signals.heartbreak > 0) {
    return "This sounds deeply hurt. Name the impact first, then the response you need from them.";
  }

  if (social.blamePerception && social.defensiveTrigger) {
    return "If you send it like this, they will likely focus on blame, not what you need. Lead with impact and one specific request.";
  }

  if (social.escalationRisk || (risk === "high" && social.blamePerception)) {
    return "This could escalate fast. Replace absolutes with what happened and what you need now.";
  }

  if (tone === "frustrated" && signals.anger > 0) {
    return "You are probably trying to be direct, but it may land harsher than intended. Focus on impact and what you need now.";
  }

  if (tone === "frustrated") {
    return "This may read as blame first. Shift to what you need instead of what they always do.";
  }

  if (tone === "anxious" || stateOfMind === "reassurance-seeking") {
    return "This reads like you want reassurance. Ask for it directly instead of hinting.";
  }

  if (tone === "sad" && signals.disappointment > 0) {
    return "This sounds more hurt than angry. Say what let you down and what would feel different now.";
  }

  if (tone === "sad" || stateOfMind === "hurt" || stateOfMind === "devastated") {
    return "Say how this affected you so it is heard as impact, not accusation.";
  }

  if (tone === "defensive" || stateOfMind === "guarded") {
    return "This may sound self-protective. Remove the opener and state your point plainly.";
  }

  if (tone === "urgent") {
    return "Urgency is coming through strongly. Slow the pace and make the immediate ask explicit.";
  }

  if (tone === "hopeful" || intent === "repair conflict" || intent === "reconnect") {
    return "This reads open and collaborative. Keep that tone and name the next step clearly.";
  }

  if (intent === "set a boundary") {
    return "Keep the boundary clear and concrete without adding extra blame.";
  }

  if (intent === "seek clarity" || intent === "make a request") {
    return "Make the ask specific so the other person knows how to respond.";
  }

  return "Keep it clear, grounded, and specific.";
}

/**
 * Phase 3.3: Communication Strategy Engine
 * -----------------------------------------
 * These functions determine the best communication move, not just emotion labels.
 */

function determineCommunicationPattern(context) {
  const { signals, social, intent, stateOfMind, tone, risk, lower, wordCount } = context;

  // Shutdown pattern
  if (signals.shutdown > 0 || signals.dismissal >= 2) {
    return "shutdown";
  }

  // Professional context
  if (signals.professional > 0) {
    return "professional concern";
  }

  // Blame-heavy (QA fix: lowered threshold since blamePerception already aggregates signals)
  if (social.blamePerception && (signals.accusation >= 1 || signals.blame >= 1 || signals.absolutes >= 1)) {
    return "blame-heavy";
  }

    // Reassurance-seeking
  if (intent === "ask for reassurance" || stateOfMind === "reassurance-seeking" || signals.reassurance >= 2) {
    return "reassurance-seeking";
  }

  // Boundary-setting
  if (intent === "set a boundary" || signals.boundary >= 2) {
    return "boundary-setting";
  }

  // Repair attempt
  if (intent === "repair conflict" || intent === "reconnect" || signals.repair >= 2) {
    return "repair attempt";
  }

  // Over-explaining (long message with uncertainty or defensive markers)
  if (wordCount > 35 && (signals.defensive > 0 || signals.overExplaining > 0 || signals.anxiety > 0)) {
    return "over-explaining";
  }

  // Phase 5.6: Communication uncertainty (meta-talk about not knowing how to say something)
  if (/\bi\s+don'?t\s+know\s+how\s+to\s+(say|bring|start)/.test(lower) && signals.anxiety > 0) {
    return "vague hurt / unclear ask";
  }

  // Vague complaint (emotion without clear request)
  const emotionalLoad = signals.anger + signals.pain + signals.disappointment + signals.betrayal + signals.heartbreak;
  if (emotionalLoad > 0 && signals.request === 0 && signals.clarity === 0 && signals.boundary === 0) {
    return "vague hurt / unclear ask";
  }

  // Emotional overload
  if (stateOfMind === "emotionally flooded" || signals.overload >= 2 || (signals.anger >= 2 && signals.contempt > 0)) {
    return "emotional overload";
  }

  // Guarded / avoidant
  if (stateOfMind === "guarded" || signals.defensive >= 2) {
    return "guarded / avoidant";
  }

  // Direct request
  if (intent === "make a request" && signals.request >= 1 && signals.clarity >= 1) {
    return "direct request";
  }

  // Escalation (high anger + confrontation)
  if (social.escalationRisk || (risk === "high" && (signals.anger >= 2 || signals.confrontation >= 2))) {
    return "escalation";
  }

  // Default to intent-based or neutral
  if (intent === "express hurt") {
    return "expressing hurt";
  }
  if (intent === "confront" || intent === "address betrayal") {
    return "confrontation";
  }
  if (intent === "vent frustration") {
    return "venting frustration";
  }

  return "neutral / unclear";
}

function determineLikelyRecipientReaction(pattern, context) {
  const { social, signals, risk } = context;

  switch (pattern) {
    case "blame-heavy":
      return "may get defensive";
    case "shutdown":
      return "may feel pushed away or confused";
    case "reassurance-seeking":
      return "may feel pressure if the ask is indirect";
    case "boundary-setting":
      return "may push back, but clarity helps";
    case "repair attempt":
      return "may respond better if the opening stays calm";
    case "vague hurt / unclear ask":
      return "may not understand what the user needs";
    case "over-explaining":
      return "may feel overwhelmed by too much detail";
    case "emotional overload":
      return "may shut down or escalate in response";
    case "escalation":
      return "may escalate or disengage";
    case "professional concern":
      return "may hear this as a complaint if too emotional";
    case "guarded / avoidant":
      return "may not understand what the user wants";
    case "direct request":
      return "should understand the ask if stated clearly";
    case "expressing hurt":
      return social.blamePerception ? "may feel blamed" : "may hear this as vulnerability";
    case "confrontation":
      return "may get defensive";
    case "venting frustration":
      return "may focus on defending themselves instead of hearing you";
    default:
      if (risk === "high") return "may react defensively";
      if (social.defensiveTrigger) return "may get defensive";
      return "reaction depends on tone and clarity";
  }
}

function determineBestCommunicationMove(pattern, context) {
  const { signals, social } = context;

  switch (pattern) {
    case "blame-heavy":
      return "behavior + impact + request";
    case "shutdown":
      return "clarify space vs repair";
    case "reassurance-seeking":
      return "ask directly for reassurance";
    case "boundary-setting":
      return "keep it clear and firm";
    case "repair attempt":
      return "lead with shared goal";
    case "vague hurt / unclear ask":
      return "add one specific ask";
    case "over-explaining":
      return "trim to core message";
    case "emotional overload":
      return "pause before sending";
    case "escalation":
      return "remove absolutes and focus on one need";
    case "professional concern":
      return "focus on impact and solution";
    case "guarded / avoidant":
      return "state the point plainly";
    case "direct request":
      return "keep it specific and concrete";
    case "expressing hurt":
      return social.blamePerception ? "behavior + impact + request" : "name the specific behavior";
    case "confrontation":
      return "soften accusation, focus on impact";
    case "venting frustration":
      return "replace accusation with what you need";
    default:
      return "clarify the goal";
  }
}

function determineSuggestedStyle(pattern, context) {
  const { signals, tone } = context;

  switch (pattern) {
    case "blame-heavy":
    case "escalation":
      return "calm and direct";
    case "shutdown":
      return "clear about next step";
    case "reassurance-seeking":
      return "direct and vulnerable";
    case "boundary-setting":
      return "short boundary";
    case "repair attempt":
      return "repair-focused";
    case "vague hurt / unclear ask":
      return "emotionally honest but specific";
    case "over-explaining":
      return "strategic minimal";
    case "emotional overload":
      return "pause and reset";
    case "professional concern":
      return "professional";
    case "guarded / avoidant":
      return "plain and direct";
    case "direct request":
      return "clear request";
    case "expressing hurt":
      return "emotionally honest but not heavy";
    case "confrontation":
      return "firm but not accusatory";
    case "venting frustration":
      return "calm and direct";
    default:
      if (tone === "hopeful") return "collaborative";
      if (signals.repair > 0) return "repair-focused";
      return "clear and grounded";
  }
}

/**
 * Phase 5: Context-Aware Coaching + Anti-Repetition Engine
 * ----------------------------------------------------------
 * Guidance Angle System: Multiple coaching approaches per pattern
 * Anti-Repetition: Tracks recent guidance to avoid repetitive advice
 * Human Language: Natural coach voice, not robotic templates
 */

// Guidance Angles: Different coaching approaches
const GUIDANCE_ANGLES = {
  SOFTEN_ACCUSATION: "soften_accusation",
  CLARIFY_ASK: "clarify_ask",
  NAME_IMPACT: "name_impact",
  REQUEST_REASSURANCE: "request_reassurance",
  SET_BOUNDARY: "set_boundary",
  REPAIR_CONNECTION: "repair_connection",
  SLOW_DOWN: "slow_down",
  ASK_FOR_CONTEXT: "ask_for_context",
  CHOOSE_TIMING: "choose_timing",
  REDUCE_EXPLAINING: "reduce_explaining",
  BE_SPECIFIC: "be_specific",
  PROTECT_RESPECT: "protect_respect",
  INVITE_COLLABORATION: "invite_collaboration",
  DEESCALATE: "deescalate",
  EMOTION_TO_REQUEST: "emotion_to_request",
  CLARIFY_SPACE_REPAIR: "clarify_space_repair",
  WORKPLACE_FRAME: "workplace_frame",
  BOUNDARY_NO_EXPLAIN: "boundary_no_explain",
  TRUST_REPAIR: "trust_repair",
  SHUTDOWN_REDIRECT: "shutdown_redirect",
};

// Guidance variations for each angle (natural, human language)
const GUIDANCE_VARIATIONS = {
  [GUIDANCE_ANGLES.SOFTEN_ACCUSATION]: [
    "This may sound like blame. Try leading with what happened and what you need.",
    "They may focus on the blame instead of what hurt you. Name the moment and one clear ask.",
    "Lead with the specific moment, not the pattern. That helps them hear you better.",
  ],
  [GUIDANCE_ANGLES.CLARIFY_ASK]: [
    "They may not know what you want to happen next. Add one clear request.",
    "You're signaling something's wrong. Say what you need them to do or say.",
    "The feeling is clear, the ask isn't. Say what you want to happen next.",
  ],
  [GUIDANCE_ANGLES.NAME_IMPACT]: [
    "Say how this affected you so it's heard better.",
    "Lead with how this landed for you, not what they always do.",
    "Name the specific impact instead of the pattern.",
  ],
  [GUIDANCE_ANGLES.REQUEST_REASSURANCE]: [
    "You may want reassurance. Ask directly instead of guessing.",
    "If you're seeking reassurance, say that. They may not pick up the hint.",
    "Ask for the reassurance you need instead of circling around it.",
  ],
  [GUIDANCE_ANGLES.SET_BOUNDARY]: [
    "This sounds like a boundary. Keep it short and clear.",
    "You're setting a line here. Say it plainly and stop after the boundary.",
    "Boundaries work best when they're short. Don't add a bunch of reasons.",
  ],
  [GUIDANCE_ANGLES.REPAIR_CONNECTION]: [
    "This sounds like repair. Lead with that instead of the problem first.",
    "If your goal is reconnecting, say that upfront so they don't hear attack.",
    "Start with the shared goal, then the problem.",
  ],
  [GUIDANCE_ANGLES.SLOW_DOWN]: [
    "This sounds reactive. Consider pausing before sending.",
    "Try slowing this down. Write it out, then trim to what really matters.",
    "Take a breath, then send the version that gets heard.",
  ],
  [GUIDANCE_ANGLES.ASK_FOR_CONTEXT]: [
    "If you don't have the full story, ask for context first.",
    "This might be reacting to incomplete information. Check in before confronting.",
    "Make sure you're not filling in blanks they should explain.",
  ],
  [GUIDANCE_ANGLES.CHOOSE_TIMING]: [
    "Timing matters here. Consider when they're most likely to hear this.",
    "This conversation works better when you're both calm. Consider when to send it.",
    "Think about when this will land best.",
  ],
  [GUIDANCE_ANGLES.REDUCE_EXPLAINING]: [
    "This is getting long. Trim it so it doesn't overwhelm.",
    "You're probably over-explaining. Cut this to one clear point and one ask.",
    "The more you explain, the less they'll hear. Pick the strongest line.",
  ],
  [GUIDANCE_ANGLES.BE_SPECIFIC]: [
    "Make the ask specific so they know how to respond.",
    "You're asking for something real. Make the request clear.",
    "Say exactly what you need, not just how you feel.",
  ],
  [GUIDANCE_ANGLES.PROTECT_RESPECT]: [
    "You can be direct without losing your dignity. Keep it firm but respectful.",
    "Don't apologize for the boundary, but don't make it personal either.",
    "Say what you need without making yourself small or them the villain.",
  ],
  [GUIDANCE_ANGLES.INVITE_COLLABORATION]: [
    "This reads open and collaborative. Keep that tone and name the next step.",
    "You're setting up a conversation, not an attack. Make the goal clear.",
    "This feels solution-focused. Suggest a clear path forward.",
  ],
  [GUIDANCE_ANGLES.DEESCALATE]: [
    "This could turn into an argument fast. Focus on one clear need.",
    "Pick the one thing that matters most right now.",
    "Replace the absolutes with what actually happened and what you need now.",
  ],
  [GUIDANCE_ANGLES.EMOTION_TO_REQUEST]: [
    "They hear you're upset. Turn the emotion into one clear request.",
    "Feelings are valid, but requests move things forward. What do you need?",
    "You're sharing hurt. Add what happened and what you need next.",
    "You're unsure how to start. Add the main feeling and what you want next.",
  ],
  [GUIDANCE_ANGLES.CLARIFY_SPACE_REPAIR]: [
    "This sounds like shutting down. Say if you need space or still want to talk.",
    "Are you asking for space or trying to reconnect? Make that clear.",
    "Say whether this is temporary distance or done.",
  ],
  [GUIDANCE_ANGLES.WORKPLACE_FRAME]: [
    "This sounds work-related. Keep it specific, calm, and solution-focused.",
    "Frame this as impact on the work, not just how you feel.",
    "Keep the workplace lens on this. Talk about outcomes.",
  ],
  [GUIDANCE_ANGLES.BOUNDARY_NO_EXPLAIN]: [
    "This sounds like a boundary. Keep it calm and short.",
    "You don't need to justify this. Say what you need and stop.",
    "State it clearly and let it stand.",
  ],
  [GUIDANCE_ANGLES.TRUST_REPAIR]: [
    "This is about broken trust. Ask for honesty, accountability, or space.",
    "If trust is broken, say that. Then say what would start to rebuild it.",
    "Say what repair looks like, not just the pain.",
  ],
  [GUIDANCE_ANGLES.SHUTDOWN_REDIRECT]: [
    "If you want to talk later, say that instead of shutting down.",
    "They need to know if this is temporary or done.",
    "If that's not your intent, clarify what you actually mean.",
  ],
};

// Select guidance angle based on pattern and context
function selectGuidanceAngle(pattern, context) {
  const { signals, social, intent, risk, tone, stateOfMind, wordCount } = context;

  // Phase 5.6: Prioritize betrayal → trust repair
  if (signals.betrayal > 0 && (pattern === "confrontation" || pattern === "blame-heavy" || pattern === "expressing hurt")) {
    return GUIDANCE_ANGLES.TRUST_REPAIR;
  }

  switch (pattern) {
    case "blame-heavy":
      // Phase 5.6: Prioritize soften accusation for "always/never" patterns
      if (social.alwaysNever) return GUIDANCE_ANGLES.SOFTEN_ACCUSATION;
      if (risk === "high" || social.escalationRisk) return GUIDANCE_ANGLES.DEESCALATE;
      if (signals.betrayal > 0) return GUIDANCE_ANGLES.TRUST_REPAIR;
      return GUIDANCE_ANGLES.SOFTEN_ACCUSATION;

    case "shutdown":
      if (intent === "repair conflict") return GUIDANCE_ANGLES.REPAIR_CONNECTION;
      return GUIDANCE_ANGLES.CLARIFY_SPACE_REPAIR;

    case "reassurance-seeking":
      // Phase 5.6: Detect repair intent within reassurance
      if (signals.repair > 0 || /\bus\s+to\s+be\s+okay\b/.test(context.lower)) return GUIDANCE_ANGLES.REPAIR_CONNECTION;
      return GUIDANCE_ANGLES.REQUEST_REASSURANCE;

    case "boundary-setting":
      if (wordCount > 25) return GUIDANCE_ANGLES.BOUNDARY_NO_EXPLAIN;
      if (tone === "defensive" || tone === "frustrated") return GUIDANCE_ANGLES.PROTECT_RESPECT;
      return GUIDANCE_ANGLES.SET_BOUNDARY;

    case "repair attempt":
      return GUIDANCE_ANGLES.REPAIR_CONNECTION;

    case "vague hurt / unclear ask":
      // Phase 5.6: Include anger and anxiety signals as emotional expression needing request
      if (signals.pain > 0 || signals.disappointment > 0 || signals.anger > 0 || signals.anxiety > 0) return GUIDANCE_ANGLES.EMOTION_TO_REQUEST;
      return GUIDANCE_ANGLES.CLARIFY_ASK;

    case "over-explaining":
      return GUIDANCE_ANGLES.REDUCE_EXPLAINING;

    case "emotional overload":
      return GUIDANCE_ANGLES.SLOW_DOWN;

    case "escalation":
      return GUIDANCE_ANGLES.DEESCALATE;

    case "professional concern":
      return GUIDANCE_ANGLES.WORKPLACE_FRAME;

    case "guarded / avoidant":
      if (signals.request > 0) return GUIDANCE_ANGLES.BE_SPECIFIC;
      return GUIDANCE_ANGLES.CLARIFY_ASK;

    case "direct request":
      if (signals.clarity >= 2) return GUIDANCE_ANGLES.INVITE_COLLABORATION;
      return GUIDANCE_ANGLES.BE_SPECIFIC;

    case "expressing hurt":
      if (social.blamePerception) return GUIDANCE_ANGLES.SOFTEN_ACCUSATION;
      if (signals.request === 0) return GUIDANCE_ANGLES.EMOTION_TO_REQUEST;
      return GUIDANCE_ANGLES.NAME_IMPACT;

    case "confrontation":
      if (signals.betrayal > 0 || signals.distrust > 0) return GUIDANCE_ANGLES.TRUST_REPAIR;
      if (risk === "high") return GUIDANCE_ANGLES.DEESCALATE;
      return GUIDANCE_ANGLES.SOFTEN_ACCUSATION;

    case "venting frustration":
      if (risk === "high") return GUIDANCE_ANGLES.DEESCALATE;
      return GUIDANCE_ANGLES.EMOTION_TO_REQUEST;

    default:
      if (risk === "high") return GUIDANCE_ANGLES.DEESCALATE;
      if (signals.repair > 0) return GUIDANCE_ANGLES.INVITE_COLLABORATION;
      if (signals.request === 0 && signals.clarity === 0) return GUIDANCE_ANGLES.CLARIFY_ASK;
      return GUIDANCE_ANGLES.BE_SPECIFIC;
  }
}

// Check if guidance was recently shown (anti-repetition)
function wasRecentlyShown(guidanceText) {
  // Exact match
  if (recentGuidanceHistory.includes(guidanceText)) return true;

  // Similar match (first 30 chars to catch variations)
  const shortForm = guidanceText.substring(0, 30).toLowerCase();
  return recentGuidanceHistory.some(recent =>
    recent.substring(0, 30).toLowerCase() === shortForm
  );
}

// Add guidance to history (anti-repetition tracking)
function trackGuidance(guidanceText) {
  recentGuidanceHistory.push(guidanceText);
  if (recentGuidanceHistory.length > MAX_GUIDANCE_HISTORY) {
    recentGuidanceHistory.shift(); // Remove oldest
  }
}

function generateUserFacingGuidance(pattern, reaction, move, context) {
  const { social, signals, intent, risk, confidenceLabel, tone, wordCount, lower } = context;

  // Phase 5.6: No coaching needed for simple practical questions (check before low confidence)
  if (intent === "ask a practical question" && signals.practical >= 1 && risk === "low" && tone === "neutral") {
    return ""; // No guidance needed
  }

  // Phase 5.6: Specific pattern-based guidance overrides (exact phrase matching)
  if (/\bi\s+feel\s+ignored\b/.test(lower) && signals.pain > 0) {
    return "You're sharing hurt. Add what happened and what you need next.";
  }
  if (/\bi\s+feel\s+overlooked\b/.test(lower) && signals.pain > 0) {
    return "You're sharing that you feel unseen. Add what happened and what you need next.";
  }
  if (/\bi\s+feel\s+dismissed\b/.test(lower) && signals.pain > 0) {
    return "You're sharing hurt. Name what happened and what you need next.";
  }
  if (/\bi\s+feel\s+unheard\b/.test(lower) && signals.pain > 0) {
    return "You're sharing hurt. Name what happened and what you need next.";
  }
  if (/\bi\s+feel\s+unseen\b/.test(lower) && signals.pain > 0) {
    return "You're sharing that you feel unseen. Name what happened and what you need next.";
  }
  if (/\bi\s+feel\s+left\s+out\b/.test(lower) && signals.pain > 0) {
    return "You're sharing hurt. Name what happened and what you need next.";
  }
  if (/\bi'?m\s+mad\s+at\s+you\b/.test(lower) && signals.anger > 0) {
    return "You're angry. Say what happened before saying what they are.";
  }
  if (/\bare\s+you\s+mad\s+at\s+me\b/.test(lower) && signals.reassurance > 0) {
    return "You may want reassurance. Ask directly instead of guessing.";
  }
  if (/\bi\s+don'?t\s+know\s+how\s+to\s+say\s+this\b/.test(lower) && signals.anxiety > 0) {
    return "You're unsure how to start. Add the main feeling and what you want next.";
  }
  if (/\bi\s+feel\s+like\s+you\s+don'?t\s+care/.test(lower)) {
    return "You're sharing hurt. Try naming the moment before saying they don't care.";
  }

  // Phase 6.5: Shutdown detection (explicit patterns before low confidence)
  if (signals.shutdown >= 1 || /\bnever\s+mind\.?$/i.test(lower) || /\bnvm\b/.test(lower)) {
    return "This sounds like you might be pulling back. Say if you need space or still want to talk.";
  }
  if (/\bit'?s\s+fine\s+whatever\b/.test(lower) || /\bwhatever.*forget\s+it\b/.test(lower)) {
    return "This may sound like you're closing off. Say what you actually need.";
  }

  // Low confidence cases (after practical check, before angle selection)
  if (confidenceLabel === "low" && intent !== "ask a practical question") {
    if (social.escalationRisk) {
      return "This is short, but it will likely land as accusation. Drop absolutes and name one specific need.";
    }
    return "I may need more context. Add one clear feeling or what you're asking for.";
  }

  // Phase 5: Select guidance angle based on pattern and context
  const angle = selectGuidanceAngle(pattern, context);
  const variations = GUIDANCE_VARIATIONS[angle] || GUIDANCE_VARIATIONS[GUIDANCE_ANGLES.BE_SPECIFIC];

  // Anti-repetition: Try each variation until we find one not recently shown
  for (let i = 0; i < variations.length; i++) {
    const candidate = variations[i];
    if (!wasRecentlyShown(candidate)) {
      trackGuidance(candidate);
      return candidate;
    }
  }

  // Fallback: If all variations were recently shown, use the first one anyway
  // (This means user is typing very similar messages repeatedly)
  trackGuidance(variations[0]);
  return variations[0];
}

function generateExampleMessage(pattern, context) {
  const { signals, intent } = context;

  switch (pattern) {
    case "blame-heavy":
      return "When plans change last minute, I feel left out. Can we talk about what happened?";

    case "shutdown":
      return "I'm upset and need a little space, but I do want to talk when I'm calmer.";

    case "reassurance-seeking":
      return "I'm feeling unsure and could use some reassurance. Are we okay?";

    case "boundary-setting":
      return "I'm not okay with being spoken to like that. I'm open to talking when it stays respectful.";

    case "repair attempt":
      return "I don't want this to turn into a fight. Can we reset and talk about what happened?";

    case "vague hurt / unclear ask":
      return "I felt ignored earlier. Can you give me a heads-up next time instead of leaving me guessing?";

    case "over-explaining":
      return "I need us to talk about this. Can we find a time that works?";

    case "emotional overload":
      return "I'm overwhelmed right now. Can we talk about this when I'm calmer?";

    case "escalation":
      return "I'm frustrated about what happened. Can we talk through this?";

    case "professional concern":
      return "I noticed this is affecting the workflow. Can we align on how to handle it going forward?";

    case "guarded / avoidant":
      return "I need to talk about what happened. When can we do that?";

    case "direct request":
      return "Can you let me know by tomorrow? That would help me plan better.";

    case "expressing hurt":
      return "When that happened, I felt hurt. Can we talk about how to avoid that going forward?";

    case "confrontation":
      return "I was hurt by what happened. Can we talk about it?";

    case "venting frustration":
      return "I'm frustrated about this. Can we find a way to handle it differently next time?";

    default:
      if (signals.repair > 0) {
        return "I want us to work through this. Can we talk?";
      }
      if (intent === "make a request") {
        return "Can you [specific ask]? That would really help.";
      }
      return "I'd like to talk about this. When works for you?";
  }
}

function analyzeDraft(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return null;
  }

  const lower = raw.toLowerCase().replace(/[\u2018\u2019\u201B]/g, "'");
  const wordCount = raw.split(/\s+/).filter(Boolean).length;
  const questionCount = (raw.match(/\?/g) || []).length;
  const exclamationCount = (raw.match(/!/g) || []).length;
  const ellipsisCount = (raw.match(/\.\.\.+/g) || []).length;
  const uppercaseRuns = (raw.match(/\b[A-Z]{3,}\b/g) || []).length;
  const startsWithQuestion = /^(how|what|when|where|why|can|could|would|will|do|did|are|is)\b/i.test(raw);
  const strongEmotionStatement =
    /\bi(?:'|\s+a)m\s+(mad|angry|hurt|upset|furious|livid|anxious|scared|afraid|frustrated)\b/.test(lower) ||
    /\bi\s+feel\s+(hurt|angry|sad|anxious|betrayed|frustrated|disappointed)\b/.test(lower);
  const socialCues = {
    alwaysNever: /\byou\s+(always|never)\b/.test(lower),
    iFeel: /\bi\s+feel\b/.test(lower),
    youDid: /\byou\s+(did|said|made|ignored|betrayed|cheated|lied)\b/.test(lower),
    canWe: /\bcan\s+we\b/.test(lower),
    iNeed: /\bi\s+need\b/.test(lower),
  };

  const signals = {
    anger: countPatternHits(lower, DRAFT_ANALYZER_PATTERNS.anger),
    accusation: countPatternHits(lower, DRAFT_ANALYZER_PATTERNS.accusation),
    blame: countPatternHits(lower, DRAFT_ANALYZER_PATTERNS.blame),
    absolutes: countPatternHits(lower, DRAFT_ANALYZER_PATTERNS.absolutes),
    dismissal: countPatternHits(lower, DRAFT_ANALYZER_PATTERNS.dismissal),
    contempt: countPatternHits(lower, DRAFT_ANALYZER_PATTERNS.contempt),
    pain: countPatternHits(lower, DRAFT_ANALYZER_PATTERNS.pain),
    betrayal: countPatternHits(lower, DRAFT_ANALYZER_PATTERNS.betrayal),
    heartbreak: countPatternHits(lower, DRAFT_ANALYZER_PATTERNS.heartbreak),
    anxiety: countPatternHits(lower, DRAFT_ANALYZER_PATTERNS.anxiety),
    reassurance: countPatternHits(lower, DRAFT_ANALYZER_PATTERNS.reassurance),
    repair: countPatternHits(lower, DRAFT_ANALYZER_PATTERNS.repair),
    hopeful: countPatternHits(lower, DRAFT_ANALYZER_PATTERNS.hopeful),
    boundary: countPatternHits(lower, DRAFT_ANALYZER_PATTERNS.boundary),
    clarity: countPatternHits(lower, DRAFT_ANALYZER_PATTERNS.clarity),
    request: countPatternHits(lower, DRAFT_ANALYZER_PATTERNS.request),
    defensive: countPatternHits(lower, DRAFT_ANALYZER_PATTERNS.defensive),
    urgent: countPatternHits(lower, DRAFT_ANALYZER_PATTERNS.urgent),
    overload: countPatternHits(lower, DRAFT_ANALYZER_PATTERNS.overload),
    ownership: countPatternHits(lower, DRAFT_ANALYZER_PATTERNS.ownership),
    disappointment: countPatternHits(lower, DRAFT_ANALYZER_PATTERNS.disappointment),
    distrust: countPatternHits(lower, DRAFT_ANALYZER_PATTERNS.distrust),
    confrontation: countPatternHits(lower, DRAFT_ANALYZER_PATTERNS.confrontation),
    reflective: countPatternHits(lower, DRAFT_ANALYZER_PATTERNS.reflective),
    collaboration: countPatternHits(lower, DRAFT_ANALYZER_PATTERNS.collaboration),
    practical: countPatternHits(lower, DRAFT_ANALYZER_PATTERNS.practical),
    shutdown: countPatternHits(lower, DRAFT_ANALYZER_PATTERNS.shutdown),
    professional: countPatternHits(lower, DRAFT_ANALYZER_PATTERNS.professional),
    overExplaining: countPatternHits(lower, DRAFT_ANALYZER_PATTERNS.overExplaining),
  };

  const social = {
    alwaysNever: socialCues.alwaysNever,
    blamePerception:
      signals.accusation + signals.blame + signals.absolutes + signals.confrontation + (socialCues.youDid ? 1 : 0) >= 2,
    defensiveTrigger:
      signals.accusation + signals.blame + signals.absolutes + signals.contempt + (socialCues.alwaysNever ? 1 : 0) >= 2,
    emotionalSafetyRisk:
      signals.contempt + signals.dismissal + signals.anger + signals.accusation >= 2,
    clearRequest: signals.request + signals.boundary + signals.clarity >= 1,
    ownershipLanguage: signals.ownership > 0,
    collaborationCue: signals.collaboration + signals.repair + signals.reassurance >= 1,
    escalationRisk:
      signals.accusation + signals.absolutes + signals.contempt + signals.anger + (socialCues.alwaysNever ? 1 : 0) >= 3,
    requestClarity: signals.request + signals.boundary + signals.clarity + (socialCues.canWe ? 1 : 0) + (socialCues.iNeed ? 1 : 0) >= 1,
  };

  const emotionalLoad =
    signals.anger +
    signals.accusation +
    signals.blame +
    signals.contempt +
    signals.pain +
    signals.betrayal +
    signals.heartbreak +
    signals.anxiety +
    signals.disappointment +
    signals.distrust +
    signals.confrontation +
    signals.overload +
    signals.defensive;

  const vagueComplaint =
    emotionalLoad > 0 &&
    signals.request === 0 &&
    signals.clarity === 0 &&
    signals.boundary === 0 &&
    questionCount === 0;

  const toneScores = {
    calm: 0.12,
    neutral: 0.3,
    frustrated: 0,
    anxious: 0,
    sad: 0,
    hopeful: 0,
    defensive: 0,
    urgent: 0,
  };

  toneScores.frustrated +=
    signals.anger * 2.8 +
    signals.accusation * 2.4 +
    signals.blame * 1.9 +
    signals.confrontation * 1.7 +
    signals.betrayal * 1.2 +
    signals.distrust * 0.8 +
    signals.absolutes * 1.1 +
    (socialCues.alwaysNever ? 1.2 : 0) +
    signals.dismissal * 1.5 +
    signals.contempt * 3 +
    exclamationCount * 0.5 +
    uppercaseRuns * 0.8;
  toneScores.anxious +=
    signals.anxiety * 2.3 +
    signals.reassurance * 1.8 +
    signals.distrust * 0.8 +
    signals.overload * 1.4 +
    (socialCues.iNeed ? 0.25 : 0) +
    ellipsisCount * 0.5 +
    Math.max(questionCount - 1, 0) * 0.35;
  toneScores.sad +=
    signals.pain * 2.5 +
    signals.heartbreak * 3.1 +
    signals.betrayal * 1.8 +
    signals.disappointment * 1.7 +
    signals.distrust * 0.7 +
    signals.reassurance * 0.8 +
    (socialCues.iFeel ? 0.9 : 0) +
    signals.ownership * 0.5 +
    signals.reflective * 0.3;
  toneScores.hopeful +=
    signals.repair * 2.2 +
    signals.hopeful * 1.7 +
    signals.collaboration * 0.8 +
    signals.clarity * 0.6 +
    signals.ownership * 0.4;
  toneScores.defensive +=
    signals.defensive * 2.4 +
    signals.blame * 0.7 +
    signals.dismissal * 0.5;
  toneScores.urgent +=
    signals.urgent * 2.5 +
    exclamationCount * 0.55 +
    uppercaseRuns * 0.45 +
    Math.max(questionCount - 1, 0) * 0.2;
  toneScores.calm +=
    signals.ownership * 0.9 +
    signals.clarity * 0.8 +
    signals.collaboration * 0.5 +
    (signals.practical > 0 ? 0.4 : 0) +
    (emotionalLoad === 0 && exclamationCount === 0 ? 0.8 : 0);
  toneScores.neutral +=
    signals.practical * 2.1 +
    signals.request * 1 +
    signals.clarity * 0.8 +
    questionCount * 0.45 +
    (startsWithQuestion ? 0.4 : 0) +
    (emotionalLoad === 0 ? 0.45 : 0);

  if (selectedEmotion && toneScores[selectedEmotion] !== undefined) {
    const chipBias = emotionalLoad >= 2 ? 0.2 : emotionalLoad === 1 ? 0.3 : 0.45;
    toneScores[selectedEmotion] += selectedEmotion === "calm" ? Math.min(chipBias, 0.3) : chipBias;
  }

  const toneWinner = topScoredKey(toneScores, signals.practical > 0 ? "neutral" : emotionalLoad > 0 ? "sad" : "neutral");
  let tone = toneWinner.key;

  if (tone === "calm" && emotionalLoad > 0) {
    const emotionalTone = topScoredKey(
      {
        frustrated: toneScores.frustrated,
        anxious: toneScores.anxious,
        sad: toneScores.sad,
        hopeful: toneScores.hopeful,
        defensive: toneScores.defensive,
        urgent: toneScores.urgent,
      },
      "sad"
    );
    tone = emotionalTone.score >= 0.95 ? emotionalTone.key : emotionalLoad >= 2 ? "sad" : "neutral";
  }

  if (signals.betrayal > 0 && signals.anger === 0 && signals.contempt === 0 && exclamationCount === 0) {
    tone = "sad";
  }

  if (tone === "neutral" && emotionalLoad > 0) {
    const emotiveToneWinner = topScoredKey(
      {
        frustrated: toneScores.frustrated,
        anxious: toneScores.anxious,
        sad: toneScores.sad,
        hopeful: toneScores.hopeful,
        defensive: toneScores.defensive,
        urgent: toneScores.urgent,
      },
      "neutral"
    );
    if (emotiveToneWinner.score >= 0.95) {
      tone = emotiveToneWinner.key;
    }
  }

  const stateScores = {
    hurt:
      signals.pain * 2.5 +
      signals.disappointment * 1.4 +
      signals.accusation * 0.7 +
      signals.reassurance * 0.5 +
      (socialCues.iFeel ? 0.8 : 0),
    betrayed: signals.betrayal * 2.8 + signals.distrust * 1.5 + signals.confrontation * 0.5,
    devastated: signals.heartbreak * 2.8 + signals.betrayal * 1.1 + signals.pain * 0.9,
    overwhelmed: signals.overload * 2.1 + signals.anxiety * 0.8 + signals.urgent * 0.7,
    reactive:
      signals.anger * 2 +
      signals.accusation * 1.4 +
      signals.blame * 1.1 +
      signals.confrontation * 1.1 +
      exclamationCount * 0.7 +
      signals.contempt * 1.1,
    insecure: signals.anxiety * 1.4 + signals.reassurance * 1.1 + signals.distrust * 0.8,
    anxious: signals.anxiety * 2 + signals.reassurance * 0.8 + signals.overload * 0.7,
    "reassurance-seeking": signals.reassurance * 2.3 + questionCount * 0.4,
    reflective: signals.reflective * 2 + signals.ownership * 0.9 + signals.repair * 0.5,
    guarded: signals.defensive * 2.2 + signals.dismissal * 0.6,
    "emotionally flooded":
      signals.overload * 1.8 +
      signals.anger * 1.2 +
      signals.contempt * 1.2 +
      signals.accusation * 0.9 +
      uppercaseRuns * 0.8 +
      exclamationCount * 0.7,
    "clear-headed":
      signals.clarity * 1.3 +
      signals.request * 0.9 +
      signals.collaboration * 0.7 +
      (emotionalLoad === 0 ? 1 : 0),
  };

  if (selectedEmotion === "sad") {
    stateScores.hurt += 0.3;
  } else if (selectedEmotion === "anxious") {
    stateScores.insecure += 0.35;
    stateScores["reassurance-seeking"] += 0.3;
  } else if (selectedEmotion === "frustrated") {
    stateScores.reactive += 0.35;
  } else if (selectedEmotion === "hopeful") {
    stateScores.reflective += 0.2;
    stateScores["clear-headed"] += 0.2;
  } else if (selectedEmotion === "calm") {
    stateScores["clear-headed"] += 0.25;
  }

  const stateOfMind = topScoredKey(stateScores, "clear-headed").key;

  const intentScores = {
    "ask for reassurance": signals.reassurance * 2.4 + questionCount * 0.35,
    "set a boundary": signals.boundary * 2.4 + signals.request * 0.8,
    "express hurt":
      signals.pain * 2.4 +
      signals.heartbreak * 2 +
      signals.disappointment * 1.3 +
      signals.ownership * 0.7,
    "seek clarity": signals.clarity * 2 + questionCount * 0.8 + (startsWithQuestion ? 0.5 : 0),
    "repair conflict": signals.repair * 2.3 + signals.collaboration * 1.1 + signals.hopeful * 0.5,
    "vent frustration":
      signals.anger * 2.3 +
      signals.accusation * 2 +
      signals.blame * 1.4 +
      signals.confrontation * 1.5 +
      signals.contempt * 1.5 +
      signals.dismissal * 0.8,
    "ask a practical question": signals.practical * 2.5 + questionCount * 0.9,
    reconnect: signals.repair * 1.4 + signals.collaboration * 1.2 + signals.hopeful * 0.6,
    "make a request": signals.request * 2.1 + signals.clarity * 0.8 + signals.boundary * 0.6,
    "address betrayal": signals.betrayal * 2.8 + signals.distrust * 1.2,
    confront: signals.confrontation * 2.2 + signals.anger * 1.5 + signals.accusation * 1.1,
  };

  let intent = topScoredKey(intentScores, questionCount > 0 ? "seek clarity" : "make a request").key;
  if (signals.practical > 0 && emotionalLoad === 0) {
    intent = "ask a practical question";
  } else if (signals.betrayal > 0) {
    intent = "address betrayal";
  } else if ((signals.pain > 0 || signals.heartbreak > 0 || signals.disappointment > 0) && signals.accusation === 0 && signals.repair === 0) {
    intent = "express hurt";
  }

  let riskScore =
    signals.anger * 1.3 +
    signals.accusation * 2.2 +
    signals.blame * 1.8 +
    signals.betrayal * 1.7 +
    signals.confrontation * 1.1 +
    signals.absolutes * 0.9 +
    signals.dismissal * 1.4 +
    signals.contempt * 3.2 +
    signals.heartbreak * 0.8 +
    signals.distrust * 0.9 +
    signals.overload * 0.8 +
    signals.urgent * 0.7 +
    exclamationCount * 0.55 +
    uppercaseRuns * 0.75 +
    (socialCues.alwaysNever ? 1.2 : 0) +
    (socialCues.youDid ? 0.5 : 0) +
    (vagueComplaint ? 1 : 0);

  if (social.blamePerception) {
    riskScore += 0.5;
  }

  if (social.clearRequest && social.ownershipLanguage) {
    riskScore -= 0.35;
  }

  riskScore -=
    signals.ownership * 0.5 +
    signals.repair * 0.8 +
    signals.clarity * 0.55 +
    signals.collaboration * 0.45;

  if (signals.contempt > 0 && (signals.accusation > 0 || /\bi\s+hate\s+you\b/.test(lower))) {
    riskScore += 2;
  }

  const risk = riskScore >= 5.5 ? "high" : riskScore >= 2.8 ? "medium" : "low";

  const signalWeight = Object.values(signals).reduce((sum, value) => sum + value, 0);
  const secondToneScore = secondBestScore(toneScores, toneWinner.key);
  const toneGap = Math.max(toneWinner.score - secondToneScore, 0);
  const explicitEmotionHits =
    signals.anger +
    signals.pain +
    signals.betrayal +
    signals.heartbreak +
    signals.anxiety +
    signals.disappointment +
    signals.distrust +
    Math.min(signals.reassurance, 1);

  const groupHits = [
    signals.anger + signals.accusation + signals.blame + signals.contempt,
    signals.pain + signals.disappointment + signals.heartbreak,
    signals.anxiety + signals.reassurance + signals.overload,
    signals.betrayal + signals.distrust,
    signals.repair + signals.hopeful + signals.collaboration,
    signals.boundary + signals.request + signals.clarity,
  ].filter((value) => value > 0).length;

  // Phase 5.6: Stronger boost for explicit emotional statements
  const iFeelPainBoost = /\bi\s+feel\s+(ignored|hurt|sad|disappointed|disrespected|betrayed|lonely|rejected)\b/.test(lower) ? 0.18 : 0;
  const iFeelLikeBoost = /\bi\s+feel\s+like\s+you\s+(don'?t\s+care|ignore|never)\b/.test(lower) ? 0.15 : 0;
  const iMadAtYouBoost = /\bi'?m\s+mad\s+at\s+you\b/.test(lower) ? 0.16 : 0;
  const areYouMadBoost = /\bare\s+you\s+mad\s+at\s+me\b/.test(lower) ? 0.14 : 0;
  const dontKnowHowBoost = /\bi\s+don'?t\s+know\s+how\s+to\s+(say|start|bring)/.test(lower) ? 0.13 : 0;
  const dismissalBoost = signals.dismissal >= 2 ? 0.15 : 0;
  const reassurancePatternBoost = signals.reassurance >= 1 ? 0.12 : 0;
  const betrayalBoost = signals.betrayal >= 1 ? 0.18 : 0;
  const shutdownBoost = signals.shutdown >= 1 ? 0.14 : 0;
  const professionalBoost = signals.professional >= 2 ? 0.16 : 0;

  const consistencyBoost =
    (toneGap >= 1.4 ? 0.13 : toneGap >= 0.85 ? 0.07 : 0) +
    (explicitEmotionHits >= 2 ? 0.12 : explicitEmotionHits === 1 ? 0.05 : 0) +
    (groupHits >= 2 ? 0.11 : groupHits === 1 ? 0.04 : 0) +
    (strongEmotionStatement ? 0.16 : 0) +
    (socialCues.alwaysNever ? 0.1 : 0) +
    iFeelPainBoost +
    iFeelLikeBoost +
    iMadAtYouBoost +
    areYouMadBoost +
    dontKnowHowBoost +
    dismissalBoost +
    reassurancePatternBoost +
    betrayalBoost +
    shutdownBoost +
    professionalBoost;
  const ambiguityPenalty =
    (wordCount <= 3 && !strongEmotionStatement && !socialCues.alwaysNever && signals.dismissal < 2 && signals.shutdown === 0 ? 0.14 : 0) +
    (wordCount <= 5 && signalWeight <= 1 && signals.reassurance === 0 ? 0.08 : 0) +
    (questionCount > 0 && emotionalLoad === 0 && signals.reassurance === 0 ? 0.1 : 0) +
    (signalWeight === 0 ? 0.12 : 0);

  let confidence = clampNumber(
    0.16 +
      signalWeight * 0.038 +
      explicitEmotionHits * 0.05 +
      consistencyBoost +
      (risk === "high" ? 0.06 : risk === "medium" ? 0.03 : 0) +
      (wordCount >= 6 ? 0.04 : 0) -
      ambiguityPenalty,
    0.18,
    0.94
  );

  // Phase 5.6: Expanded confidence gates for explicit emotional patterns
  const highConfidenceGate =
    explicitEmotionHits >= 2 ||
    toneGap >= 1.25 ||
    signalWeight >= 5 ||
    strongEmotionStatement ||
    socialCues.alwaysNever ||
    signals.betrayal > 0 ||
    signals.anger > 1 ||
    signals.pain > 1 ||
    signals.dismissal >= 2 ||
    signals.reassurance >= 1 ||
    signals.shutdown >= 1 ||
    signals.professional >= 2 ||
    /\bi\s+feel\s+(ignored|hurt|like\s+you)\b/.test(lower) ||
    /\bi'?m\s+mad\s+at\s+you\b/.test(lower) ||
    /\bare\s+you\s+mad\s+at\s+me\b/.test(lower) ||
    /\bi\s+don'?t\s+know\s+how\s+to\b/.test(lower);
  if (!highConfidenceGate && confidence > 0.71) {
    confidence = 0.71;
  }

  const confidenceLabel = confidence >= 0.76 && highConfidenceGate ? "high" : confidence >= 0.5 ? "medium" : "low";
  const declaredEmotion = selectedEmotion || null;
  const observedTone = tone;
  const emotionMismatch =
    !!declaredEmotion &&
    declaredEmotion !== observedTone &&
    toneScores[observedTone] - (toneScores[declaredEmotion] || 0) >= 0.85;

  const suggestion = getToneSuggestion({
    confidence,
    confidenceLabel,
    tone: observedTone,
    intent,
    risk,
    stateOfMind,
    declaredEmotion,
    emotionMismatch,
    signals,
    social,
  });

  // Phase 3.3: Communication Strategy Engine
  const strategyContext = {
    signals,
    social,
    intent,
    stateOfMind,
    tone: observedTone,
    risk,
    confidenceLabel,
    lower,
    wordCount,
  };

  const communicationPattern = determineCommunicationPattern(strategyContext);
  const likelyRecipientReaction = determineLikelyRecipientReaction(communicationPattern, strategyContext);
  const bestCommunicationMove = determineBestCommunicationMove(communicationPattern, strategyContext);
  const suggestedStyle = determineSuggestedStyle(communicationPattern, strategyContext);
  const userFacingGuidance = generateUserFacingGuidance(communicationPattern, likelyRecipientReaction, bestCommunicationMove, strategyContext);
  const exampleMessage = generateExampleMessage(communicationPattern, strategyContext);

  // Phase 5.6: Determine if deeper AI help is recommended
  const severeLanguage = /\b(hate|cheated|scared|done|over|can't take|ruined|destroyed)\s+(you|this|us|me|it)\b/.test(lower);
  const needsAIHelp =
    (confidence < 0.5 && emotionalLoad > 0) ||
    signals.betrayal > 0 ||
    signals.contempt > 0 ||
    (wordCount > 40 && emotionalLoad >= 2) ||
    severeLanguage;

  return {
    tone: observedTone,
    observedTone,
    declaredEmotion,
    emotionMismatch,
    stateOfMind,
    intent,
    risk,
    confidence,
    confidenceLabel,
    suggestion,
    social,
    // Phase 3.3 additions
    communicationPattern,
    likelyRecipientReaction,
    bestCommunicationMove,
    suggestedStyle,
    userFacingGuidance,
    exampleMessage,
    // Phase 5.6: AI escalation flag
    needsAIHelp,
  };
}

function hideDraftCoachBar() {
  if (!draftCoachBar) return;
  draftCoachBar.classList.remove(
    "is-visible",
    "tone-calm",
    "tone-neutral",
    "tone-tense",
    "tone-frustrated",
    "tone-anxious",
    "tone-sad",
    "tone-hopeful",
    "tone-defensive",
    "tone-urgent",
    "risk-low",
    "risk-medium",
    "risk-high"
  );
}

function updateDraftCoachBar(analysis) {
  if (!draftCoachBar || !draftCoachTone || !draftCoachSuggestion) return;
  if (!analysis || !draftText.trim()) {
    hideDraftCoachBar();
    return;
  }

  // Phase 5.6: Plain-English guidance only, no technical metadata
  // Remove technical labels (Risk, Confidence, Tone) from user-facing display

  // Use userFacingGuidance (plain English, no technical terms)
  const guidanceText = analysis.userFacingGuidance || analysis.suggestion || "";

  // Phase 5.6: Hide coach bar if no guidance needed (simple practical questions)
  if (!guidanceText || guidanceText.trim() === "") {
    hideDraftCoachBar();
    return;
  }

  // Optional: Show subtle helper text only if AI help is suggested
  let helperText = "";
  if (analysis.needsAIHelp && analysis.confidence < 0.6) {
    helperText = "Tap Refine for deeper help";
  }
  draftCoachTone.textContent = helperText;

  draftCoachSuggestion.textContent = guidanceText;

  draftCoachBar.classList.add("is-visible");
  draftCoachBar.classList.remove(
    "tone-calm",
    "tone-neutral",
    "tone-tense",
    "tone-frustrated",
    "tone-anxious",
    "tone-sad",
    "tone-hopeful",
    "tone-defensive",
    "tone-urgent",
    "risk-low",
    "risk-medium",
    "risk-high"
  );
  draftCoachBar.classList.add(`tone-${analysis.tone}`, `risk-${analysis.risk}`);
}

function scheduleDraftAnalysis(text) {
  draftText = String(text || "");

  if (analysisTimeout) {
    clearTimeout(analysisTimeout);
    analysisTimeout = null;
  }

  if (!draftText.trim()) {
    draftAnalysis = null;
    isAnalyzing = false;
    hideDraftCoachBar();
    return;
  }

  const requestVersion = ++draftAnalysisVersion;
  isAnalyzing = true;

  analysisTimeout = setTimeout(() => {
    if (requestVersion !== draftAnalysisVersion) return;
    draftAnalysis = analyzeDraft(draftText);
    isAnalyzing = false;
    updateDraftCoachBar(draftAnalysis);
  }, DRAFT_ANALYSIS_DEBOUNCE_MS);
}

function handleDraftInputChange(text) {
  if (emotionChips && String(text || "").trim()) {
    emotionChips.style.display = "block";
  } else if (emotionChips) {
    emotionChips.style.display = "none";
  }
  scheduleDraftAnalysis(text);
}

function refreshDraftAnalysisImmediately() {
  if (!draftText.trim()) {
    hideDraftCoachBar();
    return;
  }
  if (analysisTimeout) {
    clearTimeout(analysisTimeout);
    analysisTimeout = null;
  }
  draftAnalysis = analyzeDraft(draftText);
  isAnalyzing = false;
  updateDraftCoachBar(draftAnalysis);
}

async function refineCurrentDraft() {
  if (!messageInput || !refineDraftBtn) return;
  const raw = messageInput.value.trim();
  if (!raw) return;

  refineDraftBtn.disabled = true;
  const originalLabel = refineDraftBtn.textContent;
  refineDraftBtn.textContent = "Refining...";

  try {
    const res = await fetch("/api/rephrase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: raw,
        userId: currentUserId,
        tone: draftAnalysis ? draftAnalysis.tone : "neutral",
        emotion: selectedEmotion,
        stateOfMind: draftAnalysis ? draftAnalysis.stateOfMind : null,
        intent: draftAnalysis ? draftAnalysis.intent : null,
        risk: draftAnalysis ? draftAnalysis.risk : null,
        confidence: draftAnalysis ? draftAnalysis.confidence : null,
        needsAIHelp: draftAnalysis ? draftAnalysis.needsAIHelp : false,
      }),
    });

    if (!res.ok) {
      throw new Error(`Refine failed (${res.status})`);
    }

    const data = await res.json();
    if (data && data.coachingBlocked === true) {
      latestRefineResult = null;
      latestRefineSuggestion = null;
      renderSafetyBlockedRefine(data);
      return;
    }

    const rewrite = String(data.rewrite || "").trim();
    if (!rewrite) return;

    // Phase 7: Store refine result for Coach context
    latestRefineResult = {
      mode: data.mode,
      rewrite: data.rewrite,
      shortReason: data.shortReason,
      quickRead: data.quickRead,
      whyItMatters: data.whyItMatters,
      bestMove: data.bestMove,
      optionalAlternative: data.optionalAlternative
    };

    latestRefineSuggestion = {
      rewrite,
      mode: data.mode,
      shortReason: data.shortReason || "",
      quickRead: data.quickRead || "",
      bestMove: data.bestMove || "",
      optionalAlternative: data.optionalAlternative || "",
    };

    // Phase 7.6: Do not overwrite draft automatically.
    renderRefineSuggestion(latestRefineSuggestion);

    if (data.mode === "deep" && (data.quickRead || data.bestMove)) {
      showDeepRefineGuidance(data);
    } else {
      showComposerHint("Suggestion ready");
      setTimeout(() => {
        if (!isRefineSuggestionVisible) showComposerHint("");
      }, 2000);
    }
  } catch (err) {
    console.error("[XL AI] refineCurrentDraft error:", err);
    showComposerHint("Unable to refine right now");
  } finally {
    refineDraftBtn.disabled = false;
    refineDraftBtn.textContent = originalLabel;
  }
}

// Phase 6: Show deeper coaching guidance after Refine
function showDeepRefineGuidance(data) {
  if (!draftCoachBar || !draftCoachTone || !draftCoachSuggestion) {
    showComposerHint("Refined with deeper help");
    return;
  }

  // Build compact guidance display
  const parts = [];
  if (data.quickRead) parts.push(data.quickRead);
  if (data.bestMove) parts.push(`Best move: ${data.bestMove}`);

  const guidanceText = parts.join(" ");

  draftCoachTone.textContent = "AI Coach";
  draftCoachSuggestion.textContent = guidanceText;

  draftCoachBar.classList.add("is-visible");
  draftCoachBar.classList.remove(
    "tone-calm",
    "tone-neutral",
    "tone-tense",
    "tone-frustrated",
    "tone-anxious",
    "tone-sad",
    "tone-hopeful",
    "tone-defensive",
    "tone-urgent",
    "risk-low",
    "risk-medium",
    "risk-high"
  );
  draftCoachBar.classList.add("tone-calm", "risk-low");

  // Phase 6.5: Guidance persists until user changes text, sends, or dismisses
  // (No auto-hide for deep Refine guidance - it's important coaching context)
}

function renderSafetyBlockedRefine(responseData) {
  const safety = responseData && responseData.safety ? responseData.safety : null;
  const message = String((responseData && responseData.message) || "XLAI paused rewrite for safety.").trim();
  const resources = Array.isArray(safety && safety.resources) ? safety.resources.filter(Boolean) : [];

  if (!refineSuggestionCard || !refineSuggestionText) {
    showComposerHint(message);
    return;
  }

  refineSuggestionText.textContent = message;

  if (refineSuggestionReason) {
    const reasonText = resources.length
      ? resources[0]
      : (safety && safety.reason ? String(safety.reason).trim() : "");
    if (reasonText) {
      refineSuggestionReason.textContent = reasonText;
      refineSuggestionReason.classList.remove("hidden");
    } else {
      refineSuggestionReason.textContent = "";
      refineSuggestionReason.classList.add("hidden");
    }
  }

  if (useRefineSuggestionBtn) {
    useRefineSuggestionBtn.classList.add("hidden");
    useRefineSuggestionBtn.disabled = true;
  }
  if (dismissRefineSuggestionBtn) dismissRefineSuggestionBtn.classList.remove("hidden");

  isRefineSuggestionVisible = true;
  refineSuggestionCard.classList.remove("hidden");
  showComposerHint("Safety pause: normal rewrite is unavailable for this message");
}

function renderRefineSuggestion(data) {
  if (!refineSuggestionCard || !refineSuggestionText || !data) return;

  const rewrite = String(data.rewrite || "").trim();
  if (!rewrite) {
    dismissRefineSuggestion();
    return;
  }

  refineSuggestionText.textContent = rewrite;

  if (useRefineSuggestionBtn) {
    useRefineSuggestionBtn.classList.remove("hidden");
    useRefineSuggestionBtn.disabled = false;
  }

  const reasonParts = [];
  if (data.bestMove) reasonParts.push(`Best move: ${data.bestMove}`);
  if (data.shortReason) reasonParts.push(data.shortReason);
  if (data.quickRead) reasonParts.push(data.quickRead);

  if (refineSuggestionReason) {
    if (reasonParts.length) {
      refineSuggestionReason.textContent = reasonParts[0];
      refineSuggestionReason.classList.remove("hidden");
    } else {
      refineSuggestionReason.textContent = "";
      refineSuggestionReason.classList.add("hidden");
    }
  }

  isRefineSuggestionVisible = true;
  refineSuggestionCard.classList.remove("hidden");
}

function useRefineSuggestion() {
  if (!messageInput || !latestRefineSuggestion || !latestRefineSuggestion.rewrite) return;

  const currentRaw = String(messageInput.value || "");
  draftOriginalText = currentRaw;
  lastSuggestionText = latestRefineSuggestion.rewrite;
  usedSuggestionFlag = true;

  messageInput.value = latestRefineSuggestion.rewrite;
  messageInput.focus();
  handleDraftInputChange(messageInput.value);
  syncComposerState();

  showComposerHint("Suggestion applied");
  setTimeout(() => showComposerHint(""), 1800);
  dismissRefineSuggestion();
}

function dismissRefineSuggestion() {
  if (refineSuggestionCard) refineSuggestionCard.classList.add("hidden");
  if (refineSuggestionText) refineSuggestionText.textContent = "";
  if (refineSuggestionReason) {
    refineSuggestionReason.textContent = "";
    refineSuggestionReason.classList.add("hidden");
  }
  if (useRefineSuggestionBtn) {
    useRefineSuggestionBtn.classList.remove("hidden");
    useRefineSuggestionBtn.disabled = false;
  }
  isRefineSuggestionVisible = false;
}

// ---- Conversation list ----

async function loadConversations() {
  const listEl = document.getElementById("conversationList");
  if (!listEl) return;

  const fetchConversationRows = async (url) => {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Conversation fetch failed (${res.status})`);
    }
    const data = await res.json();
    return Array.isArray(data.conversations) ? data.conversations : [];
  };

  try {
    let nextConversations = await fetchConversationRows(
      `/api/conversations?user_id=${encodeURIComponent(currentUserId)}`
    );

    // temporary pre-auth compatibility fallback
    if (nextConversations.length === 0) {
      const fallbackConversations = await fetchConversationRows("/api/conversations");
      if (fallbackConversations.length > 0) {
        nextConversations = fallbackConversations;
      }
    }

    conversations = nextConversations;

    // Phase 7.5: Create default conversation if none exist (development fallback)
    if (conversations.length === 0) {
      console.log("[XL AI] No conversations found, creating default dev conversation");
      conversations = [{
        conversation_id: "draft_chat",
        display_name: "Draft Chat",
        last_message_preview: "Your practice conversation",
        last_message_at: Date.now()
      }];
    }

    // Preserve selection only if still present in latest list.
    const hasValidSelection =
      !!selectedConversationId &&
      conversations.some((conv) => conv.conversation_id === selectedConversationId);

    if (!hasValidSelection) {
      selectedConversationId = null;
      currentConversationId = null;
    }

    renderConversationList();

    if (selectedConversationId) {
      await selectConversation(selectedConversationId);
      return;
    }

    // Auto-select first conversation
    await selectConversation(conversations[0].conversation_id);
  } catch (err) {
    console.error("[XL AI] loadConversations error:", err);
    resetThreadForNoSelection("Unable to load conversations right now.");
  }
}

function renderConversationList() {
  const listEl = document.getElementById("conversationList");
  if (!listEl) return;
  if (conversations.length === 0) {
    listEl.innerHTML = `<p class="xl-subtitle xl-chat-empty-hint">No conversations yet.</p>`;
    return;
  }
  listEl.innerHTML = "";
  conversations.forEach((conv) => {
    const btn = document.createElement("button");
    btn.className = "xl-chat-list-item" + (conv.conversation_id === selectedConversationId ? " is-active" : "");
    btn.setAttribute("type", "button");
    btn.dataset.convId = conv.conversation_id;

    const infoDiv = document.createElement("div");
    infoDiv.className = "xl-chat-list-info";

    const nameEl = document.createElement("p");
    nameEl.className = "xl-chat-list-name";
    nameEl.textContent = conv.display_name || conv.conversation_id;

    const previewEl = document.createElement("p");
    previewEl.className = "xl-chat-list-preview";
    previewEl.textContent = conv.last_message_preview || "";

    infoDiv.appendChild(nameEl);
    infoDiv.appendChild(previewEl);

    const timeEl = document.createElement("span");
    timeEl.className = "xl-chat-list-time";
    timeEl.textContent = conv.last_message_at ? formatConvoTimestamp(conv.last_message_at) : "";

    btn.appendChild(infoDiv);
    btn.appendChild(timeEl);
    btn.addEventListener("click", () => selectConversation(conv.conversation_id));
    listEl.appendChild(btn);
  });
}

async function selectConversation(convId) {
  if (!convId) {
    resetThreadForNoSelection();
    return;
  }

  selectedConversationId = convId;
  currentConversationId = convId; // keep in sync with send flow

  // Update thread header
  const conv = conversations.find((c) => c.conversation_id === convId);
  const nameEl = document.getElementById("activeConversationName");
  const metaEl = document.getElementById("activeConversationMeta");
  if (nameEl) nameEl.textContent = conv ? (conv.display_name || convId) : convId;
  if (metaEl) metaEl.textContent = "Conversation";

  // Highlight active in list
  document.querySelectorAll(".xl-chat-list-item").forEach((el) => {
    el.classList.toggle("is-active", el.dataset.convId === convId);
  });

  syncComposerState();
  syncInsightsLink();
  await loadThread(convId);
}

function ensureComposerHintEl() {
  if (composerHintEl) return composerHintEl;
  const composer = document.querySelector(".xl-composer");
  if (!composer) return null;

  composerHintEl = document.createElement("p");
  composerHintEl.className = "xl-subtitle";
  composerHintEl.style.margin = "6px 4px 0";
  composerHintEl.style.minHeight = "16px";
  composerHintEl.style.visibility = "hidden";
  composer.appendChild(composerHintEl);
  return composerHintEl;
}

function showComposerHint(message) {
  const hint = ensureComposerHintEl();
  if (!hint) return;

  const text = String(message || "").trim();
  hint.textContent = text;
  hint.style.visibility = text ? "visible" : "hidden";
}

function syncComposerState() {
  const hasConversation = !!selectedConversationId;
  const hasDraft = messageInput && messageInput.value.trim().length > 0;

  // Phase 7.5: Send requires conversation, but Refine only needs draft
  if (deliverButton) {
    deliverButton.disabled = !hasConversation;
  }
  if (refineDraftBtn) {
    refineDraftBtn.disabled = !hasDraft;  // Only needs draft text
  }

  if (!hasConversation) {
    showComposerHint("Select a conversation to send messages");
  } else {
    showComposerHint("");
  }
}

function syncInsightsLink() {
  if (!insightsMenuLink) return;

  const params = new URLSearchParams();
  params.set("userId", String(currentUserId || "beta_default_user"));
  if (selectedConversationId) {
    params.set("conversation", String(selectedConversationId));
  }

  insightsMenuLink.href = `/insights.html?${params.toString()}`;
}

function resetThreadForNoSelection(message = "Select a conversation first") {
  selectedConversationId = null;
  currentConversationId = null;
  chatMessages = [];

  const nameEl = document.getElementById("activeConversationName");
  const metaEl = document.getElementById("activeConversationMeta");

  if (nameEl) nameEl.textContent = "Select a chat";
  if (metaEl) metaEl.textContent = "Conversation";
  if (chatHistoryContainer) chatHistoryContainer.innerHTML = "";
  if (emptyState) {
    emptyState.textContent = message;
    emptyState.style.display = "flex";
  }

  document.querySelectorAll(".xl-chat-list-item").forEach((el) => {
    el.classList.remove("is-active");
  });

  syncComposerState();
  syncInsightsLink();
}

async function loadThread(convId) {
  const historyEl = document.getElementById("chatHistory");
  if (!historyEl) return;
  historyEl.innerHTML = "";
  try {
    const res = await fetch(`/api/messages?conversation=${encodeURIComponent(convId)}&order=asc`);
    if (!res.ok) return;
    const data = await res.json();
    chatMessages = Array.isArray(data.messages) ? data.messages : [];
    renderThread(chatMessages);
  } catch (err) {
    console.error("[XL AI] loadThread error:", err);
  }
}

function renderThread(messages) {
  const historyEl = document.getElementById("chatHistory");
  const emptyStateEl = document.getElementById("emptyState");
  if (!historyEl) return;
  historyEl.innerHTML = "";

  if (messages.length === 0) {
    if (emptyStateEl) emptyStateEl.style.display = "flex";
    return;
  }
  if (emptyStateEl) emptyStateEl.style.display = "none";

  let lastDateLabel = null;
  messages.forEach((msg) => {
    const ts = msg.created_at_timestamp;
    const dateLabel = ts ? formatDateLabel(ts) : null;

    if (dateLabel && dateLabel !== lastDateLabel) {
      const sep = document.createElement("div");
      sep.className = "xl-date-sep";
      sep.textContent = dateLabel;
      historyEl.appendChild(sep);
      lastDateLabel = dateLabel;
    }

    const isSelf = msg.user_id === currentUserId;
    const text = (msg.final_text || msg.original_text || "").trim();
    if (!text) return;

    const wrapper = document.createElement("div");
    wrapper.className = `xl-bubble-wrapper ${isSelf ? "xl-bubble-wrapper-self" : "xl-bubble-wrapper-other"}`;

    const bubble = document.createElement("div");
    bubble.className = `xl-bubble ${isSelf ? "xl-bubble-user" : "xl-bubble-ai"}`;
    bubble.textContent = text;

    const timeEl = document.createElement("span");
    timeEl.className = "xl-bubble-time";
    timeEl.textContent = ts ? formatBubbleTime(ts) : "";

    wrapper.appendChild(bubble);
    wrapper.appendChild(timeEl);
    historyEl.appendChild(wrapper);
  });

  historyEl.scrollTop = historyEl.scrollHeight;
}

function syncNavUI() {
  navViewButtons.forEach((btn) => {
    const view = btn.getAttribute("data-nav-view");
    btn.classList.toggle("is-active", view === currentView);
  });
  menuViewButtons.forEach((btn) => {
    const view = btn.getAttribute("data-menu-view");
    btn.classList.toggle("is-active", view === currentView);
  });
}

function setCurrentView(view) {
  if (!Object.prototype.hasOwnProperty.call(VIEW_TO_INDEX, view)) {
    return;
  }
  currentView = view;
  const targetIndex = VIEW_TO_INDEX[view];
  if (shellTrack) {
    shellTrack.style.transform = `translateX(-${targetIndex * 100}%)`;
  }
  syncNavUI();

  // Centralized Chats entry flow.
  if (view === "chats") {
    loadConversations();
  }
}

function openMenu() {
  if (appMenuOverlay) appMenuOverlay.classList.remove("hidden");
}

function closeMenu() {
  if (appMenuOverlay) appMenuOverlay.classList.add("hidden");
}

function getInitialView() {
  try {
    const params = new URLSearchParams(window.location.search || "");
    const panel = String(params.get("panel") || "").toLowerCase();
    if (panel === "coach") return "coach";
    if (panel === "journal") return "journal";
    if (panel === "chat" || panel === "chats") return "chats";
  } catch (e) {}
  return "chats";
}



// Keep usedSuggestionFlag true once user applied suggestion (even if they edit it)
if (messageInput) {
  messageInput.addEventListener("input", () => {
    // if user typed something new after applying suggestion, still count as used
    if (usedSuggestionFlag && lastSuggestionText) {
      // leave usedSuggestionFlag true
    }
    handleDraftInputChange(messageInput.value);
    syncComposerState();  // Phase 7.5: Update Refine button state as user types
  });
}

// Coach toggle button
if (coachToggleBtn) {
  coachToggleBtn.addEventListener("click", () => {
    setCurrentView("coach");
    const draft = (messageInput && messageInput.value.trim()) || "";
    if (coachDraftCard) {
      const draftText = draft || "No draft yet. Use the composer or type something below.";
      coachDraftCard.querySelector(".xl-chat-text").textContent = draftText;
    }
    if (coachInput) {
      coachInput.value = draft;
    }
    hideCoachResponse();
  });
}

// Dismiss emotion chips
if (dismissEmotionChips) {
  dismissEmotionChips.addEventListener("click", () => {
    if (emotionChips) emotionChips.style.display = "none";
  });
}

// Inline nudge buttons
if (nudgeUseRewriteBtn) {
  nudgeUseRewriteBtn.addEventListener("click", () => {
    if (lastSuggestionText && messageInput) {
      draftOriginalText = messageInput.value || draftOriginalText || "";
      messageInput.value = lastSuggestionText;
      usedSuggestionFlag = true;
      handleDraftInputChange(lastSuggestionText);
    }
    if (inlineCoachNudge) inlineCoachNudge.style.display = "none";
  });
}

if (nudgeWhyBtn) {
  nudgeWhyBtn.addEventListener("click", () => {
    setCurrentView("coach");
  });
}

if (coachSubmitBtn) {
  coachSubmitBtn.addEventListener("click", async () => {
    const raw = (coachInput && coachInput.value) ? coachInput.value.trim() : "";
    if (!raw) return;
    const draft = (messageInput && messageInput.value) ? messageInput.value.trim() : "";
    appendCoachChat(raw, "user");
    coachSubmitBtn.disabled = true;
    coachSubmitBtn.textContent = "Thinking...";
    await askCoach(raw, draft);
    coachSubmitBtn.disabled = false;
    coachSubmitBtn.textContent = "Ask Coach";
    if (coachInput) {
      coachInput.value = "";
    }
  });
}

if (nudgeDismissBtn) {
  nudgeDismissBtn.addEventListener("click", () => {
    if (inlineCoachNudge) inlineCoachNudge.style.display = "none";
  });
}

navViewButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const view = btn.getAttribute("data-nav-view");
    if (view) {
      setCurrentView(view);
    }
  });
});

menuViewButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const view = btn.getAttribute("data-menu-view");
    if (view) {
      setCurrentView(view);
      closeMenu();
    }
  });
});

if (menuToggleBtn) {
  menuToggleBtn.addEventListener("click", openMenu);
}
if (closeMenuBtn) {
  closeMenuBtn.addEventListener("click", closeMenu);
}
if (appMenuBackdrop) {
  appMenuBackdrop.addEventListener("click", closeMenu);
}

if (shellViewport) {
  let touchStartX = 0;
  let touchEndX = 0;
  shellViewport.addEventListener("touchstart", (event) => {
    touchStartX = event.changedTouches[0]?.clientX || 0;
  }, { passive: true });
  shellViewport.addEventListener("touchend", (event) => {
    touchEndX = event.changedTouches[0]?.clientX || 0;
    const delta = touchStartX - touchEndX;
    if (Math.abs(delta) < 40) return;
    if (delta > 0) {
      // swipe left
      if (currentView === "chats") setCurrentView("coach");
      else if (currentView === "journal") setCurrentView("chats");
    } else {
      // swipe right
      if (currentView === "chats") setCurrentView("journal");
      else if (currentView === "coach") setCurrentView("chats");
    }
  }, { passive: true });
}

/**
 * ---- Helpers: UI ----
 */
function setCoachMode(mode) {
  currentCoachMode = ["soft", "direct", "professional"].includes(mode) ? mode : "soft";

  if (coachModeSoftBtn) coachModeSoftBtn.classList.toggle("is-active", currentCoachMode === "soft");
  if (coachModeDirectBtn) coachModeDirectBtn.classList.toggle("is-active", currentCoachMode === "direct");
  if (coachModeProfessionalBtn) coachModeProfessionalBtn.classList.toggle("is-active", currentCoachMode === "professional");
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

function addBubble(text, role = "user", timestamp = null) {
  if (!chatHistoryContainer) return;

  const isSelf = role !== "ai";
  const wrapper = document.createElement("div");
  wrapper.className = `xl-bubble-wrapper ${isSelf ? "xl-bubble-wrapper-self" : "xl-bubble-wrapper-other"}`;

  const bubble = document.createElement("div");
  bubble.className = `xl-bubble ${isSelf ? "xl-bubble-user" : "xl-bubble-ai"}`;
  bubble.textContent = text;

  const timeEl = document.createElement("span");
  timeEl.className = "xl-bubble-time";
  timeEl.textContent = timestamp ? formatBubbleTime(timestamp) : formatBubbleTime(new Date().toISOString());

  wrapper.appendChild(bubble);
  wrapper.appendChild(timeEl);
  chatHistoryContainer.appendChild(wrapper);

  // Hide empty state when first message is added
  if (emptyState && chatHistoryContainer.children.length > 0) {
    emptyState.style.display = "none";
  }
  // Scroll to bottom after adding bubble
  if (chatHistoryContainer) {
    chatHistoryContainer.scrollTop = chatHistoryContainer.scrollHeight;
  }
}

function appendCoachChat(text, role = "user") {
  if (!coachChatThread) return;

  const bubble = document.createElement("div");
  bubble.className = `xl-coach-message xl-coach-message-${role}`;
  const badge = document.createElement("span");
  badge.className = "xl-chat-badge";
  badge.textContent = role === "ai" ? "Coach" : "You";
  const content = document.createElement("p");
  content.className = "xl-chat-text";
  content.textContent = text;

  bubble.appendChild(badge);
  bubble.appendChild(content);
  coachChatThread.appendChild(bubble);
  coachChatThread.scrollTop = coachChatThread.scrollHeight;
}

function hideCoachResponse() {
  if (coachResponseCard) coachResponseCard.classList.add("hidden");
  if (coachQuickReadSection) coachQuickReadSection.classList.add("hidden");
  if (coachQuickReadText) coachQuickReadText.textContent = "";
  if (coachWhatToDoSection) coachWhatToDoSection.classList.add("hidden");
  if (coachWhatToDoList) coachWhatToDoList.innerHTML = "";
  if (coachWhatToSaySection) coachWhatToSaySection.classList.add("hidden");
  if (coachWhatToSayList) coachWhatToSayList.innerHTML = "";
  if (coachWhenToUseEachSection) coachWhenToUseEachSection.classList.add("hidden");
  if (coachWhenToUseEachList) coachWhenToUseEachList.innerHTML = "";
  if (coachResponseSecondary) coachResponseSecondary.classList.add("hidden");
  if (coachRisksSection) coachRisksSection.classList.add("hidden");
  if (coachInsightSection) coachInsightSection.classList.add("hidden");
  if (coachRewriteSection) coachRewriteSection.classList.add("hidden");
  if (coachPrincipleSection) coachPrincipleSection.classList.add("hidden");
}

function normalizeStructuredList(value) {
  const stripListPrefix = (item) =>
    String(item || "")
      .replace(/^\s*(?:[-*•]+\s*)?\d+[.):-]?\s*/, "")
      .replace(/^\s*#\d+\s*[-:.>]*\s*/, "")
      .replace(/^\s*[-*•>]+\s*/, "")
      .trim();

  if (Array.isArray(value)) {
    return value.map(stripListPrefix).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/\n+/)
      .map(stripListPrefix)
      .filter(Boolean);
  }
  return [];
}

function renderResponseList(listElement, items) {
  if (!listElement) return;
  listElement.innerHTML = "";
  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    listElement.appendChild(li);
  });
}

function formatCommunicationSummary(communication) {
  if (!communication || typeof communication !== "object") return "";

  const intent = communication.intent && communication.intent.label
    ? String(communication.intent.label).trim()
    : "";
  const emotion = communication.emotion && communication.emotion.primary
    ? String(communication.emotion.primary).trim()
    : "";
  const likelyReaction =
    communication.recipientImpact && communication.recipientImpact.likelyReaction
      ? String(communication.recipientImpact.likelyReaction).trim()
      : "";
  const bestMove =
    communication.coachingStrategy && communication.coachingStrategy.approach
      ? String(communication.coachingStrategy.approach).trim()
      : "";

  const riskList = Array.isArray(communication.risks)
    ? communication.risks
        .map((risk) => {
          if (!risk || typeof risk !== "object") return "";
          const type = String(risk.type || "").trim();
          const severity = String(risk.severity || "").trim();
          if (!type && !severity) return "";
          if (!type) return severity;
          if (!severity) return type;
          return `${type} (${severity})`;
        })
        .filter(Boolean)
    : [];

  const parts = [];
  if (intent) parts.push(`Intent: ${intent}`);
  if (emotion) parts.push(`Emotion: ${emotion}`);
  if (likelyReaction) parts.push(`Likely reaction: ${likelyReaction}`);
  if (bestMove) parts.push(`Best move: ${bestMove}`);
  if (riskList.length) parts.push(`Risks: ${riskList.join(", ")}`);
  return parts.join(". ");
}

function buildLegacyCoachParagraph(coaching) {
  const quickRead = String(coaching.quick_read || "").trim();
  const whatToDo = normalizeStructuredList(coaching.what_to_do).slice(0, 2);
  const insight = String(coaching.insight || "").trim();

  const lines = [];
  if (quickRead) lines.push(quickRead);
  if (whatToDo.length) lines.push(`A better move is to ${whatToDo[0].replace(/\.$/, "")}.`);
  if (insight) lines.push(insight);

  return lines.join(" ").trim();
}

function buildCoachThreadSummary(intentType) {
  if (intentType === "rewrite_request") {
    return "Here is a cleaner version you can use.";
  }
  if (intentType === "coach_question") {
    return "Here is a practical way to approach it.";
  }
  if (intentType === "mixed") {
    return "Here is a concise approach and wording option.";
  }
  return "Here is a clearer way to say this.";
}

function normalizeCoachIntentType(rawIntent) {
  const intent = (rawIntent || "").toString().toLowerCase();
  if (intent.includes("coach_question") || intent.includes("question") || intent.includes("advice") || intent.includes("help")) {
    return "coach_question";
  }
  if (intent.includes("rewrite") || intent.includes("rephrase") || intent.includes("redraft") || intent.includes("wording") || intent.includes("polish") || intent.includes("fix")) {
    return "rewrite_request";
  }
  if (intent.includes("mixed")) {
    return "mixed";
  }
  if (intent.includes("draft") || intent.includes("analysis")) {
    return "draft_analysis";
  }
  return "mixed";
}

function renderSafetyBlockedCoach(responseData) {
  const safety = responseData && responseData.safety ? responseData.safety : null;
  const safetyMessage = String((responseData && responseData.message) || "XLAI paused normal coaching for safety.").trim();
  const resources = Array.isArray(safety && safety.resources) ? safety.resources.filter(Boolean) : [];
  const safetyLabel = safety && safety.label ? String(safety.label) : "safety pause";

  if (coachIntentLabel) coachIntentLabel.textContent = "Safety pause";
  if (coachResponseCard) coachResponseCard.classList.remove("hidden");

  if (coachQuickReadSection && coachQuickReadText) {
    coachQuickReadText.textContent = safetyMessage;
    coachQuickReadSection.classList.remove("hidden");
  }

  if (coachWhatToDoSection && coachWhatToDoList) {
    if (resources.length) {
      renderResponseList(coachWhatToDoList, resources);
      coachWhatToDoSection.classList.remove("hidden");
    } else {
      coachWhatToDoList.innerHTML = "";
      coachWhatToDoSection.classList.add("hidden");
    }
  }

  if (coachWhatToSaySection && coachWhatToSayList) {
    coachWhatToSayList.innerHTML = "";
    coachWhatToSaySection.classList.add("hidden");
  }
  if (coachWhenToUseEachSection && coachWhenToUseEachList) {
    coachWhenToUseEachList.innerHTML = "";
    coachWhenToUseEachSection.classList.add("hidden");
  }

  if (coachResponseSecondary) coachResponseSecondary.classList.remove("hidden");
  if (coachInsightSection && coachInsightText) {
    const detail = safety && Number.isInteger(safety.level)
      ? `Safety level ${safety.level}: ${safetyLabel}.`
      : `Safety: ${safetyLabel}.`;
    coachInsightText.textContent = detail;
    coachInsightSection.classList.remove("hidden");
  }

  if (coachRisksSection) coachRisksSection.classList.add("hidden");
  if (coachRewriteSection) coachRewriteSection.classList.add("hidden");
  if (coachPrincipleSection) coachPrincipleSection.classList.add("hidden");
  if (useSuggestionBtn) useSuggestionBtn.classList.add("hidden");
  if (useRewriteBtn) useRewriteBtn.classList.add("hidden");
}

function renderCoachResponse(analysis, coaching, communication) {
  const naturalResponse = String(coaching.natural_response || coaching.coach_message || "").trim();
  const legacyParagraph = buildLegacyCoachParagraph(coaching);
  const paragraph = naturalResponse || legacyParagraph || "I can help you phrase this more clearly while keeping your core intent.";

  const legacyWhatToSay = normalizeStructuredList(coaching.what_to_say).slice(0, 2);
  const suggestion = String(
    coaching.suggestion ||
      coaching.primary_suggestion ||
      legacyWhatToSay[0] ||
      coaching.rewrite ||
      ""
  ).trim();
  const softAlternative = String(
    coaching.soft_alternative ||
      coaching.optionalAlternative ||
      legacyWhatToSay[1] ||
      ""
  ).trim();
  const coachingNote = String(
    coaching.note ||
      coaching.whyItMatters ||
      coaching.bestMove ||
      coaching.insight ||
      ""
  ).trim();
  const communicationSummary = formatCommunicationSummary(communication);
  const note = [coachingNote, communicationSummary].filter(Boolean).join(" ");

  if (coachIntentLabel) {
    coachIntentLabel.textContent = "Coach";
  }

  if (coachResponseCard) coachResponseCard.classList.remove("hidden");

  // Always hide legacy/technical sections in Phase 7.6.
  if (coachWhatToDoSection) coachWhatToDoSection.classList.add("hidden");
  if (coachRisksSection) coachRisksSection.classList.add("hidden");
  if (coachRewriteSection) coachRewriteSection.classList.add("hidden");
  if (coachPrincipleSection) coachPrincipleSection.classList.add("hidden");
  if (useSuggestionBtn) useSuggestionBtn.classList.add("hidden");
  if (useRewriteBtn) useRewriteBtn.classList.add("hidden");

  if (coachQuickReadSection && coachQuickReadText) {
    coachQuickReadText.textContent = paragraph;
    coachQuickReadSection.classList.remove("hidden");
  }

  if (coachWhatToSaySection && coachWhatToSayList) {
    if (suggestion) {
      coachWhatToSayList.innerHTML = "";
      const li = document.createElement("li");
      li.textContent = suggestion;
      coachWhatToSayList.appendChild(li);
      coachWhatToSaySection.classList.remove("hidden");
    } else {
      coachWhatToSaySection.classList.add("hidden");
      coachWhatToSayList.innerHTML = "";
    }
  }

  if (coachWhenToUseEachSection && coachWhenToUseEachList) {
    if (softAlternative) {
      coachWhenToUseEachList.innerHTML = "";
      const li = document.createElement("li");
      li.textContent = softAlternative;
      coachWhenToUseEachList.appendChild(li);
      coachWhenToUseEachSection.classList.remove("hidden");
    } else {
      coachWhenToUseEachSection.classList.add("hidden");
      coachWhenToUseEachList.innerHTML = "";
    }
  }

  if (coachResponseSecondary) {
    if (note) {
      coachResponseSecondary.classList.remove("hidden");
    } else {
      coachResponseSecondary.classList.add("hidden");
    }
  }
  if (coachInsightSection && coachInsightText) {
    if (note) {
      coachInsightText.textContent = note;
      coachInsightSection.classList.remove("hidden");
    } else {
      coachInsightSection.classList.add("hidden");
      coachInsightText.textContent = "";
    }
  }
}

/**
 * Phase 7: Build Coach Context
 * Collects conversation, draft, analyzer, and refine context for Coach
 */
function buildCoachContext() {
  const context = {
    userId: currentUserId,
  };

  // Conversation context
  if (selectedConversationId) {
    context.conversationId = selectedConversationId;
    const conv = conversations.find(c => c.conversation_id === selectedConversationId);
    if (conv && conv.display_name) {
      context.conversationName = conv.display_name;
    }
  }

  // Recent messages (last 8 messages)
  if (chatMessages && chatMessages.length > 0) {
    context.recentMessages = chatMessages.slice(-8).map(msg => ({
      sender: msg.user_id === currentUserId ? "me" : "them",
      text: msg.final_text || msg.original_text || "",
      timestamp: msg.created_at_timestamp
    }));
  }

  // Current draft
  if (draftText && draftText.trim()) {
    context.currentDraft = draftText.trim();
  }

  // Selected emotion
  if (selectedEmotion) {
    context.selectedEmotion = selectedEmotion;
  }

  // Analyzer result
  if (draftAnalysis) {
    context.analyzer = {
      observedTone: draftAnalysis.observedTone || draftAnalysis.tone,
      stateOfMind: draftAnalysis.stateOfMind,
      intent: draftAnalysis.intent,
      risk: draftAnalysis.risk,
      confidenceLabel: draftAnalysis.confidenceLabel,
      communicationPattern: draftAnalysis.communicationPattern,
      likelyRecipientReaction: draftAnalysis.likelyRecipientReaction,
      bestCommunicationMove: draftAnalysis.bestCommunicationMove,
      suggestedStyle: draftAnalysis.suggestedStyle,
      userFacingGuidance: draftAnalysis.userFacingGuidance,
      needsAIHelp: draftAnalysis.needsAIHelp
    };
  }

  // Latest refine result
  if (latestRefineResult) {
    context.latestRefine = {
      mode: latestRefineResult.mode,
      rewrite: latestRefineResult.rewrite,
      quickRead: latestRefineResult.quickRead,
      bestMove: latestRefineResult.bestMove
    };
  }

  return context;
}

async function askCoach(rawText, draftText = "") {
  const text = (rawText || "").trim();
  if (!text) return;

  try {
    // Phase 7: Build context for Coach
    const context = buildCoachContext();

    const res = await fetch("/api/analyze-intensity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        draft: draftText,
        tone: currentTone,
        emotion: currentEmotion,
        rewriteStrength,
        coachMode: currentCoachMode,
        context  // Phase 7: Send full context
      }),
    });

    const data = await res.json();
    if (data && data.coachingBlocked === true) {
      appendCoachChat("XLAI paused normal coaching for safety.", "ai");
      renderSafetyBlockedCoach(data);
      return;
    }

    const analysis = data.analysis || {};
    const coaching = data.coaching || {};
    const communication = data.communication || null;
    lastSuggestionText = coaching.suggestion || coaching.primary_suggestion || coaching.rewrite || null;
    lastAnalysis = analysis;
    lastCoaching = coaching;
    const intentType = normalizeCoachIntentType(analysis.intent_type || analysis.intent_guess || "draft_analysis");

    const coachThreadSummary = buildCoachThreadSummary(intentType);
    appendCoachChat(coachThreadSummary, "ai");
    renderCoachResponse(analysis, coaching, communication);

    try {
      await fetch("/api/coach-interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: currentConversationId,
          userId: currentUserId,
          coachQuestionText: text,
          coachResponseText: coaching.natural_response || coaching.response || coaching.note || coaching.insight || coaching.suggestion || coaching.rewrite || coachThreadSummary,
          intentGuess: analysis.intent_guess || null,
          intentType: analysis.intent_type || normalizeCoachIntentType(analysis.intent_guess || ""),
          rewriteText: coaching.suggestion || coaching.primary_suggestion || coaching.rewrite || null,
          insightText: coaching.note || coaching.insight || null,
          principleText: coaching.soft_alternative || coaching.principle || null,
          intensityScore: typeof analysis.intensity === "number" ? analysis.intensity : null,
          intensityLabel: analysis.intensity_label || null,
          risks: Array.isArray(analysis.risks) ? analysis.risks : null,
          coachMode: currentCoachMode,
          communication: communication || null,
        }),
      });
    } catch (persistErr) {
      console.error("[XL AI] coach interaction persistence error:", persistErr);
    }
  } catch (err) {
    console.error("[XL AI] askCoach error:", err);
    appendCoachChat("Unable to reach XL AI right now. Please make sure the server is running and try again.", "ai");
  }
}

function setTone(tone) {
  if (!tone || !["calm", "professional", "low-key"].includes(tone)) {
    return;
  }

  currentTone = tone;
  toneButtons.forEach((btn) => {
    const btnTone = btn.getAttribute("data-tone");
    btn.classList.toggle("is-active", btnTone === tone);
  });

  if (currentToneLabel) {
    currentToneLabel.textContent = tone.toUpperCase();
  }
}

function setEmotion(emotion) {
  selectedEmotion = emotion;
  currentEmotion = emotion;
  emotionButtons.forEach((btn) => {
    const btnEmotion = btn.getAttribute("data-emotion");
    if (btnEmotion === emotion) {
      btn.classList.add("is-active");
    } else {
      btn.classList.remove("is-active");
    }
  });

  if (draftText.trim()) {
    refreshDraftAnalysisImmediately();
  }
}

function updateAnalyzerUI() {
  const label = document.getElementById("analyzerStatusLabel");
  const text = analyzerOn ? "ON" : "OFF";

  if (label) label.textContent = text;

  if (analyzerToggleBtn) {
    analyzerToggleBtn.classList.toggle("is-on", analyzerOn);
  }

  // Show adaptive note when analyzer is on
  const adaptiveNote = document.getElementById("adaptiveNote");
  if (adaptiveNote) {
    adaptiveNote.style.display = analyzerOn ? "block" : "none";
  }
}

function openPauseModal(analysis, coaching, suggestion, rawText) {
  pendingRawText = rawText;
  pendingSuggestion = suggestion || rawText;
  pendingIntensity = analysis; // now full analysis

  const pauseRisk = document.getElementById("pauseRisk");
  const pauseInsight = document.getElementById("pauseInsight");
  const pausePrinciple = document.getElementById("pausePrinciple");

  if (pauseIntensityLabel && analysis) {
    pauseIntensityLabel.textContent = analysis.intensity_label || "medium";
  }

  if (pauseRisk && analysis.risks && analysis.risks.length > 0) {
    pauseRisk.textContent = "This could " + analysis.risks[0];
    pauseRisk.style.display = "block";
  } else if (pauseRisk) {
    pauseRisk.style.display = "none";
  }

  if (pauseInsight && coaching.insight) {
    pauseInsight.textContent = coaching.insight;
    pauseInsight.style.display = "block";
  } else if (pauseInsight) {
    pauseInsight.style.display = "none";
  }

  if (pausePrinciple && coaching.principle) {
    pausePrinciple.textContent = coaching.principle;
    pausePrinciple.style.display = "block";
  } else if (pausePrinciple) {
    pausePrinciple.style.display = "none";
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
        coachMode: currentCoachMode,
        conversationId: currentConversationId,
        userId: currentUserId,
      }),
    });

    const data = await res.json();
    console.log("[XL AI] /api/analyze-intensity result:", data);

    if (data && data.coachingBlocked === true) {
      const safetyMessage = String(data.message || "XLAI paused normal coaching for safety.").trim();
      if (inlineCoachNudge) inlineCoachNudge.style.display = "none";
      showComposerHint(safetyMessage);
      lastAnalysis = null;
      lastCoaching = null;
      return { intensity: null, coaching: null };
    }

    const analysis = data.analysis || {};
    const coaching = data.coaching || {};

    // Track draft / suggestion state for logging and send behavior
    try {
      draftOriginalText = (messageInput && messageInput.value) ? messageInput.value : draftOriginalText;
    } catch (e) {}
    lastSuggestionText = coaching.rewrite || null;
    usedSuggestionFlag = false;
    lastIntensityScore = typeof analysis.intensity === "number" ? analysis.intensity : null;

    // Save intensity so /api/send can log it
    lastIntensityInfo = {
      intensity: typeof analysis.intensity === "number" ? analysis.intensity : null,
      label: analysis.intensity_label || null,
    };

    lastAnalysis = analysis;
    lastCoaching = coaching;

    // Show inline coach nudge if intensity is notable
    if (analyzerOn && typeof analysis.intensity === "number" && analysis.intensity > 0.5 && inlineCoachNudge && nudgeRisk && nudgeInsight) {
      const topRisk = (analysis.risks && analysis.risks.length > 0) ? analysis.risks[0] : "potential issue";
      nudgeRisk.textContent = `Risk: ${topRisk}`;
      nudgeInsight.textContent = coaching.insight || "This message might need adjustment.";
      inlineCoachNudge.style.display = "block";
    } else {
      if (inlineCoachNudge) inlineCoachNudge.style.display = "none";
    }

    // Update the little intensity chip / label
    const intensityLabelEl = document.getElementById("intensityLabel");
    if (intensityLabelEl) {
      intensityLabelEl.textContent = lastIntensityInfo.label || "low";
    }

    // Keep the messaging screen calm: analyzer updates state only.

    // Refresh EQ coach summary
    await refreshEqCoach();

    // Set adaptive threshold
    if (typeof data.adaptiveThreshold === "number") {
      adaptiveThreshold = data.adaptiveThreshold;
    }

    return { intensity: lastIntensityInfo, coaching };
  } catch (err) {
    console.error("[XL AI] /api/analyze-intensity error:", err);
  }
}

// Save message + metadata to DB
async function sendMessageToServer(originalText, finalText, intensityInfo, wasPauseTaken, usedSuggestion, actionTaken, pauseReason, risks, intentGuess, coachMode) {
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
    actionTaken,
    pauseReason,
    risks,
    intentGuess,
    coachMode,
  };

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

  function renderSafetyBlockedSend(responseData, attemptedText) {
    const safety = responseData && responseData.safety ? responseData.safety : null;
    const safetyMessage = String((responseData && responseData.message) || "XLAI paused sending this message for safety.").trim();
    const safetyReason = String((safety && safety.reason) || "").trim();
    const resources = Array.isArray(safety && safety.resources) ? safety.resources.filter(Boolean) : [];
    const safetyLabel = safety && safety.label ? String(safety.label).trim() : "Safety pause";
    const reasonText = safetyReason ? `\nReason: ${safetyReason}` : "";
    const resourceText = resources.length ? `\nNext steps:\n- ${resources.join("\n- ")}` : "";

    const bubbleMessage = `${safetyLabel}: ${safetyMessage}${reasonText}${resourceText}`.trim();
    addBubble(bubbleMessage, "ai");
    showComposerHint("Safety pause: this message was not sent. You can edit and try again.");

    if (messageInput && typeof attemptedText === "string") {
      messageInput.value = attemptedText;
      messageInput.focus();
      handleDraftInputChange(attemptedText);
    }

    dismissRefineSuggestion();
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
    if (!fb || !coachHintText) return;

    // coach hint
    if (fb.coachHint) {
      coachHintText.textContent = fb.coachHint;
    }
  } catch (err) {
    console.error("[XL AI] refreshEqCoach error:", err);
  }
}

// Load previous messages into the history panel (delegates to loadThread for real data)
async function loadHistory() {
  try {
    if (selectedConversationId) {
      await loadThread(selectedConversationId);
    } else {
      // If nothing is selected yet, just clear the thread
      if (chatHistoryContainer) chatHistoryContainer.innerHTML = "";
    }

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
  if (!selectedConversationId || !currentConversationId) {
    showComposerHint("Select a conversation to send messages");
    return;
  }

  const raw = messageInput.value.trim();
  if (!raw) return;
  let sendBlocked = false;
  let sendSucceeded = false;
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
      if (score >= adaptiveThreshold) {
        lastPauseReason = lastAnalysis && lastAnalysis.risks && lastAnalysis.risks.length > 0 ? lastAnalysis.risks[0] : "high intensity";
        openPauseModal(lastAnalysis, lastCoaching, lastSuggestionText || finalText, raw);
        return;
      }
    }

    lastActionTaken = null; // non-pause send
    // Send: final_text must be what's currently in the textbox. original_text per privacy rule above.
      const sendResult = await sendMessageToServer(originalText, finalText, lastIntensityInfo, false, usedSuggestionFlag, lastActionTaken, null, null, null, null);
      if (sendResult && sendResult.coachingBlocked === true) {
        sendBlocked = true;
        renderSafetyBlockedSend(sendResult, raw);
        return;
      }
    addBubble(finalText, "user");
      sendSucceeded = true;
    // Refresh thread and conversation list so preview/timestamp updates
    await loadThread(currentConversationId);
    await loadConversations();
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
      latestRefineSuggestion = null;
    deliverButton.disabled = false;
    deliverButton.textContent = "Send";

      // Clear only after successful send; blocked/failed sends keep user input in place.
      if (messageInput) {
        if (sendSucceeded && !sendBlocked && messageInput.value.trim() === raw) {
          messageInput.value = "";
          handleDraftInputChange("");
        }
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
  lastActionTaken = "used_suggestion";

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
      true,
      lastActionTaken,
      lastPauseReason,
      lastAnalysis ? lastAnalysis.risks : null,
      lastAnalysis ? lastAnalysis.intent_guess : null,
      currentCoachMode
    );
    addBubble(finalText, "user");
    await loadThread(currentConversationId);
    await loadConversations();
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
    lastActionTaken = null;
    lastPauseReason = null;
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
  lastActionTaken = "sent_anyway";

  try {
    await sendMessageToServer(
      originalText,
      finalText,
      pendingIntensity,
      true,
      false,
      lastActionTaken,
      lastPauseReason,
      lastAnalysis ? lastAnalysis.risks : null,
      lastAnalysis ? lastAnalysis.intent_guess : null,
      currentCoachMode
    );
    addBubble(finalText, "user");
    await loadThread(currentConversationId);
    await loadConversations();
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
    lastActionTaken = null;
    lastPauseReason = null;
  }
}

function handlePauseCancel() {
  // User changed their mind; keep nothing logged
  closePauseModal();
  lastActionTaken = null;
  lastPauseReason = null;
  // Remove the pending bubble if it exists
  if (chatHistoryContainer && chatHistoryContainer.lastElementChild) {
    chatHistoryContainer.lastElementChild.remove();
  }
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
      const nextEmotion = selectedEmotion === emotion ? null : emotion;
      setEmotion(nextEmotion);
    });
  });

  // Coach refresh button now resets the UI to start a new message
  if (refreshCoachButton) {
    refreshCoachButton.addEventListener("click", () => {
      if (messageInput) {
        messageInput.value = "";
        messageInput.focus();
        handleDraftInputChange("");
      }
      hideCoachResponse();
      lastSuggestionText = null;
      usedSuggestionFlag = false;
      draftOriginalText = null;
      lastIntensityInfo = null;
      latestRefineSuggestion = null;
      dismissRefineSuggestion();
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
  if (coachModeDirectBtn) coachModeDirectBtn.addEventListener("click", () => setCoachMode("direct"));
  if (coachModeProfessionalBtn) coachModeProfessionalBtn.addEventListener("click", () => setCoachMode("professional"));

  // Deliver button wiring
  if (deliverButton) {
    deliverButton.addEventListener("click", () => {
      handleDeliverClick();
    });
  }

  if (refineDraftBtn) {
    refineDraftBtn.addEventListener("click", () => {
      refineCurrentDraft();
    });
  }

  if (useRefineSuggestionBtn) {
    useRefineSuggestionBtn.addEventListener("click", () => {
      useRefineSuggestion();
    });
  }

  if (dismissRefineSuggestionBtn) {
    dismissRefineSuggestionBtn.addEventListener("click", () => {
      dismissRefineSuggestion();
      showComposerHint("");
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

// Load pattern summary
async function loadPatternSummary() {
  try {
    const url = `/api/pattern-summary?conversation=${encodeURIComponent(currentConversationId)}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error("[XL AI] /api/pattern-summary error status:", res.status);
      return;
    }
    const data = await res.json();
    console.log("[XL AI] /api/pattern-summary:", data);

    const insights = data.insights || [];
    const nextBestSuggestion = data.nextBestSuggestion || "";
    const patternInsights = document.getElementById("patternInsights");
    const patternSummaryCard = document.getElementById("patternSummaryCard");
    if (patternInsights && patternSummaryCard) {
      if (insights.length > 0) {
        let html = insights.map(insight => `<p>${insight}</p>`).join('');
        if (nextBestSuggestion) {
          html += `<p><strong>Next suggestion:</strong> ${nextBestSuggestion}</p>`;
        }
        patternInsights.innerHTML = html;
        patternSummaryCard.style.display = "block";
      } else {
        patternSummaryCard.style.display = "none";
      }
    }
  } catch (err) {
    console.error("[XL AI] loadPatternSummary error:", err);
  }
}

/**
 * ---- Boot ----
  */

function bootstrap() {
  loadPrefs();
  const initialView = getInitialView();
  setCurrentView(initialView);
  if (currentUserBadge) {
    currentUserBadge.textContent = `User: ${currentUserId}`;
  }
  setTone(currentTone);
  updateAnalyzerUI();
  setEmotion(null);
  wireEvents();
  syncComposerState();
  syncInsightsLink();
  refreshEqCoach();
  loadPatternSummary();
  setCoachMode("soft");
}
  bootstrap();