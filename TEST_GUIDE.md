# Stage Recommendations Chat Integration - Testing Guide

## Quick Start

### Automated Tests

```bash
# Run the automated test script
WORKSPACE_ID=your-workspace-id AUTH_TOKEN=your-token ./test-stage-recommendations-chat.sh
```

Or without database/API tests:

```bash
WORKSPACE_ID=your-workspace-id ./test-stage-recommendations-chat.sh
```

---

## Manual UI Testing

### Prerequisites

1. Start the development server:
   ```bash
   npm run dev
   ```

2. Log into the app and navigate to **Ask Pandora** chat

3. Ensure you have deals in your workspace with stage mismatch signals

---

### Test Case 1: Basic Stage Recommendation Display

**Goal:** Verify that stage recommendations appear in chat responses

**Steps:**
1. Ask a deal-specific question in Ask Pandora:
   - "What's the status of the Acme Corp deal?"
   - "Show me deals that might be stuck"
   - "Which deals need stage updates?"

2. **Expected Result:**
   - Chat response appears with answer text
   - Below the answer, a **"Stage Recommendations"** section appears
   - One or more StageRecCard components are rendered

3. **Verify StageRecCard displays:**
   - ✅ Severity indicator (red/orange border and icon)
   - ✅ Recommendation title (e.g., "Update Stage: Discovery → Demo Scheduled")
   - ✅ Confidence percentage badge
   - ✅ Current stage → Recommended stage transition
   - ✅ Summary text explaining the recommendation
   - ✅ "Update in CRM" button (glowing accent color)
   - ✅ "Dismiss" button
   - ✅ Collapsible "Show evidence" section
   - ✅ Timestamp (e.g., "2m ago")

---

### Test Case 2: Evidence Expansion

**Goal:** Verify evidence section expands correctly

**Steps:**
1. Find a stage recommendation card
2. Click **"Show evidence (N signals)"** button

3. **Expected Result:**
   - Button text changes to "Hide evidence (N signals)"
   - Evidence rows expand below
   - Each evidence row shows:
     - Icon (conversation, stakeholder, activity, timing, or keyword)
     - Label (e.g., "Last activity")
     - Value/description

4. Click **"Hide evidence"** button

5. **Expected Result:**
   - Evidence section collapses

---

### Test Case 3: Execute Stage Update

**Goal:** Test executing a stage recommendation

**Steps:**
1. Find a stage recommendation card
2. Click **"Update in CRM"** button

3. **Expected Result:**
   - Button shows "Updating..." briefly
   - Card transitions to **green success state**:
     - Green border and background
     - Green checkmark icon
     - Text: "Stage updated to [stage] in CRM"
     - Timestamp: "just now"
   - Card remains visible (doesn't disappear)

4. **Verify in CRM:**
   - Open the deal in your CRM (HubSpot/Salesforce)
   - Confirm the stage was actually updated

---

### Test Case 4: Edit Recommended Stage

**Goal:** Test editing the recommended stage before execution

**Steps:**
1. Find a stage recommendation card
2. Find the stage transition row (Current → Recommended)
3. Click the small **edit icon** next to the recommended stage

4. **Expected Result:**
   - Recommended stage becomes an editable text input
   - Input is focused and pre-filled with current recommendation

5. Type a different stage name (e.g., "Proposal Sent")
6. Press **Enter** or click outside the input

7. **Expected Result:**
   - Input becomes a stage pill again with new value
   - "Update in CRM" button still works

8. Click **"Update in CRM"**

9. **Expected Result:**
   - Card shows success with your custom stage name
   - CRM is updated with your custom stage (not the original recommendation)

---

### Test Case 5: Dismiss Recommendation

**Goal:** Test dismissing a stage recommendation

**Steps:**
1. Find a stage recommendation card
2. Click **"Dismiss"** button

3. **Expected Result:**
   - Card transitions to **dismissed state**:
     - Grey/muted colors
     - Reduced opacity (50%)
     - Info icon
     - Text: "Recommendation dismissed"
   - Card remains visible but inactive

4. **Verify persistence:**
   - Refresh the page or navigate away and back
   - Dismissed card should not reappear

---

### Test Case 6: Multiple Recommendations

**Goal:** Test multiple stage recommendations in one response

**Steps:**
1. Ask a question that returns multiple deals (e.g., "Show me all stalled deals")

2. **Expected Result:**
   - Multiple StageRecCard components appear (up to 2 per deal)
   - Each card is for a different action
   - Cards are stacked vertically with proper spacing

3. Test executing one card

4. **Expected Result:**
   - Only that specific card transitions to success state
   - Other cards remain in pending state
   - Can still interact with other cards

---

### Test Case 7: Compact Mode Styling

**Goal:** Verify chat-specific compact styling

**Verify the following in chat (compared to Deal Detail view):**
- ✅ Smaller padding (8px vs 10px margins)
- ✅ Smaller border radius (6-8px vs 10px)
- ✅ Smaller font sizes (11-12px vs 12-13px)
- ✅ Smaller icon sizes (12-14px vs 14px)
- ✅ Smaller action buttons (6px vs 7px padding)
- ✅ Outfit font family throughout (`fonts.sans`)
- ✅ Theme colors match rest of app (check against Deal List badges)

---

### Test Case 8: Theme Consistency

**Goal:** Verify styling matches app theme

**Check the following:**
1. **Colors:**
   - Critical severity: `colors.red`, `colors.redSoft`, `colors.redBorder`
   - Warning severity: `colors.orange`, `colors.orangeSoft`, `colors.orangeBorder`
   - Success state: `colors.green`, `colors.greenSoft`, `colors.greenBorder`
   - Accent button: `colors.accent` with `colors.accentGlow` shadow

2. **Fonts:**
   - All text uses `fonts.sans` (Outfit)
   - Monospace only for timestamps

3. **Consistency with other components:**
   - Compare colors to Deal List action badges
   - Compare layout to Deal Detail High Priority Signals section

---

### Test Case 9: Error Handling

**Goal:** Test behavior when API calls fail

**Steps:**
1. Open browser DevTools → Network tab
2. Find a stage recommendation card
3. Block network requests (or disconnect from server)
4. Click **"Update in CRM"**

5. **Expected Result:**
   - Button shows "Updating..." briefly
   - Alert appears: "Failed to execute: [error message]"
   - Card remains in pending state (doesn't transition to success)

6. Restore network
7. Click **"Update in CRM"** again

8. **Expected Result:**
   - Update succeeds
   - Card transitions to success state

---

### Test Case 10: No Recommendations

**Goal:** Verify behavior when no actions are returned

**Steps:**
1. Ask a deal-specific question about a healthy deal (e.g., "What's the status of [closed-won deal]?")

2. **Expected Result:**
   - Chat response appears normally
   - **No** "Stage Recommendations" section appears
   - No empty cards or placeholder text

---

## Expected Data Flow

```
User asks deal question
    ↓
Pandora Agent processes query with tools
    ↓
Agent extracts cited_records (deal IDs)
    ↓
Agent queries actions table for open stage actions
    ↓
Agent injects inline_actions into response
    ↓
Orchestrator passes inline_actions through
    ↓
Conversation stream emits SSE event: { type: 'inline_actions', items: [...] }
    ↓
useConversationStream receives event
    ↓
state.inlineActions updated
    ↓
ConversationView renders StageRecCard components
    ↓
User clicks "Update in CRM"
    ↓
POST /api/workspaces/:id/actions/:actionId/execute-inline
    ↓
Action execution_status → 'executed'
    ↓
dismissInlineAction removes card from state
```

---

## Troubleshooting

### No recommendations appear

**Check:**
1. Do you have deals with stage mismatch signals?
   ```sql
   SELECT * FROM actions WHERE action_type = 'update_stage' AND execution_status = 'open';
   ```

2. Is your question deal-specific? (Generic questions won't trigger inline actions)

3. Check console for errors in Pandora agent or conversation stream

### Card doesn't render properly

**Check:**
1. Browser console for React errors
2. Verify StageRecCard import in ConversationView.tsx
3. Verify inline_actions format matches InlineAction interface

### Execute/Dismiss don't work

**Check:**
1. Network tab - verify API calls are made
2. Check API endpoint responses
3. Verify workspace ID in API URL
4. Check authentication token

### Styling looks wrong

**Check:**
1. Verify Outfit font is loaded (check Network tab)
2. Verify theme colors in styles/theme.ts
3. Compare to DealList/DealDetail for consistency
4. Check compact prop is set to `true`

---

## Success Criteria

✅ **Integration Complete When:**

1. Stage recommendations appear in Ask Pandora chat for deal-specific questions
2. StageRecCard renders with all fields (title, stages, confidence, evidence, buttons)
3. Compact styling is applied (smaller than Deal Detail version)
4. Outfit font (fonts.sans) used throughout
5. Theme colors match rest of app
6. "Update in CRM" executes action and shows success state
7. "Dismiss" removes recommendation and shows dismissed state
8. Evidence section expands/collapses correctly
9. Edit stage functionality works
10. Multiple recommendations render correctly
11. No recommendations = no empty section displayed
12. Error handling works (shows alert on failure)

---

## Quick Visual Checklist

When you see a stage recommendation in chat, verify:

```
┌─────────────────────────────────────────────────────┐
│ [Icon] Update Stage: Discovery → Demo Scheduled    │ ← Title + transition
│        85% confidence                               │ ← Confidence badge
│                                                     │
│ Current: [Discovery]  →  Recommended: [Demo Sched] │ ← Stage pills + edit
│                                                     │
├─────────────────────────────────────────────────────┤
│ Deal has been in Discovery for 45 days with 3       │ ← Summary
│ stakeholder conversations completed.                │
├─────────────────────────────────────────────────────┤
│ ▶ Show evidence (3 signals)                        │ ← Collapsible evidence
├─────────────────────────────────────────────────────┤
│ [✓ Update in CRM]  [Dismiss]          2m ago      │ ← Actions + timestamp
└─────────────────────────────────────────────────────┘
```

**Colors to verify:**
- Border: Orange or red (warning/critical)
- Background: Gradient from surfaceRaised to surface
- Button: Accent color with glow
- Success: Green border/background after execution
