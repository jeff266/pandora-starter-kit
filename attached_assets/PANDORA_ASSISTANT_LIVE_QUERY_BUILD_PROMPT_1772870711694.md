# Pandora Build Prompt: Assistant Live Query Architecture
## Live Data + Change Detection + Rate Limiting + Prompt Caching + BYOK

**Status:** Ready to build  
**Depends on:** LLM Router (Session 12), existing `analysis_scopes`, `weekly_briefs`, `llm_configs` tables  
**Surfaces affected:** Assistant / Command Center VP Brief, brief assembler, LLM router  
**Core principle:** Assistant should be as truthful as Ask Pandora. The brief format and proactive narrative stay. The numbers underneath come from the same live query layer Ask Pandora uses — not a stale snapshot. Cost is controlled through change detection, rate limiting, and prompt caching. BYOK removes all limits.

---

## Before Starting

Read these files before writing a single line of code:

1. `server/briefs/brief-assembler.ts` — understand current brief assembly: how it reads skill_run snapshots, what `ai_blurbs` contains, how `the_number` and `deals_to_watch` are populated
2. `server/chat/data-tools.ts` — `queryDeals`, `computeMetric` — this is the live query layer Assistant will now use
3. `server/chat/pandora-agent.ts` — `runPandoraAgent` — understand how Ask Pandora orchestrates tool calls and synthesis
4. `server/llm/router.ts` (or equivalent) — the LLM router with BYOK support from Session 12
5. The `weekly_briefs` table schema — `assembled_at`, `ai_blurbs`, `the_number`, `deals_to_watch`, `fingerprint` (you will add this column)
6. The `llm_configs` table schema — `workspace_id`, `providers`, `routing`, `tokens_used_this_month` — understand BYOK provider key storage
7. The `workspace_configs` table — pipeline defaults, quota config, quarter dates
8. `client/src/components/assistant/ProactiveBriefing.tsx` — how the brief is rendered
9. The `brief_refresh_log` table — does it exist? If not, you will create it in T002
10. The existing `analysis_scopes` table — pipeline segment data used by the resolver

Do not proceed until you have read all ten.

---

## Architecture Overview

**Today (stale):**
```
CRM sync → skill_runs (snapshots) → brief-assembler reads snapshots → stores in weekly_briefs → UI reads weekly_briefs
```

**After this build (live):**
```
User opens Assistant / brief refresh triggered
  → Fingerprint check: has underlying data changed since last brief?
    → No change → serve cached brief (0 LLM tokens)
    → Changed → run live query pass (like Ask Pandora)
                → layer synthesis on top
                → store new brief + new fingerprint
                → serve to UI
```

**Cost controls:**
- Change detection: skip synthesis entirely when data hasn't changed
- Rate limiting: max 1 live regeneration per hour per workspace (configurable per plan)
- Prompt caching: Anthropic prompt caching on the synthesis system prompt + static context
- BYOK: workspace with own API key bypasses rate limits entirely

---

## T001 — Brief Data Fingerprint

**Files:** `migrations/051_brief_fingerprint.sql`, `server/briefs/fingerprint.ts` (new)

### Migration

```sql
-- migrations/051_brief_fingerprint.sql

ALTER TABLE weekly_briefs
  ADD COLUMN IF NOT EXISTS fingerprint VARCHAR(64),
  ADD COLUMN IF NOT EXISTS fingerprint_inputs JSONB,
  ADD COLUMN IF NOT EXISTS data_source VARCHAR(20) DEFAULT 'skill_snapshot',
  -- 'skill_snapshot' = old behavior, 'live_query' = new behavior
  ADD COLUMN IF NOT EXISTS live_query_at TIMESTAMPTZ;
  -- when the live query pass ran (may differ from assembled_at)

CREATE TABLE IF NOT EXISTS brief_refresh_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  triggered_by VARCHAR(30) NOT NULL,
  -- 'cron', 'material_sync_change', 'user_request', 'byok_unlimited'
  fingerprint_before VARCHAR(64),
  fingerprint_after VARCHAR(64),
  data_changed BOOLEAN NOT NULL,
  synthesis_ran BOOLEAN NOT NULL,
  tokens_used INTEGER DEFAULT 0,
  rate_limited BOOLEAN DEFAULT FALSE,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_brief_refresh_log_workspace ON brief_refresh_log(workspace_id, created_at DESC);
```

### Fingerprint computation

```typescript
// server/briefs/fingerprint.ts

import { createHash } from 'crypto';

export interface FingerprintInputs {
  // Core metrics — if any of these change, the brief is stale
  closed_won_qtd_amount: number;
  closed_won_qtd_count: number;
  open_pipeline_amount: number;
  open_pipeline_count: number;
  coverage_ratio: number;
  // Top deals (sorted by amount desc, top 10) — deal ID + amount + stage
  top_deals: Array<{ id: string; amount: number; stage: string; close_date: string }>;
  // Rep pipeline values (sorted by rep name for stability)
  rep_pipeline: Array<{ owner_id: string; pipeline_amount: number; closed_amount: number }>;
  // Quarter close date (changes if workspace updates quota period)
  quarter_end: string;
  quota_amount: number;
}

export async function computeBriefFingerprint(
  workspaceId: string,
  db: any
): Promise<{ fingerprint: string; inputs: FingerprintInputs }> {

  // Pull all inputs in one query batch — no LLM, pure SQL
  const [metricsRow] = await db.query(`
    WITH quarter_config AS (
      SELECT
        (workspace_configs.config->>'quarter_start')::date as quarter_start,
        (workspace_configs.config->>'quarter_end')::date as quarter_end,
        (workspace_configs.config->>'quota_amount')::numeric as quota_amount
      FROM workspace_configs
      WHERE workspace_id = $1
    ),
    closed_won AS (
      SELECT
        COALESCE(SUM(amount), 0) as amount,
        COUNT(*) as count
      FROM deals
      WHERE workspace_id = $1
        AND stage_normalized = 'closed_won'
        AND close_date >= (SELECT quarter_start FROM quarter_config)
        AND close_date <= (SELECT quarter_end FROM quarter_config)
    ),
    open_pipeline AS (
      SELECT
        COALESCE(SUM(amount), 0) as amount,
        COUNT(*) as count
      FROM deals
      WHERE workspace_id = $1
        AND stage_normalized NOT IN ('closed_won', 'closed_lost')
        AND close_date >= CURRENT_DATE
    ),
    top_deals AS (
      SELECT id, amount, stage_normalized as stage, close_date::text
      FROM deals
      WHERE workspace_id = $1
        AND stage_normalized NOT IN ('closed_won', 'closed_lost')
        AND close_date >= CURRENT_DATE
      ORDER BY amount DESC NULLS LAST
      LIMIT 10
    ),
    rep_pipeline AS (
      SELECT
        owner_id,
        COALESCE(SUM(CASE WHEN stage_normalized NOT IN ('closed_won','closed_lost')
          AND close_date >= CURRENT_DATE THEN amount ELSE 0 END), 0) as pipeline_amount,
        COALESCE(SUM(CASE WHEN stage_normalized = 'closed_won'
          AND close_date >= (SELECT quarter_start FROM quarter_config) THEN amount ELSE 0 END), 0) as closed_amount
      FROM deals
      WHERE workspace_id = $1
      GROUP BY owner_id
      ORDER BY owner_id
    )
    SELECT
      cw.amount as closed_won_amount,
      cw.count as closed_won_count,
      op.amount as open_pipeline_amount,
      op.count as open_pipeline_count,
      CASE WHEN qc.quota_amount > 0
        THEN ROUND((op.amount / qc.quota_amount)::numeric, 2)
        ELSE 0 END as coverage_ratio,
      qc.quarter_end::text as quarter_end,
      qc.quota_amount,
      json_agg(DISTINCT td.*) as top_deals,
      json_agg(DISTINCT rp.*) as rep_pipeline
    FROM closed_won cw, open_pipeline op, quarter_config qc,
         (SELECT json_agg(t.*) as j FROM top_deals t) td_agg,
         (SELECT json_agg(r.*) as j FROM rep_pipeline r) rp_agg
  `, [workspaceId]);

  const inputs: FingerprintInputs = {
    closed_won_qtd_amount: Number(metricsRow.closed_won_amount),
    closed_won_qtd_count: Number(metricsRow.closed_won_count),
    open_pipeline_amount: Number(metricsRow.open_pipeline_amount),
    open_pipeline_count: Number(metricsRow.open_pipeline_count),
    coverage_ratio: Number(metricsRow.coverage_ratio),
    top_deals: metricsRow.top_deals || [],
    rep_pipeline: metricsRow.rep_pipeline || [],
    quarter_end: metricsRow.quarter_end,
    quota_amount: Number(metricsRow.quota_amount),
  };

  // Stable serialization — sort arrays, round floats
  const stableString = JSON.stringify(inputs, (key, value) =>
    typeof value === 'number' ? Math.round(value) : value
  );

  const fingerprint = createHash('sha256').update(stableString).digest('hex').slice(0, 16);

  return { fingerprint, inputs };
}

export async function getLastBriefFingerprint(
  workspaceId: string,
  db: any
): Promise<string | null> {
  const row = await db.queryOne(`
    SELECT fingerprint FROM weekly_briefs
    WHERE workspace_id = $1
    ORDER BY assembled_at DESC
    LIMIT 1
  `, [workspaceId]);
  return row?.fingerprint || null;
}
```

**Acceptance:** `computeBriefFingerprint` runs in under 500ms, returns a 16-char hex fingerprint. Same data → same fingerprint. One deal closing → different fingerprint.

---

## T002 — Rate Limiter for Brief Refresh

**Files:** `server/briefs/rate-limiter.ts` (new), `server/briefs/brief-assembler.ts` (extend)

```typescript
// server/briefs/rate-limiter.ts

export interface RateLimitConfig {
  max_refreshes_per_hour: number;    // 1 for standard, unlimited for BYOK
  cooldown_minutes: number;          // minimum minutes between refreshes
  byok_unlimited: boolean;           // true if workspace has own API key
}

// Plan-based defaults — scaffolded for future plan types
// Today: everyone gets the same limit. Plans differentiate later.
const PLAN_RATE_LIMITS: Record<string, RateLimitConfig> = {
  design_partner: {
    max_refreshes_per_hour: 1,
    cooldown_minutes: 60,
    byok_unlimited: false,   // overridden at runtime if BYOK key present
  },
  starter: {
    max_refreshes_per_hour: 1,
    cooldown_minutes: 60,
    byok_unlimited: false,
  },
  growth: {
    max_refreshes_per_hour: 4,
    cooldown_minutes: 15,
    byok_unlimited: false,
  },
  // Future plans scaffold here — add without changing logic
};

const DEFAULT_LIMIT: RateLimitConfig = {
  max_refreshes_per_hour: 1,
  cooldown_minutes: 60,
  byok_unlimited: false,
};

export async function checkRefreshRateLimit(
  workspaceId: string,
  db: any
): Promise<{
  allowed: boolean;
  reason?: string;
  next_allowed_at?: string;
  is_byok: boolean;
}> {

  // Check if workspace has BYOK configured
  const llmConfig = await db.queryOne(`
    SELECT providers FROM llm_configs WHERE workspace_id = $1
  `, [workspaceId]);

  const hasByok = hasValidByokKey(llmConfig?.providers);

  if (hasByok) {
    return { allowed: true, is_byok: true };
  }

  // Get workspace plan (scaffold — today everyone is design_partner)
  const workspace = await db.queryOne(`
    SELECT plan_type FROM workspaces WHERE id = $1
  `, [workspaceId]);

  const planLimit = PLAN_RATE_LIMITS[workspace?.plan_type || 'design_partner'] || DEFAULT_LIMIT;

  // Check recent refresh log
  const recentRefreshes = await db.query(`
    SELECT created_at, synthesis_ran
    FROM brief_refresh_log
    WHERE workspace_id = $1
      AND synthesis_ran = true
      AND created_at >= NOW() - INTERVAL '1 hour'
    ORDER BY created_at DESC
  `, [workspaceId]);

  if (recentRefreshes.length >= planLimit.max_refreshes_per_hour) {
    const oldestInWindow = recentRefreshes[recentRefreshes.length - 1];
    const nextAllowedAt = new Date(
      new Date(oldestInWindow.created_at).getTime() + 60 * 60 * 1000
    );
    return {
      allowed: false,
      is_byok: false,
      reason: `Brief refreshed ${recentRefreshes.length} time(s) this hour. Add your own API key to unlock unlimited refreshes.`,
      next_allowed_at: nextAllowedAt.toISOString(),
    };
  }

  // Check cooldown
  if (recentRefreshes.length > 0) {
    const lastRefresh = recentRefreshes[0];
    const minutesSinceLastRefresh =
      (Date.now() - new Date(lastRefresh.created_at).getTime()) / 60000;

    if (minutesSinceLastRefresh < planLimit.cooldown_minutes) {
      const nextAllowedAt = new Date(
        new Date(lastRefresh.created_at).getTime() + planLimit.cooldown_minutes * 60 * 1000
      );
      return {
        allowed: false,
        is_byok: false,
        reason: `Brief was refreshed ${Math.round(minutesSinceLastRefresh)} minutes ago. Next refresh available in ${Math.round(planLimit.cooldown_minutes - minutesSinceLastRefresh)} minutes.`,
        next_allowed_at: nextAllowedAt.toISOString(),
      };
    }
  }

  return { allowed: true, is_byok: false };
}

function hasValidByokKey(providers: any): boolean {
  if (!providers) return false;
  // Check for any provider with a non-empty key
  return Object.values(providers).some(
    (p: any) => p?.api_key && p.api_key.length > 10
  );
}
```

**Acceptance:** A workspace with no BYOK key is blocked after 1 synthesis refresh per hour. A workspace with a BYOK key set in `llm_configs.providers` is never blocked. Rate limit status is logged to `brief_refresh_log`.

---

## T003 — Live Query Pass for Brief Assembly

**Files:** `server/briefs/live-query-assembler.ts` (new), `server/briefs/brief-assembler.ts` (extend)

This is the core architectural change. The brief assembler gets a new data collection path that runs live queries against the `deals` table — the same queries Ask Pandora uses — instead of reading from `skill_runs` snapshots.

```typescript
// server/briefs/live-query-assembler.ts

import { queryDeals } from '../chat/data-tools.js';
import { computeMetric } from '../chat/data-tools.js';
import { resolveDefaultPipeline, classifyQuestionIntent } from '../chat/pipeline-resolver.js';

export interface LiveBriefData {
  // The Number
  the_number: {
    attainment_pct: number;
    closed_won_amount: number;
    quota_amount: number;
    gap_amount: number;
    coverage_ratio: number;
    open_pipeline_amount: number;
    open_pipeline_count: number;
    days_remaining: number;
    quarter_end: string;
    pipeline_label: string;   // "Core Sales Pipeline (quota-bearing)"
  };

  // Top open deals — live from deals table
  deals_to_watch: Array<{
    id: string;
    name: string;
    amount: number;
    stage: string;
    owner_name: string;
    close_date: string;
    days_until_close: number;
    contact_count: number;
    days_since_activity: number | null;
    risk_flags: string[];   // populated from skill_runs if available, empty if not
  }>;

  // Rep performance — live
  rep_summary: Array<{
    owner_id: string;
    owner_name: string;
    pipeline_amount: number;
    closed_won_amount: number;
    coverage_ratio: number;
    deal_count: number;
  }>;

  // Change delta — what's different since last brief
  delta: {
    pipeline_change: number;      // + or - vs last fingerprint
    new_closed_won: Array<{ name: string; amount: number }>;
    newly_at_risk: Array<{ name: string; reason: string }>;
  } | null;   // null if first brief or no prior fingerprint

  // Data freshness metadata — shown in UI
  data_freshness: {
    queried_at: string;
    last_crm_sync_at: string | null;
    sync_lag_minutes: number | null;
  };
}

export async function assembleLiveBriefData(
  workspaceId: string,
  db: any
): Promise<LiveBriefData> {

  const now = new Date();

  // Load workspace config for quarter dates, quota, pipeline defaults
  const config = await db.queryOne(`
    SELECT config FROM workspace_configs WHERE workspace_id = $1
  `, [workspaceId]);

  const quarterStart = config?.config?.quarter_start || getDefaultQuarterStart();
  const quarterEnd = config?.config?.quarter_end || getDefaultQuarterEnd();
  const quotaAmount = config?.config?.quota_amount || 0;
  const daysRemaining = Math.max(0,
    Math.ceil((new Date(quarterEnd).getTime() - now.getTime()) / 86400000)
  );

  // Resolve default pipeline for attainment questions
  const pipelineResolution = await resolveDefaultPipeline(
    workspaceId, 'attainment', 'admin', ''
  );

  // 1. Closed Won QTD
  const closedWonResult = await db.query(`
    SELECT
      COALESCE(SUM(d.amount), 0) as total_amount,
      COUNT(*) as deal_count
    FROM deals d
    WHERE d.workspace_id = $1
      AND d.stage_normalized = 'closed_won'
      AND d.close_date >= $2
      AND d.close_date <= $3
      ${pipelineResolution.scope_ids
        ? `AND d.scope_id = ANY($4::uuid[])`
        : ''}
  `, pipelineResolution.scope_ids
    ? [workspaceId, quarterStart, quarterEnd, pipelineResolution.scope_ids]
    : [workspaceId, quarterStart, quarterEnd]
  );

  const closedWonAmount = Number(closedWonResult[0]?.total_amount || 0);

  // 2. Open pipeline
  const openPipelineResult = await db.query(`
    SELECT
      COALESCE(SUM(d.amount), 0) as total_amount,
      COUNT(*) as deal_count
    FROM deals d
    WHERE d.workspace_id = $1
      AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
      AND d.close_date >= CURRENT_DATE
      AND d.close_date <= $2
      ${pipelineResolution.scope_ids
        ? `AND d.scope_id = ANY($3::uuid[])`
        : ''}
  `, pipelineResolution.scope_ids
    ? [workspaceId, quarterEnd, pipelineResolution.scope_ids]
    : [workspaceId, quarterEnd]
  );

  const openPipelineAmount = Number(openPipelineResult[0]?.total_amount || 0);
  const openPipelineCount = Number(openPipelineResult[0]?.deal_count || 0);
  const coverageRatio = quotaAmount > 0
    ? Math.round((openPipelineAmount / (quotaAmount - closedWonAmount)) * 10) / 10
    : 0;

  // 3. Top open deals (live — not from skill_runs)
  const topDeals = await db.query(`
    SELECT
      d.id, d.name, d.amount, d.stage_normalized as stage,
      d.owner_name, d.close_date::text,
      DATE_PART('day', d.close_date - CURRENT_DATE)::int as days_until_close,
      COUNT(DISTINCT dc.contact_id) as contact_count,
      EXTRACT(EPOCH FROM (NOW() - MAX(a.occurred_at))) / 86400 as days_since_activity
    FROM deals d
    LEFT JOIN deal_contacts dc ON dc.deal_id = d.id AND dc.workspace_id = d.workspace_id
    LEFT JOIN activities a ON a.deal_id = d.id AND a.workspace_id = d.workspace_id
    WHERE d.workspace_id = $1
      AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
      AND d.close_date <= $2
      AND d.amount > 0
    GROUP BY d.id, d.name, d.amount, d.stage_normalized, d.owner_name, d.close_date
    ORDER BY d.amount DESC NULLS LAST
    LIMIT 15
  `, [workspaceId, quarterEnd]);

  // 4. Rep summary (live)
  const repSummary = await db.query(`
    SELECT
      d.owner_id,
      d.owner_name,
      COALESCE(SUM(CASE WHEN d.stage_normalized NOT IN ('closed_won','closed_lost')
        AND d.close_date <= $2 THEN d.amount ELSE 0 END), 0) as pipeline_amount,
      COALESCE(SUM(CASE WHEN d.stage_normalized = 'closed_won'
        AND d.close_date >= $3 THEN d.amount ELSE 0 END), 0) as closed_won_amount,
      COUNT(DISTINCT CASE WHEN d.stage_normalized NOT IN ('closed_won','closed_lost')
        AND d.close_date <= $2 THEN d.id END) as deal_count
    FROM deals d
    WHERE d.workspace_id = $1
    GROUP BY d.owner_id, d.owner_name
    HAVING COALESCE(SUM(CASE WHEN d.stage_normalized NOT IN ('closed_won','closed_lost')
      AND d.close_date <= $2 THEN d.amount ELSE 0 END), 0) > 0
       OR COALESCE(SUM(CASE WHEN d.stage_normalized = 'closed_won'
      AND d.close_date >= $3 THEN d.amount ELSE 0 END), 0) > 0
    ORDER BY pipeline_amount DESC
  `, [workspaceId, quarterEnd, quarterStart]);

  // 5. Last CRM sync time
  const lastSync = await db.queryOne(`
    SELECT MAX(completed_at) as last_sync_at
    FROM sync_log
    WHERE workspace_id = $1 AND status = 'success'
  `, [workspaceId]);

  const lastSyncAt = lastSync?.last_sync_at || null;
  const syncLagMinutes = lastSyncAt
    ? Math.round((now.getTime() - new Date(lastSyncAt).getTime()) / 60000)
    : null;

  // 6. Enrich deals with risk flags from latest skill_runs (best-effort overlay)
  const riskFlags = await loadRiskFlagsFromSkillRuns(workspaceId, db);

  const dealsToWatch = topDeals.map((d: any) => ({
    ...d,
    amount: Number(d.amount),
    contact_count: Number(d.contact_count),
    days_since_activity: d.days_since_activity ? Math.round(Number(d.days_since_activity)) : null,
    risk_flags: riskFlags[d.id] || [],
  }));

  return {
    the_number: {
      attainment_pct: quotaAmount > 0
        ? Math.round((closedWonAmount / quotaAmount) * 100)
        : 0,
      closed_won_amount: closedWonAmount,
      quota_amount: quotaAmount,
      gap_amount: Math.max(0, quotaAmount - closedWonAmount),
      coverage_ratio: coverageRatio,
      open_pipeline_amount: openPipelineAmount,
      open_pipeline_count: openPipelineCount,
      days_remaining: daysRemaining,
      quarter_end: quarterEnd,
      pipeline_label: pipelineResolution.assumption_label,
    },
    deals_to_watch: dealsToWatch,
    rep_summary: repSummary.map((r: any) => ({
      ...r,
      pipeline_amount: Number(r.pipeline_amount),
      closed_won_amount: Number(r.closed_won_amount),
      deal_count: Number(r.deal_count),
      coverage_ratio: quotaAmount > 0
        ? Math.round((Number(r.pipeline_amount) / (quotaAmount / repSummary.length)) * 10) / 10
        : 0,
    })),
    delta: null,  // populated in T004 delta detection
    data_freshness: {
      queried_at: now.toISOString(),
      last_crm_sync_at: lastSyncAt,
      sync_lag_minutes: syncLagMinutes,
    },
  };
}

// Best-effort: pull risk flags from latest skill_run outputs without blocking on them
async function loadRiskFlagsFromSkillRuns(
  workspaceId: string,
  db: any
): Promise<Record<string, string[]>> {
  try {
    const rows = await db.query(`
      SELECT sr.result_data
      FROM skill_runs sr
      WHERE sr.workspace_id = $1
        AND sr.skill_id IN ('pipeline-hygiene', 'single-thread-alert', 'deal-risk-review')
        AND sr.status = 'completed'
        AND sr.completed_at >= NOW() - INTERVAL '48 hours'
      ORDER BY sr.completed_at DESC
    `, [workspaceId]);

    const flags: Record<string, string[]> = {};
    for (const row of rows) {
      const claims = row.result_data?.claims || [];
      for (const claim of claims) {
        if (claim.entity_id) {
          if (!flags[claim.entity_id]) flags[claim.entity_id] = [];
          flags[claim.entity_id].push(claim.message);
        }
      }
    }
    return flags;
  } catch {
    return {};  // fail silently — risk flags are a bonus overlay, not required
  }
}
```

**Acceptance:** `assembleLiveBriefData` returns correct attainment, open pipeline, coverage, top deals, and rep summary from the live `deals` table. Risk flags are overlaid from skill_runs when available but don't block brief assembly if unavailable.

---

## T004 — Synthesis Layer on Top of Live Data

**Files:** `server/briefs/brief-assembler.ts` (rewrite the assembly section)

The synthesis layer takes `LiveBriefData` and produces the narrative `ai_blurbs`. This is where Claude runs — on top of structured, pre-computed data. No LLM math. No LLM querying.

```typescript
// server/briefs/brief-assembler.ts — new assembly function

import { assembleLiveBriefData } from './live-query-assembler.js';
import { computeBriefFingerprint, getLastBriefFingerprint } from './fingerprint.js';
import { checkRefreshRateLimit } from './rate-limiter.js';
import { callLLM } from '../llm/router.js';

export async function assembleLiveBrief(
  workspaceId: string,
  triggeredBy: 'cron' | 'material_sync_change' | 'user_request',
  db: any
): Promise<{
  brief: any;
  skipped: boolean;
  skip_reason?: string;
  synthesis_ran: boolean;
  tokens_used: number;
}> {

  const startTime = Date.now();

  // Step 1: Check rate limit (skip for cron and material_sync_change triggers)
  if (triggeredBy === 'user_request') {
    const rateLimit = await checkRefreshRateLimit(workspaceId, db);
    if (!rateLimit.allowed) {
      await logRefreshAttempt(workspaceId, db, {
        triggered_by: triggeredBy,
        data_changed: false,
        synthesis_ran: false,
        rate_limited: true,
        tokens_used: 0,
        duration_ms: Date.now() - startTime,
      });
      return {
        brief: await getLatestBrief(workspaceId, db),
        skipped: true,
        skip_reason: rateLimit.reason,
        synthesis_ran: false,
        tokens_used: 0,
      };
    }
  }

  // Step 2: Compute fingerprint
  const { fingerprint, inputs } = await computeBriefFingerprint(workspaceId, db);
  const lastFingerprint = await getLastBriefFingerprint(workspaceId, db);
  const dataChanged = fingerprint !== lastFingerprint;

  // Step 3: If nothing changed, serve cached brief
  if (!dataChanged && lastFingerprint !== null) {
    await logRefreshAttempt(workspaceId, db, {
      triggered_by: triggeredBy,
      fingerprint_before: lastFingerprint,
      fingerprint_after: fingerprint,
      data_changed: false,
      synthesis_ran: false,
      rate_limited: false,
      tokens_used: 0,
      duration_ms: Date.now() - startTime,
    });
    return {
      brief: await getLatestBrief(workspaceId, db),
      skipped: true,
      skip_reason: 'No data changes since last brief',
      synthesis_ran: false,
      tokens_used: 0,
    };
  }

  // Step 4: Run live query pass
  const liveData = await assembleLiveBriefData(workspaceId, db);

  // Step 5: Compute delta vs prior brief
  const priorBrief = await getLatestBrief(workspaceId, db);
  if (priorBrief?.the_number) {
    liveData.delta = computeDelta(liveData, priorBrief);
  }

  // Step 6: Synthesize narrative — Claude on top of structured data
  const { narrative, tokensUsed } = await synthesizeBriefNarrative(
    workspaceId, liveData, db
  );

  // Step 7: Store new brief
  const newBrief = await storeBrief(workspaceId, db, {
    liveData,
    narrative,
    fingerprint,
    fingerprintInputs: inputs,
    assembledAt: new Date().toISOString(),
    dataSource: 'live_query',
    liveQueryAt: liveData.data_freshness.queried_at,
  });

  await logRefreshAttempt(workspaceId, db, {
    triggered_by: triggeredBy,
    fingerprint_before: lastFingerprint,
    fingerprint_after: fingerprint,
    data_changed: true,
    synthesis_ran: true,
    rate_limited: false,
    tokens_used: tokensUsed,
    duration_ms: Date.now() - startTime,
  });

  return { brief: newBrief, skipped: false, synthesis_ran: true, tokens_used: tokensUsed };
}

function computeDelta(current: LiveBriefData, prior: any): LiveBriefData['delta'] {
  const priorPipeline = prior.the_number?.open_pipeline_amount || 0;
  const currentPipeline = current.the_number.open_pipeline_amount;

  const priorDealIds = new Set((prior.deals_to_watch || []).map((d: any) => d.id));
  const currentDealIds = new Set(current.deals_to_watch.map(d => d.id));

  // Deals that closed won since last brief
  const newClosedWon = current.deals_to_watch
    .filter(d => !priorDealIds.has(d.id) && d.stage === 'closed_won')
    .map(d => ({ name: d.name, amount: d.amount }));

  // Deals now at risk (stale 14+ days) that weren't in prior brief
  const newlyAtRisk = current.deals_to_watch
    .filter(d => d.days_since_activity !== null && d.days_since_activity >= 14)
    .filter(d => {
      const priorDeal = (prior.deals_to_watch || []).find((p: any) => p.id === d.id);
      return !priorDeal || (priorDeal.days_since_activity || 0) < 14;
    })
    .map(d => ({ name: d.name, reason: `No activity in ${d.days_since_activity} days` }));

  return {
    pipeline_change: currentPipeline - priorPipeline,
    new_closed_won: newClosedWon,
    newly_at_risk: newlyAtRisk,
  };
}
```

**Acceptance:** `assembleLiveBrief` correctly skips synthesis when data hasn't changed. When data has changed, it runs the live query pass and synthesis. Delta is correctly computed. All runs are logged to `brief_refresh_log`.

---

## T005 — Prompt Caching on Brief Synthesis

**Files:** `server/briefs/brief-assembler.ts` (synthesis function), `server/llm/router.ts`

Prompt caching reduces cost when the same synthesis prompt is called repeatedly — which happens during testing and when a user refreshes without data changes being detected (shouldn't happen with fingerprinting, but is a safety net).

Anthropic's prompt caching works by marking a portion of the prompt with `cache_control: { type: "ephemeral" }`. The cached portion must be at least 1024 tokens. The static system prompt + workspace context is the right content to cache — it doesn't change between calls for the same workspace.

```typescript
// In the synthesis function — use cache_control on static content

async function synthesizeBriefNarrative(
  workspaceId: string,
  liveData: LiveBriefData,
  db: any
): Promise<{ narrative: BriefNarrative; tokensUsed: number }> {

  // Static context — cached across calls for this workspace
  const workspaceContext = await getWorkspaceContext(workspaceId, db);
  // Includes: company name, rep names, pipeline config, quarter dates, quota
  // This content is stable between brief runs — good cache candidate

  const systemPrompt = buildBriefSystemPrompt();
  // ~500 tokens of instructions — also stable

  const staticCacheBlock = `${systemPrompt}

<workspace_context>
${workspaceContext}
</workspace_context>`;
  // Total static content: ~800-1200 tokens — above the 1024 minimum for caching

  // Dynamic content — changes every brief run — NOT cached
  const dynamicContent = buildDynamicBriefContent(liveData);
  // ~600-1000 tokens of current metrics, deals, deltas

  const messages = [
    {
      role: 'user' as const,
      content: [
        {
          type: 'text' as const,
          text: staticCacheBlock,
          // Mark for caching — Anthropic will cache this block
          cache_control: { type: 'ephemeral' as const },
        },
        {
          type: 'text' as const,
          text: dynamicContent,
          // No cache_control — this changes every call
        },
      ],
    },
  ];

  const response = await callLLM(workspaceId, 'reason', {
    messages,
    maxTokens: 1200,
    temperature: 0.4,
    _tracking: {
      workspaceId,
      skillId: 'brief-synthesis',
      phase: 'synthesize',
      stepName: 'narrative',
    },
  });

  // Track cache hits in usage — Anthropic returns cache_read_input_tokens
  const tokensUsed = (response.usage?.input_tokens || 0)
    + (response.usage?.output_tokens || 0)
    - (response.usage?.cache_read_input_tokens || 0);
  // Subtract cache reads — they cost 10% of normal input token price

  const narrative = parseBriefNarrative(response.content);

  return { narrative, tokensUsed };
}

function buildBriefSystemPrompt(): string {
  return `You are the VP RevOps analyst embedded in this team. You have already looked at the data before anyone got in. You have a point of view and you're prepared to defend it.

VOICE RULES:
- Use "we" and "I" — you own the number with the team
- Make calls. "The commit number doesn't reflect what I'm seeing" not "there may be risk"
- Name people and deals. Generic findings are useless.
- State the one thing that matters most this week as your focus — not a suggestion, a directive
- Never present a relative number without the absolute base
- Never state causation — state correlation and invite investigation
- Hedged language for low-confidence observations: "early signal", "worth watching"
- Direct language for high-confidence findings: "We have a problem here"

OUTPUT FORMAT (JSON):
{
  "week_summary": "2-3 sentence narrative of current state in the teammate voice",
  "pulse_summary": "1 sentence — the single most important thing right now",
  "key_action": "The one concrete action for this week — specific, named, time-bound",
  "rep_observations": "1-2 sentences about rep-level patterns worth noting",
  "risk_narrative": "1-2 sentences on the biggest risk to the quarter, if any"
}`;
}

function buildDynamicBriefContent(liveData: LiveBriefData): string {
  const n = liveData.the_number;
  const deals = liveData.deals_to_watch.slice(0, 8);
  const reps = liveData.rep_summary;

  return `<current_data queried_at="${liveData.data_freshness.queried_at}">
ATTAINMENT: ${n.attainment_pct}% ($${formatM(n.closed_won_amount)} closed of $${formatM(n.quota_amount)} quota)
GAP: $${formatM(n.gap_amount)} remaining | ${n.days_remaining} days left | ${n.pipeline_label}
COVERAGE: ${n.coverage_ratio}x ($${formatM(n.open_pipeline_amount)} open pipeline, ${n.open_pipeline_count} deals)

TOP OPEN DEALS:
${deals.map(d =>
  `- ${d.name}: $${formatK(d.amount)} | ${d.stage} | ${d.owner_name} | closes ${d.close_date} | ${d.contact_count} contacts | ${d.days_since_activity ? `${d.days_since_activity}d since activity` : 'activity recent'}${d.risk_flags.length > 0 ? ` | FLAGS: ${d.risk_flags[0]}` : ''}`
).join('\n')}

REPS:
${reps.map(r =>
  `- ${r.owner_name}: $${formatM(r.pipeline_amount)} pipeline | $${formatM(r.closed_won_amount)} closed | ${r.coverage_ratio}x coverage | ${r.deal_count} deals`
).join('\n')}

${liveData.delta ? `
CHANGES SINCE LAST BRIEF:
- Pipeline movement: ${liveData.delta.pipeline_change >= 0 ? '+' : ''}$${formatK(liveData.delta.pipeline_change)}
${liveData.delta.new_closed_won.length > 0 ? `- New closed won: ${liveData.delta.new_closed_won.map(d => `${d.name} ($${formatK(d.amount)})`).join(', ')}` : ''}
${liveData.delta.newly_at_risk.length > 0 ? `- Newly at risk: ${liveData.delta.newly_at_risk.map(d => `${d.name} (${d.reason})`).join(', ')}` : ''}
` : ''}
</current_data>

Write the brief narrative in the specified JSON format.`;
}

function formatM(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(Math.round(n));
}

function formatK(n: number): string {
  if (Math.abs(n) >= 1000) return `${Math.round(n / 1000)}K`;
  return String(Math.round(n));
}
```

**Acceptance:** Brief synthesis uses `cache_control` on the static system prompt + workspace context block. Two consecutive synthesis calls for the same workspace show `cache_read_input_tokens > 0` in the second call's usage. Token cost for cached calls is measurably lower.

---

## T006 — Wire Into Brief Refresh Endpoint + Frontend

**Files:** `server/routes/briefs.ts` (or equivalent), `client/src/pages/AssistantView.tsx`, `client/src/components/assistant/ProactiveBriefing.tsx`

### Backend — Refresh endpoint

The existing brief endpoint (likely `GET /api/workspaces/:id/brief`) gets a companion:

```
POST /api/workspaces/:id/brief/refresh
```

Request body:
```json
{ "force": false }
```

Response:
```json
{
  "brief": { ... },
  "refreshed": true,
  "synthesis_ran": true,
  "skipped": false,
  "tokens_used": 847,
  "is_byok": false,
  "next_refresh_allowed_at": null,
  "data_freshness": {
    "queried_at": "2026-03-07T03:41:00Z",
    "last_crm_sync_at": "2026-03-07T01:01:00Z",
    "sync_lag_minutes": 160
  }
}
```

When rate limited:
```json
{
  "brief": { ... },
  "refreshed": false,
  "skipped": true,
  "skip_reason": "Brief refreshed 1 time this hour. Add your own API key to unlock unlimited refreshes.",
  "next_refresh_allowed_at": "2026-03-07T04:41:00Z",
  "is_byok": false
}
```

### Frontend — Refresh button + rate limit messaging

In `ProactiveBriefing.tsx`, the refresh button (`↻` from T009 in the trust prompt) now calls the refresh endpoint and handles the rate limit response:

```typescript
const handleRefresh = async () => {
  setRefreshing(true);
  const result = await fetch(`/api/workspaces/${workspaceId}/brief/refresh`, {
    method: 'POST',
    body: JSON.stringify({ force: false }),
  }).then(r => r.json());

  if (result.skipped && result.skip_reason) {
    setRefreshMessage(result.skip_reason);
    if (result.next_refresh_allowed_at) {
      setNextRefreshAt(new Date(result.next_refresh_allowed_at));
    }
  } else {
    setBrief(result.brief);
    setRefreshMessage(null);
  }
  setRefreshing(false);
};
```

When rate limited, show below the refresh button:
```
Next refresh available at 4:41 PM · Add your API key for unlimited refreshes →
```

The "Add your API key" link goes to workspace settings → LLM Config (from Session 12's BYOK setup).

### BYOK unlock messaging

When a workspace successfully configures a BYOK key in `llm_configs`, the rate limit check returns `allowed: true, is_byok: true` and the refresh button shows no cooldown messaging. The settings page should make this benefit explicit: "Your API key is active — unlimited brief refreshes enabled."

**Acceptance:** Refresh button calls the live assembler. First call in an hour succeeds and shows fresh data. Second call within the hour shows the rate limit message with next available time. BYOK workspace refreshes unlimited times without rate limit messages.

---

## T007 — Plan Scaffolding in Workspace Schema

**Files:** `migrations/052_workspace_plans.sql`

This doesn't implement plan gating yet — it sets up the schema so plans can be added later without a migration.

```sql
-- migrations/052_workspace_plans.sql

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS plan_type VARCHAR(20) DEFAULT 'design_partner',
  ADD COLUMN IF NOT EXISTS plan_started_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS plan_features JSONB DEFAULT '{}';
  -- Stores plan-specific feature flags:
  -- { "max_brief_refreshes_per_hour": 1, "byok_enabled": true, "chart_renderer": true }

-- Seed existing workspaces as design_partner
UPDATE workspaces SET plan_type = 'design_partner' WHERE plan_type IS NULL;

-- Future plan values: 'design_partner', 'starter', 'growth', 'consultant'
-- PLAN_RATE_LIMITS in rate-limiter.ts already has entries for all four
```

**Acceptance:** `workspaces.plan_type` column exists and defaults to `design_partner`. The rate limiter reads this column and applies `PLAN_RATE_LIMITS['design_partner']` correctly.

---

## Sequencing

```
T001 (fingerprint) — independent, build first
T002 (rate limiter) — independent, build in parallel with T001
T003 (live query assembler) — depends on T001 for fingerprint integration
T004 (synthesis layer) — depends on T003
T005 (prompt caching) — depends on T004 (wraps synthesis call)
T006 (endpoint + frontend) — depends on T004, T002
T007 (plan schema) — independent, build anytime
```

T001 + T002 + T007 can all run in parallel. T003 → T004 → T005 is a sequential chain. T006 wraps everything.

---

## What NOT to Build Here

- Plan upgrade flow / billing — scaffold only (T007)
- Multi-model brief synthesis (always Claude for now — BYOK substitutes the key, not the model)
- Streaming brief updates (polling on page focus is fine for v1)
- Per-skill refresh rate limits (the brief is the unit of rate limiting, not individual skills)
- Brief version history UI (logs exist in brief_refresh_log, UI is future)

---

## Acceptance Criteria

1. **Brief shows live attainment.** Open Command Center after ACES closes. Attainment reflects the closed deal without requiring a manual sync or waiting for the 7 AM cron.

2. **No-change calls cost zero tokens.** Click refresh twice in a row without any CRM activity between them. Second call returns the cached brief immediately, logs `synthesis_ran: false`, charges 0 tokens.

3. **Rate limit enforces 1 refresh/hour.** Click refresh. Wait 5 minutes. Click refresh again. Second call returns the rate limit message with the next allowed time.

4. **BYOK bypasses rate limit.** Configure a valid Anthropic API key in workspace settings. Click refresh 10 times in 10 minutes. Every call succeeds. No rate limit messages.

5. **Prompt caching is active.** Check LLM usage logs after two consecutive brief syntheses for the same workspace. Second call shows `cache_read_input_tokens > 0` and lower effective cost.

6. **Teammate voice is correct.** The brief says "we" and "I." It makes a call about the quarter. It names a specific deal and rep. It ends with a concrete action, not a suggestion.

7. **Pipeline label is surfaced.** Brief always shows which pipeline the numbers are scoped to ("Showing Core Sales Pipeline (quota-bearing)").

8. **Risk flags from skill_runs overlay correctly.** If pipeline-hygiene ran in the last 48 hours and flagged a deal, that deal shows the flag in `deals_to_watch.risk_flags`. If no skill run is available, the deal shows with no flags — brief still assembles.

9. **Plan scaffolding is in place.** `workspaces.plan_type` column exists. All existing workspaces are `design_partner`. `PLAN_RATE_LIMITS` in the rate limiter has entries for all four future plan types.

10. **No regression on Ask Pandora.** The live query functions in `data-tools.ts` are unchanged. Ask Pandora continues to work exactly as before. The brief assembler calls the same underlying query functions but orchestrates them independently.
