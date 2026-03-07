# Pandora Build Prompt: Pipeline Resolution — Full Spec
## Workspace-Aware Pipeline Filtering + Intent-Based Defaulting + Assumption Surfacing

**Status:** Ready to build  
**Context:** The `pipeline_name` filter in `queryDeals` and `computeMetric` was doing open-ended `ILIKE` matching against user input. This works accidentally for Frontera ("Core Sales" happens to match "Core Sales Pipeline") but fails for any workspace where the user's natural language doesn't align with the CRM string, and silently over-matches when multiple pipelines share a name fragment. The fix uses `analysis_scopes` — the workspace-aware pipeline segment infrastructure already in the system — as the resolution layer.

**Two-part build:**
- **T001–T004:** Resolver infrastructure, query fix, tool description (Replit's plan — ship exactly as written)
- **T005–T007:** Intent-based defaulting, role-aware behavior, assumption surfacing (the "what when nothing is specified" layer)

---

## Before Starting

Read these files:

1. `server/chat/data-tools.ts` — `queryDeals` and `computeMetric` — understand current pipeline filter logic and param patterns
2. `server/chat/pandora-agent.ts` — `runPandoraAgent`, `buildGetSkillEvidenceTool`, `dynamicTools` construction, tool definitions
3. The `analysis_scopes` table schema — understand `scope_id`, `name`, `confirmed`, `filter_field`, `filter_operator`, `filter_values`, `workspace_id`
4. The `deals` table schema — understand `scope_id` column, `pipeline` column, `owner_id`
5. `server/chat/session-context.ts` (if it exists) — understand session/conversation state
6. The `workspace_configs` table — understand what workspace-level settings are stored

---

## T001: Create `server/chat/pipeline-resolver.ts`

**Blocked by:** nothing — build first

**New file. Two exported functions:**

### `resolvePipelineName`

```typescript
export async function resolvePipelineName(
  workspaceId: string,
  userInput: string
): Promise<ResolvedPipeline | null>
```

Query:
```sql
SELECT scope_id, name, confirmed, filter_field, filter_operator, filter_values
FROM analysis_scopes
WHERE workspace_id = $1
  AND scope_id != 'default'
ORDER BY confirmed DESC, created_at ASC
```

Normalizer:
```typescript
const normalize = (s: string) =>
  s.toLowerCase()
   .replace(/\bpipeline\b/gi, '')
   .replace(/[-_]+/g, ' ')
   .trim();
```

Match priority (return first match found at highest priority level):
1. Exact normalized match: `normalize(scope.name) === normalize(userInput)`
2. User input is substring of scope name: `normalize(scope.name).includes(normalize(userInput))`
3. Scope name is substring of user input: `normalize(userInput).includes(normalize(scope.name))`

Among multiple matches at the same priority level, prefer `confirmed = true`.

Return type:
```typescript
interface ResolvedPipeline {
  scope_id: string;
  name: string;               // canonical name from analysis_scopes
  confirmed: boolean;
  filter_field: string;
  filter_operator: string;
  filter_values: any[];
}
```

Returns `null` if no match found.

### `getWorkspacePipelineNames`

```typescript
export async function getWorkspacePipelineNames(
  workspaceId: string
): Promise<Array<{ scope_id: string; name: string }>>
```

Query:
```sql
SELECT scope_id, name
FROM analysis_scopes
WHERE workspace_id = $1
  AND scope_id != 'default'
  AND confirmed = true
ORDER BY created_at ASC
```

Returns scope_id + name list for dynamic tool description injection.

**Files:** `server/chat/pipeline-resolver.ts` (new)  
**Acceptance:** File compiles, imports `query` from `'../db.js'`

---

## T002: Update `queryDeals` pipeline filter in `data-tools.ts`

**Blocked by:** T001

Replace current block (lines ~490–496):
```typescript
if (params.pipeline_name) {
  conditions.push(`d.pipeline ILIKE ${addParam(`%${params.pipeline_name}%`)}`);
  descParts.push(`pipeline~"${params.pipeline_name}"`);
}
```

With:
```typescript
if (params.pipeline_name) {
  const resolved = await resolvePipelineName(workspaceId, params.pipeline_name);
  if (resolved) {
    if (resolved.confirmed) {
      // Pre-stamped scope_id column — exact match, zero ambiguity
      conditions.push(`d.scope_id = ${addParam(resolved.scope_id)}`);
    } else {
      // Scope inferred but not yet stamped — use filter_field/filter_values
      const escaped = resolved.filter_values
        .map(v => `'${String(v).replace(/'/g, "''")}'`)
        .join(',');
      conditions.push(`d.${resolved.filter_field} = ANY(ARRAY[${escaped}])`);
    }
    descParts.push(`pipeline="${resolved.name}"`);
  } else {
    // Unknown pipeline — ILIKE fallback (unconfigured workspace or new pipeline)
    conditions.push(`d.pipeline ILIKE ${addParam(`%${params.pipeline_name}%`)}`);
    descParts.push(`pipeline~"${params.pipeline_name}"`);
  }
}
```

Add at top of file:
```typescript
import { resolvePipelineName } from './pipeline-resolver.js';
```

**Files:** `server/chat/data-tools.ts`  
**Acceptance:** "Core Sales pipeline" query returns only Core Sales deals. "Fellowship" query returns only Fellowship deals. A workspace with no `analysis_scopes` rows still works via ILIKE fallback.

---

## T003: Update `computeMetric` pipeline filter in `data-tools.ts`

**Blocked by:** T001

Find `computeMetric`'s `pipeline_name` handling (~lines 980–982). Replace with resolver approach using positional `$N` params:

```typescript
if (params.pipeline_name) {
  const resolved = await resolvePipelineName(workspaceId, params.pipeline_name);
  if (resolved && resolved.confirmed) {
    values.push(resolved.scope_id);
    conditions.push(`scope_id = $${values.length}`);
  } else if (resolved && resolved.filter_values.length > 0) {
    const escaped = resolved.filter_values
      .map(v => `'${String(v).replace(/'/g, "''")}'`)
      .join(',');
    conditions.push(`${resolved.filter_field} = ANY(ARRAY[${escaped}])`);
  } else {
    values.push(`%${params.pipeline_name}%`);
    conditions.push(`pipeline ILIKE $${values.length}`);
  }
}
```

**Files:** `server/chat/data-tools.ts`  
**Acceptance:** Metric queries scoped to a pipeline use the same resolution logic as deal queries. Attainment calculations return correct numbers when scoped to a named pipeline.

---

## T004: Dynamic `query_deals` tool description in `pandora-agent.ts`

**Blocked by:** T001

Add `buildQueryDealsTool` function near `buildGetSkillEvidenceTool`:

```typescript
function buildQueryDealsTool(
  pipelineNames: Array<{ scope_id: string; name: string }>
): ToolDef {
  const nameList = pipelineNames.map(p => p.name);
  const pipelineDescription = nameList.length > 0
    ? `Filter by pipeline. Available pipelines for this workspace: ${nameList.join(', ')}. Pass the exact name or a partial match (e.g. "Core Sales" matches "Core Sales Pipeline"). If no pipeline is specified by the user, do not pass this parameter — let the system apply the workspace default.`
    : `Filter by pipeline. Describe the pipeline by name if the user mentions one. If no pipeline is specified, omit this parameter.`;

  // Return a copy of the static query_deals tool definition with updated description
  return {
    ...PANDORA_TOOLS.query_deals,
    inputSchema: {
      ...PANDORA_TOOLS.query_deals.inputSchema,
      properties: {
        ...PANDORA_TOOLS.query_deals.inputSchema.properties,
        pipeline_name: {
          type: 'string',
          description: pipelineDescription
        }
      }
    }
  };
}
```

In `runPandoraAgent`, before building `dynamicTools` (~line 1372):

```typescript
const pipelineNames = await getWorkspacePipelineNames(workspaceId);
// Replace static query_deals with dynamic version
const queryDealsTool = buildQueryDealsTool(pipelineNames);
// Use queryDealsTool in place of PANDORA_TOOLS.query_deals in tools array
```

Add import:
```typescript
import { getWorkspacePipelineNames } from './pipeline-resolver.js';
```

**Important:** The tool description instructs Claude to omit `pipeline_name` when the user doesn't specify one. This is intentional — T005 handles the default behavior server-side, not via Claude guessing.

**Files:** `server/chat/pandora-agent.ts`  
**Acceptance:** When workspace has confirmed scopes, Claude's tool description lists exact pipeline names. Claude passes `pipeline_name` only when the user has named a pipeline. When no pipeline is named, Claude omits the parameter.

---

## T005: Pipeline Intent Classifier + Default Behavior

**Blocked by:** T001

This task handles the case where `pipeline_name` is **not passed** — i.e., the user didn't name a pipeline. Without this, unscoped questions return all deals across all pipelines with no explanation.

### Step 1 — Add default pipeline config to `workspace_configs`

Add a `pipeline_defaults` field to the workspace config (or a separate `workspace_pipeline_defaults` table if workspace_configs uses a strict schema):

```typescript
interface PipelineDefaults {
  quota_bearing_scope_ids: string[];    // scope_ids that count toward quota
  primary_scope_id: string | null;      // the one to default to when unspecified
  
  // What to do when no pipeline is named, by question intent
  intent_defaults: {
    attainment: 'primary' | 'quota_bearing' | 'all';
    coverage:   'primary' | 'quota_bearing' | 'all';
    activity:   'all';                  // always all for activity questions
    rep_scoped: 'owner_only';           // always owner-scoped for rep questions
    unspecified: 'primary' | 'quota_bearing' | 'all';
  };
}
```

For a workspace with one pipeline this is all `primary`. For Frontera:
```json
{
  "quota_bearing_scope_ids": ["core_sales_scope_id"],
  "primary_scope_id": "core_sales_scope_id",
  "intent_defaults": {
    "attainment": "quota_bearing",
    "coverage": "quota_bearing",
    "activity": "all",
    "rep_scoped": "owner_only",
    "unspecified": "primary"
  }
}
```

**Population:** During workspace config inference (CRM connect), if only one pipeline exists, set it as primary and quota-bearing automatically. If multiple pipelines exist, flag for the onboarding confirmation step: "Which pipeline is quota-bearing?" This is a one-time setup that fixes ambiguity permanently.

### Step 2 — Question intent classifier

```typescript
// In server/chat/pipeline-resolver.ts — add to existing file

export type QuestionIntent =
  | 'attainment'     // "are we on track", "what's attainment", "how close to quota"
  | 'coverage'       // "how's coverage", "pipeline by rep", "who has enough pipeline"
  | 'rep_scoped'     // "my deals", "how am I doing", "show me my pipeline"
  | 'deal_lookup'    // "tell me about ACES", "what's the status of X deal"
  | 'activity'       // "what closed", "what's in the funnel", "show all pipeline"
  | 'unspecified';   // everything else

const INTENT_PATTERNS: Record<QuestionIntent, RegExp[]> = {
  attainment: [
    /attainment/i, /on track/i, /quota/i, /target/i, /gap to/i, /close the gap/i,
    /how (are|is) we doing/i, /hit (the |our )?number/i
  ],
  coverage: [
    /coverage/i, /pipeline.*rep/i, /rep.*pipeline/i, /who has enough/i,
    /pipeline.*ratio/i, /\d+x/i
  ],
  rep_scoped: [
    /\bmy\b/i, /\bmine\b/i, /my deals/i, /my pipeline/i, /how am i/i,
    /my book/i, /my quota/i
  ],
  deal_lookup: [
    /tell me about/i, /status of/i, /what.*happened.*with/i, /\baces\b/i,
    // Note: deal name detection is handled separately in T6 of the assistant prompt
  ],
  activity: [
    /what closed/i, /what.*won/i, /all pipeline/i, /full funnel/i,
    /everything in/i, /total pipeline/i, /across (all|every)/i
  ],
  unspecified: []
};

export function classifyQuestionIntent(message: string): QuestionIntent {
  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS) as [QuestionIntent, RegExp[]][]) {
    if (intent === 'unspecified') continue;
    if (patterns.some(p => p.test(message))) return intent;
  }
  return 'unspecified';
}
```

### Step 3 — Default pipeline resolver

```typescript
// Add to server/chat/pipeline-resolver.ts

export interface PipelineResolution {
  scope_ids: string[] | null;       // null = no filter (all pipelines or owner-only)
  owner_only: boolean;              // true for rep_scoped intent
  mode: 'explicit' | 'defaulted' | 'all' | 'owner_only';
  assumption_label: string;         // shown to user in response
  assumption_made: boolean;         // true when we defaulted
}

export async function resolveDefaultPipeline(
  workspaceId: string,
  intent: QuestionIntent,
  requestingUserRole: 'admin' | 'manager' | 'rep',
  requestingUserId: string
): Promise<PipelineResolution> {

  // Reps always get owner-scoped — never filtered by pipeline
  if (requestingUserRole === 'rep' || intent === 'rep_scoped') {
    return {
      scope_ids: null,
      owner_only: true,
      mode: 'owner_only',
      assumption_label: 'your deals',
      assumption_made: false
    };
  }

  // Activity/total funnel questions — always all pipelines
  if (intent === 'activity') {
    return {
      scope_ids: null,
      owner_only: false,
      mode: 'all',
      assumption_label: 'all pipelines',
      assumption_made: true
    };
  }

  // Load workspace pipeline defaults
  const defaults = await getPipelineDefaults(workspaceId);

  if (!defaults || !defaults.primary_scope_id) {
    // No config — return all, flag it
    return {
      scope_ids: null,
      owner_only: false,
      mode: 'all',
      assumption_label: 'all pipelines (no default configured)',
      assumption_made: true
    };
  }

  // Single pipeline workspace — always use it, no assumption needed
  const allScopes = await getWorkspacePipelineNames(workspaceId);
  if (allScopes.length === 1) {
    return {
      scope_ids: [allScopes[0].scope_id],
      owner_only: false,
      mode: 'defaulted',
      assumption_label: allScopes[0].name,
      assumption_made: false   // no ambiguity, only one pipeline exists
    };
  }

  // Multi-pipeline workspace — use intent to pick
  const intentDefault = defaults.intent_defaults[intent] || defaults.intent_defaults.unspecified;

  if (intentDefault === 'quota_bearing') {
    const scopeNames = await getScopeNames(workspaceId, defaults.quota_bearing_scope_ids);
    return {
      scope_ids: defaults.quota_bearing_scope_ids,
      owner_only: false,
      mode: 'defaulted',
      assumption_label: scopeNames.length === 1
        ? `${scopeNames[0]} (quota-bearing)`
        : `quota-bearing pipelines (${scopeNames.join(', ')})`,
      assumption_made: true
    };
  }

  if (intentDefault === 'primary') {
    const primaryName = await getScopeName(workspaceId, defaults.primary_scope_id);
    return {
      scope_ids: [defaults.primary_scope_id],
      owner_only: false,
      mode: 'defaulted',
      assumption_label: `${primaryName} (default)`,
      assumption_made: true
    };
  }

  // 'all'
  return {
    scope_ids: null,
    owner_only: false,
    mode: 'all',
    assumption_label: 'all pipelines',
    assumption_made: true
  };
}
```

### Step 4 — Wire into `queryDeals` and `computeMetric`

When `params.pipeline_name` is **not set**, apply the default resolution:

```typescript
// In queryDeals, after the existing pipeline_name block:

if (!params.pipeline_name) {
  const intent = classifyQuestionIntent(params._original_question || '');
  const resolution = await resolveDefaultPipeline(
    workspaceId,
    intent,
    params._requesting_user_role || 'admin',
    params._requesting_user_id || ''
  );

  if (resolution.owner_only && resolution.owner_id) {
    conditions.push(`d.owner_id = ${addParam(resolution.owner_id)}`);
    descParts.push(`owner=${resolution.owner_id}`);
  } else if (resolution.scope_ids && resolution.scope_ids.length > 0) {
    const placeholders = resolution.scope_ids.map(id => addParam(id));
    conditions.push(`d.scope_id = ANY(ARRAY[${placeholders.join(',')}])`);
    descParts.push(`pipeline="${resolution.assumption_label}"`);
  }
  // mode='all' → no condition added, returns all pipelines

  // Store resolution for assumption surfacing (T006)
  params._pipeline_resolution = resolution;
}
```

Pass `_original_question`, `_requesting_user_role`, and `_requesting_user_id` from `runPandoraAgent` when building tool call params. These are metadata fields, not CRM query fields — prefix with `_` to distinguish them.

**Files:** `server/chat/pipeline-resolver.ts`, `server/chat/data-tools.ts`, `server/chat/pandora-agent.ts`  
**Acceptance:** "How's our attainment?" on Frontera defaults to Core Sales Pipeline. "What's in the funnel?" returns all pipelines. A rep asking "how are my deals doing?" gets owner-scoped results with no pipeline filter.

---

## T006: Surface the Assumption in Every Response

**Blocked by:** T005

When a pipeline assumption was made (`assumption_made: true`), the response must surface it — one line, not buried in a footnote.

### Step 1 — Pass resolution metadata through to response assembler

The `_pipeline_resolution` stored on params in T005 needs to flow back to the response layer. After tool execution, the orchestrator has access to what filters were applied. Store it in the turn metadata:

```typescript
interface ToolExecutionResult {
  // ... existing fields ...
  pipeline_resolution?: PipelineResolution;   // populated when a pipeline query ran
}
```

### Step 2 — Assumption line in response

In the response assembler, after building the main response blocks, if `pipeline_resolution.assumption_made = true`, append an assumption disclosure:

```typescript
function buildAssumptionDisclosure(resolution: PipelineResolution): string | null {
  if (!resolution || !resolution.assumption_made) return null;
  
  switch (resolution.mode) {
    case 'defaulted':
      return `Showing ${resolution.assumption_label}.`;
    case 'all':
      return `Showing all pipelines — let me know if you want to scope this to a specific one.`;
    case 'owner_only':
      return null;   // owner-only is obvious from context, no disclosure needed
    default:
      return null;
  }
}
```

This produces natural response endings like:

> *"We're at 110% attainment with ACES closing at $315K last week. Showing Core Sales Pipeline (quota-bearing)."*

> *"Pipeline coverage is 2.4x total across $2.1M. Showing all pipelines — let me know if you want to scope this to Core Sales only."*

The assumption line is a single sentence appended to the response, styled as a metadata footnote (slightly muted color, smaller font) in the frontend — present but not visually dominant.

### Step 3 — Scope confirmation on ambiguity

When the workspace has multiple pipelines and intent is `unspecified` (we genuinely can't tell which pipeline is appropriate), instead of silently defaulting, the response should state the assumption and invite correction:

```
Showing Core Sales Pipeline — that's your quota-bearing pipeline. Want me to include Fellowship as well, or show both separately?
```

This is a sentence appended to the response, not a blocking question. The user can ignore it or answer it naturally in the next turn.

**Files:** `server/chat/pandora-agent.ts`, response assembler  
**Acceptance:** Every response that applied a pipeline default includes a one-line disclosure. A response that used an explicit user-named pipeline has no disclosure. The disclosure reads naturally, not like a disclaimer.

---

## T007: Onboarding Config — Pipeline Defaults Setup

**Blocked by:** T005

This is the one-time setup that makes the above work correctly for every workspace.

### Step 1 — Auto-populate for single-pipeline workspaces

During CRM sync / workspace config inference, after `analysis_scopes` is populated:

```typescript
async function autoConfigurePipelineDefaults(workspaceId: string): Promise<void> {
  const scopes = await getWorkspacePipelineNames(workspaceId);
  
  if (scopes.length === 0) return;   // no scopes yet
  
  if (scopes.length === 1) {
    // Single pipeline — set as primary and quota-bearing automatically
    await upsertPipelineDefaults(workspaceId, {
      quota_bearing_scope_ids: [scopes[0].scope_id],
      primary_scope_id: scopes[0].scope_id,
      intent_defaults: {
        attainment: 'primary',
        coverage: 'primary',
        activity: 'all',
        rep_scoped: 'owner_only',
        unspecified: 'primary'
      }
    });
    return;
  }
  
  // Multiple pipelines — set defaults to 'all' until user configures
  // Flag workspace as needing pipeline config
  await upsertPipelineDefaults(workspaceId, {
    quota_bearing_scope_ids: [],
    primary_scope_id: null,
    intent_defaults: {
      attainment: 'all',   // safe fallback
      coverage: 'all',
      activity: 'all',
      rep_scoped: 'owner_only',
      unspecified: 'all'
    },
    needs_configuration: true   // surface this in workspace settings UI
  });
}
```

### Step 2 — Workspace settings UI flag (minimal)

When `needs_configuration: true`, show a banner in the workspace settings or connector health page:

> *"You have multiple pipelines. Tell Pandora which one is quota-bearing so attainment questions scope correctly. → Configure pipelines"*

The configuration screen shows the confirmed `analysis_scopes` as a list with checkboxes:
- ☑ Core Sales Pipeline — quota-bearing (primary)  
- ☐ Fellowship Pipeline — not quota-bearing

One click. Saves to `pipeline_defaults`. Banner disappears. All future attainment and coverage questions scope correctly without the user ever having to specify.

**Files:** `server/workspaces/pipeline-config.ts` (new), CRM sync handler, workspace settings UI  
**Acceptance:** After CRM connect with one pipeline, pipeline defaults are auto-configured. After CRM connect with multiple pipelines, workspace is flagged for configuration. After configuration, attainment questions scope to quota-bearing pipeline automatically.

---

## What Not to Build Here

- Per-rep pipeline assignments (reps are always owner-scoped — pipeline doesn't matter for their view)
- Pipeline aliases as a user-editable field (aliases are inferred from `analysis_scopes` names + normalizer — no manual entry needed)
- Cross-pipeline comparison charts (that's a separate feature — show both pipelines side-by-side)
- Pipeline creation/editing (Pandora reads pipelines from CRM — it doesn't manage them)

---

## Sequencing

```
T001 (resolver file)
  → T002 (queryDeals fix)
  → T003 (computeMetric fix)
  → T004 (dynamic tool description)
  → T005 (default behavior + intent classifier)
    → T006 (assumption surfacing)
    → T007 (onboarding config)
```

T001–T004 are Replit's original plan and can ship independently — they fix the immediate bug. T005–T007 extend the system to handle the "no pipeline specified" case and make it dynamic across all clients.

---

## Acceptance Criteria (Full Suite)

1. **Named pipeline resolves correctly.** "Core Sales pipeline" query on Frontera returns only Core Sales deals via `scope_id` match, not ILIKE. "Fellowship" returns only Fellowship deals.

2. **Partial name match works.** "Core Sales" matches "Core Sales Pipeline." "Fellowship" matches "Fellowship Pipeline." Normalization strips "pipeline" suffix before matching.

3. **Fallback works for unconfigured workspaces.** A workspace with no `analysis_scopes` rows falls back to ILIKE and still returns results. No errors.

4. **Dynamic tool description lists actual pipeline names.** Inspect Claude's tool call for a Frontera workspace — `pipeline_name` description lists "Core Sales Pipeline, Fellowship Pipeline" as available options.

5. **Unspecified attainment question defaults to quota-bearing.** "How's our attainment?" on Frontera returns Core Sales numbers only. Response ends with "Showing Core Sales Pipeline (quota-bearing)."

6. **Rep question is owner-scoped.** A rep asking "how are my deals doing?" gets their deals only, across all pipelines. No pipeline filter applied.

7. **Total funnel question returns all pipelines.** "What's in the funnel?" or "show me all pipeline" returns all pipelines combined. Response ends with "Showing all pipelines."

8. **Assumption is always surfaced.** Every response where a pipeline default was applied includes a one-line disclosure. Named-pipeline responses have no disclosure.

9. **Single-pipeline workspaces auto-configure.** After CRM connect with one pipeline, no configuration needed. All questions scope to that pipeline as default.

10. **Multi-pipeline workspaces get flagged.** After CRM connect with multiple pipelines, workspace settings shows a configuration prompt. After configuration, attainment scopes correctly.

11. **No regression on existing behavior.** Queries that worked before (deal lookup by name, rep scorecard, skill runs) are unaffected. The pipeline resolver only touches `queryDeals` and `computeMetric`.
