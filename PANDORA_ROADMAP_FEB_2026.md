# Pandora Platform Roadmap
## Updated February 12, 2026

---

## WHAT'S SHIPPED

### Data Connectors — Production
| Connector | Status | Data |
|-----------|--------|------|
| HubSpot | ✅ Live | 6,062 records (Frontera Health) |
| Salesforce | ✅ Live (hardened) | 617 deals synced, OAuth with PKCE, token refresh, stage history, activities, nightly cron, file import upgrade path |
| Gong | ✅ Live | 66 calls synced |
| Fireflies | ✅ Live | 21 calls synced |
| File Import (CSV/Excel) | ✅ Live | AI column classification, stage mapping, 3 re-upload strategies (replace/merge/append), deduplication detection with recommendations, snapshot diffing for deal stage history |

### Cross-Entity Linking
| Capability | Status |
|-----------|--------|
| Email-based conversation → account matching | ✅ 20/22 Gong conversations matched |
| Single-deal inference | ✅ Automatic deal linking when account has one open deal |
| Internal meeting filter | ✅ Prevents false positive deal linking |
| Association inference for file imports | ✅ Domain + company name matching |

### Skills — All 13 Validated Against Production Data (Frontera Health)
| # | Skill | Category | Schedule | Token Budget | Status |
|---|-------|----------|----------|-------------|--------|
| 1 | Pipeline Hygiene | pipeline | Mon 8 AM | ✅ On target | Production |
| 2 | Deal Risk Review | pipeline | Post-sync | ✅ On target | Production |
| 3 | Weekly Recap | reporting | Fri 4 PM | ✅ On target | Production |
| 4 | Single Thread Alert | pipeline | Mon 8 AM | ✅ On target | Production |
| 5 | Data Quality Audit | operations | Mon 8 AM | ✅ On target | Production |
| 6 | Pipeline Coverage by Rep | pipeline | Mon 8 AM | ✅ On target | Production |
| 7 | Forecast Roll-up (v3.0) | forecasting | Mon 8 AM | ✅ On target | Production |
| 8 | Pipeline Waterfall | pipeline | Mon 8 AM | ✅ Optimized (37K → 2.6K) | Production |
| 9 | Rep Scorecard | reporting | Fri 4 PM | ✅ Optimized (110K → 2.5K) | Production |
| 10 | Custom Field Discovery | operations | On demand | ✅ Compute-only | Production |
| 11 | Lead Scoring | scoring | On demand | ✅ 2,821 tokens | Production |
| 12 | Contact Role Resolution | operations | On demand | ✅ Compute-only | Production |
| 13 | ICP Discovery | intelligence | On demand | ✅ 4,879 tokens | Production |

**Weekly cost for all 13 skills per workspace: ~$1.00**
**Projected cost at 100 workspaces: ~$100/month**

### Infrastructure
| Component | Status |
|-----------|--------|
| Three-phase skill pattern (Compute → DeepSeek → Claude) | ✅ Enforced across all skills |
| LLM routing (Anthropic Claude + DeepSeek via Fireworks) | ✅ Provider adapters live |
| Skill cron scheduler with staggered execution | ✅ Monday AM + Friday PM cycles |
| Workspace configuration layer (stage mapping, department patterns, role fields, grade thresholds) | ✅ 7 REST endpoints, context_layer storage |
| Quota upload with AI-assisted column mapping | ✅ Excel/CSV parsing, DeepSeek classification |
| Deal stage history tracking | ✅ 1,481 transitions backfilled for Frontera + snapshot diffing for file re-uploads |
| Slack integration for skill output | ✅ Formatted reports delivered |
| Graceful degradation across all skills for sparse/file-imported data | ✅ Data freshness tracking, conditional sections |
| End-to-end file import test suite (Prompts 1-9) | ✅ Comprehensive tests for upload, classification, linking, re-upload strategies, snapshot diffing |
| Token budget optimization | ✅ Two major reductions (93% and 98%) |
| Salesforce ID normalization (15-char ↔ 18-char) | ✅ Applied across adapter, file import upgrade, and matching logic |
| Salesforce end-to-end test suite | ✅ 536 lines, 12 test groups, 28 assertions |

### Validation Sprint Results
- 13 skills validated against Frontera Health production data
- 4 bugs caught and fixed (JSONB casting, column naming, output persistence, DeepSeek model deprecation)
- 2 token budget optimizations (combined savings: ~142K tokens per run)
- Comprehensive end-to-end file import test suite (Prompts 1-9 coverage: upload, classification, association inference, re-upload strategies, snapshot diffing, data freshness)

---

## WHAT'S NEXT — Priority Order

### ~~1. Salesforce OAuth Hardening~~ ✅ COMPLETE (Feb 12, 2026)
All 6 prompts implemented. OAuth with PKCE + HMAC state signing, token refresh at 90-min threshold, stage history from OpportunityFieldHistory, activity sync with 6-month filter, nightly cron scheduler, file import → Salesforce upgrade path with 15/18-char ID normalization, 536-line end-to-end test suite. Production-ready.

### 1. Conversation Intelligence Expansion
**Effort:** Medium-Large | **Specs:** `PANDORA_INTERNAL_FILTER_AND_CWD_SPEC.md`, `PANDORA_ICP_CONVERSATION_INTELLIGENCE_ADDENDUM.md`
**Why now:** Cross-entity linker is built and matching 20/22 Gong conversations to accounts. The infrastructure is ready — the intelligence layer on top is what makes conversation data actionable.

#### 2a. Conversations Without Deals (CWD)
Identifies engagement gaps where prospects are active (calls happening) but deals aren't logged in the CRM. Integrates into Data Quality Audit (as step 2.5) and Pipeline Coverage by Rep (as shadow pipeline metric).

Key deliverables:
- `findConversationsWithoutDeals()` with account enrichment and severity classification
- Data Quality Audit: new section surfacing conversation coverage gaps
- Pipeline Coverage: per-rep shadow pipeline metric from untracked conversations
- DeepSeek classification of CWD items (new root cause: `active_not_logging`)

#### 2b. Conversation Signals in ICP Discovery
Adds behavioral patterns from call transcripts to the ICP model. Moves ICP Discovery from firmographic + engagement patterns to behavioral patterns.

Key deliverables:
- Step 2.5 in ICP Discovery: extract conversation signals (metadata + DeepSeek transcript classification)
- Feature matrix expansion with conversation metrics (talk ratio, call density, question rate)
- Lead Scoring weight additions for conversation signals
- Coverage-based degradation (skip conversation features if coverage < 30%)

### 2. Otter.ai → Zapier → Pandora Connector
**Effort:** Small-Medium | **Customer:** Imubit specifically
**Why now:** Imubit uses Otter.ai for calls (no API). The path is: Otter → Zapier → Zapier Tables → Pandora sync via new `zapier-table` connector type. This is a new connector type, not a modification to existing connectors.

Key deliverables:
- New `zapier-table` connector type in the adapter registry
- Sync from Zapier Tables API to normalized conversations table
- Transform layer mapping Otter.ai transcript format to Pandora schema
- Cross-entity linker compatibility (same email-based matching)

### 3. ICP Discovery External Enrichment Pipeline
**Effort:** Large | **Spec:** `PANDORA_LEAD_SCORING_SKILL_SPECS.md`
**Why now:** ICP Discovery runs on CRM data today and produces useful output (validated: VP Operations 3.2x lift, 51-200 employee sweet spot, partner referral 50% win rate). External enrichment adds firmographic, technographic, and career data to build data-driven profiles that go beyond what's in the CRM.

Key deliverables:
- Closed Deal Enrichment skill: Apollo (firmographics), Serper (company context), LinkedIn (career data)
- External API integration with rate limiting, cost tracking, and caching
- Enriched feature matrix feeding ICP Discovery and Lead Scoring
- Token budget: ~$4.20/month per active workspace (API costs dominate)

### 4. Agent Builder / Self-Serve Skill Creation
**Effort:** Large | **Timeline:** Further out
**Why now (to spec):** The skill framework is proven (13 skills, three-phase pattern, token optimization). The next step is letting consultants build custom skills without code. Requires visible tradeoffs in the UI.

Key requirements (from previous discussions):
- Token cost meter — show estimated cost per run before deploying
- Framework conflict detection — warn when a new skill overlaps with existing ones
- Alert fatigue projections — estimate notification volume before enabling
- Focus score — how much of the workspace's data this skill actually uses
- Hard caps — per-workspace token budget limits to prevent runaway costs

---

## BACKLOG — Not Prioritized

| Item | Notes |
|------|-------|
| Credential encryption at rest | Before connecting external customer orgs. Small effort, high trust signal. |
| Dashboard UI | Connector status, skill results, pipeline snapshot. Makes everything visible. |
| LLM Router BYOK | Workspace-level LLM config, capability-based routing, support for Anthropic/OpenAI/Fireworks/Google. |
| Monday.com connector | Adapter exists in codebase audit, not yet wired. |
| Asana connector | Adapter exists in codebase audit, not yet wired. |
| Google Drive connector | Adapter exists in codebase audit, not yet wired. |
| Bi-directional CRM sync | Currently read-only. Write-back enables auto-updating deal stages, creating tasks from skill recommendations. |
| CWD → Auto Deal Creation | For opt-in workspaces, CWD findings trigger automated deal creation in HubSpot/Salesforce. Premium automation feature. |
| Internal Meeting Intelligence | Internal meetings currently filtered out. Could power process intelligence (meeting load, cross-team collaboration patterns). |
| Real-time Salesforce webhooks | Requires Streaming API setup. Currently polling via scheduled sync. |
| Multi-tenant scaling (Neon) | PostgreSQL with Neon for database-per-tenant. Not needed until customer count demands it. |

---

## PRINCIPLES

1. **Ship functional code over specs.** Depth over breadth. Finish WIP before starting new tracks.
2. **Test against production data.** Real data reveals issues mock data cannot (HubSpot empty date strings, forecast category derivation, internal meeting false positives — all invisible until real data hit).
3. **Compute first, LLM last.** The three-phase pattern (Compute → DeepSeek → Claude) delivers 95%+ cost reduction. If Claude needs tool calls during synthesis, the compute phase didn't aggregate enough.
4. **Graceful degradation always.** Every skill must work with whatever data exists. File-imported data is sparser than API-synced — handle it without crashing or showing empty sections.
5. **Workspace isolation is non-negotiable.** Every query scoped by workspace_id. Defensive query patches. Cross-tenant data leakage is a platform-killing bug.
6. **Token budget is unit economics.** 13 skills at ~$1/week per workspace is viable. At 10x that, it's not. Monitor and optimize continuously.

---

## KEY REFERENCE DOCS

| Document | Purpose |
|----------|---------|
| `PANDORA_SKILL_DESIGN_GUIDE.md` | Mandatory three-phase pattern, token budgets, validation rules |
| `PANDORA_TIER1_SKILL_SPECS.md` | All 6 original Tier 1 skill specifications |
| `PANDORA_SALESFORCE_BUILD_PROMPTS.md` | 6-prompt Salesforce integration sequence |
| `PANDORA_FILE_IMPORT_CONNECTOR_SPEC.md` | File import data model, classification, association inference |
| `PANDORA_FILE_IMPORT_BUILD_PROMPTS.md` | 9-prompt file import build sequence |
| `PANDORA_INTERNAL_FILTER_AND_CWD_SPEC.md` | Internal meeting filter + Conversations Without Deals |
| `PANDORA_ICP_CONVERSATION_INTELLIGENCE_ADDENDUM.md` | Conversation signals in ICP Discovery |
| `PANDORA_LEAD_SCORING_SKILL_SPECS.md` | ICP Discovery + Lead Scoring + external enrichment pipeline |
| `PANDORA_REP_SCORECARD_PROMPT.md` | Rep Scorecard full build prompt |
| `PANDORA_PIPELINE_WATERFALL_PROMPT.md` | Pipeline Waterfall full build prompt |
| `PANDORA_FORECAST_ROLLUP_BUILD_PROMPT.md` | Forecast Roll-up full build prompt |
| `CLAUDE_CODE_SYNC_HARDENING.md` | Sync reliability: throttling, retry-on-429, incremental sync |
| `REPLIT_CONTEXT.md` | Replit environment context and patterns |
