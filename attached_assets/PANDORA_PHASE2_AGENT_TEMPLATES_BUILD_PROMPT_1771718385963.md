# Phase 2: Agent Templates + Builder Parameters — Build Prompt

## Context

Phase 1 (Editorial Synthesis Engine) is complete and verified. The following files were built:

- `server/agents/editorial-synthesizer.ts` (253 lines) — Single Claude call for holistic briefing synthesis with editorial decisions
- `server/agents/evidence-gatherer.ts` (166 lines) — Smart caching with staleness thresholds, triggers fresh skill runs when needed
- `server/agents/tuning.ts` (135 lines) — Reads feedback-driven tuning pairs from `agent_tuning_pairs` table
- `server/agents/editorial-generator.ts` (287 lines) — Pipeline integration, routes to editorial path when template has `agent_id`
- `server/db/migrations/075_agent_editorial.sql` — Links agents to report templates, stores editorial decisions

The editorial synthesis path produces 3 focused sections with narrative (vs 7 raw sections from the static path). Both paths coexist: `agent_id` on template → editorial, no `agent_id` → static.

**Phase 2 Goal:** The Agent Builder lets users configure *what the agent cares about and who it serves*, not just which skills to run. Users pick from a template gallery, customize audience/focus/schedule, and the editorial synthesizer uses these parameters to shape its output.

---

## Task 2A: Migration — Extend Schema

Create `server/db/migrations/076_agent_templates.sql`:

```sql
-- Extend agents table with briefing config columns
ALTER TABLE agents ADD COLUMN IF NOT EXISTS audience JSONB DEFAULT '{}';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS focus_questions JSONB DEFAULT '[]';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS data_window JSONB DEFAULT '{"primary": "current_week", "comparison": "previous_period"}';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS output_formats JSONB DEFAULT '["slack"]';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS event_config JSONB;  -- null for cron-based agents

-- Agent templates table (pre-built starting points)
CREATE TABLE IF NOT EXISTS agent_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  category TEXT DEFAULT 'briefing',       -- 'briefing', 'monitoring', 'analysis'
  defaults JSONB NOT NULL,                -- Full AgentBriefingConfig
  prep_agent JSONB,                       -- Optional prep agent config
  is_system BOOLEAN DEFAULT true,         -- System templates vs user-created
  workspace_id INTEGER REFERENCES workspaces(id), -- null = system template
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed the 5 system templates (see Task 2B for data)
-- INSERT INTO agent_templates ... (done in seed script, not migration)
```

**Important:** Check the current `agents` table schema first. The columns `audience`, `focus_questions`, `data_window`, `output_formats`, and `event_config` must not conflict with any existing columns. The `agents` table already has columns like `skills` (JSONB array), `schedule` (JSONB), etc. from prior migrations. Run `\d agents` to verify before writing the migration.

---

## Task 2B: Agent Template Definitions

Create `server/agents/agent-templates.ts`:

This file exports the 5 pre-built agent templates and a seed function to insert them into the `agent_templates` table.

```typescript
export interface AgentBriefingConfig {
  // WHO is this for?
  audience: {
    role: string;              // "VP Sales", "CRO", "Board of Directors", "Sales Manager"
    detail_preference: 'executive' | 'manager' | 'analyst';
    vocabulary_avoid?: string[];
    vocabulary_prefer?: string[];
  };
  
  // WHAT should the agent focus on?
  focus_questions: string[];
  
  // WHEN does the data window cover?
  data_window: {
    primary: 'current_week' | 'current_month' | 'current_quarter' | 'trailing_30d' | 'trailing_90d' | 'fiscal_year';
    comparison: 'previous_period' | 'same_period_last_year' | 'none';
  };
  
  // WHAT formats should it produce?
  output_formats: ('pdf' | 'docx' | 'pptx' | 'slack' | 'email')[];
  
  // Skills to include
  skills: string[];
  
  // HOW should it be triggered?
  schedule: {
    type: 'cron' | 'event_prep' | 'manual';
    cron?: string;
    prep_days_before?: number;
    event_dates?: string[];
    event_name?: string;
  };
}

export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'briefing' | 'monitoring' | 'analysis';
  defaults: AgentBriefingConfig;
  prep_agent?: {
    skills: string[];
    schedule: { type: 'cron'; cron: string };
  };
}
```

**The 5 templates:**

### 1. Monday Pipeline Briefing
```typescript
{
  id: 'monday-pipeline-operator',
  name: 'Monday Pipeline Briefing',
  description: 'Weekly pipeline health briefing for sales leadership. Leads with what matters most this week.',
  icon: '📊',
  category: 'briefing',
  defaults: {
    skills: ['pipeline-hygiene', 'single-thread-alert', 'pipeline-coverage', 'deal-risk-review', 'forecast-rollup'],
    audience: { role: 'VP Sales', detail_preference: 'manager' },
    focus_questions: [
      'What changed in the pipeline this week?',
      'Which deals need immediate attention and why?',
      'Are we on track for the quarter?',
    ],
    data_window: { primary: 'current_week', comparison: 'previous_period' },
    output_formats: ['pdf', 'slack', 'email'],
    schedule: { type: 'cron', cron: '0 7 * * 1' },  // Monday 7am
  },
  prep_agent: {
    skills: ['pipeline-hygiene', 'single-thread-alert', 'pipeline-coverage', 'deal-risk-review', 'forecast-rollup', 'conversation-intelligence'],
    schedule: { type: 'cron', cron: '0 20 * * 0' },  // Sunday 8pm
  },
}
```

### 2. Forecast Call Prep
```typescript
{
  id: 'forecast-call-prep',
  name: 'Forecast Call Prep',
  description: 'Pre-meeting intelligence brief for forecast calls. Frames everything as distance-to-target.',
  icon: '🎯',
  category: 'briefing',
  defaults: {
    skills: ['forecast-rollup', 'deal-risk-review', 'pipeline-coverage', 'monte-carlo-forecast', 'conversation-intelligence'],
    audience: { role: 'CRO', detail_preference: 'executive' },
    focus_questions: [
      'Will we hit the number this quarter?',
      'What deals could move the forecast up or down?',
      'Where does the rep forecast disagree with the data?',
      'What questions should I ask in the forecast call?',
    ],
    data_window: { primary: 'current_quarter', comparison: 'previous_period' },
    output_formats: ['pdf', 'slack'],
    schedule: { type: 'cron', cron: '0 16 * * 4' },  // Thursday 4pm
  },
}
```

### 3. Friday Recap
```typescript
{
  id: 'friday-recap',
  name: 'Friday Recap',
  description: 'End-of-week retrospective. Compares Monday predictions to Friday actuals.',
  icon: '📋',
  category: 'briefing',
  defaults: {
    skills: ['pipeline-hygiene', 'deal-risk-review', 'forecast-rollup', 'rep-scorecard'],
    audience: { role: 'Sales Manager', detail_preference: 'manager' },
    focus_questions: [
      'What actually happened this week vs what we expected?',
      'Which deals moved forward and which stalled?',
      "Were last Monday's risk flags addressed?",
      'What should we focus on next week?',
    ],
    data_window: { primary: 'current_week', comparison: 'previous_period' },
    output_formats: ['slack', 'email'],
    schedule: { type: 'cron', cron: '0 17 * * 5' },  // Friday 5pm
  },
}
```

### 4. Board Meeting Prep
```typescript
{
  id: 'board-meeting-prep',
  name: 'Board Meeting Prep',
  description: 'Strategic analysis for board meetings. Generates deck, memo, and raw data backup.',
  icon: '🏛️',
  category: 'briefing',
  defaults: {
    skills: ['forecast-rollup', 'pipeline-coverage', 'rep-scorecard', 'icp-discovery', 'conversation-intelligence', 'monte-carlo-forecast'],
    audience: {
      role: 'Board of Directors',
      detail_preference: 'executive',
      vocabulary_avoid: ['MEDDPICC', 'single-thread', 'weighted pipeline coverage', 'ACV'],
      vocabulary_prefer: ['revenue', 'growth', 'market', 'competitive position', 'unit economics'],
    },
    focus_questions: [
      'Are we going to hit the annual number?',
      'Is the sales team sized correctly for the plan?',
      'What is our competitive win rate trend?',
      'How does pipeline generation compare to plan?',
      'What are the top risks to the revenue forecast?',
    ],
    data_window: { primary: 'fiscal_year', comparison: 'same_period_last_year' },
    output_formats: ['pptx', 'pdf', 'docx'],
    schedule: {
      type: 'event_prep',
      prep_days_before: 5,
      event_dates: [],  // User fills in board dates
      event_name: 'Board Meeting',
    },
  },
}
```

### 5. Quarterly Business Review
```typescript
{
  id: 'qbr-strategist',
  name: 'Quarterly Business Review',
  description: 'Comprehensive quarterly analysis with full pipeline, team, and strategy review.',
  icon: '📈',
  category: 'briefing',
  defaults: {
    skills: ['forecast-rollup', 'pipeline-hygiene', 'pipeline-coverage', 'rep-scorecard', 'deal-risk-review', 'icp-discovery', 'conversation-intelligence', 'monte-carlo-forecast', 'data-quality-audit'],
    audience: { role: 'CRO + VP Sales', detail_preference: 'manager' },
    focus_questions: [
      'How did we perform against plan this quarter?',
      'Which segments and reps drove results?',
      'What does the pipeline for next quarter look like?',
      'What operational changes should we make?',
      'Where is data quality hurting our visibility?',
    ],
    data_window: { primary: 'current_quarter', comparison: 'previous_period' },
    output_formats: ['pptx', 'pdf', 'docx'],
    schedule: {
      type: 'event_prep',
      prep_days_before: 7,
      event_dates: [],
      event_name: 'QBR',
    },
  },
}
```

**Seed function:** Export `seedAgentTemplates(db)` that upserts all 5 templates into the `agent_templates` table. Use `ON CONFLICT (id) DO UPDATE` so it's idempotent. Call it from the migration runner or startup.

---

## Task 2C: Wire Audience + Focus Questions into Editorial Synthesizer

Update `server/agents/editorial-synthesizer.ts` to use the new agent config fields.

Currently, the editorial synthesis prompt uses a generic system prompt. Now it should read from the agent's `audience`, `focus_questions`, and `data_window` columns and inject them into the prompt.

**Changes to the synthesis prompt:**

```
SYSTEM: You are the {agent.role} for {workspace.name}.
Your goal: {agent.goal}

AUDIENCE:
Role: {agent.audience.role}
Detail level: {agent.audience.detail_preference}
{if vocabulary_avoid: "Avoid these terms: " + vocabulary_avoid.join(', ')}
{if vocabulary_prefer: "Prefer these terms: " + vocabulary_prefer.join(', ')}

FOCUS QUESTIONS (the reader wants these answered):
{focus_questions.map((q, i) => `${i+1}. ${q}`).join('\n')}

DATA WINDOW: {data_window.primary} compared to {data_window.comparison}

TUNING (learned from previous feedback):
{tuningPairs formatted as instructions}

EVIDENCE:
{each skill's latest evidence, summarized to key findings}

INSTRUCTIONS:
1. Read all evidence. Your primary job is answering the focus questions.
2. Decide which sections to include based on what the evidence supports.
3. Adjust depth and vocabulary for the audience.
4. Write an opening narrative that frames the briefing for a {audience.role}.
5. Output editorial decisions and section content as structured JSON.
```

**What to change in `editorial-synthesizer.ts`:**

1. Update the `EditorialInput` interface (or its actual equivalent in code) to include `audience`, `focus_questions`, `data_window` from the agent record
2. If the agent has no `audience` set (backward compat), use the defaults: `{ role: 'Revenue Operations', detail_preference: 'analyst' }`
3. If the agent has no `focus_questions` set, omit that section from the prompt
4. The `data_window` should inform evidence gathering (Task 2D) but for now just include it as context in the prompt

**Test:** Run the editorial synthesizer for the same workspace with two different audience configs:
- `{ role: 'VP Sales', detail_preference: 'manager' }` — should produce concise, action-oriented output
- `{ role: 'Board of Directors', detail_preference: 'executive', vocabulary_avoid: ['MEDDPICC', 'single-thread'] }` — should produce strategic, jargon-free output

Both should use the same underlying evidence but produce different editorial output.

---

## Task 2D: Agent Templates API Endpoints

Add endpoints to the existing routes file (check `server/routes.ts` or `server/routes/` directory):

### GET /api/workspaces/:workspaceId/agent-templates

Returns all available templates (system templates + workspace-created templates).

```typescript
// Response:
{
  templates: AgentTemplate[]  // All 5 system templates + any workspace-custom ones
}
```

No auth beyond workspace membership. Templates are read-only for system templates.

### POST /api/workspaces/:workspaceId/agents/from-template

Creates a new agent from a template, optionally with overrides.

```typescript
// Request:
{
  template_id: string;          // e.g. 'monday-pipeline-operator'
  overrides?: {
    name?: string;              // Custom name
    audience?: Partial<AudienceConfig>;
    focus_questions?: string[];
    data_window?: DataWindowConfig;
    output_formats?: string[];
    schedule?: ScheduleConfig;
    skills?: string[];          // Override skill list
  };
}

// Response:
{
  agent: Agent                  // The created agent with all fields populated
}
```

**Logic:**
1. Look up template by `template_id`
2. Deep-merge `template.defaults` with `overrides`
3. Create a new agent row with the merged config
4. If template has `prep_agent`, note it in the response but don't auto-create (prep agent creation is a follow-up action)
5. Return the created agent

### PUT /api/workspaces/:workspaceId/agents/:agentId

Update the existing agent update endpoint to accept the new columns:
- `audience` (JSONB)
- `focus_questions` (JSONB array)
- `data_window` (JSONB)
- `output_formats` (JSONB array)
- `event_config` (JSONB, nullable)

Ensure partial updates work — sending just `{ focus_questions: [...] }` should not wipe `audience`.

---

## Task 2E: Agent Builder UI — Template Gallery

Update the Agent Builder page (find the existing component — likely in `client/src/pages/` or `client/src/components/`) to add a template selection step.

### Template Gallery (Step 0 — shown before the builder)

When user clicks "+ New Agent" or navigates to Agent Builder without an existing agent:

1. Show a gallery of template cards in a grid layout (2-3 columns)
2. Each card shows: icon, name, description, skill count, audience role
3. Last card is "Blank Agent" (start from scratch)
4. Clicking a template card loads the builder with that template's defaults pre-filled
5. Clicking "Blank Agent" loads the builder empty

```tsx
// Pseudocode for template gallery
function TemplateGallery({ onSelect }: { onSelect: (template: AgentTemplate | null) => void }) {
  const { data: templates } = useQuery({
    queryKey: ['agent-templates', workspaceId],
    queryFn: () => fetch(`/api/workspaces/${workspaceId}/agent-templates`).then(r => r.json()),
  });

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
      {templates?.map(t => (
        <Card key={t.id} onClick={() => onSelect(t)} className="cursor-pointer hover:border-primary">
          <div className="text-2xl">{t.icon}</div>
          <h3>{t.name}</h3>
          <p className="text-muted-foreground text-sm">{t.description}</p>
          <div className="flex gap-2 mt-2">
            <Badge>{t.defaults.audience.role}</Badge>
            <Badge variant="outline">{t.defaults.skills.length} skills</Badge>
          </div>
        </Card>
      ))}
      <Card onClick={() => onSelect(null)} className="cursor-pointer hover:border-primary border-dashed">
        <div className="text-2xl">➕</div>
        <h3>Blank Agent</h3>
        <p className="text-muted-foreground text-sm">Start from scratch</p>
      </Card>
    </div>
  );
}
```

---

## Task 2F: Agent Builder UI — New Parameter Tabs

The existing Agent Builder likely has tabs or sections for Skills, Schedule, and Delivery. Add these new tabs/sections:

### 1. Audience Tab

```
Role:           [Dropdown: VP Sales | CRO | Board of Directors | Sales Manager | Custom...]
                [If Custom: free text input]

Detail Level:   [Dropdown: Executive (high-level) | Manager (actionable) | Analyst (detailed)]

Vocabulary:
  Avoid:        [Tag input — add terms like "MEDDPICC", "single-thread"]
  Prefer:       [Tag input — add terms like "revenue", "attainment"]
```

### 2. Focus Questions Tab

```
Questions this agent should answer:

  1. [Text input: "What changed in the pipeline this week?"]         [×]
  2. [Text input: "Which deals need immediate attention and why?"]    [×]
  3. [Text input: "Are we on track for the quarter?"]                [×]
  
  [+ Add question]
```

Editable list. User can add, remove, reorder (drag handle). Max 8 questions. These go directly into the editorial synthesis prompt.

### 3. Data Window Tab (or section within Schedule)

```
Primary Window:    [Dropdown: This Week | This Month | This Quarter | Trailing 30d | Trailing 90d | Fiscal Year]
Compare Against:   [Dropdown: Previous Period | Same Period Last Year | No Comparison]
```

### 4. Event Prep Mode (conditional, within Schedule)

When schedule type = `event_prep`:

```
Event Name:        [Text input: "Board Meeting"]
Prep Window:       [Number input: 5] days before each event
Event Dates:       [Date picker — add multiple dates]
                   📅 March 15, 2026  [×]
                   📅 June 15, 2026   [×]
                   [+ Add date]
                   
Next run: March 10, 2026 (5 days before Board Meeting)
```

### 5. Template Selector (at top of builder when editing)

If the agent was created from a template, show a small badge: "Based on Monday Pipeline Briefing" with a "Reset to template defaults" link.

---

## Task 2G: Wire Agent Config to Generation Pipeline

When a report/briefing is generated through the editorial path, the new agent config fields must flow through to the editorial synthesizer.

**In `server/agents/editorial-generator.ts` (or wherever the editorial path is triggered):**

1. Read the agent record including the new columns: `audience`, `focus_questions`, `data_window`, `output_formats`, `event_config`
2. Pass `audience` and `focus_questions` into the `EditorialInput` for the synthesizer
3. Use `data_window` to inform the evidence gatherer about what time range to query (this may require changes to evidence-gatherer.ts to accept a date range parameter)
4. Use `output_formats` to determine which renderers to invoke after synthesis

**Backward compatibility:** If an agent has empty/null values for the new columns, use sensible defaults:
- `audience`: `{ role: 'Revenue Operations', detail_preference: 'analyst' }`
- `focus_questions`: `[]` (omit from prompt)
- `data_window`: `{ primary: 'current_week', comparison: 'previous_period' }`
- `output_formats`: read from the report template's existing format config

---

## Verification Checklist

Run these checks after building:

1. **Migration runs clean** — `076_agent_templates.sql` executes without errors, existing agents unaffected
2. **Templates seeded** — `GET /api/workspaces/:id/agent-templates` returns all 5 system templates
3. **Create from template** — `POST /api/workspaces/:id/agents/from-template` with `template_id: 'monday-pipeline-operator'` creates an agent with all defaults populated
4. **Override on create** — Same endpoint with `overrides: { audience: { role: 'CRO' } }` creates agent with CRO audience but other defaults from template
5. **Update agent** — `PUT /api/workspaces/:id/agents/:id` with `{ focus_questions: ['New question'] }` updates just that field
6. **Audience flows to synthesis** — Generate a briefing with an agent that has `audience.role: 'Board of Directors'` and `vocabulary_avoid: ['MEDDPICC']`. Verify the output does NOT contain "MEDDPICC" and reads like a board-level document.
7. **Focus questions answered** — Generate a briefing with specific focus questions. Verify the output addresses each question (the editorial synthesizer should try to answer every focus question if evidence supports it).
8. **Template gallery renders** — Navigate to Agent Builder, see all 5 template cards + blank option
9. **Template populates builder** — Click "Board Meeting Prep" template, verify builder fields are populated with board-specific defaults (executive detail, vocabulary preferences, event prep schedule, pptx+pdf+docx formats)
10. **Existing agents unaffected** — Agents created before this migration continue to work. Their new columns are null/default and the editorial synthesizer uses fallback defaults.

---

## What This Does NOT Change

- The editorial-synthesizer.ts core logic (single Claude call, editorial decisions) — only the prompt gets richer
- The evidence-gatherer.ts caching/staleness logic
- The renderer pipeline (PDF/DOCX/PPTX/Slack/email)
- The report viewer or delivery channels
- The static section-generator.ts fallback path
- The skills framework or individual skill implementations
- The existing agent CRUD endpoints (just extended, not replaced)

---

## File Summary

| Action | File | Purpose |
|--------|------|---------|
| CREATE | `server/db/migrations/076_agent_templates.sql` | Schema extension + templates table |
| CREATE | `server/agents/agent-templates.ts` | Template definitions + seed function |
| MODIFY | `server/agents/editorial-synthesizer.ts` | Inject audience, focus_questions, data_window into prompt |
| MODIFY | `server/agents/editorial-generator.ts` | Read new agent columns, pass to synthesizer |
| MODIFY | `server/routes/agents.ts` (or equivalent) | Add template endpoints + update agent CRUD |
| MODIFY | Agent Builder UI component | Add template gallery + audience/focus/data window/event tabs |
| MODIFY | Agent service/storage layer | Handle new columns in agent CRUD |
