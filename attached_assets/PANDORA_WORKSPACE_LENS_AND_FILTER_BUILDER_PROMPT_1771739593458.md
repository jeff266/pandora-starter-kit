# Replit Prompt: Workspace Lens + Filter Builder + Scope Injection

## Context

Read these files first:
- `server/tools/filter-resolver.ts` — the FilterResolver that compiles named filters to SQL
- `server/types/workspace-config.ts` — the NamedFilter type definition
- `server/routes/` — find the named filters CRUD API endpoints (GET/POST/PUT/DELETE /api/workspaces/:id/filters)
- `server/skills/tool-definitions.ts` — find the `named_filter` / `named_filters` parameters on query tools
- `server/agents/runtime.ts` — the agent executor (executeAgent function)
- `server/agents/loop-executor.ts` — the loop executor
- `server/skills/runtime.ts` — the skill runtime (executeSkill function)
- The sidebar layout component — find the workspace selector at the top of the sidebar
- The top bar component — find the sticky header with page title

You are building three connected features:
1. **Create Filter UI** — inline filter creation with a visual condition builder and live preview
2. **Agent Scope Injection** — wiring so agent-level scope filters automatically flow into every skill's tool calls
3. **Workspace Lens** — a global filter dropdown that scopes all interactive views, queries, and Ask Pandora

These three features share the same backend infrastructure (the FilterResolver and CRUD API already exist and are tested). You are building the frontend UI and the middleware/runtime wiring.

---

## Part 1: Create Filter UI

### 1A: Add "+ Create Filter" button to Scope Filters tab

In the Agent Builder's Scope Filters tab (the one shown at /agents with the list of checkboxes for Open Pipeline, New Logo Deal, etc.), add a button at the bottom of the filter list:

```
[ + Create Filter ]
```

Style it as a ghost/outline button matching the existing UI pattern — not as prominent as a primary action, but clearly clickable. Place it after the last filter card in the list.

### 1B: Create Filter Modal

When the user taps "+ Create Filter", open a modal (or slide-up sheet on mobile). The modal has these sections:

**Section 1: Filter Identity**

Two fields at the top:

```
Filter Name:    [ Enterprise Deals          ]
Applies to:     [ Deals ▼ ]
Description:    [ Optional description...    ]  (optional, collapsed by default)
```

- Filter Name is required. Auto-generate the slug/ID from the name: "Enterprise Deals" → "enterprise_deals". Show the generated ID in small muted text below the name field: `ID: enterprise_deals`
- "Applies to" is a dropdown with options: Deals, Contacts, Accounts, Conversations. Default to "Deals".
- Description is optional — show it as an expandable "Add description" link, not a visible empty field.

**Section 2: Condition Builder**

This is the core of the filter creation experience. Start with one condition row:

```
┌─────────────────────────────────────────────────────────────┐
│  [ Field ▼ ]  [ Operator ▼ ]  [ Value          ]  [ 🗑 ]  │
└─────────────────────────────────────────────────────────────┘
                    [ + Add Condition ]
```

Each condition row has three parts:

**Field Dropdown:**
- Populate from the actual database schema for the selected object type
- For Deals: amount, stage_normalized, pipeline_name, owner_name, owner_email, close_date, created_at, days_in_current_stage, days_since_last_activity, probability, is_open, contact_count, source, and any custom fields from custom_fields JSONB
- Group fields in the dropdown:
  - "Standard Fields" — amount, stage, pipeline, owner, close_date, etc.
  - "Activity Fields" — days_in_current_stage, days_since_last_activity, last_activity_date
  - "Custom Fields" — dynamically populated from the workspace's deal records (query for distinct JSONB keys in custom_fields)
- For custom fields, the field value should be formatted as `custom_fields->>'field_name'`

**Operator Dropdown:**
- Changes based on the selected field's data type:
  - Number fields (amount, probability, days_*): equals, not equals, greater than, less than, greater than or equal, less than or equal, between, is empty, is not empty
  - Text fields (stage, pipeline, owner, source): equals, not equals, contains, does not contain, is one of, is not one of, is empty, is not empty
  - Date fields (close_date, created_at): before, after, between, is this quarter, is this month, is this year, is last N days, is empty, is not empty
  - Boolean fields (is_open): is true, is false

- Map display labels to FilterOperator values:
  - "equals" → eq
  - "not equals" → neq
  - "greater than" → gt
  - "greater than or equal" → gte
  - "less than" → lt
  - "less than or equal" → lte
  - "contains" → contains
  - "is one of" → in
  - "is not one of" → not_in
  - "is empty" → is_null
  - "is not empty" → is_not_null
  - "between" → between
  - "is true" → is_true
  - "is false" → is_false
  - "is this quarter" → relative_date (with value: { type: 'relative', unit: 'quarters', offset: 0 })
  - "is last N days" → relative_date (with value: { type: 'relative', unit: 'days', offset: -N })

**Value Input:**
- For number fields: numeric input
- For text "equals"/"contains": text input
- For "is one of" / "is not one of": multi-select dropdown. Populate options from actual data — query distinct values for that field in this workspace. For example, for `stage_normalized`, fetch all distinct stage values. For `pipeline_name`, fetch all pipeline names. For `owner_name`, fetch all owner names.
- For "between": two inputs side by side [min] to [max]
- For date operators: date picker
- For "is last N days": numeric input with "days" label
- For boolean operators: no value input needed (operator implies the value)
- For "is empty" / "is not empty": no value input needed

**Multiple Conditions:**
- "+ Add Condition" adds another row below
- Between condition rows, show an AND/OR toggle pill:
  ```
  [ amount ] [ greater than ] [ 100000 ]   [🗑]
                  [ AND ▼ ]
  [ pipeline_name ] [ equals ] [ Enterprise ▼ ] [🗑]
                  [ AND ▼ ]
  [ is_open ] [ is true ]                  [🗑]
  ```
- Tapping the AND/OR pill toggles between AND and OR
- Default is AND
- All conditions at the same level share the same AND/OR operator (this matches the FilterConditionGroup structure)
- The trash icon on each row removes that condition
- Minimum 1 condition — can't delete the last one

**Nested Groups (stretch — skip for v1 if complex):**
- For v1, support only a flat list of conditions with a single AND/OR operator
- Nested groups (AND inside OR) are technically supported by the backend but the UI for nested condition groups is complex. Skip for now.

**Section 3: Preview**

Below the conditions, show a "Preview" button:

```
[ 🔍 Preview Filter ]
```

When tapped:
1. Build the FilterConditionGroup from the current condition rows
2. POST to `/api/workspaces/:id/filters/resolve` with the conditions as an inline filter (not yet saved)
   - OR if the resolve endpoint only accepts filter IDs, temporarily POST to create the filter, then preview, then delete if the user cancels. Better approach: add a preview endpoint that accepts inline conditions:
     ```
     POST /api/workspaces/:id/filters/preview-inline
     Body: { object: "deals", conditions: { operator: "AND", conditions: [...] } }
     ```
   - If this endpoint doesn't exist yet, CREATE IT. It should use the FilterResolver to compile the conditions and run a COUNT + LIMIT 5 sample query against the database.

3. Show the preview results below the button:
   ```
   ┌──────────────────────────────────────────────┐
   │  ✓ 23 deals match this filter                │
   │                                              │
   │  Acme Corp        $250,000   Negotiation     │
   │  Globex Inc       $180,000   Proposal        │
   │  Wayne Ent.       $150,000   Discovery       │
   │  ... and 20 more                             │
   └──────────────────────────────────────────────┘
   ```

4. If 0 records match, show: "⚠️ No records match these conditions. Check your filter values."
5. If there's a SQL error, show: "❌ Filter error: [error message]"

**Section 4: Actions**

Bottom of the modal:

```
[ Cancel ]                    [ Create Filter ]
```

- Cancel closes the modal, discards everything
- "Create Filter" is disabled until:
  - Filter name is non-empty
  - At least one condition has all three parts filled in (field, operator, value)
- On "Create Filter":
  1. POST to `/api/workspaces/:id/filters` with:
     ```json
     {
       "id": "[auto-generated-slug]",
       "label": "[user-entered name]",
       "description": "[optional description]",
       "object": "[selected object type]",
       "conditions": {
         "operator": "[AND or OR based on toggle]",
         "conditions": [
           { "field": "amount", "operator": "gt", "value": 100000 },
           { "field": "pipeline_name", "operator": "eq", "value": "Enterprise" }
         ]
       }
     }
     ```
  2. On success: close the modal, add the new filter to the Scope Filters list, auto-check it (since the user just created it for this agent)
  3. On error: show error message inline in the modal

### 1C: Add Preview Inline Endpoint (if not already present)

Check if a preview endpoint exists that accepts inline conditions (not a saved filter ID). If not, add:

```
POST /api/workspaces/:id/filters/preview-inline
Body: {
  "object": "deals",
  "conditions": { "operator": "AND", "conditions": [...] }
}
Response: {
  "record_count": 23,
  "sample_records": [ { name, amount, stage_normalized, owner_name, close_date }, ... ],  // first 5
  "sql_preview": "SELECT ... WHERE ..."
}
```

Use the FilterResolver to compile the conditions, then run the query scoped to the workspace.

### 1D: Field Options Endpoint

Create an endpoint that returns available fields for the condition builder:

```
GET /api/workspaces/:id/filters/field-options?object=deals
Response: {
  "standard_fields": [
    { "field": "amount", "label": "Amount", "type": "number" },
    { "field": "stage_normalized", "label": "Stage", "type": "text", "values": ["discovery", "proposal", "negotiation", "closed_won", "closed_lost"] },
    { "field": "pipeline_name", "label": "Pipeline", "type": "text", "values": ["Default", "Enterprise", "SMB"] },
    { "field": "owner_name", "label": "Owner", "type": "text", "values": ["Sarah Chen", "Mike Johnson"] },
    { "field": "close_date", "label": "Close Date", "type": "date" },
    { "field": "is_open", "label": "Is Open", "type": "boolean" },
    { "field": "days_since_last_activity", "label": "Days Since Last Activity", "type": "number" },
    ...
  ],
  "custom_fields": [
    { "field": "custom_fields->>'lead_source'", "label": "Lead Source", "type": "text", "values": ["Inbound", "Outbound", "Partner"] },
    ...
  ]
}
```

Implementation:
- Standard fields: hardcoded list based on the deals/contacts/accounts/conversations table schema
- Custom fields: `SELECT DISTINCT jsonb_object_keys(custom_fields) FROM deals WHERE workspace_id = $1 AND custom_fields IS NOT NULL`
- For text fields with "values": `SELECT DISTINCT stage_normalized FROM deals WHERE workspace_id = $1 AND stage_normalized IS NOT NULL ORDER BY stage_normalized` (same pattern for pipeline_name, owner_name, etc.)
- Cap distinct values at 50 per field to prevent huge dropdowns

---

## Part 2: Agent Scope Injection (Runtime Wiring)

This is the critical middleware that makes agent-level scope filters flow into every skill's tool calls. Without this, the Scope Filters tab is cosmetic.

### 2A: Find Where Agents Execute Skills

Look in `server/agents/runtime.ts` for the `executeAgent()` function. There should be a loop where the agent runs each of its configured skills. It likely looks something like:

```typescript
for (const skillId of agent.skills) {
  const result = await skillRuntime.executeSkill(skill, workspaceId, params);
  // ...accumulate evidence...
}
```

Also check `server/agents/loop-executor.ts` — in the loop executor, there's a similar call:

```typescript
const result = await runtime.executeSkill(skill, workspaceId, plan.skill_params || undefined, agent.id, runId);
```

### 2B: Pass Scope Filters from Agent to Skill Runtime

Modify the skill execution call to pass the agent's scope filters:

```typescript
// In runtime.ts executeAgent():
const agentFilters = agent.scope?.named_filters || [];

for (const skillId of agent.skills) {
  const result = await skillRuntime.executeSkill(skill, workspaceId, {
    ...params,
    scope_filters: agentFilters,  // ← NEW: pass agent scope
  });
}

// In loop-executor.ts:
const agentFilters = agent.scope?.named_filters || [];

const result = await runtime.executeSkill(
  skill, workspaceId, 
  { ...(plan.skill_params || {}), scope_filters: agentFilters },  // ← NEW
  agent.id, runId
);
```

### 2C: Inject Scope Filters into Tool Calls Inside Skill Runtime

This is the key wiring. In `server/skills/runtime.ts`, find where the skill runtime wraps tool functions for the Claude tool_use loop. There should be a place where tool definitions are prepared and tool calls are executed.

The runtime needs to intercept every tool call and inject the scope filters:

```typescript
// In the skill runtime, find the tool execution wrapper.
// It likely looks something like:

async function executeToolCall(toolName, toolParams, context) {
  const tool = toolRegistry.get(toolName);
  return tool.execute(toolParams, context);
}

// Modify it to inject scope filters:

async function executeToolCall(toolName, toolParams, context) {
  const tool = toolRegistry.get(toolName);
  
  // Inject scope filters from the execution context
  const scopeFilters = context.scope_filters || [];
  
  if (scopeFilters.length > 0 && isQueryTool(toolName)) {
    // Merge scope filters with any filters the skill already specified
    const existingFilters = toolParams.named_filters || 
                           (toolParams.named_filter ? [toolParams.named_filter] : []);
    toolParams.named_filters = [...new Set([...scopeFilters, ...existingFilters])];
    // Remove the singular form to avoid conflicts
    delete toolParams.named_filter;
  }
  
  return tool.execute(toolParams, context);
}

function isQueryTool(toolName: string): boolean {
  return ['query_deals', 'query_contacts', 'query_accounts', 
          'query_conversations', 'compute_metric'].includes(toolName);
}
```

This is transparent to skills — they call `query_deals({ is_open: true })` and the runtime silently adds `named_filters: ['enterprise_deals']`. The skill never knows about the scope.

### 2D: Ensure Scope Filters Are Stored on Agent

Check that the `agents` or `agents_v2` table and the agent CRUD API accept `scope.named_filters`. The Scope Filters tab in the Agent Builder already lets you check/uncheck filters — verify that:

1. Checking a filter on the Scope Filters tab saves to the agent's `scope.named_filters` array
2. The agent CRUD endpoint (PUT /api/workspaces/:id/agents/:agentId) accepts and persists `scope.named_filters`
3. The agent's config structure has a `scope` field that includes `named_filters: string[]`

If this isn't wired yet, add it:

```sql
-- If the agents table uses a config JSONB column, ensure scope.named_filters is part of it
-- No migration needed if it's JSONB — just update the service code
```

```typescript
// In the agent service, when saving:
await updateAgent(agentId, {
  ...otherFields,
  scope: {
    named_filters: selectedFilterIds,  // ['enterprise_deals', 'closing_this_quarter']
  }
});
```

### 2E: Scheduled Runs vs Manual Runs

Important distinction:
- **Scheduled agent runs** (cron): use the agent's configured `scope.named_filters`. No user session, no lens.
- **Manual "Run Now"**: use the agent's configured `scope.named_filters`. The agent's own config takes precedence.
- **Standalone skill runs** (from Skills page, no agent): no scope filters applied by default. BUT — if Workspace Lens (Part 3) is active, it applies.

---

## Part 3: Workspace Lens (Global Filter Scope)

### 3A: Lens Dropdown in Header

Add a lens selector to the sticky top bar in the main content area. Place it next to the page title, or in the top-right area near any existing controls.

```
┌─────────────────────────────────────────────────────────────────┐
│  Command Center          Viewing: [ All Data ▼ ]    [refresh]  │
└─────────────────────────────────────────────────────────────────┘
```

The dropdown shows:
```
┌─────────────────────────────┐
│  All Data            (none) │  ← default, no filter
│  ─────────────────────────  │
│  Open Pipeline              │  ← from workspace named_filters
│  New Logo Deal      ⚠ unconfirmed │
│  Stale Deal         ⚠ unconfirmed │
│  Closing This Quarter       │
│  At Risk                    │
│  Enterprise Deals           │  ← user-created
│  ─────────────────────────  │
│  + Create Filter            │  ← opens the same Create Filter modal from Part 1
└─────────────────────────────┘
```

Populate the dropdown by calling GET `/api/workspaces/:id/filters` on mount.

Show "⚠ unconfirmed" badge next to filters that have `confirmed: false`.

When a filter is selected:
1. Store the active lens in React context/state (e.g., `LensContext`)
2. Persist to localStorage so it survives page refreshes: `pandora_lens_{workspaceId} = "enterprise_deals"`
3. The dropdown label changes from "All Data" to the filter label
4. Add a subtle visual indicator that a lens is active — e.g., the dropdown gets a colored border or a small badge dot

When "All Data" is selected:
1. Clear the lens from context and localStorage
2. Remove any visual indicator

### 3B: Lens Context Provider

Create a React context that provides the active lens throughout the app:

```typescript
// client/contexts/LensContext.tsx

interface LensContextValue {
  activeLens: string | null;          // filter ID or null
  activeLensLabel: string | null;     // "Enterprise Deals" or null
  setLens: (filterId: string | null) => void;
  lensQueryParam: string;            // "?lens=enterprise_deals" or ""
}

const LensContext = createContext<LensContextValue>({
  activeLens: null,
  activeLensLabel: null,
  setLens: () => {},
  lensQueryParam: '',
});

export function LensProvider({ children, workspaceId }) {
  const [activeLens, setActiveLens] = useState<string | null>(() => {
    return localStorage.getItem(`pandora_lens_${workspaceId}`) || null;
  });
  
  const [activeLensLabel, setActiveLensLabel] = useState<string | null>(null);
  
  // Load filter label
  useEffect(() => {
    if (activeLens) {
      // Fetch filter details to get the label
      fetch(`/api/workspaces/${workspaceId}/filters/${activeLens}`)
        .then(r => r.json())
        .then(filter => setActiveLensLabel(filter.label))
        .catch(() => setActiveLensLabel(activeLens));
    } else {
      setActiveLensLabel(null);
    }
  }, [activeLens]);
  
  const setLens = (filterId: string | null) => {
    setActiveLens(filterId);
    if (filterId) {
      localStorage.setItem(`pandora_lens_${workspaceId}`, filterId);
    } else {
      localStorage.removeItem(`pandora_lens_${workspaceId}`);
    }
  };
  
  const lensQueryParam = activeLens ? `?lens=${activeLens}` : '';
  
  return (
    <LensContext.Provider value={{ activeLens, activeLensLabel, setLens, lensQueryParam }}>
      {children}
    </LensContext.Provider>
  );
}

export const useLens = () => useContext(LensContext);
```

Wrap the app's main layout in this provider so all pages have access.

### 3C: API Middleware for Lens

Create Express middleware that reads the lens from request headers and injects it into the request context:

```typescript
// server/middleware/lens-middleware.ts

export function lensMiddleware(req, res, next) {
  // Check for lens in header or query param
  const lens = req.headers['x-pandora-lens'] || req.query.lens || null;
  
  if (lens && typeof lens === 'string' && lens !== 'null' && lens !== '') {
    req.activeLens = lens;
  } else {
    req.activeLens = null;
  }
  
  next();
}
```

Register this middleware on the Express app BEFORE the API routes:
```typescript
app.use(lensMiddleware);
```

### 3D: Frontend HTTP Client — Send Lens Header

Find the API client or fetch wrapper used throughout the frontend. Add the lens header to every request:

```typescript
// In the API client or fetch wrapper:

import { useLens } from '../contexts/LensContext';

// If using a centralized fetch/axios instance:
function apiClient(url, options = {}) {
  const lens = localStorage.getItem(`pandora_lens_${currentWorkspaceId}`);
  
  const headers = {
    ...options.headers,
    'Content-Type': 'application/json',
  };
  
  if (lens) {
    headers['X-Pandora-Lens'] = lens;
  }
  
  return fetch(url, { ...options, headers });
}
```

If there's an Axios instance or similar HTTP client, add the header in an interceptor:

```typescript
apiClient.interceptors.request.use(config => {
  const lens = localStorage.getItem(`pandora_lens_${currentWorkspaceId}`);
  if (lens) {
    config.headers['X-Pandora-Lens'] = lens;
  }
  return config;
});
```

### 3E: Backend Data Routes — Apply Lens

For all data-serving API routes that return deals, contacts, accounts, or aggregated data, check for the active lens and apply it as a named filter.

**Which routes to modify:**

1. **Deal list / pipeline data endpoints** — `GET /api/workspaces/:id/deals`, `GET /api/workspaces/:id/pipeline/snapshot`, any Command Center data endpoints
2. **Account list endpoints** — `GET /api/workspaces/:id/accounts`
3. **Findings feed** — `GET /api/workspaces/:id/findings` (filter findings to only those related to records matching the lens)
4. **Pipeline metrics** — any endpoint returning pipeline value, coverage, win rate
5. **Scoped analysis** — `POST /api/workspaces/:id/analyze` (Ask Pandora)

**How to apply:**

In each route handler, check `req.activeLens` and pass it to the query:

```typescript
// Example: deals list endpoint
router.get('/api/workspaces/:id/deals', async (req, res) => {
  const { id: workspaceId } = req.params;
  const activeLens = req.activeLens;  // from lens middleware
  
  const result = await queryDeals({
    workspace_id: workspaceId,
    ...req.query,
    // Apply lens as a named filter if present
    ...(activeLens ? { named_filter: activeLens } : {}),
  });
  
  res.json(result);
});
```

For more complex endpoints (pipeline snapshot, metrics), inject the lens the same way — as an additional `named_filter` parameter passed to the underlying query functions.

**Important:** Do NOT apply the lens to:
- Agent execution endpoints (`POST /api/workspaces/:id/agents/:agentId/run`) — agents use their own scope
- Filter CRUD endpoints — you need to see all filters to manage them
- Connector/sync endpoints — data sync is never filtered
- Settings/admin endpoints

### 3F: Lens Indicator on Data Pages

On every page where the lens is active, show a small banner or badge:

```
┌─────────────────────────────────────────────────────────────────┐
│  🔍 Viewing: Enterprise Deals (amount > $100K, pipeline = Enterprise)  [ × Clear ] │
└─────────────────────────────────────────────────────────────────┘
```

Use the `useLens()` hook to check if a lens is active. If so, render a subtle info bar below the top bar. The "× Clear" button calls `setLens(null)`.

This is critical for trust — users need to know their view is filtered. Without this, someone might see "only 23 deals in pipeline" and panic, not realizing they have a filter active.

### 3G: Lens + Standalone Skill Runs

When a user runs a skill manually from the Skills page (not via an agent), the lens should apply if active:

In the skill run endpoint (`POST /api/workspaces/:id/skills/:skillId/run` or similar):

```typescript
router.post('/api/workspaces/:id/skills/:skillId/run', async (req, res) => {
  const { id: workspaceId, skillId } = req.params;
  const activeLens = req.activeLens;
  
  const result = await skillRuntime.executeSkill(skill, workspaceId, {
    ...req.body,
    // Apply lens as scope filter for standalone runs
    scope_filters: activeLens ? [activeLens] : [],
  });
  
  res.json(result);
});
```

This means:
- User sets lens to "Enterprise Deals"
- User clicks "Run Pipeline Hygiene" on the Skills page
- Pipeline Hygiene only analyzes enterprise deals
- Evidence shows the filter was applied

### 3H: Lens + Ask Pandora (Chat)

If there's a chat/ask endpoint (like `POST /api/workspaces/:id/analyze` or a chat orchestrator), inject the lens into the analysis context:

```typescript
router.post('/api/workspaces/:id/analyze', async (req, res) => {
  const activeLens = req.activeLens;
  
  // If the user asks "how's pipeline looking?" while viewing Enterprise Deals,
  // the analysis should be scoped to Enterprise Deals
  const result = await analyzeQuestion({
    workspaceId,
    question: req.body.question,
    scope_filters: activeLens ? [activeLens] : [],
    // The Claude synthesis prompt should mention the active lens
  });
  
  res.json(result);
});
```

In the Claude prompt for scoped analysis, if a lens is active, prepend:

```
ACTIVE LENS: The user is currently viewing through the "Enterprise Deals" filter 
(amount > $100K AND pipeline = Enterprise). Your analysis should be scoped to 
these records unless the user explicitly asks to look at all data.
```

---

## Part 4: Filters Management Page (Admin View)

### 4A: Add "Filters" to the Sidebar

In the sidebar navigation, add a "Filters" item under the "Data" section:

```
Data
  ├── Connectors (4)
  ├── Connector Health
  ├── Filters            ← NEW
  └── Data Dictionary
```

Or alternatively, under "Workspace" / "Settings":
```
Workspace
  ├── Users & Teams
  ├── Filters            ← NEW
  ├── Marketplace
  └── Settings
```

Choose whichever section feels most natural given the current sidebar structure. "Data" is probably best since filters are data scoping concepts.

### 4B: Filters Management Page

Route: `/filters`

This page shows all named filters for the workspace in a table/card layout:

```
┌──────────────────────────────────────────────────────────────────────┐
│  Filters                                          [ + Create Filter ] │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │  Open Pipeline                          Deals    default    ✓   │ │
│  │  All currently open deals not in terminal stages                 │ │
│  │  Last used: 2 hours ago  •  Used 147 times  •  5 agents         │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │  New Logo Deal                          Deals    default  ⚠ unconfirmed │
│  │  Open deals at accounts with no prior closed-won deals          │ │
│  │  Last used: 1 day ago  •  Used 43 times  •  2 agents            │ │
│  │                                              [ Confirm ] [ Edit ] │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │  Enterprise Deals                       Deals    user     ✓     │ │
│  │  amount > $100K AND pipeline = Enterprise                        │ │
│  │  Last used: never  •  Used 0 times  •  0 agents                 │ │
│  │                                              [ Edit ] [ Delete ]  │ │
│  └──────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

Each filter card shows:
- **Label** — the filter name
- **Object** — Deals, Contacts, etc. (as a tag/badge)
- **Source** — default, inferred, user_defined (as a tag/badge, muted color)
- **Status** — ✓ confirmed or ⚠ unconfirmed
- **Description** or conditions summary
- **Usage stats** — last used, total usage count
- **Agent count** — how many agents reference this filter (query agents table for scope.named_filters containing this ID)
- **Actions:**
  - Default filters: no delete, edit opens condition editor
  - Inferred filters: Confirm button (POST /filters/:id/confirm), Edit, Delete
  - User filters: Edit, Delete
  - Delete should warn if any agents reference the filter

"+ Create Filter" in the top right opens the same Create Filter modal from Part 1.

"Edit" opens the Create Filter modal pre-populated with the existing filter's conditions.

"Confirm" calls `POST /api/workspaces/:id/filters/:filterId/confirm` and updates the badge to ✓.

---

## Execution Priority Rules (Summary)

Document these rules in a comment block in the lens middleware and in the skill runtime:

```
FILTER APPLICATION HIERARCHY:

1. Scheduled agent runs (cron, no user session):
   → Uses agent.scope.named_filters ONLY
   → Lens does NOT apply (no active user session)
   
2. Manual agent runs ("Run Now" from Agents page):
   → Uses agent.scope.named_filters ONLY
   → Lens does NOT apply (agent has explicit scope)

3. Standalone skill runs (from Skills page):
   → If Workspace Lens is active → applies lens as scope_filters
   → If no lens → runs unscoped (full workspace data)
   → Skill itself never specifies filters

4. Data views (Command Center, deal list, accounts, pipeline):
   → If Workspace Lens is active → all queries filtered
   → If no lens → full data

5. Ask Pandora / Chat:
   → If Workspace Lens is active → analysis scoped to lens + mentioned in prompt
   → User can override: "ignore my filter and look at all deals"

6. Findings feed:
   → If Workspace Lens is active → only show findings for records matching the lens
   → This is trickier — findings reference entity IDs, not raw data
   → Approach: JOIN findings with deals/contacts table and apply filter
   → If too complex for v1, skip lens on findings feed

7. Agent Builder Scope Filters tab:
   → Independent of lens — this is configuration, not viewing
   → Shows all filters for selection regardless of active lens
```

---

## What NOT to Build

- **Nested condition groups in the UI** — the backend supports nested AND/OR, but the visual builder for v1 is flat conditions only
- **Filter versioning** — when a filter definition changes, old evidence references get stale. Accept this for now.
- **Lens for Slack output** — Slack briefings are agent-triggered, so they use agent scope. No lens concept in Slack.
- **Per-user lens** — lens is stored per-workspace in localStorage. If two users share a workspace, they have independent lens states (localStorage is browser-local). This is fine.
- **Lens stacking** — only one lens active at a time. If the user wants "Enterprise AND Stale", they create a combined filter.
- **Auto-created lens shortcuts** — e.g., clicking a pipeline bar auto-sets a lens for that stage. Cool but future.

---

## Testing

After building, verify these scenarios:

**Create Filter:**
1. Open Agent Builder → Scope Filters → "+ Create Filter"
2. Create "Big Deals" filter: amount > 50000
3. Preview shows correct count and sample records
4. Save → filter appears in checklist, auto-checked
5. Go to Filters management page → "Big Deals" is listed with source "user_defined"

**Agent Scope Injection:**
1. Create or edit an agent → select "Big Deals" in Scope Filters
2. Run the agent manually
3. Check the skill run results → `_applied_filters` should include "big_deals"
4. Evidence should show "scoped to Big Deals: amount > 50000"
5. Only deals > $50K should appear in evaluated_records

**Workspace Lens:**
1. Select "Closing This Quarter" from the lens dropdown
2. Command Center metrics should update to show only Q1 closing deals
3. Deal list should only show deals closing this quarter
4. Navigate to different pages — lens persists
5. Run Pipeline Hygiene from Skills page — it should only analyze closing-this-quarter deals
6. Clear lens → all data returns
7. Refresh page → lens persists (localStorage)

**Edge Cases:**
1. Delete a filter that's set as the active lens → lens should clear automatically
2. Delete a filter referenced by agents → should show warning with agent names
3. Create filter with duplicate name → should show error
4. Create filter, don't preview, save → should still work (preview is optional)
5. Lens active + agent runs on schedule → agent uses its own scope, NOT the lens
