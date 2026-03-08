# Replit Prompt: Save as Agent — Ask Pandora CTA + Modal

## Context

The backend is fully built:
- `POST /api/workspaces/:id/chat/extract-agent` — extracts goal, questions, skills,
  schedule, delivery from a conversation. Returns pre-filled modal data.
- `POST /api/workspaces/:id/agents-v2` — creates an Agent. Already accepts `goal`,
  `standing_questions`, `created_from`, `seed_conversation_id`.
- The `SaveAsAgentModal` component already exists from T008 but currently opens
  with manually entered data. This prompt wires it to the extraction endpoint.

This prompt builds three things:
1. **Trigger detection** — logic inside the Ask Pandora chat that decides when to
   show the CTA banner
2. **CTA banner component** — the persistent footer that appears in the chat pane
3. **Wiring** — call `extract-agent`, pass result into `SaveAsAgentModal`, handle
   the save flow end-to-end

---

## Before You Start

Scan these files first:

1. **The Ask Pandora chat component** — find where the chat message list renders.
   It may be in `client/src/pages/ask-pandora.tsx`, `client/src/components/chat/`,
   or similar. Find:
   - Where messages are stored in state or fetched
   - Where the conversation_id is available
   - Where the message input renders (you're adding a banner above or below it)

2. **`SaveAsAgentModal`** — find its current props interface. It was built in T008.
   You need to know exactly what props it accepts today so you can pass the
   extraction result into it correctly.

3. **How TanStack Query is used** in adjacent chat components — use the same
   `useQuery` / `useMutation` pattern already established. Don't introduce a new
   fetching approach.

4. **The workspace context** — how is `workspaceId` accessed in the chat page?
   Hook, context, URL param? Use the same pattern.

5. **Tailwind + shadcn/ui conventions** — look at 2–3 existing components to
   understand the dark theme color tokens being used (background, border, text
   colors). Match them exactly. Do not introduce new color values.

---

## Task 1: Trigger Detection Hook

Create `client/src/hooks/useSaveAsAgentTrigger.ts`

```typescript
import { useMemo } from 'react';

interface ChatMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  skill_id?: string;
  metadata?: Record<string, any>;
}

interface TriggerState {
  shouldShow: boolean;
  reason: 'too_short' | 'no_skills' | 'already_saved' | 'dismissed' | 'eligible';
}

/**
 * Determines whether the "Save as Agent" CTA should be shown.
 *
 * Conditions to show (ALL must be true):
 *   1. 5 or more user turns in the conversation
 *   2. At least 1 skill was invoked (detectable from messages)
 *   3. Not already saved (no agent linked to this conversation_id)
 *   4. User has not dismissed the banner in this session
 *
 * Skill detection mirrors the server-side logic:
 *   - message.skill_id present
 *   - message.metadata?.skill_id present
 *   - message.metadata?.skills_used array present
 *   - message.role === 'tool' (tool response messages)
 */
export function useSaveAsAgentTrigger(
  messages: ChatMessage[],
  conversationId: string | undefined,
  dismissed: boolean,
  alreadySaved: boolean,
): TriggerState {
  return useMemo(() => {
    if (dismissed)    return { shouldShow: false, reason: 'dismissed' };
    if (alreadySaved) return { shouldShow: false, reason: 'already_saved' };

    const userTurns = messages.filter(m => m.role === 'user').length;
    if (userTurns < 5) return { shouldShow: false, reason: 'too_short' };

    const hasSkill = messages.some(m => {
      if (m.skill_id) return true;
      if (m.role === 'tool') return true;
      const meta = m.metadata ?? {};
      if (meta.skill_id) return true;
      if (Array.isArray(meta.skills_used) && meta.skills_used.length > 0) return true;
      if (Array.isArray(meta.skill_evidence_used) && meta.skill_evidence_used.length > 0) return true;
      return false;
    });

    if (!hasSkill) return { shouldShow: false, reason: 'no_skills' };

    return { shouldShow: true, reason: 'eligible' };
  }, [messages, dismissed, alreadySaved]);
}
```

---

## Task 2: CTA Banner Component

Create `client/src/components/chat/SaveAsAgentBanner.tsx`

This renders as a persistent footer inside the chat pane — above the message
input, below the message list. It appears when `shouldShow` is true and stays
visible until dismissed or saved.

```tsx
interface SaveAsAgentBannerProps {
  suggestedName?: string;       // Shown before extraction — may be undefined initially
  isLoading: boolean;           // True while extract-agent call is in flight
  onSave: () => void;           // Opens the modal (after extraction is done)
  onDismiss: () => void;
}
```

**Visual spec:**

```
┌─────────────────────────────────────────────────────────────────┐
│  💡  Looks like a Weekly Pipeline Review                        │
│      Save this as a recurring Agent?                            │
│                              [Save as Agent →]   [×]           │
└─────────────────────────────────────────────────────────────────┘
```

- Background: one step lighter than the chat pane background (surfaceRaised)
- Left border: 3px solid teal accent
- The suggested name is shown if available, otherwise show generic copy
- `[Save as Agent →]` button: teal/accent colored, small/compact
- `[×]` dismiss: icon button, muted color
- Loading state: button shows a spinner, text says "Analyzing…"
- Animate in: slide up from bottom, 200ms ease-out
- The banner does NOT block the message input — it sits between the message
  list and the input area

**Implementation notes:**
- Use `cn()` for conditional classes (already used throughout the codebase)
- Use shadcn `Button` component for the CTA (check what's already imported nearby)
- Keep the component under 80 lines — it's a simple banner, not a complex widget
- No external dependencies beyond what's already in the project

---

## Task 3: Extraction State Management

In the Ask Pandora chat page/component, add this state and mutation alongside
the existing chat state:

```typescript
// State
const [bannerDismissed, setBannerDismissed] = useState(false);
const [alreadySaved, setAlreadySaved] = useState(false);
const [extractionResult, setExtractionResult] = useState<ExtractionResult | null>(null);
const [modalOpen, setModalOpen] = useState(false);

// Trigger detection
const { shouldShow } = useSaveAsAgentTrigger(
  messages,
  conversationId,
  bannerDismissed,
  alreadySaved,
);

// Extraction mutation — called when user clicks "Save as Agent →"
const extractMutation = useMutation({
  mutationFn: async () => {
    const res = await fetch(
      `/api/workspaces/${workspaceId}/chat/extract-agent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: conversationId }),
      }
    );
    if (!res.ok) throw new Error('Extraction failed');
    return res.json();
  },
  onSuccess: (data) => {
    setExtractionResult(data);
    setModalOpen(true);
  },
  onError: () => {
    // Don't block the user — open the modal with empty defaults
    setExtractionResult(null);
    setModalOpen(true);
  },
});

// Handler for the banner CTA click
const handleSaveClick = () => {
  extractMutation.mutate();
};

// Handler for successful save from modal
const handleAgentSaved = (agentId: string) => {
  setModalOpen(false);
  setAlreadySaved(true);
  // Optional: show a brief toast — "Agent saved. View it in Agents →"
  // Use whatever toast/notification pattern exists in the codebase
};
```

---

## Task 4: Wire ExtractionResult into SaveAsAgentModal

The `SaveAsAgentModal` from T008 currently accepts some props. You need to
extend it to also accept the extraction result and pre-fill fields from it.

**Find the current `SaveAsAgentModal` props interface and ADD these fields:**

```typescript
// Add to SaveAsAgentModalProps:
extractionResult?: {
  suggested_name: string;
  goal: string;
  standing_questions: string[];
  detected_skills: string[];
  suggested_schedule: {
    cron: string;
    label: string;
  };
  suggested_delivery: {
    format: 'slack' | 'email' | 'command_center';
    channel?: string;
  };
  confidence: 'high' | 'medium' | 'low';
} | null;

seedConversationId?: string;   // Passed through to the POST body
onSaved?: (agentId: string) => void;
```

**Inside the modal, when `extractionResult` is provided, pre-fill:**

```typescript
// Use useEffect or direct defaultValues — whichever the modal already uses
// for form state initialization:

const defaultName     = extractionResult?.suggested_name ?? '';
const defaultGoal     = extractionResult?.goal ?? '';
const defaultQuestions = extractionResult?.standing_questions ?? [];
const defaultScheduleLabel = extractionResult?.suggested_schedule?.label ?? 'Every Monday at 8 AM';
const defaultDelivery = extractionResult?.suggested_delivery ?? { format: 'slack' };
```

**The POST body when saving must include:**

```typescript
{
  name: formValues.name,
  goal: formValues.goal,
  standing_questions: formValues.questions,
  skills: extractionResult?.detected_skills ?? [],
  schedule: { cron: resolvedCron },
  deliverable: { format: formValues.deliveryFormat, channel: formValues.channel },
  created_from: 'conversation',
  seed_conversation_id: seedConversationId,
}
```

**Skills field in the modal (read-only when from extraction):**

Show the detected skills as read-only chips — they cannot be changed in this
modal. Add a small note: "Skills from your conversation. Edit after saving."

If `extractionResult` is null (extraction failed or modal opened without
extraction), fall back to the existing empty/default state — the user fills
everything manually.

---

## Task 5: Render the Banner in the Chat Pane

In the Ask Pandora chat component, add the banner and modal into the JSX:

```tsx
{/* Inside the chat pane layout, between message list and input: */}

{shouldShow && (
  <SaveAsAgentBanner
    suggestedName={extractionResult?.suggested_name}
    isLoading={extractMutation.isPending}
    onSave={handleSaveClick}
    onDismiss={() => setBannerDismissed(true)}
  />
)}

{/* Modal — render outside the scroll container: */}
<SaveAsAgentModal
  open={modalOpen}
  onOpenChange={setModalOpen}
  extractionResult={extractionResult}
  seedConversationId={conversationId}
  onSaved={handleAgentSaved}
/>
```

**Layout constraint:** The banner must not cause the message input to shift or
jump when it appears. Use a fixed-height reservation or animate in a way that
doesn't reflow the input. The safest approach: add the banner slot to the layout
unconditionally with `visibility: hidden` when not shown, so the input position
never changes.

---

## Task 6: Post-Save Toast

After a successful save, show a brief success message with a navigation link.
Use whatever toast/notification component already exists in the codebase
(check for `useToast`, `toast()`, or a similar pattern):

```
✓ Agent saved  ·  View "Weekly Pipeline Review" →
```

Clicking "View..." navigates to `/workspaces/${workspaceId}/agents/${agentId}`.
The link should open in the same tab (not a new tab).

---

## Task 7: Confidence Badge in Modal

When `extractionResult?.confidence === 'low'`, show a subtle warning in the modal:

```
⚠  Low confidence extraction — review fields before saving.
```

- Small, muted warning below the modal title
- Only show for 'low' confidence — do not show for 'high' or 'medium'
- Color: yellow/warning, not red (it's advisory, not blocking)

When confidence is 'high', optionally show a small green "✓ Auto-detected" chip
next to the modal title. Keep it subtle — don't over-celebrate automation.

---

## Acceptance Criteria

Test each of these manually before marking complete:

1. **Banner does not appear** on a fresh conversation with 0 messages.

2. **Banner does not appear** after 6 user messages if no skill was invoked.

3. **Banner appears** after 5+ user turns + at least 1 skill invocation. Verify
   the suggested name in the banner text matches what the endpoint returns.

4. **Dismiss works** — clicking `[×]` hides the banner for the rest of the session.
   Refreshing the page resets dismissed state (session-only, not persisted).

5. **Click "Save as Agent →"** — button enters loading state, extract-agent endpoint
   is called, modal opens pre-filled with name/goal/questions/schedule.

6. **Skills are read-only chips** in the modal when opened from extraction.

7. **Saving from modal** creates an agent with `created_from: 'conversation'` and
   `seed_conversation_id` set. Verify in the DB or via the agent detail page.

8. **After save**: banner changes to show success state (or disappears), toast
   appears with link to agent detail, `alreadySaved` is true so banner cannot
   re-trigger.

9. **Extraction failure** (mock a 500 from extract-agent): modal still opens
   with empty defaults — user can fill manually. No crash, no blocking error.

10. **Low confidence**: modal shows the yellow advisory warning.

---

## What NOT to Build

- Do NOT persist `bannerDismissed` to localStorage or the DB — session-only is
  correct. Users will see the CTA again in their next conversation if applicable.

- Do NOT add a "preview" step before the modal — the extraction result IS the
  preview. One click → modal → save.

- Do NOT make skills editable in this modal — that's the Agent Builder's job.
  If the user wants different skills, they edit the Agent after saving.

- Do NOT add a "Start a conversation" link from the Agents list page yet — that
  is a separate piece of work. This prompt is purely the chat → agent direction.

- Do NOT build the Agent detail page changes (goal header, run history diff) —
  those are separate Replit tasks from the spec.
