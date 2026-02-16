# Pandora Feedback & Workspace Learning System — Build Prompt

## For: Replit
## Depends on: Conversational Agent (just built), ConfigSuggestion infrastructure (Prompt 3), Command Center frontend
## Effort estimate: 15-20 hours across 5 parts

---

## Context

Pandora's conversational agent is production-ready (verified: flat token cost, heuristic routing, thread anchors, unified orchestrator). The workspace config system already has `ConfigSuggestion` storage, CRUD API, and accept/dismiss endpoints.

What's missing: **the system doesn't learn from user interactions.** When a user says "that deal is paused for legal review," that context disappears. When they dismiss 15 findings every Monday, Pandora doesn't notice the pattern. When they thumbs-up a response, Pandora doesn't know its tone is calibrated right.

This prompt builds the feedback layer that turns every user interaction into a learning signal. The workspace accumulates the operator's *judgment* about their data — that's the moat no competitor can replicate by connecting to the same CRM.

---

## Before Starting

Read these to understand the existing systems this builds on:

1. **Conversational agent** — The chat orchestrator, intent classification, conversation state management, `POST /chat` and `GET /chat/:threadId/history` endpoints. Understand the response shape.
2. **ConfigSuggestion infrastructure** — `server/config/config-suggestions.ts` (if it exists). Understand `addConfigSuggestion()`, `getPendingSuggestions()`, `resolveSuggestion()`. If this file doesn't exist, you'll create it as part of this build.
3. **Findings table** — `findings` table schema. Understand how findings are created, resolved, and queried.
4. **Conversation state** — How `conversation_state` tracks focus, entities_discussed, turn_count. The feedback handler will extend this.
5. **Workspace config** — `context_layer` table, `WorkspaceConfigLoader`. Feedback patterns generate ConfigSuggestions that modify workspace config.
6. **Settings page** — The existing settings UI. The Workspace Learning dashboard will be a new tab/section here.

---

## Part 1: Database Migration — workspace_annotations Table

Create a new migration. This is the core storage for everything users tell Pandora that the CRM doesn't know.

```sql
-- Workspace annotations: entity-level knowledge from user interactions
CREATE TABLE IF NOT EXISTS workspace_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  
  -- What entity is this about?
  entity_type TEXT NOT NULL,          -- 'deal', 'account', 'contact', 'rep', 'workspace'
  entity_id UUID,                     -- NULL for workspace-level annotations
  entity_name TEXT,                   -- Denormalized for display: "Acme Corp", "Sara Chen"
  
  -- What's the annotation?
  annotation_type TEXT NOT NULL,      -- 'context', 'confirmation', 'dismissal', 'preference', 'correction'
  content TEXT NOT NULL,              -- The actual annotation text
  
  -- Where did it come from?
  source TEXT NOT NULL,               -- 'chat', 'slack_thread', 'slack_dm', 'ui_button', 'api'
  source_thread_id TEXT,              -- Chat/Slack thread that produced this
  source_message_id TEXT,             -- Specific message, for traceability
  
  -- Who created it?
  created_by TEXT,                    -- User email or identifier
  
  -- Lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,            -- NULL = never expires. Default: created_at + 90 days
  resolved_at TIMESTAMPTZ,           -- When annotation was superseded or resolved
  
  -- For corrections: what finding/response was corrected?
  references_finding_id UUID,        -- If correcting a specific finding
  references_skill_run_id UUID       -- If correcting a skill output
);

-- Fast lookups by entity (dossier assembly pulls these)
CREATE INDEX idx_annotations_entity ON workspace_annotations(workspace_id, entity_type, entity_id)
  WHERE resolved_at IS NULL AND (expires_at IS NULL OR expires_at > NOW());

-- Fast lookups by workspace (learning dashboard counts)
CREATE INDEX idx_annotations_workspace ON workspace_annotations(workspace_id, annotation_type, created_at DESC);

-- Cleanup: find expired annotations
CREATE INDEX idx_annotations_expiry ON workspace_annotations(expires_at)
  WHERE expires_at IS NOT NULL AND resolved_at IS NULL;
```

Also create a feedback_signals table for lightweight quality signals (thumbs up/down) that don't warrant a full annotation:

```sql
-- Lightweight feedback signals on responses and findings
CREATE TABLE IF NOT EXISTS feedback_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  
  -- What is being rated?
  target_type TEXT NOT NULL,          -- 'chat_response', 'finding', 'skill_report', 'slack_message'
  target_id TEXT NOT NULL,            -- Message ID, finding ID, or skill_run_id
  
  -- The signal
  signal_type TEXT NOT NULL,          -- 'thumbs_up', 'thumbs_down', 'dismiss', 'confirm', 'correct'
  signal_metadata JSONB DEFAULT '{}', -- Additional context: { reason: "too verbose", correction: "..." }
  
  -- Context
  source TEXT NOT NULL,               -- 'chat', 'slack', 'command_center'
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_feedback_workspace ON feedback_signals(workspace_id, signal_type, created_at DESC);
CREATE INDEX idx_feedback_target ON feedback_signals(target_type, target_id);
```

### Expiry defaults

Set `expires_at` based on annotation type and entity:
- Deal-scoped context annotations: expire when deal closes, or 90 days, whichever is sooner
- Account-scoped context: 90 days
- Workspace-level corrections: 180 days
- Confirmations: 90 days (they validate a point-in-time assessment)
- Preferences: never expire (until explicitly changed)

---

## Part 2: Feedback Detection in Chat

The conversational agent's orchestrator needs a **post-response feedback handler**. This runs after Claude responds, analyzing the user's NEXT message to detect feedback signals. It also wires thumbs up/down buttons into every chat response.

### 2a. Response Shape Enhancement

Every chat response should include feedback affordances. Update the `POST /chat` response to include:

```typescript
interface ChatResponse {
  // Existing fields
  threadId: string;
  message: string;
  tokensUsed: number;
  
  // NEW: Feedback context
  responseId: string;            // Unique ID for this response (for feedback targeting)
  feedbackEnabled: boolean;      // Always true for LLM-generated responses, false for heuristic
  entitiesMentioned: {           // Entities in this response (for annotation targeting)
    deals: { id: string; name: string }[];
    accounts: { id: string; name: string }[];
    reps: { id: string; name: string }[];
  };
}
```

### 2b. Feedback API Endpoints

```
POST /api/workspaces/:id/feedback
  Body: {
    targetType: 'chat_response' | 'finding' | 'skill_report',
    targetId: string,           // responseId, finding ID, or skill_run_id
    signalType: 'thumbs_up' | 'thumbs_down' | 'dismiss',
    metadata?: {
      reason?: string,          // Optional: "too verbose", "wrong deal", "not relevant"
    }
  }
  
  Returns: { id: string, recorded: true }
  
  Side effects:
  - Stores in feedback_signals table
  - If thumbs_down on a chat_response: logs for voice tuning review
  - If dismiss on a finding: checks dismiss velocity (see Part 4)


POST /api/workspaces/:id/annotations
  Body: {
    entityType: 'deal' | 'account' | 'contact' | 'rep' | 'workspace',
    entityId?: string,          // Required unless entityType is 'workspace'
    entityName?: string,
    annotationType: 'context' | 'correction',
    content: string,
    source: 'chat' | 'slack' | 'command_center',
    sourceThreadId?: string,
    referencesFindingId?: string,
    referencesSkillRunId?: string,
  }
  
  Returns: { id: string, expiresAt: string }
  
  Side effects:
  - Stores in workspace_annotations table with calculated expires_at
  - If annotationType is 'correction' and referencesFindingId is set:
    mark that finding as having user context


GET /api/workspaces/:id/annotations
  Query params: entityType, entityId, annotationType, active (default: true)
  Returns: Paginated annotations, sorted by created_at DESC
  Note: active=true filters out expired and resolved annotations


GET /api/workspaces/:id/annotations/entity/:entityType/:entityId
  Returns: All active annotations for a specific entity
  Used by: Dossier assemblers to include user context


GET /api/workspaces/:id/feedback/summary
  Query params: since (ISO date, default 30 days), signalType
  Returns: {
    totalSignals: number,
    byType: {
      thumbs_up: number,
      thumbs_down: number,
      dismiss: number,
      confirm: number,
      correct: number,
    },
    byWeek: [{ week: string, count: number }],  // For learning rate chart
    activeAnnotations: number,
    pendingConfigSuggestions: number,
  }
```

### 2c. Implicit Feedback Detection in Chat

Add a feedback detection step to the chat orchestrator. After the user sends a message, BEFORE running the normal intent classification, check if the message is feedback on the previous response.

```typescript
// In the chat orchestrator, before intent classification:

function detectFeedback(message: string, previousResponse: ChatResponse | null): FeedbackSignal | null {
  if (!previousResponse) return null;
  
  const lower = message.toLowerCase().trim();
  
  // Confirmation patterns
  const confirmPatterns = [
    /^(that'?s? right|exactly|correct|yes|yeah|yep|confirmed|makes sense|good point)/,
    /^(spot on|nailed it|bingo|precisely)/,
  ];
  
  // Correction patterns  
  const correctionPatterns = [
    /^(actually|no[,.]|that'?s? (wrong|not right|incorrect)|not really)/,
    /^(well[,.]|but |however[,.])/,
    /the (deal|account|rep) is (actually|really)/,
    /you'?re? (missing|wrong|off) (about|on|regarding)/,
  ];
  
  // Dismissal patterns (for findings/alerts specifically)
  const dismissalPatterns = [
    /^(i know|already aware|seen this|old news|not important)/,
    /^(skip|next|move on|don'?t care)/,
  ];
  
  for (const pattern of confirmPatterns) {
    if (pattern.test(lower)) {
      return { type: 'confirm', confidence: 0.8 };
    }
  }
  
  for (const pattern of correctionPatterns) {
    if (pattern.test(lower)) {
      return { type: 'correct', confidence: 0.7 };
    }
  }
  
  for (const pattern of dismissalPatterns) {
    if (pattern.test(lower)) {
      return { type: 'dismiss', confidence: 0.6 };
    }
  }
  
  return null; // Not feedback — proceed with normal intent classification
}
```

**When feedback is detected:**

1. **Confirmation** → Store as a `feedback_signal` with type `confirm`. If the previous response contained a specific finding or analysis assertion, record which finding was confirmed. Don't consume a turn — acknowledge briefly ("Noted.") and let the user continue.

2. **Correction** → This IS a normal turn, but with special handling. The orchestrator should:
   - Process the correction as a normal message (Claude will understand the correction)
   - ALSO extract the correction as a `workspace_annotation`:
     - Parse which entity the correction applies to (from conversation state focus)
     - Store annotation_type = 'correction'
     - Set source_thread_id from current thread
   - This is the one signal type that needs LLM help — use the existing DeepSeek classification to extract: `{ entity_type, entity_id, correction_content }`

3. **Dismissal** → Store as `feedback_signal` with type `dismiss`. Acknowledge briefly and move on.

**Important: Feedback detection is heuristic-first (zero tokens). Only corrections need LLM help to extract the entity and content.**

---

## Part 3: Wire Annotations into Dossiers and Skills

Annotations are only valuable if the system uses them. Two integration points:

### 3a. Dossier Assembly

Update `assembleDealDossier()` and `assembleAccountDossier()` to include annotations:

```typescript
// In deal dossier assembly, add:
const annotations = await db.query(`
  SELECT id, annotation_type, content, source, created_at, created_by, expires_at
  FROM workspace_annotations
  WHERE workspace_id = $1
    AND entity_type = 'deal'
    AND entity_id = $2
    AND resolved_at IS NULL
    AND (expires_at IS NULL OR expires_at > NOW())
  ORDER BY created_at DESC
  LIMIT 10
`, [workspaceId, dealId]);

// Add to dossier response:
dossier.annotations = annotations.rows;
dossier.hasUserContext = annotations.rows.length > 0;
```

Same for account dossiers. The frontend should display annotations in a distinct "Team Notes" or "Context" section of the dossier — visually distinct from computed data so users know this came from humans, not algorithms.

### 3b. Skill Synthesis Prompts

When a skill generates output that mentions an entity with annotations, include them in the Claude synthesis prompt:

```typescript
// In the skill's synthesize step, for each entity being discussed:
const entityAnnotations = await db.query(`
  SELECT content, annotation_type, created_at, created_by
  FROM workspace_annotations
  WHERE workspace_id = $1
    AND entity_type = $2
    AND entity_id = $3
    AND resolved_at IS NULL
    AND (expires_at IS NULL OR expires_at > NOW())
  ORDER BY created_at DESC
  LIMIT 5
`, [workspaceId, entityType, entityId]);

// Append to synthesis prompt:
if (entityAnnotations.rows.length > 0) {
  prompt += '\n\nUSER-PROVIDED CONTEXT (from team members, treat as authoritative):\n';
  for (const ann of entityAnnotations.rows) {
    prompt += `- ${ann.content} (${ann.created_by}, ${new Date(ann.created_at).toLocaleDateString()})\n`;
  }
  prompt += 'Incorporate this context into your analysis. If it contradicts CRM data, note the discrepancy but trust the user context.\n';
}
```

This is how "that deal is paused for legal review" changes Pandora's output from "CRITICAL: Deal stale for 45 days, no activity" to "Deal flagged as stale (45 days), though team notes indicate it's paused for legal review (Sara, Feb 15). Monitor for when legal review concludes."

### 3c. Chat Orchestrator Context

When the chat loads context for a response about a specific entity, include its annotations. This is similar to 3b but for chat responses:

```typescript
// In the chat data strategy, when fetching entity context:
if (conversationState.focus?.entityId) {
  const annotations = await getActiveAnnotations(
    workspaceId, 
    conversationState.focus.type, 
    conversationState.focus.entityId
  );
  // Include in Claude's context window
  dataPayload.userAnnotations = annotations;
}
```

---

## Part 4: Dismiss Velocity → ConfigSuggestion Pipeline

This is the feedback loop that turns user behavior into workspace configuration changes.

### 4a. Dismiss Velocity Tracker

Create `server/feedback/dismiss-velocity.ts`:

After every finding dismissal, check if the user is exhibiting a pattern:

```typescript
export async function checkDismissVelocity(
  workspaceId: string,
  userId: string
): Promise<void> {
  // Count dismissals in the last 7 days, grouped by severity
  const recentDismissals = await db.query(`
    SELECT 
      f.signal_metadata->>'severity' as severity,
      COUNT(*) as dismiss_count,
      COUNT(*) FILTER (WHERE f.created_at > NOW() - INTERVAL '7 days') as last_week
    FROM feedback_signals f
    WHERE f.workspace_id = $1
      AND f.created_by = $2
      AND f.signal_type = 'dismiss'
      AND f.target_type = 'finding'
      AND f.created_at > NOW() - INTERVAL '30 days'
    GROUP BY 1
  `, [workspaceId, userId]);

  for (const row of recentDismissals.rows) {
    // If dismissing >10 findings of a severity per week, suggest raising threshold
    if (row.last_week > 10) {
      const severity = row.severity || 'info';
      
      // Check if we already suggested this
      const existing = await getPendingSuggestions(workspaceId);
      const alreadySuggested = existing.some(s => 
        s.path === `alert_threshold.${userId}` && s.status === 'pending'
      );
      
      if (!alreadySuggested) {
        await addConfigSuggestion(workspaceId, {
          source_skill: 'feedback-system',
          source_run_id: 'dismiss-velocity',
          section: 'voice',
          path: `alert_threshold`,
          type: 'adjust',
          message: `${userId} dismissed ${row.last_week} ${severity}-level findings last week. Consider raising the alert threshold to reduce noise.`,
          evidence: `${row.dismiss_count} total dismissals in 30 days, ${row.last_week} in the last week. Severity: ${severity}.`,
          confidence: row.last_week > 20 ? 0.85 : 0.7,
          suggested_value: severity === 'info' ? 'notable' : 'critical',
          current_value: severity,
        });
      }
    }
  }
}

// Also check for pattern-specific dismissals
export async function checkCategoryDismissals(
  workspaceId: string
): Promise<void> {
  // If a specific finding category is consistently dismissed across all users
  const categoryDismissals = await db.query(`
    SELECT 
      f.signal_metadata->>'category' as category,
      COUNT(*) as dismiss_count,
      COUNT(DISTINCT f.created_by) as unique_users
    FROM feedback_signals f
    WHERE f.workspace_id = $1
      AND f.signal_type = 'dismiss'
      AND f.target_type = 'finding'
      AND f.created_at > NOW() - INTERVAL '30 days'
    GROUP BY 1
    HAVING COUNT(*) > 15
  `, [workspaceId]);

  for (const row of categoryDismissals.rows) {
    if (!row.category) continue;
    
    // Map finding category to config path
    const configMapping: Record<string, { section: string; path: string; suggestion: string }> = {
      'stale_deal': { 
        section: 'thresholds', 
        path: 'thresholds.stale_deal_days', 
        suggestion: 'Stale deal threshold may be too aggressive' 
      },
      'single_threaded': { 
        section: 'thresholds', 
        path: 'thresholds.minimum_contacts_per_deal', 
        suggestion: 'Single-thread alert threshold may need adjustment' 
      },
      'missing_field': { 
        section: 'thresholds', 
        path: 'thresholds.required_fields', 
        suggestion: 'Required field list may include non-essential fields' 
      },
      'coverage_gap': { 
        section: 'thresholds', 
        path: 'thresholds.coverage_target', 
        suggestion: 'Coverage target may be too high for this workspace' 
      },
    };
    
    const mapping = configMapping[row.category];
    if (mapping) {
      await addConfigSuggestion(workspaceId, {
        source_skill: 'feedback-system',
        source_run_id: 'category-dismissals',
        section: mapping.section,
        path: mapping.path,
        type: 'alert',
        message: `${row.dismiss_count} "${row.category}" findings dismissed by ${row.unique_users} user(s) in 30 days. ${mapping.suggestion}.`,
        evidence: `Category: ${row.category}. Dismissals: ${row.dismiss_count}. Unique users: ${row.unique_users}. Period: last 30 days.`,
        confidence: row.unique_users > 1 ? 0.8 : 0.65,
      });
    }
  }
}
```

### 4b. Wire Dismiss Velocity Into Finding Dismissal Flow

Whenever a finding is dismissed (via chat, Slack button, or Command Center UI):

```typescript
// After recording the dismiss signal:
await checkDismissVelocity(workspaceId, userId);

// Run category check less frequently (daily or weekly via cron, not per-dismiss)
// But can run on-demand when accumulated dismissals cross a threshold
```

### 4c. Confirmation → Config Confidence Boost

When users confirm analysis results, boost the confidence of the underlying config values:

```typescript
export async function boostConfigConfidence(
  workspaceId: string,
  confirmedEntities: { type: string; id: string }[]
): Promise<void> {
  // When a user confirms an analysis, the config values that
  // produced that analysis gain confidence.
  // 
  // This is lightweight — just update the _meta confidence
  // for config sections the skill relied on.
  //
  // For now, increment a confirmation counter in context_layer:
  
  await db.query(`
    INSERT INTO context_layer (workspace_id, category, key, value, updated_at)
    VALUES ($1, 'feedback', 'confirmation_count', '1'::jsonb, NOW())
    ON CONFLICT (workspace_id, category, key)
    DO UPDATE SET 
      value = (COALESCE(context_layer.value::int, 0) + 1)::text::jsonb,
      updated_at = NOW()
  `, [workspaceId]);
}
```

---

## Part 5: Workspace Learning Dashboard

Add a "Learning" tab to the Settings page. This is how the product owner sees that feedback is accumulating and the system is improving.

### 5a. Dashboard API

```
GET /api/workspaces/:id/learning/summary
  Returns: {
    annotations: {
      active: number,
      byType: { context: N, correction: N, confirmation: N },
      byEntity: { deal: N, account: N, rep: N, workspace: N },
      expiringIn30Days: number,
      recentlyAdded: [                // Last 5 annotations
        { entityName, content, source, createdAt, annotationType }
      ]
    },
    feedbackSignals: {
      last30Days: {
        thumbsUp: number,
        thumbsDown: number,
        dismiss: number,
        confirm: number,
        correct: number,
        total: number,
      },
      byWeek: [                       // For learning rate chart
        { weekStart: string, signals: number }
      ],
    },
    configSuggestions: {
      pending: number,
      accepted: number,
      dismissed: number,
      fromFeedback: number,           // Suggestions generated by feedback patterns
      fromSkills: number,             // Suggestions generated by skill compute
      items: [                        // Pending suggestions
        { id, message, confidence, source_skill, created_at }
      ]
    },
    health: {
      learningRate: 'growing' | 'stable' | 'declining',  // Based on weekly signal trend
      annotationCoverage: number,     // % of entities with at least one annotation
      configConfidence: number,       // Average confidence across config sections
    }
  }
```

### 5b. Frontend Component

In the Settings page, add a "Workspace Learning" section. This can also be a standalone page if navigation allows.

**Layout:**

```
┌─────────────────────────────────────────────────────────────┐
│  Workspace Learning                                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │    12     │  │    47     │  │     6     │  │    2      │   │
│  │ Active    │  │ Signals   │  │ Correct-  │  │ Pending   │   │
│  │Annotations│  │ (30 days) │  │  ions     │  │Suggestions│   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
│                                                              │
│  Learning Rate (last 8 weeks)                                │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  ▁ ▂ ▃ ▄ ▅ ▆ ▇ █  (bar chart, signals per week)   │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  Recent Annotations                                          │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 🏷 Acme Corp (deal) — "Paused for legal review"     │    │
│  │   via chat · Sara · Feb 15 · expires May 16          │    │
│  │                                                       │    │
│  │ 🏷 TechStart (account) — "Evaluating competitors"    │    │
│  │   via Slack · Nate · Feb 14 · expires May 15          │    │
│  │                                                       │    │
│  │ ✓ Pipeline coverage target confirmed as appropriate  │    │
│  │   via chat · Sara · Feb 13                            │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  Config Suggestions from Feedback                            │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ ⚡ Raise stale threshold to 21 days for enterprise    │    │
│  │   Based on: 8 dismissals of 14-day alerts             │    │
│  │   Confidence: 78%                                     │    │
│  │   [Accept]  [Dismiss]                                 │    │
│  │                                                       │    │
│  │ ⚡ Raise alert threshold for sara@acme.com            │    │
│  │   Based on: 12 info-level dismissals/week             │    │
│  │   Confidence: 85%                                     │    │
│  │   [Accept]  [Dismiss]                                 │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  Feedback Breakdown (30 days)                                │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 👍 Thumbs up:     38    ████████████████             │    │
│  │ 👎 Thumbs down:    4    ██                           │    │
│  │ ✓  Confirmed:     47    ████████████████████          │    │
│  │ ✏  Corrected:      6    ███                          │    │
│  │ ✕  Dismissed:     23    ██████████                    │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 5c. Design Guidelines

- Use the existing dark SaaS theme from the Command Center
- Metric cards use the same component as the Command Center home page
- Learning rate chart uses the same chart library as the pipeline chart
- Annotation list items are compact — entity name, content, source, date
- Config suggestion cards include Accept/Dismiss buttons that call existing ConfigSuggestion endpoints
- The "health" indicators (growing/stable/declining) use green/yellow/red dot styling consistent with connector status indicators

---

## Part 6: Annotation Cleanup Cron

Add a daily cron job that expires old annotations:

```typescript
// Run daily at 3 AM
async function cleanupExpiredAnnotations(): Promise<void> {
  const result = await db.query(`
    UPDATE workspace_annotations
    SET resolved_at = NOW()
    WHERE expires_at < NOW()
      AND resolved_at IS NULL
    RETURNING id, workspace_id, entity_type, entity_name, content
  `);
  
  console.log(`[Annotation Cleanup] Expired ${result.rowCount} annotations`);
}

// Also: when a deal is marked closed (won or lost), resolve its annotations
// Wire this into the deal sync pipeline:
async function resolveClosedDealAnnotations(workspaceId: string, dealId: string): Promise<void> {
  await db.query(`
    UPDATE workspace_annotations
    SET resolved_at = NOW()
    WHERE workspace_id = $1
      AND entity_type = 'deal'
      AND entity_id = $2
      AND resolved_at IS NULL
  `, [workspaceId, dealId]);
}
```

---

## Part 7: Thumbs Up/Down in Chat UI

Update the ChatPanel component to show thumbs up/down on every LLM-generated response:

```tsx
// For each assistant message in the chat:
{message.feedbackEnabled && (
  <div className="feedback-buttons">
    <button 
      onClick={() => submitFeedback(message.responseId, 'thumbs_up')}
      className={feedbackGiven === 'thumbs_up' ? 'active' : ''}
      title="Helpful response"
    >
      👍
    </button>
    <button 
      onClick={() => submitFeedback(message.responseId, 'thumbs_down')}
      className={feedbackGiven === 'thumbs_down' ? 'active' : ''}
      title="Not helpful"
    >
      👎
    </button>
  </div>
)}
```

**Design details:**
- Buttons appear on hover (not always visible — reduces clutter)
- After clicking, the selected button stays highlighted, the other fades
- One click per response (clicking thumbs_up then thumbs_down replaces the signal)
- Heuristic responses (zero-token SQL answers) don't show feedback buttons — they're data, not opinions
- For thumbs_down, optionally show a small text input: "What was wrong?" (but don't require it)

---

## Part 8: Finding Dismiss/Confirm in Command Center

On the Insights Feed and on finding cards throughout the Command Center, add dismiss and confirm actions:

```tsx
// On each finding card:
<div className="finding-actions">
  <button onClick={() => confirmFinding(finding.id)} title="Confirm this is accurate">
    ✓ Confirm
  </button>
  <button onClick={() => dismissFinding(finding.id)} title="Dismiss — not relevant">
    ✕ Dismiss
  </button>
</div>
```

When dismissed:
1. Record `feedback_signal` with type 'dismiss', target_type 'finding', target_id finding.id
2. Include finding severity and category in signal_metadata
3. Visually fade the finding (don't remove — keep it visible but muted)
4. Call `checkDismissVelocity()` in background

When confirmed:
1. Record `feedback_signal` with type 'confirm', target_type 'finding', target_id finding.id
2. Visually mark with a checkmark
3. Call `boostConfigConfidence()` in background

---

## Testing Checklist

### Annotation lifecycle:
```
1. Open chat on a deal detail page
2. Ask "What's happening with this deal?"
3. Reply: "Actually, this deal is paused because they're waiting on board approval"
4. Verify: workspace_annotations table has a new row with entity_type='deal', annotation_type='correction'
5. Close chat, reload deal dossier
6. Verify: dossier includes the annotation in a "Team Notes" section
7. Run pipeline-hygiene skill
8. Verify: if the deal is flagged as stale, the output mentions "Note: team reports deal is paused for board approval"
```

### Feedback signals:
```
1. Ask a question in chat, get an LLM response
2. Click thumbs up → verify feedback_signals table has new row
3. Click thumbs down → verify it replaces the thumbs_up row
4. Type "that's right" → verify feedback detection creates a 'confirm' signal
5. Type "actually that's wrong, the deal closed last week" → verify both a 'correct' signal AND a workspace_annotation are created
```

### Dismiss velocity:
```
1. Dismiss 12+ findings in the Command Center
2. Verify: checkDismissVelocity runs and checks the pattern
3. If threshold met: verify a ConfigSuggestion is created
4. Check Settings > Workspace Learning > Config Suggestions from Feedback
5. Accept the suggestion → verify config updates
```

### Learning dashboard:
```
1. Navigate to Settings > Workspace Learning
2. Verify: metrics show correct counts from above test actions
3. Verify: learning rate chart shows signals per week
4. Verify: recent annotations list shows the deal annotation from step 1
5. Verify: config suggestions show with Accept/Dismiss buttons
6. Accept a suggestion → verify it disappears from pending, config updates
```

### Expiry:
```
1. Create an annotation with a short expires_at (set manually for testing)
2. Run the cleanup cron
3. Verify: annotation is marked resolved_at
4. Verify: it no longer appears in dossier or annotation queries
```

---

## DO NOT:

- Make feedback detection blocking — it runs async, failures don't break chat
- Store personally identifiable information beyond email in annotations
- Auto-apply ConfigSuggestions — always require human accept/dismiss
- Show feedback buttons on heuristic (zero-token) responses — they're data lookups, not opinions
- Remove dismissed findings from the database — just mark them in feedback_signals
- Generate ConfigSuggestions from fewer than 10 signals — need statistical significance
- Expire confirmations immediately — they validate a point-in-time assessment
- Add LLM calls for feedback detection — heuristic patterns only (except corrections which need entity extraction)
- Send annotations to external services — they contain user judgment and business context
- Build a complex annotation editor UI — simple text input is enough for v1
