"use strict";

const { spawn } = require("child_process");
const path = require("path");
const {
  validateAnalyzeIntensityResponse,
  validateRephraseResponse,
  validateSendResponse,
  validateSafetyBlockedResponse,
} = require("../../engine/responseContracts");
const { buildContextEnvelope } = require("../../engine/contextRouter");
const {
  SAFETY_POLICY_VERSION,
  SAFETY_CATEGORIES,
  getSafetyCategory,
  listSafetyCategories,
  validateSafetyKnowledgeBase,
} = require("../../engine/safetyKnowledgeBase");
const {
  DECISION_VERSION,
  buildSafetyDecision,
  validateSafetyDecision,
  getDecisionPolicyForContext,
} = require("../../engine/safetyDecisionEngine");
const { buildSafetyDecisionSafe } = require("../../engine/safetyDecisionRuntime");

const PORT = Number(process.env.CONTRACT_TEST_PORT || 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ROOT = path.resolve(__dirname, "..", "..");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(maxAttempts = 80) {
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      const text = await res.text();
      if (res.ok && text.trim() === "healthy") {
        return;
      }
    } catch (error) {
      // Retry until server is up.
    }
    await sleep(250);
  }
  throw new Error("Server did not become healthy in time.");
}

function startServer() {
  const env = {
    ...process.env,
    PORT: String(PORT),
  };

  const child = spawn("node", ["server.js"], {
    cwd: ROOT,
    env,
    stdio: "ignore",
  });

  return child;
}

async function postJson(route, body, headers = {}) {
  const res = await fetch(`${BASE_URL}${route}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });

  let payload = null;
  try {
    payload = await res.json();
  } catch (error) {
    payload = null;
  }

  return { status: res.status, payload };
}

async function getJson(route) {
  const res = await fetch(`${BASE_URL}${route}`);
  let payload = null;
  try {
    payload = await res.json();
  } catch (error) {
    payload = null;
  }
  return { status: res.status, payload };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function ensureValid(name, result) {
  if (!result.ok) {
    throw new Error(`${name} contract errors:\n- ${result.errors.join("\n- ")}`);
  }
}

async function run() {
  const server = startServer();
  const results = [];

  const runCase = async (name, fn) => {
    try {
      await fn();
      results.push({ name, status: "PASS" });
      console.log(`[contracts] PASS ${name}`);
    } catch (error) {
      results.push({ name, status: "FAIL", error: String(error.message || error) });
      console.error(`[contracts] FAIL ${name}: ${error.message}`);
    }
  };

  try {
    await waitForHealth();

    await runCase("safety knowledge base exposes policy version", async () => {
      assert(typeof SAFETY_POLICY_VERSION === "string", "Expected SAFETY_POLICY_VERSION to be a string");
      assert(SAFETY_POLICY_VERSION.length > 0, "Expected non-empty SAFETY_POLICY_VERSION");
    });

    await runCase("safety knowledge base contains all required category keys", async () => {
      const requiredKeys = [
        "none",
        "emotional_distress",
        "conflict_crisis",
        "unsafe_relationship_dynamics",
        "abuse_or_coercion",
        "stalking_or_tracking",
        "threats_or_intimidation",
        "coercive_control_or_isolation",
        "home_danger",
        "self_harm_or_suicide",
        "violence_risk",
        "immediate_danger",
      ];

      requiredKeys.forEach((key) => {
        assert(Object.prototype.hasOwnProperty.call(SAFETY_CATEGORIES, key), `Missing safety category key: ${key}`);
        assert(getSafetyCategory(key), `Expected getSafetyCategory('${key}') to return a category`);
      });

      assert(listSafetyCategories().length === requiredKeys.length, "Expected exact required category count");
    });

    await runCase("safety knowledge base validation passes", async () => {
      const result = validateSafetyKnowledgeBase();
      assert(result.ok === true, `Expected validation to pass: ${result.errors.join(" | ")}`);
    });

    await runCase("level 3+ messaging policies pause and block normal send", async () => {
      const categories = listSafetyCategories().filter((category) => category.level >= 3);

      categories.forEach((category) => {
        assert(category.messagingPolicy.allowNormalSend === false, `${category.key} should block normal send`);
        assert(category.messagingPolicy.shouldPauseSend === true, `${category.key} should pause send`);
        assert(category.messagingPolicy.persistAsNormalMessage === false, `${category.key} should not persist as normal message`);
      });
    });

    await runCase("level 3+ coach policies disable normal rewrite apply", async () => {
      const categories = listSafetyCategories().filter((category) => category.level >= 3);

      categories.forEach((category) => {
        assert(category.coachPolicy.allowNormalCoaching === false, `${category.key} should disable normal coaching`);
        assert(category.coachPolicy.allowRewriteApply === false, `${category.key} should disable rewrite apply`);
        assert(category.coachPolicy.useSafetyGuidance === true, `${category.key} should use safety guidance`);
      });
    });

    await runCase("level 0 allows normal send and coaching", async () => {
      const category = getSafetyCategory("none");
      assert(category.messagingPolicy.allowNormalSend === true, "Level 0 should allow normal send");
      assert(category.messagingPolicy.shouldPauseSend === false, "Level 0 should not pause send");
      assert(category.coachPolicy.allowNormalCoaching === true, "Level 0 should allow normal coaching");
      assert(category.coachPolicy.allowRewriteApply === true, "Level 0 should allow rewrite apply");
    });

    await runCase("decision engine level 0 deterministic allows policies", async () => {
      const decision = buildSafetyDecision({
        contextEnvelope: { contextType: "messaging_send", channel: "messaging" },
        deterministicResult: {
          level: 0,
          label: "normal coaching",
          shouldStopNormalCoaching: false,
          reason: "No critical safety signals detected.",
          matchedSignals: [],
        },
        semanticResult: null,
        policyVersion: SAFETY_POLICY_VERSION,
      });

      assert(decision.decisionVersion === DECISION_VERSION, "Expected valid decision version");
      assert(decision.category === "none", `Expected none category, got ${decision.category}`);
      assert(decision.messagingPolicy.allowNormalSend === true, "Expected allowNormalSend true at level 0");
      assert(decision.coachPolicy.allowNormalCoaching === true, "Expected allowNormalCoaching true at level 0");
      ensureValid("decision level 0", validateSafetyDecision(decision));
    });

    await runCase("decision engine level 3 deterministic blocks messaging and coaching", async () => {
      const decision = buildSafetyDecision({
        contextEnvelope: { contextType: "messaging_rephrase", channel: "messaging" },
        deterministicResult: {
          level: 3,
          label: "possible abuse or coercion",
          shouldStopNormalCoaching: true,
          reason: "Possible abuse, coercion, stalking, or unsafe relationship dynamics detected.",
          matchedSignals: ["abuse_or_coercion"],
        },
        semanticResult: null,
        policyVersion: SAFETY_POLICY_VERSION,
      });

      assert(decision.level === 3, "Expected level 3");
      assert(decision.source === "deterministic", "Expected deterministic source");
      assert(decision.messagingPolicy.allowNormalSend === false, "Expected blocked normal send");
      assert(decision.messagingPolicy.persistAsNormalMessage === false, "Expected blocked normal persistence");
      assert(decision.coachPolicy.allowNormalCoaching === false, "Expected blocked normal coaching");
      assert(decision.coachPolicy.allowRewriteApply === false, "Expected blocked rewrite apply");
      ensureValid("decision level 3", validateSafetyDecision(decision));
    });

    await runCase("decision engine preserves deterministic precedence for level 4 and level 5", async () => {
      const semanticAttempt = {
        category: "none",
        confidence: 0.99,
        level: 0,
        semanticSignals: ["semantic_low_risk"],
      };

      const level4Decision = buildSafetyDecision({
        contextEnvelope: { contextType: "coaching_analysis", channel: "coach" },
        deterministicResult: {
          level: 4,
          label: "self-harm or violence risk",
          shouldStopNormalCoaching: true,
          reason: "Possible self-harm, suicide, or violence risk detected.",
          matchedSignals: ["self_harm_or_suicide"],
        },
        semanticResult: semanticAttempt,
        policyVersion: SAFETY_POLICY_VERSION,
      });

      const level5Decision = buildSafetyDecision({
        contextEnvelope: { contextType: "messaging_send", channel: "messaging" },
        deterministicResult: {
          level: 5,
          label: "emergency immediate danger",
          shouldStopNormalCoaching: true,
          reason: "Immediate danger or emergency language detected.",
          matchedSignals: ["emergency_immediate_danger"],
        },
        semanticResult: semanticAttempt,
        policyVersion: SAFETY_POLICY_VERSION,
      });

      assert(level4Decision.level === 4, "Expected deterministic level 4 to win");
      assert(level4Decision.source === "deterministic", "Expected deterministic source at level 4");
      assert(level4Decision.shouldStopNormalCoaching === true, "Expected stop for level 4");

      assert(level5Decision.level === 5, "Expected deterministic level 5 to win");
      assert(level5Decision.source === "deterministic", "Expected deterministic source at level 5");
      assert(level5Decision.shouldStopNormalCoaching === true, "Expected stop for level 5");
    });

    await runCase("decision engine handles null semantic safely", async () => {
      const decision = buildSafetyDecision({
        contextEnvelope: { contextType: "coaching_analysis", channel: "coach" },
        deterministicResult: {
          level: 2,
          label: "high-conflict relationship crisis",
          shouldStopNormalCoaching: false,
          reason: "High-conflict relationship language detected.",
          matchedSignals: ["high_conflict_relationship"],
        },
        semanticResult: null,
        policyVersion: SAFETY_POLICY_VERSION,
      });

      assert(decision.trace.semanticCategory === null, "Expected null semanticCategory");
      assert(decision.trace.semanticConfidence === null, "Expected null semanticConfidence");
      ensureValid("decision null semantic", validateSafetyDecision(decision));
    });

    await runCase("decision engine unknown category fallback is safe", async () => {
      const decision = buildSafetyDecision({
        contextEnvelope: { contextType: "messaging_send", channel: "messaging" },
        deterministicResult: {
          level: 3,
          label: "unmapped label",
          shouldStopNormalCoaching: true,
          reason: "Possible abuse, coercion, stalking, or unsafe relationship dynamics detected.",
          matchedSignals: [],
        },
        semanticResult: {
          category: "unknown_future_category",
          confidence: 0.8,
        },
        policyVersion: SAFETY_POLICY_VERSION,
      });

      assert(decision.category === "unsafe_relationship_dynamics", `Expected safe fallback category, got ${decision.category}`);
      assert(decision.messagingPolicy.allowNormalSend === false, "Expected blocked normal send on fallback level 3");
      assert(decision.coachPolicy.allowNormalCoaching === false, "Expected blocked normal coaching on fallback level 3");
      ensureValid("decision unknown category fallback", validateSafetyDecision(decision));
    });

    await runCase("decision engine keeps messaging and coach policies distinct", async () => {
      const policy = getDecisionPolicyForContext({
        contextEnvelope: { contextType: "messaging_send", channel: "messaging" },
        categoryKey: "conflict_crisis",
        fallbackLevel: 2,
      });

      assert(policy.messagingPolicy.allowNormalSend === true, "Expected messaging allowNormalSend true");
      assert(policy.messagingPolicy.shouldPauseSend === true, "Expected messaging shouldPauseSend true");
      assert(policy.coachPolicy.allowNormalCoaching === true, "Expected coach allowNormalCoaching true");
      assert(policy.coachPolicy.useSafetyGuidance === true, "Expected coach useSafetyGuidance true");
      assert(
        Object.prototype.hasOwnProperty.call(policy.messagingPolicy, "persistAsNormalMessage"),
        "Expected messaging-only policy field persistAsNormalMessage"
      );
      assert(
        Object.prototype.hasOwnProperty.call(policy.coachPolicy, "allowRewriteApply"),
        "Expected coach-only policy field allowRewriteApply"
      );
    });

    await runCase("decision engine output contains no raw user text", async () => {
      const rawText = "My private sentence should never appear in decision metadata.";
      const decision = buildSafetyDecision({
        contextEnvelope: {
          contextType: "messaging_send",
          channel: "messaging",
          text: rawText,
          route: "/api/send",
        },
        deterministicResult: {
          level: 0,
          label: "normal coaching",
          shouldStopNormalCoaching: false,
          reason: "No critical safety signals detected.",
          matchedSignals: [],
        },
        semanticResult: null,
        policyVersion: SAFETY_POLICY_VERSION,
      });

      assert(!Object.prototype.hasOwnProperty.call(decision, "text"), "Decision must not expose raw text field");
      const serialized = JSON.stringify(decision);
      assert(!serialized.includes(rawText), "Decision serialization must not include raw text contents");
    });

    await runCase("invalid decision object fails validation", async () => {
      const decision = buildSafetyDecision({
        contextEnvelope: { contextType: "messaging_send", channel: "messaging" },
        deterministicResult: {
          level: 3,
          label: "possible abuse or coercion",
          shouldStopNormalCoaching: true,
          reason: "Possible abuse, coercion, stalking, or unsafe relationship dynamics detected.",
          matchedSignals: ["abuse_or_coercion"],
        },
        semanticResult: null,
        policyVersion: SAFETY_POLICY_VERSION,
      });

      const invalid = {
        ...decision,
        source: "invalid-source",
        trace: {
          ...decision.trace,
          policyVersion: "",
        },
      };

      const result = validateSafetyDecision(invalid);
      assert(result.ok === false, "Expected invalid decision validation to fail");
      assert(result.errors.length > 0, "Expected validation errors for invalid decision");
    });

    await runCase("decision runtime helper isolates build exceptions", async () => {
      const result = buildSafetyDecisionSafe({
        route: "/api/analyze-intensity",
        contextEnvelope: { contextType: "coaching_analysis", channel: "coach" },
        deterministicResult: {
          level: 2,
          label: "high-conflict relationship crisis",
          shouldStopNormalCoaching: false,
          reason: "High-conflict relationship language detected.",
          matchedSignals: ["high_conflict_relationship"],
        },
        semanticResult: null,
        policyVersion: SAFETY_POLICY_VERSION,
        buildDecision: () => {
          throw new Error("forced_build_failure");
        },
      });

      assert(result.ok === false, "Expected helper to report non-ok when build fails");
      assert(result.decision === null, "Expected null decision when build fails");
      assert(result.validation && result.validation.ok === false, "Expected failed validation summary when build fails");
      assert(
        Array.isArray(result.validation.errors) &&
          result.validation.errors.some((entry) => String(entry).includes("decision_build_exception")),
        "Expected build exception marker in validation errors"
      );
    });

    await runCase("decision runtime helper isolates validation exceptions", async () => {
      const result = buildSafetyDecisionSafe({
        route: "/api/rephrase",
        contextEnvelope: { contextType: "messaging_rephrase", channel: "messaging" },
        deterministicResult: {
          level: 1,
          label: "emotional distress",
          shouldStopNormalCoaching: false,
          reason: "Emotional distress language detected.",
          matchedSignals: ["emotional_distress"],
        },
        semanticResult: null,
        policyVersion: SAFETY_POLICY_VERSION,
        validateDecision: () => {
          throw new Error("forced_validation_failure");
        },
      });

      assert(result.ok === true, "Expected helper to keep decision result when validation throws");
      assert(result.decision && typeof result.decision === "object", "Expected decision object when build succeeds");
      assert(result.validation && result.validation.ok === false, "Expected validation summary to fail when validator throws");
      assert(
        Array.isArray(result.validation.errors) &&
          result.validation.errors.some((entry) => String(entry).includes("decision_validation_exception")),
        "Expected validation exception marker in validation errors"
      );
    });

    await runCase("context router maps /api/send to messaging_send", async () => {
      const context = buildContextEnvelope({
        route: "/api/send",
        body: {
          finalText: "Can we talk later?",
          userId: "contract_tester",
          conversationId: "contract_suite",
        },
      });

      assert(context.contextType === "messaging_send", `Expected messaging_send but got ${context.contextType}`);
      assert(context.channel === "messaging", `Expected messaging channel but got ${context.channel}`);
      assert(context.route === "/api/send", `Expected /api/send route but got ${context.route}`);
    });

    await runCase("context router maps /api/rephrase to messaging_rephrase", async () => {
      const context = buildContextEnvelope({
        route: "/api/rephrase",
        body: {
          text: "Rephrase this message",
        },
      });

      assert(
        context.contextType === "messaging_rephrase",
        `Expected messaging_rephrase but got ${context.contextType}`
      );
      assert(context.channel === "messaging", `Expected messaging channel but got ${context.channel}`);
      assert(context.route === "/api/rephrase", `Expected /api/rephrase route but got ${context.route}`);
    });

    await runCase("context router maps /api/analyze-intensity to coaching_analysis", async () => {
      const context = buildContextEnvelope({
        route: "/api/analyze-intensity",
        body: {
          text: "How should I say this?",
          draft: "You always ignore me",
        },
      });

      assert(context.contextType === "coaching_analysis", `Expected coaching_analysis but got ${context.contextType}`);
      assert(context.channel === "coach", `Expected coach channel but got ${context.channel}`);
      assert(
        context.route === "/api/analyze-intensity",
        `Expected /api/analyze-intensity route but got ${context.route}`
      );
    });

    await runCase("context router maps unknown route safely", async () => {
      const context = buildContextEnvelope({
        route: "/api/not-a-real-route",
        body: {
          text: "hello",
        },
      });

      assert(context.contextType === "unknown", `Expected unknown but got ${context.contextType}`);
      assert(context.channel === "unknown", `Expected unknown channel but got ${context.channel}`);
      assert(context.requestedAction === "unknown", `Expected unknown action but got ${context.requestedAction}`);
    });

    let dbConnected = false;
    try {
      const dbRes = await fetch(`${BASE_URL}/api/db-health`);
      const dbPayload = await dbRes.json();
      dbConnected = !!(dbPayload && dbPayload.connected === true);
    } catch (error) {
      dbConnected = false;
    }

    await runCase("analyze-intensity non-blocked contract", async () => {
      const { status, payload } = await postJson("/api/analyze-intensity", {
        text: "Can we talk later today? I want to understand what happened.",
        tone: "calm",
        coachMode: "soft",
      });

      assert(status === 200, `Expected 200 but got ${status}`);
      ensureValid("/api/analyze-intensity", validateAnalyzeIntensityResponse(payload));
      assert(payload.coachingBlocked !== true, "Expected non-blocked analyze-intensity response");
      assert(payload.safetyDecision === undefined, "Decision metadata must not be exposed externally");
    });

    await runCase("analyze-intensity safety-blocked contract", async () => {
      const { status, payload } = await postJson("/api/analyze-intensity", {
        text: "I don’t feel safe around you.",
      });

      assert(status === 200, `Expected 200 but got ${status}`);
      ensureValid("safety-blocked", validateSafetyBlockedResponse(payload));
      assert(payload.coachingBlocked === true, "Expected coachingBlocked true");
      assert(payload.safety && payload.safety.level >= 3, "Expected safety level 3+ for unsafe feeling phrase");
    });

    await runCase("analyze-intensity unsafe phrase blocks (you make me feel unsafe)", async () => {
      const { status, payload } = await postJson("/api/analyze-intensity", {
        text: "You make me feel unsafe.",
      });

      assert(status === 200, `Expected 200 but got ${status}`);
      ensureValid("safety-blocked", validateSafetyBlockedResponse(payload));
      assert(payload.coachingBlocked === true, "Expected coachingBlocked true");
      assert(payload.safety && payload.safety.level >= 3, "Expected safety level 3+ for unsafe phrase");
    });

    await runCase("analyze-intensity abuse-concern phrase blocks", async () => {
      const { status, payload } = await postJson("/api/analyze-intensity", {
        text: "I think I’m being abused.",
      });

      assert(status === 200, `Expected 200 but got ${status}`);
      ensureValid("safety-blocked", validateSafetyBlockedResponse(payload));
      assert(payload.coachingBlocked === true, "Expected coachingBlocked true");
      assert(payload.safety && payload.safety.level >= 3, "Expected safety level 3+ for abuse-concern phrase");
    });

    await runCase("rephrase non-blocked contract", async () => {
      const { status, payload } = await postJson("/api/rephrase", {
        text: "You always ignore me",
        tone: "frustrated",
        needsAIHelp: true,
        stateOfMind: "hurt",
        intent: "express hurt",
        risk: "high",
        confidence: 0.8,
      });

      assert(status === 200, `Expected 200 but got ${status}`);
      ensureValid("/api/rephrase", validateRephraseResponse(payload));
      assert(payload.coachingBlocked !== true, "Expected non-blocked rephrase response");
      assert(payload.safetyDecision === undefined, "Decision metadata must not be exposed externally");
    });

    await runCase("rephrase safety-blocked contract", async () => {
      const { status, payload } = await postJson("/api/rephrase", {
        text: "I want to die",
        tone: "sad",
        needsAIHelp: true,
      });

      assert(status === 200, `Expected 200 but got ${status}`);
      ensureValid("safety-blocked", validateSafetyBlockedResponse(payload));
      assert(payload.coachingBlocked === true, "Expected coachingBlocked true");
    });

    if (dbConnected) {
      await runCase("send dry-run non-blocked contract", async () => {
        const { status, payload } = await postJson(
          "/api/send",
          {
            conversationId: "contract_suite",
            userId: "contract_tester",
            originalText: "Can we align on this tomorrow morning?",
            finalText: "Can we align on this tomorrow morning?",
            preSendEmotion: "calm",
            intensityScore: 0.2,
          },
          {
            "X-Smoke-Test": "1",
          }
        );

        assert(status === 200, `Expected 200 but got ${status}`);
        ensureValid("/api/send", validateSendResponse(payload));
        assert(payload.dry_run === true, "Expected dry_run true in smoke send response");
        assert(payload.safetyDecision === undefined, "Decision metadata must not be exposed externally");
      });

      await runCase("send safety-blocked contract", async () => {
        const { status, payload } = await postJson(
          "/api/send",
          {
            conversationId: "contract_suite",
            userId: "contract_tester",
            originalText: "I am in immediate danger and need help now.",
            finalText: "I am in immediate danger and need help now.",
          },
          {
            "X-Smoke-Test": "1",
          }
        );

        assert(status === 200, `Expected 200 but got ${status}`);
        ensureValid("safety-blocked", validateSafetyBlockedResponse(payload));
      });

      await runCase("send partner threatening/tracking safety-blocked contract", async () => {
        const { status, payload } = await postJson(
          "/api/send",
          {
            conversationId: "contract_suite",
            userId: "contract_tester",
            originalText: "My partner tracks my location and threatens me.",
            finalText: "My partner tracks my location and threatens me.",
          },
          {
            "X-Smoke-Test": "1",
          }
        );

        assert(status === 200, `Expected 200 but got ${status}`);
        ensureValid("safety-blocked", validateSafetyBlockedResponse(payload));
        assert(payload.coachingBlocked === true, "Expected coachingBlocked true");
        assert(payload.safety && payload.safety.level >= 3, "Expected safety level 3+ for abuse/coercion phrase");
      });

      await runCase("send coercive-control safety-blocked contract", async () => {
        const { status, payload } = await postJson(
          "/api/send",
          {
            conversationId: "contract_suite",
            userId: "contract_tester",
            originalText: "They won’t let me leave the house.",
            finalText: "They won’t let me leave the house.",
          },
          {
            "X-Smoke-Test": "1",
          }
        );

        assert(status === 200, `Expected 200 but got ${status}`);
        ensureValid("safety-blocked", validateSafetyBlockedResponse(payload));
        assert(payload.coachingBlocked === true, "Expected coachingBlocked true");
        assert(payload.safety && payload.safety.level >= 3, "Expected safety level 3+ for coercive-control phrase");
      });

      await runCase("communication persistence appears in pattern-summary", async () => {
        const conversationId = "contract_ci_persist";
        const { status: sendStatus, payload: sendPayload } = await postJson("/api/send", {
          conversationId,
          userId: "contract_tester",
          originalText: "I feel ignored when messages are missed.",
          finalText: "I feel ignored when messages are missed. Can we agree on a check-in time?",
          preSendEmotion: "frustrated",
          intensityScore: 0.55,
          wasPauseTaken: true,
          usedSuggestion: true,
          actionTaken: "used_suggestion",
        });

        assert(sendStatus === 200, `Expected 200 but got ${sendStatus}`);
        ensureValid("/api/send", validateSendResponse(sendPayload));
        assert(sendPayload.coachingBlocked !== true, "Expected non-blocked send response");

        const { status: summaryStatus, payload: summaryPayload } = await getJson(
          `/api/pattern-summary?conversation=${encodeURIComponent(conversationId)}`
        );
        assert(summaryStatus === 200, `Expected 200 but got ${summaryStatus}`);
        assert(summaryPayload && summaryPayload.summary, "Expected summary object in pattern summary response");
        assert(
          Object.prototype.hasOwnProperty.call(summaryPayload.summary, "topCommunicationIntent"),
          "Expected additive communication summary field: topCommunicationIntent"
        );
        assert(
          Object.prototype.hasOwnProperty.call(summaryPayload.summary, "communicationRiskCounts"),
          "Expected additive communication summary field: communicationRiskCounts"
        );
      });
    } else {
      results.push({ name: "send route contracts", status: "SKIP", note: "DATABASE_URL not configured" });
      console.log("[contracts] SKIP send route contracts (DATABASE_URL not configured)");
    }
  } finally {
    if (!server.killed) {
      server.kill("SIGTERM");
    }
  }

  const failed = results.filter((r) => r.status === "FAIL");
  const skipped = results.filter((r) => r.status === "SKIP");

  console.log("\n[contracts] Summary");
  results.forEach((r) => {
    const details = r.error ? ` :: ${r.error}` : r.note ? ` :: ${r.note}` : "";
    console.log(`- ${r.status} ${r.name}${details}`);
  });

  if (failed.length > 0) {
    process.exitCode = 1;
    return;
  }

  if (skipped.length > 0) {
    console.log("[contracts] Completed with skips.");
  } else {
    console.log("[contracts] All contract tests passed.");
  }
}

run().catch((error) => {
  console.error("[contracts] Fatal error:", error);
  process.exit(1);
});
