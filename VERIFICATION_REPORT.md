# Pandora Ground Truth Verification Report

**Date:** 2026-02-24
**Method:** Exhaustive trace of every tool, skill, renderer, agent, and data table against actual codebase and live database.

---

## Part 1: Tool Verification (33 MECE Spec Tools)

### Summary

| Rating | Count | Tools |
|--------|-------|-------|
| 🟢 LIVE | 19 | query_deals, query_accounts, query_conversations, query_contacts, query_activity_timeline, get_skill_evidence, compute_metric, compute_stage_benchmarks, query_stage_history, query_field_history, compute_metric_segmented, search_transcripts, compute_activity_trend, infer_contact_role, compute_close_probability, compute_forecast_accuracy, compute_pipeline_creation, compute_inqtr_close_rate, compute_competitive_rates |
| 🟢 FIXED | 1 | compute_shrink_rate (field_change_log table created + backfilled with 4,175 stage + 2,193 amount records) |
| 🔴 STUB/MISSING | 13 | score_icp_fit, score_multithreading, score_conversation_sentiment, compute_rep_conversions, detect_buyer_signals, check_stakeholder_status, enrich_market_signals, query_product_usage, compute_wallet_share, compute_attention_score, score_activity_quality, detect_process_blockers, compute_source_conversion |

### Architecture Note
Two tool systems exist:
1. **Ask Pandora chat tools** (`server/chat/data-tools.ts` → `executeDataTool()`) — 20 tools called by conversational agent
2. **Skill runtime tools** (`server/skills/tool-definitions.ts` → `toolRegistry`) — 80+ tools called by scheduled skills

All 19 LIVE tools are in `server/chat/data-tools.ts`, dispatched via `pandora-agent.ts`.
All 13 MISSING tools have zero code anywhere in the codebase — aspirational spec items never built.

### Notable Gaps
- `score_icp_fit`: ICP scoring exists as `icpScoreOpenDeals` in skill runtime but NOT exposed as chat tool
- `compute_shrink_rate`: **FIXED** — `field_change_log` table created + backfilled (4,175 stage + 2,193 amount records)
- `query_field_history`: **FIXED** — `field_change_log` table now available with proper indexes

---

## Part 2: Skill Verification (27 Skills)

### Summary

| Rating | Count | Skills |
|--------|-------|-------|
| 🟢 PRODUCTION | 25 | bowtie-analysis, contact-role-resolution, conversation-intelligence, custom-field-discovery, data-quality-audit, deal-risk-review, deal-scoring-model, forecast-accuracy-tracking, forecast-model, forecast-rollup, icp-discovery, icp-taxonomy-builder, lead-scoring, monte-carlo-forecast, pipeline-coverage, pipeline-goals, pipeline-hygiene, pipeline-waterfall, project-recap, rep-scorecard, single-thread-alert, stage-velocity-benchmarks, strategy-insights, weekly-recap, workspace-config-audit |
| 🟡 COMPLETE BUT UNVERIFIED | 2 | competitive-intelligence (0 completed runs + possible dependsOn bug), pipeline-gen-forecast (1 run stuck in 'running') |

### Key Findings
1. **25/27 skills have completed production runs** with evidence in `skill_runs` table (570 total runs)
2. **Top runners:** single-thread-alert (82), deal-risk-review (81), pipeline-hygiene (69)
3. **Zero stubs or shells** — every skill file has real multi-phase logic
4. **3 potential `dependsOn` bugs** (outputKey used instead of step ID):
   - competitive-intelligence step 5: `competitive_patterns` → should be `analyze-competitive-patterns`
   - stage-velocity-benchmarks step 5: `pattern_classifications` → should be `classify-patterns`
   - forecast-accuracy-tracking step 5: `rep_classifications` → should be `classify-volatile-reps`
5. **9/27 skills lack evidence builders** (no structured findings extraction)
6. All 27 skills registered in `server/skills/index.ts` with cron schedules

### Architecture Pattern
All skills follow declarative `SkillDefinition` with COMPUTE → CLASSIFY → SYNTHESIZE phases:
- COMPUTE: Call tool functions for raw data
- CLASSIFY: DeepSeek (Fireworks) for extraction/classification
- SYNTHESIZE: Claude for narrative generation
- Some variations: 3 compute-only skills, 1 meta-analysis skill skips DeepSeek

---

## Part 3: Renderer Verification

### Summary

| Renderer | Rating | Library | File | Lines | Evidence |
|----------|--------|---------|------|-------|----------|
| XLSX (WorkbookGenerator) | 🟢 LIVE | ExcelJS | `server/renderers/workbook-generator.ts` | 794 | Real implementation with 3 modes (evidence tables, template-driven, single skill). Multi-tab workbooks with styled headers, severity coloring, conditional formatting |
| PDF (PDFRenderer) | 🟢 LIVE | PDFKit | `server/renderers/pdf-renderer.ts` | 400 | Real implementation with cover pages, TOC, styled sections, severity indicators. Writes to temp files |
| DOCX (DOCXRenderer) | 🟢 LIVE | docx | `server/renderers/docx-renderer.ts` | 378 | Full implementation with branded tables, severity tags, metric cards, action items. Uses `docx` library's Document/Packer/Paragraph/Table classes |
| PPTX (Full) | 🟢 LIVE | pptxgenjs | `server/renderers/pptx-renderer-full.ts` | 342 | Full implementation for report generation context. Dark-themed slides with cover, metrics, deals, actions |
| PPTX (Registry Stub) | 🔴 STUB | N/A | `server/renderers/pptx-renderer.ts` | 19 | Throws error: "PPTX rendering is not yet available". This is the version registered in the renderer registry |
| Slack (SlackRenderer) | 🟢 LIVE | Native (Block Kit JSON) | `server/renderers/slack-renderer.ts` | 245 | Block Kit JSON generation for agent, skill, and template outputs. Severity emoji, action buttons, structured sections |
| Command Center | 🟢 LIVE | Native JSON | `server/renderers/command-center-renderer.ts` | 132 | JSON payload formatter for React frontend consumption |

### Notable Gaps
- **PPTX has split implementation**: `pptx-renderer-full.ts` (342 lines, real pptxgenjs) exists but `pptx-renderer.ts` (stub, 19 lines) is what's registered in the renderer registry → PPTX via the registry always throws an error
- **DOCX and PPTX-full** are NOT registered in the renderer registry (`server/renderers/index.ts`) — they're called directly by report routes, not through `renderDeliverable()`

### Registered in Registry (5):
1. xlsx (WorkbookGenerator) ✅
2. pdf (PDFRenderer) ✅
3. slack_blocks (SlackRenderer) ✅
4. command_center (CommandCenterRenderer) ✅
5. pptx (PPTXRenderer — STUB) ❌

---

## Part 4: Agent Verification (6 Agents)

### Summary

| Agent | Rating | Skills Used | Trigger | Evidence |
|-------|--------|-------------|---------|----------|
| pipeline-state | 🟡 DEFINED + RUNS | pipeline-hygiene, single-thread-alert, deal-risk-review | Cron: Mon 7am | All 3 skills have 60+ runs each. Agent composition works. |
| forecast-call-prep | 🟡 DEFINED | forecast-rollup, deal-risk-review, rep-scorecard, lead-scoring | Manual trigger | All 4 skills have runs. Agent never explicitly triggered but skills work independently. |
| friday-recap | 🟡 DEFINED | weekly-recap, project-recap, pipeline-goals | Cron: Fri 4pm | All 3 skills have runs. |
| bowtie-review | 🟡 DEFINED | bowtie-analysis, pipeline-goals, deal-risk-review | Cron: Mon 7am | All 3 skills have runs. |
| attainment-vs-goal | 🟡 DEFINED | pipeline-goals, forecast-rollup, pipeline-coverage, rep-scorecard | Manual trigger | All 4 skills have runs. |
| strategy-insights | 🟡 DEFINED | strategy-insights, pipeline-hygiene, bowtie-analysis | Cron: Wed 9am | All 3 skills have runs. |

### Agent Execution Evidence
- `agents` table: **2 rows** — "Monday Pipeline Briefing Agent" and "Monday Pipeline Briefing" (DB-stored agents, not the 6 hardcoded definitions)
- `agent_runs` table: **53 rows** — agents have been executed (likely via the DB-stored agents or agent runtime)
- `report_generations` with agent_id: **2 runs** for "Monday Pipeline Briefing" agent (UUID `7fc1fa0d-...`)
- `agent_memory` table: **1 row** — self-reference memory has been used at least once
- `agent_templates` table: **5 rows** — pre-built templates stored

### Architecture
- **Runtime**: `server/agents/runtime.ts` (505 lines) — full execution engine with:
  - Sequential skill execution with caching (30-min TTL)
  - Claude synthesis with template variable interpolation
  - Slack delivery with evidence formatting
  - Error handling with partial result support
  - `agent_runs` table logging
- **Registry**: `server/agents/registry.ts` — singleton pattern, workspace filtering
- **Editorial Synthesizer**: `server/agents/editorial-synthesizer.ts` — advanced synthesis with audience tuning, focus questions, data window
- **DOCX/PPTX rendering**: Called directly by `server/reports/generator.ts` and `server/reports/editorial-generator.ts` (NOT via renderer registry)

### Rating Justification
All 6 hardcoded agents are 🟡 (DEFINED) because:
- All agent definitions are complete with real skills, synthesis prompts, and triggers
- The underlying skills all have production runs
- The agent runtime is fully implemented
- **However**: The 6 hardcoded agents in `server/agents/definitions/` are NOT the same as the 2 agents in the `agents` DB table. The 53 `agent_runs` may correspond to DB-stored agents, not necessarily the hardcoded definitions
- We can prove the runtime works (53 runs), but we cannot individually confirm each of the 6 definition-based agents has been executed

---

## Part 5: Data Layer Verification

### Live Production Data (from database queries)

| Table | Row Count | Status |
|-------|-----------|--------|
| contacts | 177,511 | 🟢 Heavy production use |
| accounts | 48,373 | 🟢 Heavy production use |
| activities | 31,360 | 🟢 Heavy production use |
| deal_contacts | 8,259 | 🟢 Active |
| token_usage | 5,984 | 🟢 LLM usage tracked |
| deal_stage_history | 4,175 | 🟢 Active |
| account_scores | 4,573 | 🟢 Scoring active |
| account_signals | 3,014 | 🟢 Signal detection active |
| deals | 2,890 | 🟢 Core entity |
| lead_scores | 2,086 | 🟢 Lead scoring active |
| findings | 1,410 | 🟢 Skill findings generated |
| sync_log | 1,067 | 🟢 Sync infrastructure working |
| conversations | 986 | 🟢 Call data ingested |
| skill_runs | 570 | 🟢 Skills executing |
| actions | 432 | 🟢 Actions queue active |
| chat_messages | 110 | 🟢 Ask Pandora used |
| agent_runs | 53 | 🟢 Agents executing |
| icp_profiles | 25 | 🟢 ICP discovery ran |
| workspace_members | 12 | 🟢 Multi-user |
| connections | 8 | 🟢 Connectors configured |
| workspaces | 6 | 🟢 Multi-tenant |
| context_layer | 6 | 🟢 Business context set |
| agent_templates | 5 | 🟢 Templates stored |
| report_generations | 4 | 🟡 Light use |
| chat_sessions | 4 | 🟡 Light use |
| report_templates | 3 | 🟡 Light use |
| users | 2 | 🟢 Auth working |
| agent_memory | 1 | 🟡 Minimal |

### Missing Tables (referenced in code but not in database)

| Table | Referenced By | Impact |
|-------|---------------|--------|
| `field_change_log` | compute_shrink_rate, query_field_history | compute_shrink_rate always returns hardcoded 10% |
| `forecast_snapshots` | N/A (no references found) | No dedicated forecast snapshot table |
| `targets` | Migration 064 exists | Migration may not have run |
| `quotas` | Migration 064 exists | Migration may not have run |
| `deal_score_snapshots` | Migration 056 exists | Migration may not have run |
| `report_share_links` | Migration 051 exists | Migration may not have run |

### Tables That Exist But Are Empty (0 rows)

| Table | Expected Use | Concern |
|-------|-------------|---------|
| documents | Document repository entity | Google Drive connector not active |
| tasks | Task management entity | Monday.com connector not active |
| calls | Call entity | Data may be in conversations table instead |
| enriched_accounts | Apollo/Serper enrichment | ICP enrichment pipeline not run |
| waitlist | Homepage waitlist signups | Feature built but no signups yet |
| notifications | Push notification system | Delivery system configured but unused |
| notification_queue | Digest queue | Unused |
| feedback_signals | User feedback capture | Feature built but unused |

---

## Part 6: Ground Truth Scorecard

### Overall System Health

| Component | Working | Total | Percentage | Grade |
|-----------|---------|-------|------------|-------|
| Chat Tools | 19 | 33 | 58% | C+ |
| Skills | 25 | 27 | 93% | A |
| Renderers (registered) | 4 | 5 | 80% | B |
| Renderers (all impl) | 6 | 7 | 86% | B+ |
| Agents | 6 | 6 | 100% (defined) | A- |
| Core Data Tables | 28 populated | 28 | 100% | A |
| Missing Tables | 6 | 6 | 0% created | F |

### What's Actually Working End-to-End

1. **HubSpot Sync → Deals/Contacts/Accounts/Activities** ✅
   - 177K contacts, 48K accounts, 2.9K deals, 31K activities
   - sync_log shows 1,067 sync entries

2. **Skill Framework** ✅
   - 25/27 skills have completed production runs
   - 570 skill_runs, 1,410 findings generated
   - Cron scheduling operational

3. **Ask Pandora Conversational Agent** ✅
   - 19 working tools, 110 chat messages, 4 sessions
   - Three-tier routing operational

4. **Agent Briefings** ✅
   - 53 agent_runs, runtime fully implemented
   - Editorial synthesis with Claude

5. **Account Scoring + Lead Scoring** ✅
   - 4,573 account scores, 2,086 lead scores
   - ICP profiles (25), account signals (3,014)

6. **XLSX/PDF/Slack/DOCX Renderers** ✅
   - All use real libraries (ExcelJS, PDFKit, docx, pptxgenjs)
   - Generate real files to /tmp

7. **Multi-Tenant Auth + Members** ✅
   - 6 workspaces, 12 members, 2 users
   - Workspace roles, magic links

### What's NOT Working or Missing

1. **13 chat tools never built** — spec-only, zero code
2. **PPTX via registry** — stub throws error (full impl exists but unregistered)
3. **field_change_log table** — never created, breaks shrink_rate and field_history
4. **6 migrations not applied** — targets, quotas, deal_score_snapshots, report_share_links, forecast_snapshots
5. **Document, Task, Call entities** — tables exist but 0 rows (connectors not active)
6. **Enrichment pipeline** — enriched_accounts is empty (Apollo/Serper not run)
7. **Notification/delivery system** — fully built but 0 rows in all delivery tables
8. **Waitlist** — 0 signups
9. **2 skills never completed** — competitive-intelligence (possible dependsOn bug), pipeline-gen-forecast (stuck run)

---

## Part 7: Revised Build Priority

### Tier 1 — Quick Wins (High Impact, Low Effort)

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| 1 | Fix PPTX registry: register `pptx-renderer-full.ts` instead of stub | 5 min | Unblocks PPTX downloads |
| 2 | Fix 3 `dependsOn` bugs in skills (outputKey → step ID) | 15 min | Unblocks competitive-intelligence + 2 others |
| 3 | Run missing migrations (064, 056, 051) | 10 min | Creates targets, quotas, deal_score_snapshots, report_share_links tables |
| 4 | Create `field_change_log` table + populate from deal stage history | 30 min | Fixes compute_shrink_rate, query_field_history |

### Tier 2 — Moderate Effort, High Value

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| 5 | Expose ICP scoring as `score_icp_fit` chat tool | 1 hr | Adds ICP fit queries to Ask Pandora |
| 6 | Build `score_multithreading` chat tool | 2 hr | Contact threading analysis in chat |
| 7 | Build `compute_rep_conversions` chat tool | 2 hr | Rep performance queries |
| 8 | Add evidence builders to 9 skills missing them | 3 hr | Structured findings for all skills |

### Tier 3 — New Capability (Requires Design)

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| 9 | Build remaining 10 chat tools (buyer signals, stakeholder status, etc.) | 2-3 days | Full MECE tool coverage |
| 10 | Activate document/task/call connectors | 1-2 days | Fills empty entity tables |
| 11 | Run ICP enrichment pipeline (Apollo + Serper) | 1 day | Populates enriched_accounts |
| 12 | Activate notification/delivery system | 1 day | Push delivery working |

### Do Not Build (Remove from Spec)

| Item | Reason |
|------|--------|
| query_product_usage | No product usage data source exists or is planned |
| compute_wallet_share | No data model for wallet share exists |
| compute_attention_score | Vague concept, no clear data source |

---

## Appendix: File Reference

| Area | Key Files |
|------|-----------|
| Chat tools | `server/chat/data-tools.ts`, `server/chat/pandora-agent.ts` |
| Skills | `server/skills/library/*.ts`, `server/skills/index.ts`, `server/skills/runtime.ts`, `server/skills/tool-definitions.ts` |
| Agents | `server/agents/definitions/*.ts`, `server/agents/runtime.ts`, `server/agents/registry.ts` |
| Renderers | `server/renderers/*.ts` |
| Migrations | `server/migrations/*.sql` |
| DB | `server/db.ts` |

---

## Fixes Applied (2026-02-24)

| Fix | Description | Status |
|-----|-------------|--------|
| 1. PPTX Registry | Replaced stub with wrapper class adapting `renderPPTX()` to `Renderer` interface. Added `templateMatrix` support. | DONE |
| 2. dependsOn Bugs | Fixed 3 skills referencing `outputKey` instead of step ID: `competitive-intelligence`, `stage-velocity-benchmarks`, `forecast-accuracy-tracking` | DONE |
| 3. Missing Migrations | Applied 5 migrations: `targets`, `quotas`, `deal_score_snapshots`, `report_share_links`, `tool_call_logs` | DONE |
| 4. field_change_log | Created table with indexes, backfilled 4,175 stage + 2,193 amount records from existing data. Unblocks `compute_shrink_rate` and `query_field_history`. | DONE |
