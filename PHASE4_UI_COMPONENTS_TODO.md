# Phase 4: Feedback UI Components - Implementation Guide

## Backend Complete ✅

The following backend components are now implemented:

1. **Migration** - `migrations/079_agent_feedback.sql`
   - `agent_feedback` table with signals, ratings, comments
   - Indexes for fast lookups

2. **Feedback Processor** - `server/agents/feedback-processor.ts`
   - Converts feedback signals to tuning pairs
   - Enforces 15-pair cap per agent
   - Handles all signal types (too_detailed, wrong_lead, good_insight, etc.)

3. **API Routes** - `server/routes/agent-feedback.ts`
   - POST `/:workspaceId/agents/:agentId/feedback` - Submit feedback
   - GET `/:workspaceId/agents/:agentId/feedback` - List feedback history
   - GET `/:workspaceId/agents/:agentId/tuning` - List tuning pairs
   - DELETE `/:workspaceId/agents/:agentId/tuning/:key` - Remove tuning pair
   - GET `/:workspaceId/generations/:generationId/feedback-summary` - Feedback state

4. **Server Integration** - `server/index.ts`
   - Routes registered on workspaceApiRouter

---

## Frontend Components Needed

### 1. SectionFeedback Component

**Location:** Create `client/src/components/reports/SectionFeedback.tsx`

**Purpose:** Feedback bar shown at the bottom of each section in the report viewer

**Props:**
```typescript
interface SectionFeedbackProps {
  workspaceId: string;
  agentId: string;
  generationId: string;
  sectionId: string;
  existingFeedback?: { signal: string; comment?: string };
}
```

**Features:**
- Quick reactions: 👍 👎 💬 buttons
- Expandable panel with radio options:
  - Wrong emphasis — focus on something else
  - Too detailed — just give me the headline
  - Too brief — I need more context
  - Wrong data — a number is incorrect
  - Missing information I expected
  - Great insight — keep doing this
- Optional comment textarea
- Submit button that calls POST `/api/workspaces/:workspaceId/agents/:agentId/feedback`
- Show submitted state if feedback already exists

**API Integration:**
```typescript
const submitMutation = useMutation({
  mutationFn: (data) => fetch(
    `/api/workspaces/${workspaceId}/agents/${agentId}/feedback`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        generation_id: generationId,
        feedback_type: 'section',
        section_id: sectionId,
        signal: data.signal,
        comment: data.comment,
      }),
    }
  ).then(r => r.json()),
});
```

---

### 2. OverallBriefingFeedback Component

**Location:** Create `client/src/components/reports/OverallBriefingFeedback.tsx`

**Purpose:** Overall feedback panel at the bottom of the report viewer

**Props:**
```typescript
interface OverallBriefingFeedbackProps {
  workspaceId: string;
  agentId: string;
  generationId: string;
}
```

**Features:**
- Star rating (1-5 stars)
- Editorial feedback chips:
  - Good structure
  - Wrong lead section
  - Wrong section order
  - Wrong tone
- Conditional comment textarea for editorial signals
- Submit button

**API Integration:**
```typescript
// For star rating
submitMutation.mutate({
  generation_id: generationId,
  feedback_type: 'overall',
  signal: 'useful', // or 'not_useful' based on rating
  rating: rating,
});

// For editorial feedback
submitMutation.mutate({
  generation_id: generationId,
  feedback_type: 'editorial',
  signal: editorialSignal, // 'wrong_lead', 'wrong_order', etc.
  comment: comment,
});
```

---

### 3. LearnedPreferences Component

**Location:** Create `client/src/components/agents/LearnedPreferences.tsx`

**Purpose:** Show active tuning pairs in the Agent Builder

**Props:**
```typescript
interface LearnedPreferencesProps {
  workspaceId: string;
  agentId: string;
}
```

**Features:**
- Header showing count: "12/15 active"
- Description text explaining what learned preferences are
- List of tuning pairs with:
  - Instruction text
  - Confidence percentage
  - Date added (relative time)
  - Delete button (✕)
- Empty state: "No preferences yet. Give feedback on a briefing to start teaching the agent."

**API Integration:**
```typescript
// Load tuning pairs
const { data } = useQuery({
  queryKey: ['agent-tuning', workspaceId, agentId],
  queryFn: () => fetch(
    `/api/workspaces/${workspaceId}/agents/${agentId}/tuning`
  ).then(r => r.json()),
});

// Delete tuning pair
const deleteMutation = useMutation({
  mutationFn: (key: string) => fetch(
    `/api/workspaces/${workspaceId}/agents/${agentId}/tuning/${encodeURIComponent(key)}`,
    { method: 'DELETE' }
  ),
  onSuccess: () => queryClient.invalidateQueries(['agent-tuning']),
});
```

---

### 4. Report Viewer Integration

**Location:** Modify existing Report Viewer (likely `client/src/pages/ReportViewer.tsx` or similar)

**Changes Needed:**

1. **Load feedback summary on mount:**
```typescript
const { data: feedbackSummary } = useQuery({
  queryKey: ['feedback-summary', generationId],
  queryFn: () => fetch(
    `/api/workspaces/${workspaceId}/generations/${generationId}/feedback-summary`
  ).then(r => r.json()),
  enabled: !!agentId, // Only for agent-generated reports
});
```

2. **Add SectionFeedback to each section:**
```tsx
{sections.map(section => (
  <div key={section.section_id}>
    {/* Existing section rendering */}
    <SectionContent section={section} />

    {/* NEW: Add feedback if this is an agent-generated report */}
    {agentId && (
      <SectionFeedback
        workspaceId={workspaceId}
        agentId={agentId}
        generationId={generationId}
        sectionId={section.section_id}
        existingFeedback={feedbackSummary?.sections[section.section_id]}
      />
    )}
  </div>
))}
```

3. **Add OverallBriefingFeedback at bottom:**
```tsx
{agentId && (
  <OverallBriefingFeedback
    workspaceId={workspaceId}
    agentId={agentId}
    generationId={generationId}
  />
)}
```

4. **Optional: Feedback indicators**
- Sections with positive feedback: show subtle green checkmark
- Sections with negative feedback: show amber indicator
- Use `feedbackSummary.sections[sectionId]` to determine state

---

### 5. Agent Builder Integration

**Location:** Modify `client/src/pages/AgentBuilder.tsx`

**Changes Needed:**

Add LearnedPreferences section at the bottom of the agent edit form (after existing tabs):

```tsx
{selectedAgent && (
  <>
    {/* Existing tabs: Audience, Focus, Skills, Schedule, Delivery */}

    {/* NEW: Learned Preferences section */}
    <div className="mt-8 pt-8 border-t">
      <LearnedPreferences
        workspaceId={workspaceId}
        agentId={selectedAgent.id}
      />
    </div>
  </>
)}
```

---

### 6. Optional: Agent Cards Enhancement

**Location:** Agents list page (wherever agent cards are rendered)

**Enhancement:** Show feedback stats on each agent card

```tsx
<div className="agent-card">
  <h3>{agent.name}</h3>
  <p>Status: {agent.is_active ? 'Active' : 'Inactive'}</p>
  <p>Last run: {formatDate(agent.last_run_at)}</p>

  {/* NEW: Feedback stats */}
  {agent.feedback_stats && (
    <p className="text-sm text-muted-foreground">
      Feedback: {agent.feedback_stats.total} total
      {agent.feedback_stats.avg_rating && ` · ⭐${agent.feedback_stats.avg_rating.toFixed(1)} avg`}
      {agent.feedback_stats.active_tuning > 0 && ` · ${agent.feedback_stats.active_tuning} preferences`}
    </p>
  )}
</div>
```

**Backend change needed (optional):**
Modify agents list endpoint to join feedback stats. Add to `server/routes/agents.ts`:

```sql
SELECT
  a.*,
  COUNT(DISTINCT af.id) as feedback_count,
  AVG(af.rating) as avg_rating,
  (SELECT COUNT(*) FROM context_layer cl
   WHERE cl.workspace_id = a.workspace_id
     AND cl.category = 'agent_tuning'
     AND cl.key LIKE CONCAT(a.id::text, ':%')) as active_tuning_count
FROM agents a
LEFT JOIN agent_feedback af ON af.agent_id = a.id
WHERE a.workspace_id = $1
GROUP BY a.id
```

---

## Signal Labels for UI

Use these labels in the radio groups:

```typescript
const signalLabels = {
  // Section signals
  useful: 'Helpful',
  not_useful: 'Not helpful',
  good_insight: 'Great insight — keep doing this',
  wrong_emphasis: 'Wrong emphasis — focus on something else',
  too_detailed: 'Too detailed — just give me the headline',
  too_brief: 'Too brief — I need more context',
  wrong_data: 'Wrong data — a number is incorrect',
  missing_context: 'Missing information I expected',

  // Editorial signals
  wrong_lead: 'Led with wrong section',
  wrong_order: 'Wrong section order',
  wrong_tone: 'Wrong tone for audience',
  good_structure: 'Good structure and flow',

  // Overall signals
  keep_doing_this: 'Keep this approach',
};
```

---

## Testing Checklist

### Backend (already complete)
- ✅ POST feedback endpoint works
- ✅ Feedback converts to tuning pairs
- ✅ Tuning cap enforced at 15
- ✅ GET tuning pairs works
- ✅ DELETE tuning pair works
- ✅ GET feedback summary works

### Frontend (to be implemented)
- [ ] SectionFeedback component renders
- [ ] Quick reactions (👍👎💬) work
- [ ] Expanded panel with radio options works
- [ ] Submit feedback succeeds
- [ ] Already-submitted state shows correctly
- [ ] OverallBriefingFeedback renders
- [ ] Star rating works
- [ ] Editorial chips work
- [ ] LearnedPreferences shows in Agent Builder
- [ ] Tuning pair deletion works
- [ ] Feedback indicators show on sections
- [ ] Non-agent reports don't show feedback UI

---

## API Endpoints Summary

All endpoints are prefixed with `/api/workspaces/:workspaceId`

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/agents/:agentId/feedback` | Submit feedback |
| GET | `/agents/:agentId/feedback` | List feedback history |
| GET | `/agents/:agentId/tuning` | List tuning pairs |
| DELETE | `/agents/:agentId/tuning/:key` | Remove tuning pair |
| GET | `/generations/:generationId/feedback-summary` | Get feedback state for viewer |

---

## Next Steps

1. **Implement the 3 core UI components** (SectionFeedback, OverallBriefingFeedback, LearnedPreferences)
2. **Integrate into Report Viewer** (add to sections + bottom)
3. **Integrate into Agent Builder** (add LearnedPreferences section)
4. **Test the complete loop:**
   - Generate briefing
   - Submit feedback ("too detailed")
   - Verify tuning pair created
   - Generate again
   - Verify section is shorter
5. **Optional:** Add feedback stats to agent cards

Total frontend work: ~300-400 lines of React/TypeScript across 3 components + 2 integration points.
