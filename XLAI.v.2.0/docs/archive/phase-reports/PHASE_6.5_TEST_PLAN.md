# Phase 6.5 QA + Calibration Test Plan

**Goal**: Fix analyzer inconsistencies and coach bar behavior before Phase 7

---

## Current Issues Identified

### 1. "Never mind" treated too vaguely
**Problem**: Shows "I may need more context" instead of recognizing shutdown/withdrawal

**Root Cause**: 
- Short messages (≤3 words) get ambiguity penalty if signals.dismissal < 2
- "Never mind" = 2 words, dismissal signal = 1, so it gets penalized
- Low confidence triggers generic "I may need more context"

**Fix Needed**: Add explicit shutdown checks before low confidence fallback

---

### 2. "I feel overlooked" treated as unclear
**Problem**: Shows "I may need more context" instead of treating like "I feel ignored"

**Root Cause**:
- "overlooked" not in pain patterns (only "ignored" is)
- No explicit phrase check for "I feel overlooked"
- Falls through to low confidence → generic guidance

**Expand pain patterns**: 
- overlooked, dismissed, unheard, unseen, left out, not considered, not important, pushed aside, brushed off

**Add explicit checks for**:
- "I feel overlooked"
- "I feel dismissed"
- "I feel unheard"
- "I feel unseen"
- "I feel left out"

---

### 3. Coach guidance disappears after 8 seconds
**Problem**: Deep Refine guidance auto-hides too fast for emotional situations

**Root Cause**: Line 1858 in chat.js:
```javascript
setTimeout(() => {
  if (draftCoachBar) {
    hideDraftCoachBar();
  }
}, 8000);
```

**Fix Needed**: Remove auto-hide for Refine guidance, persist until:
- User changes text
- User sends message
- User manually dismisses (future enhancement)

---

### 4. "Refined draft applied" stays too long
**Problem**: Status message doesn't fade, feels permanent

**Root Cause**: showComposerHint() has no auto-hide logic

**Fix Needed**: Add 2-3 second auto-hide for status messages

---

## Test Groups

### Test Group A: Light Messages (Should Show No/Light Coach Bar)

#### A1: "Hey are you free later?"
**Expected**:
- Coach bar hidden OR very light guidance
- NOT "I may need more context"
- NOT dramatic/conflict-focused

**Current Status**: ❓ (To be tested)

---

#### A2: "Can we talk later?"
**Expected**:
- Low-pressure, practical guidance or hidden
- NOT dramatic

**Current Status**: ❓ (To be tested)

---

### Test Group B: Hurt / Ignored / Unseen

#### B1: "I feel ignored"
**Expected**: 
```
You're sharing hurt. Add what happened and what you need next.
```

**Current Status**: ✅ (Working - has explicit check)

---

#### B2: "I feel overlooked"
**Expected**: 
```
You're sharing that you feel unseen. Add what happened and what you need next.
```
OR similar hurt-focused guidance

**Current Status**: ❌ (Shows "I may need more context")

**Fix Needed**:
1. Add "overlooked" to pain patterns
2. Add explicit check: `/\bi\s+feel\s+overlooked\b/`

---

#### B3: "I feel dismissed"
**Expected**: 
```
You're sharing hurt. Name what happened and what you need next.
```

**Current Status**: ❌ (Likely shows "I may need more context")

**Fix Needed**:
1. Add "dismissed" to pain patterns
2. Add explicit check: `/\bi\s+feel\s+dismissed\b/`

---

#### B4: "I feel like you don't care about me"
**Expected**: 
```
You're sharing hurt. Try naming the moment before saying they don't care.
```

**Current Status**: ✅ (Has explicit check for "I feel like you don't care")

---

### Test Group C: Shutdown / Pulling Away

#### C1: "Never mind"
**Expected**: 
```
This sounds like you might be pulling back. Say if you need space or still want to talk.
```

**Current Status**: ❌ (Shows "I may need more context")

**Fix Needed**:
1. Add explicit shutdown check: `/\bnever\s+mind\.?$/i`
2. Boost shutdown confidence (prevent ambiguity penalty)

---

#### C2: "Nvm forget it"
**Expected**: 
```
This sounds like shutting down. Say if you need space or still want to talk.
```

**Current Status**: ❌ (Likely unclear)

**Fix Needed**: Same as C1

---

#### C3: "It's fine whatever"
**Expected**: 
```
This may sound like you're closing off. Say what you actually need.
```

**Current Status**: ❓ (To be tested)

---

### Test Group D: Anger / Blame

#### D1: "You always ignore me"
**Expected**: 
```
This may sound like blame. Name the moment instead of using "always."
```

**Current Status**: ✅ (Likely working - has alwaysNever + accusation)

---

#### D2: "I'm mad at you"
**Expected**: 
```
You're angry. Say what happened before saying what they are.
```

**Current Status**: ✅ (Has explicit check)

---

#### D3: "Why do you always make me feel bad"
**Expected**: 
```
This may sound like blame. Name what happened and what you need next.
```

**Current Status**: ✅ (Likely working)

---

### Test Group E: Betrayal / Serious Conflict

#### E1: "I can't believe you cheated on me"
**Expected (local analyzer)**: 
```
This is about broken trust. Ask for honesty, accountability, or space.
```

**Current Status**: ✅ (Should work - has betrayal patterns)

**Then tap Refine**:

**Expected (rewrite)**:
```
I'm hurt by what happened, and I need honesty about why you cheated.
```
OR
```
I'm really hurt, and I need honesty and accountability before I can keep talking about this.
```

**Should NOT be too soft** (maintain seriousness)

**Current Status**: ❓ (To be tested)

---

### Test Group F: Refine Behavior

#### F1: "I feel ignored" → Tap Refine
**Expected**:
1. Input changes to better message
2. Coach guidance appears
3. Guidance does NOT disappear too fast ❌ (Currently auto-hides after 8s)
4. "Refined draft applied" shows briefly (2-3s), then fades ❌ (Currently stays forever)

---

#### F2: "Whatever forget it" → Tap Refine
**Expected rewrite**:
```
I'm upset and need space right now, but I do want to talk later.
```
OR similar clarification

---

#### F3: "This team environment feels unprofessional" → Tap Refine
**Expected rewrite**:
```
I've noticed some patterns in the work environment that are affecting communication. Can we discuss ways to improve it?
```
OR similar professional framing

---

## Implementation Checklist

### Pattern Additions

#### Expand `pain` patterns (line ~262):
```javascript
pain: [
  // ... existing patterns ...
  /\bignored\b/,              // Already exists
  /\boverlooked\b/,           // ⬅ ADD
  /\bdismissed\b/,            // ⬅ ADD
  /\bunheard\b/,              // ⬅ ADD
  /\bunseen\b/,               // ⬅ ADD
  /\bleft\s+out\b/,           // ⬅ ADD
  /\bnot\s+considered\b/,     // ⬅ ADD
  /\bnot\s+important\b/,      // ⬅ ADD
  /\bpushed\s+aside\b/,       // ⬅ ADD
  /\bbrushed\s+off\b/,        // ⬅ ADD
],
```

#### Expand `shutdown` patterns (line ~418):
```javascript
shutdown: [
  /\bwhatever\b/,           // Already exists
  /\bnvm\b/,                // Already exists
  /\bnever\s+mind\b/,       // Already exists
  /\bforget\s+it\b/,        // Already exists
  /\bdo\s+what\s+you\s+want\b/,
  /\bi'?m\s+done\b/,
  /\bfine\.?\s*$/,
  /\bif\s+that'?s\s+what\s+you\s+want\b/,
  /\bleave\s+it\b/,         // ⬅ ADD
  /\bit'?s\s+fine\b/,       // ⬅ ADD
  /\bdon'?t\s+worry\s+about\s+it\b/,  // ⬅ ADD
],
```

### Explicit Phrase Checks

#### Add to `generateUserFacingGuidance` (line ~1087):
```javascript
// Existing:
if (/\bi\s+feel\s+ignored\b/.test(lower) && signals.pain > 0) {
  return "You're sharing hurt. Add what happened and what you need next.";
}

// ⬅ ADD:
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
```

#### Add shutdown checks BEFORE low confidence (line ~1108):
```javascript
// ⬅ ADD THIS before "Low confidence cases" comment:
// Shutdown detection (explicit patterns)
if (signals.shutdown >= 1 || /\bnever\s+mind\.?$/i.test(lower) || /\bnvm\b/.test(lower)) {
  return "This sounds like you might be pulling back. Say if you need space or still want to talk.";
}
if (/\bit'?s\s+fine\s+whatever\b/.test(lower) || /\bwhatever.*forget\s+it\b/.test(lower)) {
  return "This may sound like you're closing off. Say what you actually need.";
}

// Low confidence cases
if (confidenceLabel === "low" && intent !== "ask a practical question") {
  // ... existing code ...
}
```

### Confidence Calculation Fix

#### Adjust ambiguity penalty (line ~1540):
```javascript
const ambiguityPenalty =
  (wordCount <= 3 && !strongEmotionStatement && !socialCues.alwaysNever && signals.dismissal < 2 && signals.shutdown === 0 ? 0.14 : 0) +  // ⬅ ADD signals.shutdown check
  // ... rest ...
```

### Coach Bar Persistence Fixes

#### Remove auto-hide from deep Refine guidance (line ~1858):
```javascript
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

  // ❌ REMOVE THIS:
  // Auto-hide after a few seconds so it doesn't clutter
  // setTimeout(() => {
  //   if (draftCoachBar) {
  //     hideDraftCoachBar();
  //   }
  // }, 8000);
  
  // ✅ Guidance persists until user changes text, sends, or dismisses
}
```

#### Add auto-hide to "Refined draft applied" (line ~1814):
```javascript
} else {
  showComposerHint("Refined draft applied");
  // ⬅ ADD: Auto-hide status message after 2.5 seconds
  setTimeout(() => {
    showComposerHint("");
  }, 2500);
}
```

---

## Success Criteria

✅ **Pattern Recognition**:
- "I feel overlooked" → hurt-focused guidance (NOT "I may need more context")
- "I feel dismissed" → hurt-focused guidance
- "Never mind" → shutdown guidance (NOT "I may need more context")
- "Nvm forget it" → shutdown guidance

✅ **Confidence Calibration**:
- Shutdown phrases no longer get ambiguity penalty
- Pain phrases get recognized even in short messages

✅ **Coach Bar Behavior**:
- Deep Refine guidance persists (no auto-hide)
- "Refined draft applied" fades after 2-3 seconds

✅ **No Regressions**:
- All existing passing tests still pass
- Light messages still get light/no guidance
- Anger/blame messages still get appropriate warnings

---

## Post-Implementation Testing

Run all test groups (A-F) and document:
- Expected vs Actual for each test case
- Any new issues discovered
- Calibration adjustments needed

**Target Score**: 90%+ accuracy on all test groups before Phase 7
