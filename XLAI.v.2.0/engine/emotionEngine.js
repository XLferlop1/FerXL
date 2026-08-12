"use strict";

function analyzeEmotion(text = "", emotionHint = "") {
  const raw = String(text || "").trim();
  const lower = raw.toLowerCase();
  const hint = String(emotionHint || "").toLowerCase().trim();

  const buckets = {
    calm: /\b(calm|steady|all good|okay|fine now)\b/g,
    frustrated: /\b(frustrated|annoyed|irritated|fed up)\b/g,
    angry: /\b(angry|furious|livid|mad)\b/g,
    hurt: /\b(hurt|ignored|dismissed|unseen|left out|betrayed)\b/g,
    anxious: /\b(anxious|worried|nervous|afraid|stressed)\b/g,
    confused: /\b(confused|unclear|don't understand|what do you mean)\b/g,
    overwhelmed: /\b(overwhelmed|too much|can't handle|drained|exhausted)\b/g,
    neutral: /\b(update|fyi|note|status|schedule)\b/g,
  };

  let topLabel = "neutral";
  let topScore = 0;

  for (const [label, regex] of Object.entries(buckets)) {
    const hits = (lower.match(regex) || []).length;
    if (hits > topScore) {
      topScore = hits;
      topLabel = label;
    }
  }

  if (hint && buckets[hint]) {
    topLabel = topScore === 0 ? hint : topLabel;
    topScore = Math.max(topScore, 1);
  }

  const punctuationBoost = (raw.match(/[!]{1,}/g) || []).length > 0 ? 0.1 : 0;
  const intensity = Math.max(0.1, Math.min(1, topScore * 0.28 + punctuationBoost));

  return {
    primary: topLabel,
    intensity: Number(intensity.toFixed(2)),
    explanation:
      topScore > 0
        ? `Detected ${topLabel} cues in wording.`
        : "No strong emotion terms found; defaulting to neutral.",
  };
}

module.exports = { analyzeEmotion };
