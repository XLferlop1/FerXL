// humanize.js
// Second-pass humanization function for coach responses
// Converts robotic/system language to natural human coaching voice

const humanizeCoachVoice = (coachingObj) => {
  const humanize = (text) => {
    if (!text || typeof text !== "string") return text;

    // Pattern replacements: robotic → conversational
    const patterns = [
      // Generic instruction starters
      [/\bIdentify\s+(?:the\s+)?/gi, "What's "],
      [/\bConsider\s+/gi, "Try "],
      [/\bUtilize\b/gi, "Use"],
      [/\bFrame\s+your\s+feedback/gi, "Say it"],
      [/\bImplement\s+/gi, "Try "],
      [/\bIt\s+is\s+important\s+to/gi, "It matters to"],

      // Passive/clinical tone
      [/This\s+message\s+contains/gi, "Your message has"],
      [/This\s+wording\s+may\b/gi, "This might"],
      [/The\s+recipient\s+may\b/gi, "They might"],

      // Therapy-speak neutralizers
      [/It\s+sounds\s+like\s+you\s+are\s+/gi, "Sounds like you're "],
      [/It\s+seems\s+like\s+you\s+are\s+/gi, "Seems like you're "],

      // "Use" statement conversions (keep meaning, soften tone)
      [/Use\s+this\s+when\s+you\s+want\s+([^.]+)\./gi, "Say this when you want $1."],
      [/Use\s+this\s+phrasing\b/gi, "Try this phrasing"],

      // Impact language (more specific)
      [/may\s+cause\s+/gi, "will probably cause "],
      [/may\s+lead\s+to\b/gi, "will likely lead to"],
      [/might\s+feel\b/gi, "will probably feel"],
      [/risk\s+of\s+/gi, "risk you'll get "],

      // Advice softeners
      [/You\s+should\s+/gi, "Try "],
      [/You\s+need\s+to\s+/gi, "You'll want to "],
      [/Make\s+sure\s+to\s+/gi, "Remember to "],
      [/Don't\s+forget\s+to\s+/gi, "Don't overlook "],

      // Conversational bridges
      [/What\s+usually\s+works\s+is/gi, "What works well is"],
      [/What\s+typically\s+helps\s+is/gi, "What helps is"],
      [/The\s+key\s+is\b/gi, "Here's what matters:"],

      // Remove filler words
      [/\bBasically,?\s+/gi, ""],
      [/\bEssentially,?\s+/gi, ""],

      // Social language improvements
      [/\bThey\s+will\s+likely\b/gi, "They'll probably"],
      [/\bthey\s+will\s+feel\s+defensive/gi, "they'll get defensive"],
      [/\bthey\s+may\s+shut\s+down/gi, "they'll shut down"],
      [/might\s+misunderstand/gi, "could misread"],

      // More natural "if" constructions
      [/If\s+you\s+use\s+/gi, "If you say "],
      [/because\s+it\s+sounds\b/gi, "because it lands"],
    ];

    let result = text;
    for (const [pattern, replacement] of patterns) {
      result = result.replace(pattern, replacement);
    }

    // Add semantic enhancements for social dynamics
    if (result.includes("defensive")) {
      if (!result.includes("stop listening")) {
        result = result.replace(/they'll get defensive/gi, "they'll get defensive and stop listening");
      }
    }

    // Clean up double spaces
    result = result.replace(/\s+/g, " ").trim();

    return result;
  };

  const humanizeArray = (arr) => {
    if (!Array.isArray(arr)) return arr;
    return arr.map(humanize).filter(Boolean);
  };

  return {
    quick_read: humanize(coachingObj.quick_read || ""),
    what_to_do: humanizeArray(coachingObj.what_to_do || []),
    what_to_say: humanizeArray(coachingObj.what_to_say || []),
    when_to_use_each: humanizeArray(coachingObj.when_to_use_each || []),
    insight: humanize(coachingObj.insight || ""),
    principle: humanize(coachingObj.principle || ""),
    suggestion: humanize(coachingObj.suggestion || ""),
    rewrite: humanize(coachingObj.rewrite || ""),
    response: humanize(coachingObj.response || ""),
  };
};

module.exports = { humanizeCoachVoice };
