"use strict";

const SAFETY_POLICY_VERSION = "phase2-safety-kb-v1";

const VALID_URGENCY_VALUES = Object.freeze([
  "none",
  "monitor",
  "elevated",
  "high",
  "immediate",
]);

const REQUIRED_POLICY_FIELDS = Object.freeze([
  "allowNormalSend",
  "shouldPauseSend",
  "persistAsNormalMessage",
  "showSafetyResources",
]);

const REQUIRED_COACH_POLICY_FIELDS = Object.freeze([
  "allowNormalCoaching",
  "useSafetyGuidance",
  "showSafetyResources",
  "allowRewriteApply",
]);

function buildCategory(definition) {
  return Object.freeze({
    ...definition,
    signals: Object.freeze([...(definition.signals || [])]),
    contextualSignals: Object.freeze([...(definition.contextualSignals || [])]),
    nearMisses: Object.freeze([...(definition.nearMisses || [])]),
    messagingPolicy: Object.freeze({ ...(definition.messagingPolicy || {}) }),
    coachPolicy: Object.freeze({ ...(definition.coachPolicy || {}) }),
    resourceTags: Object.freeze([...(definition.resourceTags || [])]),
    notes: Object.freeze([...(definition.notes || [])]),
  });
}

const SAFETY_CATEGORIES = Object.freeze({
  none: buildCategory({
    key: "none",
    label: "normal coaching",
    definition: "No material safety concern is indicated by the current content.",
    level: 0,
    defaultUrgency: "none",
    description: "Normal communication coaching can proceed without safety escalation.",
    signals: [
      "ordinary communication intent without credible danger or coercion cues",
      "clear request, update, repair attempt, or reflective processing without threat framing",
    ],
    contextualSignals: [
      "routine conversation planning, clarification, or emotional expression without loss-of-safety cues",
      "frustration that stays within normal conflict coaching scope",
    ],
    nearMisses: [
      "phrases like 'this is hard' or 'I am upset' without danger, coercion, or self-harm content",
      "heated but ordinary arguments that do not imply immediate safety risk",
    ],
    messagingPolicy: {
      allowNormalSend: true,
      shouldPauseSend: false,
      persistAsNormalMessage: true,
      showSafetyResources: false,
    },
    coachPolicy: {
      allowNormalCoaching: true,
      useSafetyGuidance: false,
      showSafetyResources: false,
      allowRewriteApply: true,
    },
    resourceTags: [],
    notes: [
      "Level 0 preserves current baseline coaching and rewrite behavior.",
    ],
  }),
  emotional_distress: buildCategory({
    key: "emotional_distress",
    label: "emotional distress",
    definition: "The user expresses acute emotional strain without a clear signal of immediate harm.",
    level: 1,
    defaultUrgency: "monitor",
    description: "Content may need calmer pacing and supportive language, but does not by itself require blocking.",
    signals: [
      "feeling overwhelmed, broken, hopeless, panicked, or unable to cope",
      "language suggesting intense internal distress without stated self-harm intent",
    ],
    contextualSignals: [
      "rapid escalation in emotional load during a personal conflict",
      "visible difficulty regulating tone or continuing a conversation safely",
    ],
    nearMisses: [
      "ordinary sadness, disappointment, or stress stated without crisis intensity",
      "casual statements like 'this sucks' that do not imply severe internal collapse",
    ],
    messagingPolicy: {
      allowNormalSend: true,
      shouldPauseSend: true,
      persistAsNormalMessage: true,
      showSafetyResources: false,
    },
    coachPolicy: {
      allowNormalCoaching: true,
      useSafetyGuidance: true,
      showSafetyResources: false,
      allowRewriteApply: true,
    },
    resourceTags: ["grounding", "pause"],
    notes: [
      "This category supports calmer coaching without invoking crisis blocking.",
    ],
  }),
  conflict_crisis: buildCategory({
    key: "conflict_crisis",
    label: "high-conflict relationship crisis",
    definition: "The content reflects severe interpersonal conflict, rupture, or betrayal without a direct safety threat.",
    level: 2,
    defaultUrgency: "elevated",
    description: "Normal coaching can continue, but the interaction may need stronger de-escalation and clarity support.",
    signals: [
      "relationship rupture, explosive fighting, betrayal, separation threats, or repeated accusation patterns",
      "language showing conflict intensity that could quickly worsen if sent unchanged",
    ],
    contextualSignals: [
      "ongoing breakup, divorce, trust collapse, or repeated volatile argument loops",
      "recipient is likely to react defensively or disengage if the message is sent as-is",
    ],
    nearMisses: [
      "firm but ordinary disagreement without crisis framing",
      "clear boundary setting that is direct but not explosively confrontational",
    ],
    messagingPolicy: {
      allowNormalSend: true,
      shouldPauseSend: true,
      persistAsNormalMessage: true,
      showSafetyResources: false,
    },
    coachPolicy: {
      allowNormalCoaching: true,
      useSafetyGuidance: true,
      showSafetyResources: false,
      allowRewriteApply: true,
    },
    resourceTags: ["deescalation", "repair"],
    notes: [
      "Level 2 remains within normal product behavior under the current Safety Engine.",
    ],
  }),
  unsafe_relationship_dynamics: buildCategory({
    key: "unsafe_relationship_dynamics",
    label: "unsafe relationship dynamics",
    definition: "The content suggests the relationship context may be unsafe even if the exact form of harm is not yet fully specified.",
    level: 3,
    defaultUrgency: "elevated",
    description: "High-risk relationship context should shift away from normal coaching and toward safety-aware handling.",
    signals: [
      "fear of a partner or household member",
      "statements that home, contact, or the relationship no longer feels safe",
    ],
    contextualSignals: [
      "coercive or intimidating pattern is implied but not fully described",
      "the speaker is trying to manage danger rather than only improve communication",
    ],
    nearMisses: [
      "statements like 'this relationship is unhealthy' without fear, coercion, or danger cues",
      "ordinary distrust or resentment without safety implications",
    ],
    messagingPolicy: {
      allowNormalSend: false,
      shouldPauseSend: true,
      persistAsNormalMessage: false,
      showSafetyResources: true,
    },
    coachPolicy: {
      allowNormalCoaching: false,
      useSafetyGuidance: true,
      showSafetyResources: true,
      allowRewriteApply: false,
    },
    resourceTags: ["safety_planning", "domestic_violence_support"],
    notes: [
      "Level 3+ categories are designed to mirror current blocking posture without wiring it in yet.",
    ],
  }),
  abuse_or_coercion: buildCategory({
    key: "abuse_or_coercion",
    label: "possible abuse or coercion",
    definition: "The content points to abusive behavior, coercion, or control by another person.",
    level: 3,
    defaultUrgency: "high",
    description: "Safety handling should replace normal coaching when the user appears to be navigating abusive control or physical harm.",
    signals: [
      "physical harm, grabbing, hitting, strangling, or forced compliance",
      "control through fear, punishment, threats, or forced responses",
    ],
    contextualSignals: [
      "the speaker is describing survival behavior rather than ordinary message drafting",
      "communication choices are being constrained by another person's control",
    ],
    nearMisses: [
      "hyperbolic language like 'my boss is abusive' used casually without actual harm or coercion cues",
      "strict or unfair behavior that is harmful but not clearly abusive in the immediate sense",
    ],
    messagingPolicy: {
      allowNormalSend: false,
      shouldPauseSend: true,
      persistAsNormalMessage: false,
      showSafetyResources: true,
    },
    coachPolicy: {
      allowNormalCoaching: false,
      useSafetyGuidance: true,
      showSafetyResources: true,
      allowRewriteApply: false,
    },
    resourceTags: ["domestic_violence_support", "trusted_contact", "emergency_services"],
    notes: [
      "Use non-diagnostic language focused on safety and practical next steps.",
    ],
  }),
  stalking_or_tracking: buildCategory({
    key: "stalking_or_tracking",
    label: "stalking or tracking",
    definition: "The content suggests surveillance, following, location tracking, or monitoring that creates safety concern.",
    level: 3,
    defaultUrgency: "high",
    description: "The user may be dealing with monitoring or unwanted pursuit that changes the risk of normal messaging behavior.",
    signals: [
      "location tracking, phone checking, appearing unexpectedly, or monitoring movements",
      "following, showing up uninvited, or repeated surveillance behavior",
    ],
    contextualSignals: [
      "fear that normal contact will reveal location or increase risk",
      "communication decisions shaped by surveillance or unwanted observation",
    ],
    nearMisses: [
      "consensual location sharing between family or partners",
      "ordinary curiosity or one-time check-ins without sustained monitoring behavior",
    ],
    messagingPolicy: {
      allowNormalSend: false,
      shouldPauseSend: true,
      persistAsNormalMessage: false,
      showSafetyResources: true,
    },
    coachPolicy: {
      allowNormalCoaching: false,
      useSafetyGuidance: true,
      showSafetyResources: true,
      allowRewriteApply: false,
    },
    resourceTags: ["digital_safety", "safety_planning", "emergency_services"],
    notes: [
      "This category should remain compatible with current stalking and tracking signal coverage.",
    ],
  }),
  threats_or_intimidation: buildCategory({
    key: "threats_or_intimidation",
    label: "threats or intimidation",
    definition: "The content describes threats, intimidation, or credible fear of being harmed.",
    level: 3,
    defaultUrgency: "high",
    description: "Normal communication coaching should give way to safety-oriented guidance when threats or intimidation are present.",
    signals: [
      "someone threatens harm, retaliation, or punishment",
      "credible fear created by intimidation, terrorizing language, or repeated scare tactics",
    ],
    contextualSignals: [
      "the user is choosing words to avoid being harmed",
      "the threat alters whether messaging is safe at all",
    ],
    nearMisses: [
      "figurative or joking statements that are not credible threats",
      "ordinary conflict like 'do not talk to me' without implied danger",
    ],
    messagingPolicy: {
      allowNormalSend: false,
      shouldPauseSend: true,
      persistAsNormalMessage: false,
      showSafetyResources: true,
    },
    coachPolicy: {
      allowNormalCoaching: false,
      useSafetyGuidance: true,
      showSafetyResources: true,
      allowRewriteApply: false,
    },
    resourceTags: ["trusted_contact", "domestic_violence_support", "emergency_services"],
    notes: [
      "Threat content can escalate quickly and should stay in the current Level 3 blocking family.",
    ],
  }),
  coercive_control_or_isolation: buildCategory({
    key: "coercive_control_or_isolation",
    label: "coercive control or isolation",
    definition: "The content suggests another person is restricting movement, money, contact, or autonomy.",
    level: 3,
    defaultUrgency: "high",
    description: "Normal rewrite or send flows may be unsafe when a controlling person limits access, movement, or communication.",
    signals: [
      "preventing contact with friends or family, taking devices, controlling finances, or not allowing someone to leave",
      "forced check-ins, forced replies, or rules backed by fear",
    ],
    contextualSignals: [
      "the user appears to be navigating restricted autonomy rather than only wording a message",
      "communication is being shaped by isolation or control dynamics",
    ],
    nearMisses: [
      "ordinary requests for space or privacy that are not coercive",
      "shared budgeting or household rules without fear or control cues",
    ],
    messagingPolicy: {
      allowNormalSend: false,
      shouldPauseSend: true,
      persistAsNormalMessage: false,
      showSafetyResources: true,
    },
    coachPolicy: {
      allowNormalCoaching: false,
      useSafetyGuidance: true,
      showSafetyResources: true,
      allowRewriteApply: false,
    },
    resourceTags: ["safety_planning", "domestic_violence_support", "trusted_contact"],
    notes: [
      "This category should distinguish coercive control from ordinary conflict boundaries.",
    ],
  }),
  home_danger: buildCategory({
    key: "home_danger",
    label: "home danger",
    definition: "The content indicates the home or living environment is not currently safe.",
    level: 3,
    defaultUrgency: "high",
    description: "Safety handling should focus on immediate environment risk rather than message optimization.",
    signals: [
      "fear of going home, home not feeling safe, or needing to leave the house safely",
      "the living environment itself is described as dangerous",
    ],
    contextualSignals: [
      "the user may need practical safety support before any messaging guidance",
      "normal send behavior could worsen immediate environmental risk",
    ],
    nearMisses: [
      "complaints that home is stressful or tense without danger cues",
      "wanting to avoid a difficult conversation at home without fear or threat content",
    ],
    messagingPolicy: {
      allowNormalSend: false,
      shouldPauseSend: true,
      persistAsNormalMessage: false,
      showSafetyResources: true,
    },
    coachPolicy: {
      allowNormalCoaching: false,
      useSafetyGuidance: true,
      showSafetyResources: true,
      allowRewriteApply: false,
    },
    resourceTags: ["safety_planning", "trusted_contact", "emergency_services"],
    notes: [
      "Home danger remains in Level 3 under the requested phase mapping.",
    ],
  }),
  self_harm_or_suicide: buildCategory({
    key: "self_harm_or_suicide",
    label: "self-harm or suicide risk",
    definition: "The content suggests possible self-harm, suicidal intent, or a desire not to live.",
    level: 4,
    defaultUrgency: "high",
    description: "Normal coaching and rewrite behavior should be disabled in favor of crisis-oriented safety messaging.",
    signals: [
      "wanting to die, end life, hurt oneself, overdose, or not wanting to live",
      "language indicating possible self-directed lethal or self-harming action",
    ],
    contextualSignals: [
      "the user is not primarily asking for communication help but expressing potential self-harm risk",
      "message content suggests urgent crisis support may be needed",
    ],
    nearMisses: [
      "figurative frustration like 'I am dead tired' without self-harm meaning",
      "discussion of suicide or self-harm in abstract or third-person contexts without personal risk cues",
    ],
    messagingPolicy: {
      allowNormalSend: false,
      shouldPauseSend: true,
      persistAsNormalMessage: false,
      showSafetyResources: true,
    },
    coachPolicy: {
      allowNormalCoaching: false,
      useSafetyGuidance: true,
      showSafetyResources: true,
      allowRewriteApply: false,
    },
    resourceTags: ["crisis_support", "988", "emergency_services"],
    notes: [
      "This category preserves the current Level 4 crisis posture without changing enforcement.",
    ],
  }),
  violence_risk: buildCategory({
    key: "violence_risk",
    label: "violence risk",
    definition: "The content suggests possible intent or risk of physically harming another person.",
    level: 4,
    defaultUrgency: "high",
    description: "Normal messaging and coaching should stop when the content moves into credible violence risk.",
    signals: [
      "wanting to hurt, kill, attack, or act violently toward someone",
      "language indicating possible movement from anger into physical harm",
    ],
    contextualSignals: [
      "the speaker may be seeking wording while also expressing potential violence",
      "recipient safety may be affected by continuing normal coaching",
    ],
    nearMisses: [
      "figurative phrases like 'that killed me' used without threat meaning",
      "violent media discussion or quoting someone else without personal intent",
    ],
    messagingPolicy: {
      allowNormalSend: false,
      shouldPauseSend: true,
      persistAsNormalMessage: false,
      showSafetyResources: true,
    },
    coachPolicy: {
      allowNormalCoaching: false,
      useSafetyGuidance: true,
      showSafetyResources: true,
      allowRewriteApply: false,
    },
    resourceTags: ["crisis_support", "emergency_services"],
    notes: [
      "Violence-risk handling should remain practical and non-diagnostic.",
    ],
  }),
  immediate_danger: buildCategory({
    key: "immediate_danger",
    label: "immediate danger",
    definition: "The content suggests a current emergency or life-threatening situation needing immediate action.",
    level: 5,
    defaultUrgency: "immediate",
    description: "All normal messaging and coaching behavior should yield to immediate emergency guidance.",
    signals: [
      "someone has a weapon, an attack is happening now, or emergency help is needed immediately",
      "current, time-sensitive danger rather than general fear or historical harm",
    ],
    contextualSignals: [
      "the user appears to need emergency services rather than communication support",
      "delay itself could increase danger",
    ],
    nearMisses: [
      "urgent but non-dangerous scheduling language like 'I need help now with this project'",
      "dramatic emphasis without any real safety emergency context",
    ],
    messagingPolicy: {
      allowNormalSend: false,
      shouldPauseSend: true,
      persistAsNormalMessage: false,
      showSafetyResources: true,
    },
    coachPolicy: {
      allowNormalCoaching: false,
      useSafetyGuidance: true,
      showSafetyResources: true,
      allowRewriteApply: false,
    },
    resourceTags: ["emergency_services", "crisis_support"],
    notes: [
      "This is the highest-severity category and maps directly to Level 5.",
    ],
  }),
});

function getSafetyCategory(categoryKey) {
  return SAFETY_CATEGORIES[categoryKey] || null;
}

function listSafetyCategories() {
  return Object.values(SAFETY_CATEGORIES);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function hasRequiredBooleanFields(target, keys) {
  return keys.every((key) => Object.prototype.hasOwnProperty.call(target, key) && typeof target[key] === "boolean");
}

function validateSafetyKnowledgeBase() {
  const errors = [];
  const categories = listSafetyCategories();
  const seenKeys = new Set();

  categories.forEach((category, index) => {
    const path = `categories[${index}]`;

    if (!category || typeof category !== "object") {
      errors.push(`${path}: category must be an object`);
      return;
    }

    if (typeof category.key !== "string" || category.key.trim() === "") {
      errors.push(`${path}.key: must be a non-empty string`);
    } else if (seenKeys.has(category.key)) {
      errors.push(`${path}.key: duplicate category key '${category.key}'`);
    } else {
      seenKeys.add(category.key);
    }

    if (typeof category.label !== "string" || category.label.trim() === "") {
      errors.push(`${path}.label: must be a non-empty string`);
    }
    if (typeof category.definition !== "string" || category.definition.trim() === "") {
      errors.push(`${path}.definition: must be a non-empty string`);
    }
    if (!Number.isInteger(category.level) || category.level < 0 || category.level > 5) {
      errors.push(`${path}.level: must be an integer between 0 and 5`);
    }
    if (!VALID_URGENCY_VALUES.includes(category.defaultUrgency)) {
      errors.push(`${path}.defaultUrgency: must be one of ${VALID_URGENCY_VALUES.join(", ")}`);
    }
    if (typeof category.description !== "string" || category.description.trim() === "") {
      errors.push(`${path}.description: must be a non-empty string`);
    }

    if (!isStringArray(category.signals)) {
      errors.push(`${path}.signals: must be an array of strings`);
    }
    if (!isStringArray(category.contextualSignals)) {
      errors.push(`${path}.contextualSignals: must be an array of strings`);
    }
    if (!isStringArray(category.nearMisses)) {
      errors.push(`${path}.nearMisses: must be an array of strings`);
    }
    if (!isStringArray(category.resourceTags)) {
      errors.push(`${path}.resourceTags: must be an array of strings`);
    }
    if (!isStringArray(category.notes)) {
      errors.push(`${path}.notes: must be an array of strings`);
    }

    if (!category.messagingPolicy || typeof category.messagingPolicy !== "object") {
      errors.push(`${path}.messagingPolicy: must be an object`);
    } else if (!hasRequiredBooleanFields(category.messagingPolicy, REQUIRED_POLICY_FIELDS)) {
      errors.push(`${path}.messagingPolicy: must include boolean fields ${REQUIRED_POLICY_FIELDS.join(", ")}`);
    }

    if (!category.coachPolicy || typeof category.coachPolicy !== "object") {
      errors.push(`${path}.coachPolicy: must be an object`);
    } else if (!hasRequiredBooleanFields(category.coachPolicy, REQUIRED_COACH_POLICY_FIELDS)) {
      errors.push(`${path}.coachPolicy: must include boolean fields ${REQUIRED_COACH_POLICY_FIELDS.join(", ")}`);
    }
  });

  return {
    ok: errors.length === 0,
    errors,
    categoryCount: categories.length,
    policyVersion: SAFETY_POLICY_VERSION,
  };
}

module.exports = {
  SAFETY_POLICY_VERSION,
  SAFETY_CATEGORIES,
  getSafetyCategory,
  listSafetyCategories,
  validateSafetyKnowledgeBase,
};