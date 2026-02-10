# SESSION 11: Wire Phase 3 Skill Framework to Express

```
Read REPLIT_CONTEXT.md and PANDORA_ROADMAP_PHASE3_PLUS.md first.

Phase 3 core was built by Claude Code and pushed via GitHub. The following files 
are now in the codebase:

  server/skills/types.ts              — Core type definitions (SkillDefinition, SkillStep, etc.)
  server/skills/tool-definitions.ts   — 28 tools wrapping all query functions
  server/skills/runtime.ts            — SkillRuntime with Claude tool_use loop
  server/skills/registry.ts           — Skill registry (singleton, register/get/list)
  server/skills/library/pipeline-hygiene.ts   — Skill: weekly pipeline health
  server/skills/library/deal-risk-review.ts   — Skill: deal risk assessment
  server/skills/library/weekly-recap.ts       — Skill: Friday summary
  server/skills/formatters/slack-formatter.ts — Slack Block Kit formatter
  server/skills/formatters/markdown-formatter.ts — Markdown output
  server/skills/webhook.ts            — n8n webhook handlers
  server/skills/index.ts              — Barrel exports

Your job is to wire these into the running Express app. Do NOT rewrite or restructure 
the skill framework files — they are tested and complete. You are connecting them.

## Step 1: Register Skills at Startup

In server/index.ts (or wherever the app bootstraps):

- Import the skill registry and all three skill definitions
- Register each skill on startup:
  ```
  import { skillRegistry } from './skills/registry';
  import { pipelineHygieneSkill } from './skills/library/pipeline-hygiene';
  import { dealRiskReviewSkill } from './skills/library/deal-risk-review';
  import { weeklyRecapSkill } from './skills/library/weekly-recap';

  skillRegistry.register(pipelineHygieneSkill);
  skillRegistry.register(dealRiskReviewSkill);
  skillRegistry.register(weeklyRecapSkill);
  ```
- Log: "Registered {N} skills" on startup

## Step 2: API Routes for Skills

Create server/routes/skills.ts with these endpoints:

POST /api/workspaces/:workspaceId/skills/:skillId/run
  - Instantiate SkillRuntime with workspaceId
  - Load skill from registry by skillId
  - Execute skill via runtime.executeSkill(skill)
  - Log execution to skill_runs table (the table already exists from checkpoint cleanup)
  - Format result based on skill.outputFormat (slack or markdown)
  - If skill.outputFormat is 'slack' AND workspace has a Slack webhook configured:
    - Post formatted result to Slack automatically
  - Return: { runId, status, duration_ms, output_preview }
  - This is the manual trigger endpoint for testing

GET /api/workspaces/:workspaceId/skills
  - List all registered skills with their metadata
  - Return: [{ id, name, description, category, schedule, lastRunAt }]
  - lastRunAt comes from querying skill_runs table for most recent run

GET /api/workspaces/:workspaceId/skills/:skillId/runs
  - List execution history for a skill
  - Query skill_runs table filtered by workspace_id and skill_id
  - Return: [{ runId, status, startedAt, completedAt, duration_ms, tokenUsage, error }]

GET /api/workspaces/:workspaceId/skills/:skillId/runs/:runId
  - Get full result of a specific run
  - Return: full skill_runs row including output JSON

## Step 3: Wire Webhook Handlers

The webhook.ts file exports handler functions. Connect them to Express:

POST /api/webhooks/skills/:skillId/trigger
  - Body: { workspaceId, params?, callbackUrl? }
  - Queues skill execution (for now, run synchronously — async queue is Phase 4)
  - Returns: { runId, status: 'queued' }
  - After execution, if callbackUrl provided, POST result to callbackUrl

POST /api/webhooks/events
  - Body: { event, workspaceId, data }
  - Events: 'sync_completed', 'deal_stage_changed', 'new_conversation'
  - Looks up skills with matching triggers
  - Returns: { skillsTriggered: [{ skillId, runId }] }

GET /api/webhooks/skills/:skillId/runs/:runId
  - Same as the skills route above — just an alias for webhook consumers

## Step 4: Extend Scheduler for Skill Cron

The sync scheduler already runs in server/sync/scheduler.ts.
Extend it to also check skill schedules.

- On startup (or every 60 seconds), check all registered skills
- For each skill with a schedule.cron field:
  - Parse the cron expression (install node-cron or cron-parser package)
  - If the cron matches the current time window (within 60 seconds):
    - Check skill_runs to see if it already ran in this window (prevent duplicates)
    - If not, get all workspaces with at least one connected source
    - For each workspace, queue the skill execution
    - Log: "Scheduled skill {skillId} for {N} workspaces"

Default schedules (from skill definitions):
  - pipeline-hygiene: Monday 8:00 AM workspace timezone (fall back to PST)
  - deal-risk-review: post_sync trigger (fires after sync completes, not cron)
  - weekly-recap: Friday 4:00 PM workspace timezone

For post_sync triggers:
  - After the sync orchestrator completes, emit a 'sync_completed' event
  - The event handler (from Step 3) triggers matching skills
  - Wire this into the existing sync orchestrator: after successful sync,
    call the events webhook handler internally

## Step 5: Slack Integration for Skill Results

The Slack client from Phase 2 handles outbound webhooks.
Extend it to handle skill output:

- When a skill completes with outputFormat 'slack':
  1. Get the workspace's Slack webhook URL from workspace.settings or connector_configs
  2. Format the result using slack-formatter.ts
  3. Post to Slack
  4. Log: "Posted {skillId} result to Slack for workspace {workspaceId}"

- If no Slack webhook configured, skip posting but still return result in API response

## Step 6: Environment Variables

Ensure these are set (check .env):
  - ANTHROPIC_API_KEY — for Claude calls in skill runtime
  - FIREWORKS_API_KEY — for DeepSeek calls in skill runtime
  - DATABASE_URL — already set from Phase 1

The skill runtime reads these via the llm-client utility.
Verify llm-client.ts reads from process.env correctly.

## Step 7: Smoke Test Sequence

After wiring, test this exact sequence:

1. Start the server, verify "Registered 3 skills" in logs
2. GET /api/workspaces/{id}/skills — should return 3 skills
3. POST /api/workspaces/{id}/skills/pipeline-hygiene/run
   - Should execute the skill
   - Should query deals from normalized tables
   - Should call Claude for analysis step
   - Should return structured result
   - Should post to Slack if webhook configured
   - Should log to skill_runs table
4. Check skill_runs table — should have one row with status, duration, token usage
5. GET /api/workspaces/{id}/skills/pipeline-hygiene/runs — should show the run
6. POST /api/webhooks/skills/deal-risk-review/trigger with { workspaceId: "..." }
   - Should execute deal risk review
   - Should return { runId, status }

If the pipeline-hygiene skill fails on the Claude step (API key issues, tool errors),
check the skill_runs table — the runtime logs partial results and errors there.

## What NOT to Change

- Do NOT modify files in server/skills/ unless fixing an import path
- Do NOT restructure the skill type system
- Do NOT add authentication to webhook endpoints yet (Phase 4)
- Do NOT build a queue system yet — synchronous execution is fine for now
- Do NOT add the LLM router yet — hardcoded Claude/DeepSeek is correct for this session

## Package Installs

- node-cron or cron-parser (for skill scheduling) — pick whichever is simpler
- Nothing else needed — all other dependencies are already installed
```

---

# SESSION 12: LLM Router + BYOK

> Only start this AFTER Session 11 is validated with a real skill running end-to-end.

```
Read PANDORA_ROADMAP_PHASE3_PLUS.md — specifically the "LLM Router" section.

Replace the hardcoded Claude/DeepSeek calls with a capability-based router.

## Step 1: LLM Config Table

Create migration 003_llm_config.sql:

llm_configs
  - id (UUID, primary key)
  - workspace_id (UUID, FK to workspaces, unique)
  - providers (jsonb) — keys per provider, enabled/disabled
  - routing (jsonb) — capability → provider/model mapping
  - default_token_budget (integer, default 50000) — monthly budget per workspace
  - tokens_used_this_month (integer, default 0)
  - budget_reset_at (timestamptz)
  - created_at, updated_at

Default routing (inserted when workspace is created):
{
  "providers": {},
  "routing": {
    "extract": "fireworks/deepseek-v3",
    "reason": "anthropic/claude-sonnet-4-20250514",
    "generate": "anthropic/claude-sonnet-4-20250514",
    "classify": "fireworks/deepseek-v3"
  }
}

When providers is empty, use Pandora's platform keys (from env vars).
When a user adds their own key, their key is used instead.

## Step 2: Update llm-client.ts

Replace callClaude() and callDeepSeek() with:

  llmRouter.call(workspaceId, capability, { messages, tools?, schema?, maxTokens? })

The router:
1. Loads workspace's llm_config from DB (cache in memory, refresh every 5 min)
2. Resolves capability → provider/model from routing config
3. Checks if workspace has a key for that provider, else use platform key
4. Formats the request for the target provider's API:
   - Anthropic: messages API with tool_use
   - OpenAI/Fireworks: chat completions with function calling
   - Google: Gemini generateContent
5. Normalizes the response to a common shape:
   { content: string, toolCalls?: ToolCall[], usage: { input, output } }
6. Tracks token usage in llm_configs.tokens_used_this_month
7. Returns normalized response

CRITICAL: The tool_use format differs between providers.
- Anthropic: tool_use content blocks in assistant message
- OpenAI: function_call / tool_calls in assistant message
- Gemini: functionCall in parts

The router must translate your tool definitions into each provider's format
and translate tool results back. This is the hardest part.

For Phase 3, support TWO providers:
- Anthropic (Claude) — for reason + generate capabilities
- Fireworks (DeepSeek) — for extract + classify capabilities

Add OpenAI and Gemini support in Phase 4 when users actually need it.

## Step 3: Update Skill Runtime

The runtime currently calls llm functions directly.
Update it to call llmRouter.call() instead.

Each SkillStep declares a capability instead of a provider:
- COMPUTE steps: unchanged (no LLM)
- DEEPSEEK steps become: capability = 'extract'
- CLAUDE steps become: capability = 'reason'

The runtime passes the capability to the router. The router picks the provider.

## Step 4: API Routes for LLM Config

POST /api/workspaces/:id/llm/config
  - Set provider keys and routing overrides
  - Validate keys by making a test call to each provider
  - Store encrypted (at minimum, don't log keys)

GET /api/workspaces/:id/llm/config
  - Return routing config and provider status (connected/not connected)
  - NEVER return API keys in response — just { provider: "anthropic", connected: true }

GET /api/workspaces/:id/llm/usage
  - Return token usage this month, budget remaining, per-skill breakdown

## Step 5: Validate

1. Run pipeline-hygiene skill — should work exactly as before (uses platform keys)
2. Add an OpenAI key to a workspace's config
3. Change routing.reason to "openai/gpt-4o"
4. Run pipeline-hygiene again — Claude step should now use GPT-4o
5. Check token tracking — usage should be logged
```
