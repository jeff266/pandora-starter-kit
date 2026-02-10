# Pandora Roadmap — Phase 3 through Phase 6
## Decisions, Architecture, and Build Plans

**Created**: 2026-02-10
**Purpose**: Preserve all architectural decisions from the Phase 3 planning conversation. Add this to the Pandora project so future Claude sessions and Replit have full context.

---

## Current State (Post Phase 2)

**Complete:**
- 8 normalized entity tables (deals, contacts, accounts, activities, conversations, tasks, documents + context_layer)
- 6 connectors: HubSpot, Gong, Fireflies, Monday.com, Google Drive (adapter pattern via registry)
- Sync orchestrator with scheduler
- 30+ query functions across all entities
- Computed fields engine (days_in_stage, engagement_score, health_score, velocity, pipeline coverage)
- Context layer (business model, team structure, goals, definitions, maturity)
- Pipeline snapshot → Slack (proof of life)
- 24 smoke tests passing
- skill_runs table, Slack client, webhook endpoints pre-wired

**Phase 3 Core (Built by Claude Code, needs Replit wiring):**
- server/skills/types.ts — Core type definitions
- server/skills/tool-definitions.ts — 28 tools wrapping query functions
- server/skills/runtime.ts — Agent runtime with Claude tool_use loop
- server/skills/registry.ts — Skill registry (singleton)
- server/skills/library/pipeline-hygiene.ts — First production skill
- server/skills/library/deal-risk-review.ts — Second skill
- server/skills/library/weekly-recap.ts — Third skill
- server/skills/formatters/slack-formatter.ts — Slack Block Kit formatter
- server/skills/formatters/markdown-formatter.ts — Markdown formatter
- server/skills/webhook.ts — n8n webhook integration

---

## Four-Tier Execution Model

| Tier | Provider | Use Case | Cost |
|---|---|---|---|
| **Tier 1 COMPUTE** | Your functions | Scoring, anomaly detection, statistics, queries | Free, deterministic |
| **Tier 2 DEEPSEEK** | Fireworks API | Transcript extraction, field mapping, summarization | $ bulk |
| **Tier 3 CLAUDE** | Anthropic API | Strategic reasoning, skill execution, narrative | $$$ high-value |
| **Tier 4 n8n** | Self-hosted | Webhooks, scheduled triggers, skill chaining | Free orchestration |

---

## Phase 3: Skill Framework + LLM Router (NOW)

### What Phase 3 Delivers
- Skill definitions as declarative config (not code)
- Runtime that interprets skill steps by tier
- Claude tool_use loop with safety limits (maxToolCalls)
- Full tool registry wrapping all query functions
- 3 production skills: Pipeline Hygiene, Deal Risk Review, Weekly Recap
- Slack + Markdown output formatters
- n8n webhook integration for external orchestration
- Token tracking and error handling
- All skill runs logged to skill_runs table

### Replit Wiring Needed
- API routes for webhook handlers → Express
- Scheduler extension to check skill.schedule.cron
- Environment variables: FIREWORKS_API_KEY, ANTHROPIC_API_KEY
- Slack posting integration for formatted results
- Manual trigger endpoints for testing

### LLM Router (After Wiring Validated)
Replace hardcoded Claude/DeepSeek with capability-based routing:

**Capabilities:**
- `extract` → bulk parsing, classification (default: DeepSeek)
- `reason` → multi-step tool use, judgment (default: Claude Sonnet)
- `generate` → long-form narrative (default: Claude Sonnet)
- `embed` → similarity search (default: Voyage/OpenAI)
- `classify` → simple routing, intent (default: DeepSeek)

**BYOK (Bring Your Own Key):**
Workspace-level LLM config stored in DB:
```json
{
  "providers": {
    "anthropic": { "api_key": "sk-ant-...", "enabled": true },
    "openai": { "api_key": "sk-...", "enabled": true },
    "fireworks": { "api_key": "fw-...", "enabled": true },
    "google": { "api_key": "...", "enabled": false }
  },
  "routing": {
    "extract": "fireworks/deepseek-v3",
    "reason": "anthropic/claude-sonnet-4-20250514",
    "generate": "anthropic/claude-sonnet-4-20250514",
    "classify": "fireworks/deepseek-v3"
  }
}
```

Users override routing per capability. Router resolves capability → provider, formats request per provider API, normalizes response. Skill definitions declare capabilities, not providers.

---

## Phase 4: Write-Back + Chaining + Output Skills

### Write-Back Tools
- Update HubSpot deals (stage, owner, custom fields)
- Update HubSpot contacts (lifecycle stage, properties)
- Create Monday.com tasks from skill outputs
- Push lifecycle stage recommendations back to CRM

### Skill-to-Skill Triggers
Add `onComplete` field to SkillDefinition:
```typescript
onComplete: {
  triggerSkills?: {
    skillId: string,
    condition: string,       // e.g., "stale_deals.length > 0"
    paramMapping: Record<string, string>  // map output keys to input params
  }[]
}
```

### Chain Token Budgets
- Each skill in a chain has a token budget
- Chain has a total budget
- If budget exhausted, remaining skills run compute-only or skip
- Prevents runaway token consumption

### Output Skills
- PPTX generation (QBR decks, board packs)
- DOCX generation (reports, proposals)
- PDF generation (formatted deliverables)
- Templated outputs with data injection

### Anti-Waterfall Rules for Chaining
1. **No agent reviews another agent's conclusion** — agents produce data, not opinions about other agents
2. **Each agent sees raw data, not prior analysis** — chain passes data arrays, not narrative
3. **Disagreement is surfaced, not resolved** — synthesis step presents both perspectives
4. **Agents have different data access** — different tools give different viewpoints naturally
5. **Hard token budgets per chain** — prevents runaway loops

---

## Phase 5: Chat Agent + Slack Bot + Mechanical Promotion

### Ad Hoc Chat Architecture
User asks question → intent classifier (DeepSeek/pattern matching) → route:
- **Data lookup** → run query tool directly, format result (0 tokens)
- **Needs reasoning** → Claude with tools and context ($$ tokens)

### Query Caching & Mechanical Promotion
Track every chat query:
```sql
chat_queries:
  id, workspace_id,
  query_text,
  query_embedding (vector for similarity),
  resolution_type: 'tool_direct' | 'agent_reasoning' | 'cached' | 'mechanical',
  tool_calls: jsonb,      -- what tools were called
  response_template,      -- formatted answer with placeholders
  hit_count,
  last_asked_at,
  promoted_to_mechanical: boolean
```

**Promotion pipeline:**
- Same query pattern appears 3+ times (embedding similarity)
- If pattern is deterministic (same tools, same filters, same output shape)
- Promote to "mechanical" — saved query template, no LLM needed
- User sees: faster answers, lower cost over time
- Mechanical responses always run fresh queries (cache the plan, not the data)

### Slack Bot (Primary Chat Interface)
Full Slack app (not just webhook):
- Direct messages to bot
- @mentions in channels
- Slash commands: `/pandora pipeline status`, `/pandora ask "which deals are stale?"`
- Responses in threads (follow-ups maintain context)
- Interactive elements: buttons for "See details", "Run full analysis", "Correct this"
- Map Slack workspace ID → Pandora workspace ID for multi-tenant

### User-Defined Lifecycle Stages
User defines via API or UI:
```json
{
  "stage_mapping": {
    "Discovery": "awareness",
    "Demo Completed": "evaluation",
    "SAO": "qualification",
    "Proposal Sent": "decision"
  },
  "qualified_stages": ["SAO", "Proposal Sent", "Negotiation"],
  "qualified_criteria": {
    "min_amount": 1000,
    "requires_contact": true,
    "requires_close_date": true
  },
  "terminology": {
    "qualified": "SAO",
    "pipeline": "Qualified Pipeline",
    "coverage": "SAO Coverage"
  }
}
```
Stored in context_layer.definitions. All skills and computed fields respect this. Win rate = deals entering qualified stage that closed-won ÷ all deals entering qualified stage. User's language appears in all outputs.

---

## Phase 6: Skill Builder + Visual Chaining + Meta-Agent

### Skill Builder (Document → Agent Canvas)
User uploads document (JD, playbook, SOP, process doc) →

**Step 1 (DeepSeek):** Extract discrete responsibilities with implied frequency, data sources, outputs
**Step 2 (Claude):** Map each to tools, context, tier, schedule, output format
**Step 3 (Canvas UI):** Present proposed skills as cards:
- Name, schedule, output format, tool count, tier
- [Edit] to modify prompts, tools, schedule
- [Enable] to register and activate
- [+ Add Custom Skill] for manual creation

Works for: job descriptions, playbooks, meeting agendas, SOPs, free-text prompts

### Visual Agent Chaining (via n8n)
Directed graph, not a chat room. Each node is a Pandora skill, edges define data flow with conditions.

Use n8n as the orchestration canvas:
- Each skill = an n8n node (triggered via webhook)
- User builds chains in n8n's visual editor
- n8n handles conditionals, parallel branches, error handling, retries, human approval
- Pandora provides skill nodes; n8n provides the canvas

### Meta-Agent (Goal-Based Planning)
For goals that can't be pre-decomposed:
- User states goal: "Prepare for board meeting next Thursday"
- Single Claude call with `executeSkill` as a tool
- Claude plans: run Pipeline Review → Forecast Model → Win/Loss → assemble Board Pack
- One planning call + independent skill executions
- Planner, not a committee — avoids waterfall

---

## Use Cases Validated Against Architecture

### 1. Autonomous Segmentation Detection
- **Schedule:** Monthly or post-backfill
- **Steps:** Compute (feature vectors from deals/accounts/contacts) → Compute (k-means clustering) → DeepSeek (name segments) → Claude (compare to stated ICP, produce insight)
- **Missing:** Clustering compute function in server/analysis/segmentation.ts
- **Everything else exists**

### 2. Lifecycle Change Recommendations
- **Trigger:** Post-sync
- **Steps:** Compute (behavioral profile per contact) → Compute (compare to lifecycle definitions from context layer) → Claude (review mismatches, produce recommendations)
- **Missing:** Behavioral profile function, HubSpot write-back (Phase 4)
- **Context layer already stores lifecycle definitions**

### 3. Standard RevOps Analyses
- **Pattern:** Each analysis type = a skill definition
- **Categories:** Pipeline & Deals, People & Performance, Strategy & Process, Diagnostics
- **Missing:** Just the skill definitions — each is a config file in server/skills/library/
- **Runtime supports adding skills without touching core**

### 4. Ad Hoc Chat
- **Phase 5:** Chat agent = Claude with all tools + context, no predefined steps
- **Optimization:** Intent classifier routes simple lookups to compute (0 tokens)
- **Caching:** Query patterns tracked, promoted to mechanical after 3 similar asks

### 5. User-Built Agents
- **Skills are declarative config** — user fills out: name, tools, context, steps, prompts, schedule, output
- **The prompt IS the agent** — user's domain expertise goes into the Claude prompt
- **Guardrails:** Token budgets, tool call limits, workspace isolation enforced by runtime

### 6. Agent-to-Agent Chaining
- **Architecture:** Directed graph (not debate), data flows downstream (not conclusions)
- **Implementation:** n8n visual workflows OR onComplete skill triggers
- **Anti-waterfall:** 5 rules (no reviewing conclusions, raw data only, surface disagreement, different data access, hard budgets)

---

## Build Order Summary

| Phase | What Gets Added | Build Tool |
|---|---|---|
| **3a** (now) | Wire Phase 3 to Express, validate end-to-end | Replit |
| **3b** (next) | LLM router with BYOK, capability-based routing | Claude Code → Replit |
| **4** | Write-back tools, skill triggers, token budgets, output skills (pptx/docx) | Claude Code → Replit |
| **5** | Chat agent, Slack bot, query caching, mechanical promotion, lifecycle UI | Claude Code → Replit |
| **6** | Skill builder, n8n visual chaining, meta-agent | Claude Code → Replit |

---

## Technical Principles (Carry Forward)

1. **workspaceId NEVER in tool parameters** — always from execution context (tenant isolation)
2. **Skills are declarative config** — runtime interprets them, no code per skill
3. **All tool calls logged** with params + result count
4. **All skill runs logged** to skill_runs table with full metadata
5. **Errors never throw from runtime** — always return partial results
6. **tool_use loop has hard safety limit** (maxToolCalls per step)
7. **DeepSeek for extraction, Claude for reasoning** — never reverse (until router overrides)
8. **Context layer is the source of truth** for all business definitions
9. **Data flows downstream, conclusions don't** (anti-waterfall)
10. **Mechanical promotion** — repetitive agent queries become deterministic over time

---

**END OF ROADMAP**
