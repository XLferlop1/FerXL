# Phase 7 Pre-Implementation Audit

## Executive Summary

**Goal**: Connect Chat + Coach + Analyzer context so Coach can answer with awareness of the selected conversation, recent messages, current draft, local analyzer result, emotion chip, and refine context.

---

## Current State Analysis

### Frontend State (chat.js)

**Available Context**:
- `selectedConversationId` (line 10): Currently selected conversation ID
- `currentConversationId` (line 9): Same as selectedConversationId, kept in sync
- `conversations` (line 11): Array of all conversations with `display_name`, `conversation_id`, etc.
- `chatMessages` (line 12): Array of loaded messages for selected conversation
- `draftText` (line 44): Current draft text
- `draftAnalysis` (line 45): Local analyzer result containing:
  - `tone` (observedTone)
  - `stateOfMind`
  - `intent`
  - `risk`
  - `confidence`
  - `confidenceLabel`
  - `communicationPattern`
  - `likelyRecipientReaction`
  - `bestCommunicationMove`
  - `suggestedStyle`
  - `userFacingGuidance`
  - `needsAIHelp`
- `selectedEmotion` (line 48): Selected emotion chip ("calm", "anxious", "frustrated", "sad", "hopeful")
- `currentCoachMode` (line 32): Coach mode setting ("soft", "direct", "professional")
- `currentTone` (line 14): Tone setting ("calm", "professional", "low-key")
- `currentUserId` (line 13): User ID

**Missing**:
- ❌ No storage for latest refine result
- ❌ Coach doesn't receive recent messages
- ❌ Coach doesn't receive analyzer context
- ❌ Coach doesn't receive conversation name

---

### askCoach Function (Line 2606-2665)

**Current Payload Sent to /api/analyze-intensity**:
```javascript
{
  text: "user's coach question",
  draft: draftText,
  tone: currentTone,
  emotion: currentEmotion,
  rewriteStrength,
  coachMode: currentCoachMode,
  conversationId: currentConversationId,  // ⚠️ sent but unused by backend
  userId: currentUserId
}
```

**What's Missing**:
- ❌ Recent messages from `chatMessages`
- ❌ Analyzer result from `draftAnalysis`
- ❌ Latest refine result
- ❌ Conversation name from `conversations.find(c => c.conversation_id === selectedConversationId).display_name`

---

### Backend /api/analyze-intensity (Line 399-776)

**Current Request Handling**:
```javascript
const { text, draft, tone, emotion, rewriteStrength, coachMode, userId } = req.body || {};
```

**What Backend Currently Uses**:
- ✅ `text` - Coach question
- ✅ `draft` - Draft context
- ✅ `tone` - Tone preference
- ✅ `emotion` - Emotion chip
- ✅ `rewriteStrength` - Rewrite strength setting
- ✅ `coachMode` - Coach mode
- ✅ `userId` - For adaptive metrics

**What Backend Currently Ignores**:
- ❌ `conversationId` - Sent but never used
- ❌ Recent messages - Not sent
- ❌ Analyzer result - Not sent
- ❌ Refine result - Not sent
- ❌ Conversation name - Not sent

**Current System Prompt** (Line 422-570):
- Very long, well-structured coaching prompt
- Does NOT mention using conversation context
- Does NOT mention recent messages
- Does NOT mention analyzer result
- Generic coaching without conversation awareness

---

### refineCurrentDraft Function (Line 1769-1824)

**Current Behavior**:
- Calls `/api/rephrase` with draft + metadata
- Receives back:
  - Simple mode: `{ mode: "simple", rewrite, shortReason }`
  - Deep mode: `{ mode: "deep", rewrite, quickRead, whyItMatters, bestMove, optionalAlternative }`
- Updates `messageInput.value` with rewrite
- Displays deep guidance in coach bar
- ❌ **Does NOT store the refine result anywhere**

**Missing**:
- No `latestRefineResult` variable
- Coach can't reference what Refine suggested

---

### Message Loading (Line 2083-2099)

**loadThread Function**:
```javascript
const res = await fetch(`/api/messages?conversation=${convId}&order=asc`);
const data = await res.json();
chatMessages = Array.isArray(data.messages) ? data.messages : [];
renderThread(chatMessages);
```

**Message Structure** (from database):
```javascript
{
  message_id,
  conversation_id,
  sender_user_id,
  message_text,
  created_at_timestamp,
  // ... other fields
}
```

**Current State**:
- ✅ Messages are loaded and stored in `chatMessages`
- ❌ Never sent to Coach
- ❌ No limit on message count (could send entire history)

---

## Gap Analysis

### What Coach Currently Knows:
1. ✅ The question user asked
2. ✅ Current draft (if any)
3. ✅ User's tone preference
4. ✅ Selected emotion chip
5. ✅ Coach mode setting
6. ✅ Rewrite strength
7. ✅ User ID for adaptive metrics

### What Coach Doesn't Know:
1. ❌ **Recent conversation messages** - Can't see what was said before
2. ❌ **Conversation name** - Doesn't know who user is talking to
3. ❌ **Local analyzer result** - Misses patterns like "shutdown", "hurt", "blame-heavy"
4. ❌ **Latest refine result** - Can't build on what Refine suggested
5. ❌ **Draft analysis confidence** - Doesn't know if analyzer is uncertain
6. ❌ **needsAIHelp flag** - Doesn't know if situation is complex

### User Experience Gaps:

**Gap 1: Coach gives generic advice when conversation context exists**
- User types: "How should I respond?"
- Coach says: "Try using I-statements and be clear."
- **Should say**: "Based on the Alex conversation, this looks like you're reacting to feeling ignored. Don't start with 'you always.' A better move is to name the moment and ask for what you need next."

**Gap 2: Coach doesn't see analyzer insights**
- Draft says: "You always ignore me"
- Analyzer detects: `communicationPattern: "blame-heavy"`, `bestCommunicationMove: "behavior + impact + request"`
- Coach doesn't see this, gives general advice

**Gap 3: Coach can't build on Refine**
- User taps Refine, gets deep mode guidance
- Then asks Coach: "Make this better"
- Coach doesn't know what Refine already suggested

**Gap 4: Coach doesn't know who user is talking to**
- Selected conversation: "Alex (Manager)"
- Coach gives relationship advice instead of workplace advice

---

## Phase 7 Implementation Plan

### Frontend Changes (chat.js)

**1. Add latestRefineResult State Variable** (line ~48)
```javascript
let latestRefineResult = null; // stores last refine output
```

**2. Store Refine Result** (in refineCurrentDraft, line ~1820)
```javascript
latestRefineResult = {
  mode: data.mode,
  rewrite: data.rewrite,
  shortReason: data.shortReason,
  quickRead: data.quickRead,
  whyItMatters: data.whyItMatters,
  bestMove: data.bestMove,
  optionalAlternative: data.optionalAlternative
};
```

**3. Create buildCoachContext() Helper** (new function)
```javascript
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

  // Recent messages (last 6-10)
  if (chatMessages && chatMessages.length > 0) {
    context.recentMessages = chatMessages.slice(-8).map(msg => ({
      sender: msg.sender_user_id === currentUserId ? "me" : "them",
      text: msg.message_text,
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
```

**4. Update askCoach to Send Context** (line ~2606)
```javascript
const context = buildCoachContext();

await fetch("/api/analyze-intensity", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    text,
    draft: draftText,
    tone: currentTone,
    emotion: currentEmotion,
    rewriteStrength,
    coachMode: currentCoachMode,
    context  // ⬅ NEW: full context object
  }),
});
```

---

### Backend Changes (server.js)

**1. Update Request Parsing** (line ~400)
```javascript
const { text, draft, tone, emotion, rewriteStrength, coachMode, userId, context } = req.body || {};
```

**2. Extract Context Fields**
```javascript
const ctx = context || {};
const conversationName = ctx.conversationName || null;
const recentMessages = Array.isArray(ctx.recentMessages) ? ctx.recentMessages : [];
const analyzer = ctx.analyzer || null;
const latestRefine = ctx.latestRefine || null;
```

**3. Update System Prompt** (line ~422)
Add context awareness instructions:
```javascript
// Add to system prompt:
CONVERSATION CONTEXT:
${conversationName ? `Conversation with: ${conversationName}` : 'No active conversation selected'}

${recentMessages.length > 0 ? `
Recent messages (last ${recentMessages.length}):
${recentMessages.map(m => `${m.sender === 'me' ? 'User' : conversationName || 'Other'}: "${m.text}"`).join('\n')}
` : ''}

${analyzer ? `
Local analyzer detected:
- Pattern: ${analyzer.communicationPattern}
- State of mind: ${analyzer.stateOfMind}
- Likely reaction: ${analyzer.likelyRecipientReaction}
- Best move: ${analyzer.bestCommunicationMove}
- Risk: ${analyzer.risk}
${analyzer.needsAIHelp ? '- Complex situation (needs deeper help)' : ''}
` : ''}

${latestRefine ? `
User already used Refine:
- Mode: ${latestRefine.mode}
- Suggestion: ${latestRefine.bestMove || latestRefine.quickRead || ''}
${latestRefine.rewrite ? `- Rewrite: "${latestRefine.rewrite}"` : ''}
` : ''}

IMPORTANT:
- Use conversation context when relevant
- Don't repeat what analyzer/refine already said
- If recent messages show conflict, acknowledge it
- If talking to a manager, adjust to workplace context
- Give practical next steps, not generic advice
```

---

## Expected Improvements

### Scenario 1: Context-Aware Response
**Before**:
- User: "How should I respond?"
- Coach: "Try using I-statements and be clear."

**After**:
- User: "How should I respond?"
- Coach: "Alex just said they didn't mean to ignore you. Don't lead with 'you always' because that'll make them defensive. Try: 'I felt left out when plans changed without a heads-up. Can we talk about what happened?'"

### Scenario 2: Building on Analyzer
**Before**:
- Draft: "You always ignore me"
- User asks Coach: "Make this better"
- Coach: Generic rewrite advice

**After**:
- Draft: "You always ignore me"
- Analyzer detected: blame-heavy pattern
- Coach: "The analyzer caught that this sounds like blame. Drop 'always' and name the specific moment instead. Try: 'I felt ignored when you didn't reply to my text earlier. Can we talk about it?'"

### Scenario 3: Building on Refine
**Before**:
- User taps Refine → gets suggestion
- Then asks Coach: "What else?"
- Coach doesn't know what Refine said

**After**:
- Refine suggested: "This is about broken trust. Ask for honesty."
- User asks Coach: "What else?"
- Coach: "Refine caught the trust issue. Beyond asking for honesty, you also need to decide if you want space first or to talk right away. If you want space: 'I need time to process this, but I do want to talk tomorrow.' If you want to talk now: 'I'm hurt and I need to understand what happened before we can move forward.'"

---

## Risks & Mitigation

### Risk 1: Huge payload size
**Mitigation**: Limit recent messages to last 8 (6-10 range)

### Risk 2: Backend fails if context missing
**Mitigation**: Use optional chaining, default to current behavior if no context

### Risk 3: Coach repeats analyzer guidance
**Mitigation**: System prompt instructs not to repeat what analyzer already said

### Risk 4: Exposing analyzer metadata to user
**Mitigation**: Only send structured fields, frontend never shows raw analyzer to user

### Risk 5: Breaking existing coach flow
**Mitigation**: Make context optional, backward compatible

---

## Acceptance Criteria

1. ✅ Selected conversation + user asks "How should I respond?" → Coach references recent messages
2. ✅ Draft with "You always ignore me" + user asks "Make this better" → Coach addresses blame pattern
3. ✅ Draft "I feel ignored" + user asks "What should I say?" → Coach gives hurt-focused examples
4. ✅ Recent conflict messages, no draft → Coach infers from messages
5. ✅ No selected conversation, only draft → Coach still works
6. ✅ No draft, no messages → Coach gives general advice
7. ✅ Refine used before Coach → Coach can reference refine result
8. ✅ Chat/Journal/Insights still work

---

## Files to Change

1. **chat.js**:
   - Add `latestRefineResult` variable
   - Store refine result in `refineCurrentDraft()`
   - Create `buildCoachContext()` helper
   - Update `askCoach()` to send context

2. **server.js**:
   - Update `/api/analyze-intensity` request parsing
   - Extract context fields
   - Update system prompt with context awareness
   - Maintain backward compatibility

---

## Implementation Order

1. ✅ Audit (complete)
2. ⬜ Frontend: Add latestRefineResult storage
3. ⬜ Frontend: Create buildCoachContext() helper
4. ⬜ Frontend: Update askCoach() to send context
5. ⬜ Backend: Update request parsing
6. ⬜ Backend: Update system prompt
7. ⬜ Test all 8 acceptance scenarios

---

**Status**: Audit complete, ready for implementation
