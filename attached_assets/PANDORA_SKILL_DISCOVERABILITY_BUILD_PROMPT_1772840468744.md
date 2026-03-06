# Claude Code Prompt: Custom Skill Discoverability — Description Injection + Override Flag

## Objective

Two targeted improvements that make the Ask Pandora router aware of what custom skills actually answer and when to prefer them over built-ins. No new tables beyond one column addition.

---

## Pre-Flight: Read Before Writing Any Code

1. **Find the planner** — search for where the assistant/agent constructs the `AVAILABLE SKILLS:` list passed to Claude. Likely in `server/chat/orchestrator.ts`, `server/agents/runtime.ts`, or a planner utility. Find the exact line(s) where skill `id`, `name`, `category` are serialized into the prompt.

2. **Find `get_skill_evidence`** — locate the tool definition for this tool. It likely has a hardcoded `description` string listing specific built-in skill slugs. This is what gets passed to Claude as tool metadata.

3. **Find the skill registry** — locate where skills are registered (likely `server/skills/registry.ts` or similar). Understand how to query all skills for a workspace including custom ones, and what fields are available (`id`, `name`, `description`, `category`, `is_custom`, etc.).

4. **Find the custom skills table** — confirm the schema for the custom skills table. Note the exact column names. You'll be adding a `replaces_skill_id TEXT` column.

5. **Find the Skill Builder UI** — locate the custom skill creation/edit form in the frontend (likely in `client/src/pages/SkillsPage.tsx` or a `SkillBuilder` component). Understand the current fields shown.

---

## Part 1: Description Injection

### 1a. Planner prompt — inject descriptions

**What to change:** In the planner where `AVAILABLE SKILLS:` is built, expand each skill entry to include its `description` field formatted as an "answers:" annotation.

**Before:**
```
AVAILABLE SKILLS:
- custom-deal-risk: My Deal Risk Skill (pipeline)
- pipeline-hygiene: Pipeline Hygiene (pipeline)
- single-thread-alert: Single Thread Alert (pipeline)
```

**After:**
```
AVAILABLE SKILLS:
- custom-deal-risk: My Deal Risk Skill (pipeline) — answers: "Which enterprise deals are at risk of slipping before quarter end?"
- pipeline-hygiene: Pipeline Hygiene (pipeline) — answers: "Which deals in the full pipeline need immediate attention due to staleness, missing fields, or close date risk?"
- single-thread-alert: Single Thread Alert (pipeline) — answers: "Which deals have only one contact engaged, creating single-thread risk?"
```

**Implementation:**
```typescript
// In the skill list serializer — find and update this pattern:

// BEFORE (approximate):
const skillList = skills.map(s => `- ${s.id}: ${s.name} (${s.category})`).join('\n');

// AFTER:
const skillList = skills.map(s => {
  const base = `- ${s.id}: ${s.name} (${s.category})`;
  const desc = s.description?.trim();
  return desc ? `${base} — answers: "${desc}"` : base;
}).join('\n');
```

**Note:** If `description` is stored differently for built-in vs custom skills, handle both. Built-ins may have descriptions in their definition files; custom ones have them in the DB column from the Skill Builder "What question does this answer?" field.

### 1b. `get_skill_evidence` — dynamic tool description

**What to change:** The `get_skill_evidence` tool definition currently has a hardcoded description listing specific built-in slugs. This means Claude doesn't know custom skills exist when deciding whether to call this tool.

Replace the static string with a dynamically generated description that includes all available skills for the workspace:

```typescript
// Find where get_skill_evidence tool is defined. It looks something like:
const getSkillEvidenceTool = {
  name: 'get_skill_evidence',
  description: `Retrieves evidence from Pandora skill runs. Available skills: pipeline-hygiene, single-thread-alert, ...`, // HARDCODED
  input_schema: { ... }
};

// Replace with a function that takes workspaceId and returns the tool definition:
async function buildGetSkillEvidenceTool(workspaceId: string) {
  const skills = await skillRegistry.getForWorkspace(workspaceId);
  
  const skillDescriptions = skills.map(s => {
    const answers = s.description?.trim() ? ` — answers: "${s.description}"` : '';
    return `  • ${s.id}${answers}`;
  }).join('\n');

  return {
    name: 'get_skill_evidence',
    description: `Retrieves evidence and findings from Pandora skill runs. Use when the user asks about specific pipeline metrics, deal risks, rep performance, or data quality.\n\nAvailable skills for this workspace:\n${skillDescriptions}`,
    input_schema: { ... } // unchanged
  };
}
```

Make sure `buildGetSkillEvidenceTool(workspaceId)` is called at request time (not module load time) so the skill list reflects current workspace state.

---

## Part 2: Override Flag

### 2a. Schema — add `replaces_skill_id` column

```sql
ALTER TABLE custom_skills 
ADD COLUMN IF NOT EXISTS replaces_skill_id TEXT DEFAULT NULL;

-- replaces_skill_id is the slug of the built-in skill this custom skill overrides.
-- Example: 'pipeline-hygiene', 'stage-velocity-benchmarks', 'single-thread-alert'
-- NULL means no override — compete on description quality alone.

COMMENT ON COLUMN custom_skills.replaces_skill_id IS 
  'When set, this custom skill suppresses the named built-in skill from the planner. The router will always prefer this custom skill over the built-in for matching questions.';
```

### 2b. Planner — suppress overridden built-ins

In the planner, before building the skills list:

```typescript
async function buildSkillListForPlanner(workspaceId: string): Promise<Skill[]> {
  const allSkills = await skillRegistry.getForWorkspace(workspaceId);
  
  // Find all built-in slugs that are overridden by a custom skill
  const overriddenSlugs = new Set(
    allSkills
      .filter(s => s.is_custom && s.replaces_skill_id)
      .map(s => s.replaces_skill_id!)
  );
  
  // Suppress overridden built-ins
  return allSkills.filter(s => {
    if (!s.is_custom && overriddenSlugs.has(s.id)) {
      return false; // suppressed — custom replacement takes its slot
    }
    return true;
  });
}
```

This is a clean substitution: if `custom-deal-risk` declares `replaces_skill_id = 'pipeline-hygiene'`, the planner will include `custom-deal-risk` and exclude `pipeline-hygiene`. No ambiguity, no competition.

### 2c. Skill Builder UI — "Replaces built-in" dropdown

**File:** Wherever the custom skill create/edit form lives.

Add a dropdown field below the existing description field:

```typescript
// Field label: "Override a built-in skill (optional)"
// Helper text: "When set, Ask Pandora will always use this skill instead of the selected built-in."

const BUILT_IN_SKILLS = [
  { value: '', label: 'None — compete on description match' },
  { value: 'pipeline-hygiene', label: 'Pipeline Hygiene' },
  { value: 'single-thread-alert', label: 'Single Thread Alert' },
  { value: 'data-quality-audit', label: 'Data Quality Audit' },
  { value: 'pipeline-coverage', label: 'Pipeline Coverage by Rep' },
  { value: 'forecast-rollup', label: 'Forecast Roll-up' },
  { value: 'stage-velocity-benchmarks', label: 'Stage Velocity Benchmarks' },
  { value: 'icp-discovery', label: 'ICP Discovery' },
  { value: 'lead-scoring', label: 'Lead Scoring' },
  { value: 'conversation-intelligence', label: 'Conversation Intelligence' },
  { value: 'competitive-intelligence', label: 'Competitive Intelligence' },
];

// Render as a <select> or styled dropdown matching existing Skill Builder UI patterns
// Save as replaces_skill_id on the custom_skills record
```

**On save:** Include `replaces_skill_id` (or `null`) in the PATCH/POST body to the custom skills API. Update the API handler to accept and persist this field.

---

## What NOT to Build

- Do NOT build A/B comparison UI — that's a separate spec
- Do NOT change skill execution logic — only the planner's skill selection changes
- Do NOT add preference scoring yet — description injection alone is sufficient for v1 routing improvement
- Do NOT show the override dropdown unless the workspace has at least one custom skill (it's a power-user feature)

---

## Verification

**Part 1 — Description injection:**
1. Open Ask Pandora and ask a question that a custom skill specifically answers (e.g., "which enterprise deals are at risk?")
2. Check server logs for the planner prompt — confirm the `AVAILABLE SKILLS:` block now includes `— answers: "..."` annotations
3. Confirm the custom skill is chosen over a similarly-named built-in

**Part 2 — Override flag:**
1. In the Skill Builder, edit a custom skill → set "Replaces built-in" to "Pipeline Hygiene" → save
2. Ask Pandora a pipeline hygiene question
3. Check server logs — confirm `pipeline-hygiene` is absent from the planner's skill list and the custom skill appears in its slot
4. Verify the custom skill's response is returned (not the built-in's)

**Database check:**
```sql
SELECT id, name, replaces_skill_id 
FROM custom_skills 
WHERE workspace_id = '<your_workspace_id>';
-- Should show replaces_skill_id = 'pipeline-hygiene' for the overriding skill
```
