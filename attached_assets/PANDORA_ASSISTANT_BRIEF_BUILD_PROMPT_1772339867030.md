# Claude Code Prompt: The Assistant — Brief-First Architecture

## Vision

The Assistant is a chief of staff, not a chatbot. It does the work before you arrive, lets you pull threads by tapping, and investigates on demand. The **brief** is the primary interface. The conversation input is secondary.

Three zoom levels on one surface:

```
BRIEF (zoomed out)     → scan in 90 seconds, the work is done
  tap any section      ↓
DETAIL (zoomed in)     → expanded tables, deal cards, rep profiles
  ask a question       ↓
INVESTIGATION (focused) → operators recruit, findings stream, synthesis
```

**Critical architectural rule:** The brief is the first cache layer. When a user asks a question, check the brief BEFORE routing to the complexity gate. If the brief already contains the answer, return it instantly with zero AI calls.

```
User asks question
    │
    ▼
Brief has the answer? ──yes──→ Return from brief. 0 tokens. Instant.
    │ no
    ▼
Tier 0: SQL query? ──yes──→ Run query. 0 tokens. <2s.
    │ no
    ▼
Tier 1-3: Skills / Investigation
```

---

## Before You Start — Read These Files

1. The current Assistant View component
2. `server/briefing/` — any existing greeting or brief assembler files
3. `server/agents/runtime.ts` — how operators execute and store results
4. `server/skills/runtime.ts` — how skill results are stored in `skill_runs`
5. The `findings` table schema — persistence fields (times_flagged, trend, escalation_level)
6. The `skill_runs` table — `result` JSONB column
7. The `deals` table — pipeline, stage, amount, owner_name, close_date, custom_fields
8. `stage_configs` table — won/lost stage classification
9. `server/investigation/complexity-gate.ts` — the tier system
10. `server/investigation/data-query-executor.ts` — Tier 0 if it exists
11. The conversation stream SSE endpoint
12. `quota_periods` + `rep_quotas` — quota data if configured
13. `goal_snapshots` — trending data if goals are configured
14. The renderer infrastructure — Slack, PDF, email renderers

---

## Task 1: Brief Schema & Database

### Migration: `124_weekly_briefs.sql`

```sql
CREATE TABLE IF NOT EXISTS weekly_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  
  -- Period
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  
  -- The five sections (structured JSON, NOT narratives)
  the_number JSONB NOT NULL DEFAULT '{}',
  what_changed JSONB NOT NULL DEFAULT '{}',
  segments JSONB NOT NULL DEFAULT '{}',
  reps JSONB NOT NULL DEFAULT '[]',
  deals_to_watch JSONB NOT NULL DEFAULT '[]',
  
  -- AI-generated narrative blurbs (the ONE Claude call)
  ai_blurbs JSONB NOT NULL DEFAULT '{}',
  -- { rep_conversation: "...", deal_recommendation: "...", overall_summary: "..." }
  
  -- Status
  status TEXT DEFAULT 'assembling' CHECK (status IN ('assembling', 'ready', 'sent', 'edited', 'failed')),
  error_message TEXT,
  
  -- Delivery tracking
  sent_to JSONB DEFAULT '[]',
  -- [{ channel: "slack", recipient: "#sales-leadership", timestamp: "...", message_ts: "..." }]
  
  -- Editing
  edited_sections JSONB DEFAULT '{}',
  -- { "ai_blurbs.deal_recommendation": "edited text here" }
  edited_by TEXT,
  edited_at TIMESTAMPTZ,
  
  -- Metadata
  assembly_duration_ms INT,
  ai_tokens_used INT,
  skill_runs_used UUID[],  -- Which skill_run IDs contributed to this brief
  
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_briefs_workspace_period ON weekly_briefs(workspace_id, period_start DESC);
CREATE INDEX idx_briefs_workspace_latest ON weekly_briefs(workspace_id, generated_at DESC);

-- Only one brief per workspace per period
CREATE UNIQUE INDEX idx_briefs_unique_period ON weekly_briefs(workspace_id, period_start, period_end);
```

---

## Task 2: Brief Assembler Service

Create `server/briefing/brief-assembler.ts`

The assembler pulls structured data from deals, skill_runs, findings, and quota tables. SQL-first. Only ONE Claude call at the end for narrative blurbs.

```typescript
// server/briefing/brief-assembler.ts

import { query } from '../db';
import { callAnthropicAI } from '../llm/router';

export async function assembleBrief(workspaceId: string): Promise<WeeklyBrief> {
  const startTime = Date.now();
  const now = new Date();
  const weekStart = getMonday(now);
  const priorWeekStart = getMonday(subDays(weekStart, 1));
  
  const wonLostStages = await getWonLostStages(workspaceId);
  const openFilter = wonLostStages.map(s => `'${s}'`).join(',');
  
  // ═══════════════════════════════════════════
  // SECTION 1: THE NUMBER
  // ═══════════════════════════════════════════
  
  // Current pipeline
  const pipeline = await query(`
    SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
    FROM deals 
    WHERE workspace_id = $1 
      AND stage NOT IN (${openFilter})
  `, [workspaceId]);
  
  // Closed won this quota period
  const quota = await getCurrentQuota(workspaceId);
  const periodStart = quota?.period_start || quarterStart(now);
  const periodEnd = quota?.period_end || quarterEnd(now);
  
  const closedWon = await query(`
    SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
    FROM deals
    WHERE workspace_id = $1
      AND stage IN (SELECT stage_name FROM stage_configs WHERE workspace_id = $1 AND is_won = true)
      AND close_date >= $2 AND close_date <= $3
  `, [workspaceId, periodStart, periodEnd]);
  
  // Forecast buckets from most recent forecast-rollup run
  const forecastRun = await query(`
    SELECT result FROM skill_runs
    WHERE workspace_id = $1 AND skill_id = 'forecast-rollup' AND status = 'completed'
    ORDER BY started_at DESC LIMIT 1
  `, [workspaceId]);
  
  const forecast = forecastRun.rows[0]?.result || {};
  
  // Prior week snapshot for trend
  const priorSnapshot = await query(`
    SELECT attainment_pct FROM goal_snapshots
    WHERE workspace_id = $1 AND snapshot_date >= $2 AND snapshot_date < $3
    ORDER BY snapshot_date DESC LIMIT 1
  `, [workspaceId, priorWeekStart, weekStart]);
  
  const currentAttainment = quota?.target 
    ? (parseFloat(closedWon.rows[0].total) / quota.target) * 100 
    : null;
  const priorAttainment = priorSnapshot.rows[0]?.attainment_pct || null;
  const directionPts = (currentAttainment && priorAttainment) 
    ? Math.round(currentAttainment - priorAttainment) 
    : null;
  
  const theNumber = {
    metric: quota ? `Q${getQuarter(now)} Forecast` : 'Pipeline',
    pipeline_total: parseFloat(pipeline.rows[0].total),
    pipeline_count: parseInt(pipeline.rows[0].count),
    closed: parseFloat(closedWon.rows[0].total),
    target: quota?.target || null,
    attainment_pct: currentAttainment,
    gap: quota?.target ? quota.target - parseFloat(closedWon.rows[0].total) : null,
    commit: forecast.commit_total || 0,
    best_case: forecast.best_case_total || 0,
    weighted: forecast.weighted_forecast || parseFloat(pipeline.rows[0].total),
    coverage_on_gap: null as number | null,
    win_rate: forecast.win_rate || null,
    direction: (directionPts && directionPts > 1) ? 'improving' 
             : (directionPts && directionPts < -1) ? 'declining' 
             : 'flat',
    direction_pts: directionPts,
  };
  
  // Coverage on gap
  if (theNumber.gap && theNumber.gap > 0 && theNumber.win_rate) {
    const neededPipeline = theNumber.gap / theNumber.win_rate;
    theNumber.coverage_on_gap = parseFloat(pipeline.rows[0].total) / neededPipeline;
  }
  
  // ═══════════════════════════════════════════
  // SECTION 2: WHAT CHANGED (week over week)
  // ═══════════════════════════════════════════
  
  // Current week totals
  const thisWeekCreated = await query(`
    SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total
    FROM deals WHERE workspace_id = $1 AND created_at >= $2
  `, [workspaceId, weekStart]);
  
  const thisWeekWon = await query(`
    SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total
    FROM deals WHERE workspace_id = $1 
      AND stage IN (SELECT stage_name FROM stage_configs WHERE workspace_id = $1 AND is_won = true)
      AND close_date >= $2
  `, [workspaceId, weekStart]);
  
  const thisWeekLost = await query(`
    SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total
    FROM deals WHERE workspace_id = $1
      AND stage IN (SELECT stage_name FROM stage_configs WHERE workspace_id = $1 AND is_lost = true)
      AND updated_at >= $2
  `, [workspaceId, weekStart]);
  
  // Pushed: deals where close_date was moved forward this week
  // Approximate: deals with close_date > original expected close and updated this week
  const thisWeekPushed = await query(`
    SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total
    FROM deals WHERE workspace_id = $1
      AND stage NOT IN (${openFilter})
      AND close_date > $2
      AND updated_at >= $3
      AND custom_fields->>'original_close_date' IS NOT NULL
      AND close_date > (custom_fields->>'original_close_date')::date
  `, [workspaceId, periodEnd, weekStart]);
  
  // Prior week same queries (replace weekStart with priorWeekStart, cap at weekStart)
  const priorWeekCreated = await query(`
    SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total
    FROM deals WHERE workspace_id = $1 AND created_at >= $2 AND created_at < $3
  `, [workspaceId, priorWeekStart, weekStart]);
  
  // ... same pattern for won, lost, pushed in prior week
  
  // Prior week total pipeline (from snapshot or computed)
  const priorPipeline = await query(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM deals WHERE workspace_id = $1 AND stage NOT IN (${openFilter})
      AND created_at < $2
  `, [workspaceId, weekStart]);
  // Note: this is approximate. Better approach: store weekly pipeline snapshots.
  // For now, compute from deals table. If goal_snapshots has pipeline data, prefer that.
  
  const whatChanged = {
    total_pipeline: {
      current: theNumber.pipeline_total,
      prior: parseFloat(priorPipeline.rows[0]?.total || '0'),
      delta: theNumber.pipeline_total - parseFloat(priorPipeline.rows[0]?.total || '0'),
    },
    deals_created: {
      count: parseInt(thisWeekCreated.rows[0].count),
      amount: parseFloat(thisWeekCreated.rows[0].total),
      prior_count: parseInt(priorWeekCreated.rows[0].count),
      prior_amount: parseFloat(priorWeekCreated.rows[0].total),
    },
    deals_won: {
      count: parseInt(thisWeekWon.rows[0].count),
      amount: parseFloat(thisWeekWon.rows[0].total),
      prior_count: 0, // fill from prior week query
      prior_amount: 0,
    },
    deals_lost: {
      count: parseInt(thisWeekLost.rows[0].count),
      amount: parseFloat(thisWeekLost.rows[0].total),
      prior_count: 0,
      prior_amount: 0,
    },
    deals_pushed: {
      count: parseInt(thisWeekPushed.rows[0]?.count || '0'),
      amount: parseFloat(thisWeekPushed.rows[0]?.total || '0'),
      prior_count: 0,
      prior_amount: 0,
    },
    streak: null as string | null,
  };
  
  // Check persistence for streak
  const streak = await query(`
    SELECT times_flagged FROM findings
    WHERE workspace_id = $1 AND category LIKE '%net_pipeline%' AND resolved_at IS NULL
    ORDER BY created_at DESC LIMIT 1
  `, [workspaceId]);
  if (streak.rows[0]?.times_flagged > 1) {
    whatChanged.streak = `${ordinal(streak.rows[0].times_flagged)} consecutive week of net negative pipeline`;
  }
  
  // ═══════════════════════════════════════════
  // SECTION 3: BY SEGMENT
  // ═══════════════════════════════════════════
  
  // Auto-detect best segmentation: multiple pipelines? use pipeline. 
  // One pipeline with deal types? use deal type. Otherwise, use stage.
  const pipelineCount = await query(`
    SELECT COUNT(DISTINCT pipeline) as cnt FROM deals 
    WHERE workspace_id = $1 AND pipeline IS NOT NULL
  `, [workspaceId]);
  
  let segmentColumn: string;
  let segmentLabel: string;
  
  if (parseInt(pipelineCount.rows[0].cnt) > 1) {
    segmentColumn = 'pipeline';
    segmentLabel = 'Pipeline';
  } else {
    const dealTypeCount = await query(`
      SELECT COUNT(DISTINCT custom_fields->>'dealtype') as cnt 
      FROM deals WHERE workspace_id = $1 AND custom_fields->>'dealtype' IS NOT NULL
    `, [workspaceId]);
    
    if (parseInt(dealTypeCount.rows[0].cnt) > 1) {
      segmentColumn = `custom_fields->>'dealtype'`;
      segmentLabel = 'Deal Type';
    } else {
      // Check record_type_name (Salesforce)
      const rtCount = await query(`
        SELECT COUNT(DISTINCT custom_fields->>'record_type_name') as cnt
        FROM deals WHERE workspace_id = $1 AND custom_fields->>'record_type_name' IS NOT NULL
      `, [workspaceId]);
      
      if (parseInt(rtCount.rows[0].cnt) > 1) {
        segmentColumn = `custom_fields->>'record_type_name'`;
        segmentLabel = 'Record Type';
      } else {
        segmentColumn = 'pipeline';
        segmentLabel = 'Pipeline';
      }
    }
  }
  
  const segmentRows = await query(`
    SELECT 
      COALESCE(${segmentColumn}, 'Other') as segment,
      COUNT(*) as deal_count,
      COALESCE(SUM(amount), 0) as pipeline,
      COALESCE(AVG(amount), 0) as avg_deal
    FROM deals
    WHERE workspace_id = $1 AND stage NOT IN (${openFilter})
    GROUP BY segment
    ORDER BY pipeline DESC
  `, [workspaceId]);
  
  // WoW delta per segment (approximate — from prior week's pipeline by same segment)
  // For v1, mark delta as null. When weekly snapshots exist, compute properly.
  
  const segments = {
    dimension: segmentLabel,
    rows: segmentRows.rows.map(r => ({
      label: r.segment,
      pipeline: parseFloat(r.pipeline),
      deal_count: parseInt(r.deal_count),
      avg_deal: parseFloat(r.avg_deal),
      coverage: null,  // Requires per-segment quota, which is the goals/motions feature
      wow_delta: null,  // Requires weekly snapshot per segment
      direction: 'flat' as const,
    })),
  };
  
  // ═══════════════════════════════════════════
  // SECTION 4: YOUR REPS
  // ═══════════════════════════════════════════
  
  const repData = await query(`
    SELECT 
      COALESCE(d.owner_name, d.owner_email) as rep_name,
      d.owner_email,
      COUNT(*) as deal_count,
      COALESCE(SUM(d.amount), 0) as pipeline,
      rq.quota_value
    FROM deals d
    LEFT JOIN rep_quotas rq ON rq.rep_identifier = d.owner_email 
      AND rq.workspace_id = d.workspace_id
      AND rq.quota_period_id = (
        SELECT id FROM quota_periods 
        WHERE workspace_id = d.workspace_id 
        ORDER BY created_at DESC LIMIT 1
      )
    WHERE d.workspace_id = $1 AND d.stage NOT IN (${openFilter})
    GROUP BY d.owner_name, d.owner_email, rq.quota_value
    ORDER BY pipeline DESC
  `, [workspaceId]);
  
  // Get closed won per rep this period
  const repClosed = await query(`
    SELECT 
      COALESCE(owner_name, owner_email) as rep_name,
      COALESCE(SUM(amount), 0) as closed
    FROM deals
    WHERE workspace_id = $1
      AND stage IN (SELECT stage_name FROM stage_configs WHERE workspace_id = $1 AND is_won = true)
      AND close_date >= $2 AND close_date <= $3
    GROUP BY rep_name
  `, [workspaceId, periodStart, periodEnd]);
  
  const closedMap = new Map(repClosed.rows.map(r => [r.rep_name, parseFloat(r.closed)]));
  
  // Get rep flags from findings
  const repFindings = await query(`
    SELECT 
      COALESCE(owner_email, entity_id) as rep_key,
      message, category, times_flagged, escalation_level, trend
    FROM findings
    WHERE workspace_id = $1 AND resolved_at IS NULL AND severity IN ('act', 'watch')
    ORDER BY escalation_level DESC, times_flagged DESC
  `, [workspaceId]);
  
  const repFlagMap = new Map<string, any>();
  for (const f of repFindings.rows) {
    if (!repFlagMap.has(f.rep_key)) {
      repFlagMap.set(f.rep_key, f);
    }
  }
  
  const reps = repData.rows.map(r => {
    const closed = closedMap.get(r.rep_name) || 0;
    const quotaVal = r.quota_value ? parseFloat(r.quota_value) : null;
    const attainment = quotaVal ? (closed / quotaVal) * 100 : null;
    const flag = repFlagMap.get(r.owner_email);
    
    return {
      name: r.rep_name,
      email: r.owner_email,
      pipeline: parseFloat(r.pipeline),
      deal_count: parseInt(r.deal_count),
      closed,
      quota: quotaVal,
      attainment_pct: attainment ? Math.round(attainment) : null,
      weighted: parseFloat(r.pipeline) * (theNumber.win_rate || 0.3),
      flag: flag?.message || null,
      flag_severity: flag 
        ? (flag.escalation_level >= 2 ? 'critical' : flag.escalation_level >= 1 ? 'warning' : 'ok')
        : 'ok',
      flag_weeks: flag?.times_flagged || null,
    };
  });
  
  // ═══════════════════════════════════════════
  // SECTION 5: DEALS THAT MATTER
  // ═══════════════════════════════════════════
  
  // Top deals by amount
  const topDeals = await query(`
    SELECT name, amount, stage, pipeline, 
           COALESCE(owner_name, owner_email) as owner,
           close_date, updated_at
    FROM deals
    WHERE workspace_id = $1 AND stage NOT IN (${openFilter})
    ORDER BY amount DESC
    LIMIT 5
  `, [workspaceId]);
  
  // Deals with active findings (risk signals)
  const riskyDeals = await query(`
    SELECT DISTINCT d.name, d.amount, d.stage, d.pipeline,
           COALESCE(d.owner_name, d.owner_email) as owner,
           f.message as signal_text, f.severity,
           f.category
    FROM findings f
    JOIN deals d ON d.id::text = f.deal_id AND d.workspace_id = f.workspace_id
    WHERE f.workspace_id = $1 AND f.resolved_at IS NULL AND f.severity IN ('act', 'watch')
    ORDER BY d.amount DESC
    LIMIT 5
  `, [workspaceId]);
  
  // Deals won this week (celebrate)
  const wonThisWeek = await query(`
    SELECT name, amount, stage, COALESCE(owner_name, owner_email) as owner
    FROM deals
    WHERE workspace_id = $1
      AND stage IN (SELECT stage_name FROM stage_configs WHERE workspace_id = $1 AND is_won = true)
      AND close_date >= $2
    ORDER BY amount DESC LIMIT 3
  `, [workspaceId, weekStart]);
  
  // Merge and deduplicate — prioritize risky deals + top deals, add wins
  const dealMap = new Map<string, any>();
  
  for (const d of riskyDeals.rows) {
    dealMap.set(d.name, {
      name: d.name, amount: parseFloat(d.amount), stage: d.stage,
      owner: d.owner, pipeline: d.pipeline,
      signal: d.severity === 'act' ? 'critical' : 'warning',
      signal_text: d.signal_text,
    });
  }
  
  for (const d of topDeals.rows) {
    if (!dealMap.has(d.name)) {
      dealMap.set(d.name, {
        name: d.name, amount: parseFloat(d.amount), stage: d.stage,
        owner: d.owner, pipeline: d.pipeline,
        signal: 'neutral',
        signal_text: `$${formatCompact(d.amount)} in ${d.stage}`,
      });
    }
  }
  
  for (const d of wonThisWeek.rows) {
    dealMap.set(d.name, {
      name: d.name, amount: parseFloat(d.amount), stage: d.stage,
      owner: d.owner,
      signal: 'positive',
      signal_text: `Won this week`,
    });
  }
  
  const dealsToWatch = Array.from(dealMap.values())
    .sort((a, b) => {
      // Sort: critical first, then warning, then by amount
      const severityOrder = { critical: 0, warning: 1, neutral: 2, positive: 3 };
      const aDiff = severityOrder[a.signal] ?? 2;
      const bDiff = severityOrder[b.signal] ?? 2;
      if (aDiff !== bDiff) return aDiff - bDiff;
      return b.amount - a.amount;
    })
    .slice(0, 8);
  
  // ═══════════════════════════════════════════
  // AI BLURBS — ONE Claude call for all narratives
  // ═══════════════════════════════════════════
  
  const aiBlurbs = await generateBriefNarratives(theNumber, whatChanged, reps, dealsToWatch);
  
  // ═══════════════════════════════════════════
  // SAVE BRIEF
  // ═══════════════════════════════════════════
  
  const brief = {
    workspace_id: workspaceId,
    period_start: weekStart.toISOString().split('T')[0],
    period_end: endOfWeek(weekStart).toISOString().split('T')[0],
    the_number: theNumber,
    what_changed: whatChanged,
    segments,
    reps,
    deals_to_watch: dealsToWatch,
    ai_blurbs: aiBlurbs,
    status: 'ready',
    assembly_duration_ms: Date.now() - startTime,
    ai_tokens_used: aiBlurbs._tokens || 0,
  };
  
  const result = await query(`
    INSERT INTO weekly_briefs 
      (workspace_id, period_start, period_end, the_number, what_changed, 
       segments, reps, deals_to_watch, ai_blurbs, status, assembly_duration_ms, ai_tokens_used)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT (workspace_id, period_start, period_end) 
    DO UPDATE SET
      the_number = $4, what_changed = $5, segments = $6, reps = $7,
      deals_to_watch = $8, ai_blurbs = $9, status = $10,
      assembly_duration_ms = $11, ai_tokens_used = $12,
      updated_at = NOW()
    RETURNING *
  `, [workspaceId, brief.period_start, brief.period_end,
      JSON.stringify(brief.the_number), JSON.stringify(brief.what_changed),
      JSON.stringify(brief.segments), JSON.stringify(brief.reps),
      JSON.stringify(brief.deals_to_watch), JSON.stringify(brief.ai_blurbs),
      brief.status, brief.assembly_duration_ms, brief.ai_tokens_used]);
  
  return result.rows[0];
}
```

### Narrative Generation (single Claude call)

```typescript
async function generateBriefNarratives(
  theNumber: any,
  whatChanged: any,
  reps: any[],
  deals: any[]
): Promise<{ rep_conversation: string; deal_recommendation: string; overall_summary: string; _tokens: number }> {
  
  const prompt = `Write three short narrative sections for a weekly RevOps brief. The reader is a CRO. Be calm, direct, and specific. No fluff, no fear, no lectures.

DATA:
Forecast: ${theNumber.target ? `$${formatCompact(theNumber.closed)} closed of $${formatCompact(theNumber.target)} target (${theNumber.attainment_pct?.toFixed(0) || '?'}%)` : `$${formatCompact(theNumber.pipeline_total)} pipeline across ${theNumber.pipeline_count} deals`}
Direction: ${theNumber.direction} ${theNumber.direction_pts ? `(${theNumber.direction_pts > 0 ? '+' : ''}${theNumber.direction_pts}pts WoW)` : ''}
Pipeline change: ${whatChanged.total_pipeline.delta >= 0 ? '+' : ''}$${formatCompact(whatChanged.total_pipeline.delta)} WoW${whatChanged.streak ? ` (${whatChanged.streak})` : ''}
${reps.map(r => `${r.name}: $${formatCompact(r.pipeline)} pipeline, ${r.attainment_pct || '?'}% attainment${r.flag ? ` — ${r.flag}${r.flag_weeks > 1 ? ` (week ${r.flag_weeks})` : ''}` : ''}`).join('\n')}
${deals.filter(d => d.signal === 'critical' || d.signal === 'warning').map(d => `${d.name}: $${formatCompact(d.amount)} ${d.stage} — ${d.signal_text}`).join('\n')}

Write EXACTLY three sections as JSON:

{
  "overall_summary": "1-2 sentences. The headline for Slack. What does the CRO need to know in 10 seconds.",
  "rep_conversation": "2-3 sentences. Who needs attention and why. Reference specific weeks if flags have persisted. No homework assignments.",
  "deal_recommendation": "2-3 sentences. The ONE deal the CRO should ask about today and why. Name the deal, the risk, and what to ask."
}

RULES:
- Use specific names, numbers, and timeframes.
- Never say "terrify", "flying blind", "alarming", "vanity metrics", or any fear language.
- Never assign homework or deadlines unless asked.
- If data is missing (no quota, no forecast), work with what's there. Never refuse.
- Short is better. Total output under 200 words.`;

  const response = await callAnthropicAI({
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 500,
    temperature: 0.3,
  });
  
  const text = extractText(response);
  const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
  parsed._tokens = response.usage?.total_tokens || 500;
  return parsed;
}
```

---

## Task 3: Brief-as-Cache Query Resolver

Create `server/briefing/brief-resolver.ts`

This is the layer that sits BEFORE the complexity gate. When a user asks a question, it checks whether the current brief already contains the answer.

```typescript
// server/briefing/brief-resolver.ts

export interface BriefResolverResult {
  answered: boolean;
  section: string | null;     // Which brief section answered it
  data: any;                  // The structured data to return
  display_hint: 'value' | 'table' | 'card' | 'section';
  footnote?: string;
}

/**
 * Check if the current brief can answer this question.
 * Returns the answer from the brief if yes, null if no.
 * 
 * This runs BEFORE the complexity gate. Zero tokens. Instant.
 */
export async function resolveFromBrief(
  workspaceId: string,
  message: string
): Promise<BriefResolverResult | null> {
  
  // Get the most recent brief
  const brief = await query(`
    SELECT * FROM weekly_briefs
    WHERE workspace_id = $1 AND status IN ('ready', 'sent', 'edited')
    ORDER BY generated_at DESC LIMIT 1
  `, [workspaceId]);
  
  if (brief.rows.length === 0) return null;
  
  const b = brief.rows[0];
  const lower = message.toLowerCase();
  
  // ── "How much pipeline?" / "What's our pipeline?" ──
  if (/\b(how much|what('?s| is| are|do we have).*(pipeline|revenue))\b/i.test(lower)) {
    // Check if asking about a specific segment
    const segData = JSON.parse(b.segments);
    for (const row of segData.rows || []) {
      if (lower.includes(row.label.toLowerCase())) {
        return {
          answered: true,
          section: 'segments',
          data: row,
          display_hint: 'value',
        };
      }
    }
    // General pipeline question
    const num = JSON.parse(b.the_number);
    return {
      answered: true,
      section: 'the_number',
      data: {
        total: num.pipeline_total,
        count: num.pipeline_count,
        segments: segData.rows,
      },
      display_hint: 'value',
    };
  }
  
  // ── "Break down by [X]" / "Pipeline by [X]" ──
  if (/\b(break\s*down|breakdown|split|by (record|deal|pipeline|type|rep|owner|stage|segment))\b/i.test(lower)) {
    const segData = JSON.parse(b.segments);
    const dimension = detectRequestedDimension(lower);
    
    // If asking for the same dimension the brief used, return it
    if (dimensionMatches(dimension, segData.dimension)) {
      return {
        answered: true,
        section: 'segments',
        data: segData,
        display_hint: 'table',
      };
    }
    
    // If asking for rep breakdown
    if (dimension === 'rep' || dimension === 'owner') {
      return {
        answered: true,
        section: 'reps',
        data: JSON.parse(b.reps),
        display_hint: 'table',
      };
    }
    
    // Brief doesn't have this dimension — fall through to Tier 0
    return null;
  }
  
  // ── "Who's behind?" / "Rep performance" / "How are reps doing?" ──
  if (/\b(who('?s| is).*(behind|struggling|underperform)|rep (performance|scorecard|status)|how are (reps|the team|my reps))\b/i.test(lower)) {
    return {
      answered: true,
      section: 'reps',
      data: JSON.parse(b.reps),
      display_hint: 'table',
    };
  }
  
  // ── "What changed?" / "What happened this week?" ──
  if (/\b(what (changed|happened|moved)|this week|week over week|wow|delta)\b/i.test(lower)) {
    return {
      answered: true,
      section: 'what_changed',
      data: JSON.parse(b.what_changed),
      display_hint: 'section',
    };
  }
  
  // ── "Forecast" / "Are we going to hit the number?" (basic version) ──
  if (/\b(forecast|the number|attainment|quota|target|are we (going to|gonna) hit)\b/i.test(lower) &&
      !/\bwhy\b/i.test(lower)) {
    return {
      answered: true,
      section: 'the_number',
      data: JSON.parse(b.the_number),
      display_hint: 'section',
    };
  }
  
  // ── "At risk deals" / "Deal risks" / "Deals to watch" ──
  if (/\b(at.risk|deal risk|deals? to watch|risky deals?|what deals?)\b/i.test(lower)) {
    return {
      answered: true,
      section: 'deals_to_watch',
      data: JSON.parse(b.deals_to_watch),
      display_hint: 'table',
    };
  }
  
  // ── Specific rep name mentioned ──
  const repsData = JSON.parse(b.reps);
  for (const rep of repsData) {
    if (rep.name && lower.includes(rep.name.toLowerCase().split(' ')[0])) {
      // "How's Nate doing?" — return that rep's brief card
      return {
        answered: true,
        section: 'reps',
        data: rep,
        display_hint: 'card',
      };
    }
  }
  
  // ── Specific deal name mentioned ──
  const dealsData = JSON.parse(b.deals_to_watch);
  for (const deal of dealsData) {
    const dealWords = deal.name.toLowerCase().split(' ');
    if (dealWords.some(w => w.length > 3 && lower.includes(w))) {
      return {
        answered: true,
        section: 'deals_to_watch',
        data: deal,
        display_hint: 'card',
      };
    }
  }
  
  // Brief can't answer this question
  return null;
}

function detectRequestedDimension(lower: string): string {
  if (/\b(record.?type|deal.?type|type)\b/.test(lower)) return 'record_type';
  if (/\b(pipeline)\b/.test(lower)) return 'pipeline';
  if (/\b(stage)\b/.test(lower)) return 'stage';
  if (/\b(rep|owner|sales.?rep)\b/.test(lower)) return 'rep';
  if (/\b(month|quarter)\b/.test(lower)) return 'time';
  return 'unknown';
}

function dimensionMatches(requested: string, briefDimension: string): boolean {
  const map: Record<string, string[]> = {
    'record_type': ['Record Type', 'Deal Type'],
    'pipeline': ['Pipeline'],
    'stage': ['Stage'],
  };
  return (map[requested] || []).includes(briefDimension);
}
```

---

## Task 4: Wire Brief Resolver into the Question Flow

Find where user messages enter the investigation/response pipeline. Insert the brief resolver as the FIRST check, before the complexity gate.

```typescript
// In the conversation handler (orchestrator or SSE endpoint):

import { resolveFromBrief } from '../briefing/brief-resolver';
import { classifyComplexity } from '../investigation/complexity-gate';

// STEP 1: Check the brief first
const briefAnswer = await resolveFromBrief(workspaceId, message);

if (briefAnswer) {
  console.log(`[brief-resolver] Answered from brief section: ${briefAnswer.section}`);
  
  // Format the brief data for the response
  const response = formatBriefAnswer(briefAnswer, message);
  
  // Send as immediate response — no agents, no streaming
  send({ type: 'synthesis_start' });
  send({ type: 'synthesis_chunk', text: response });
  send({ type: 'synthesis_done' });
  send({ type: 'done' });
  return;
}

// STEP 2: Brief couldn't answer — proceed to complexity gate
const complexity = await classifyComplexity(message, { ... });
// ... existing tier routing (0, 1, 2, 3)


// ═══════════════════════════════════════════
// Format brief data into readable response
// ═══════════════════════════════════════════
function formatBriefAnswer(result: BriefResolverResult, question: string): string {
  const data = result.data;
  
  switch (result.display_hint) {
    case 'value': {
      if (data.total !== undefined) {
        let text = `**${formatCurrency(data.total)}** across ${data.count} deals`;
        if (data.segments?.length > 1) {
          text += '\n\n' + data.segments.map(s => 
            `${s.label}: ${formatCurrency(s.pipeline)} (${s.deal_count} deals)`
          ).join('\n');
        }
        return text;
      }
      if (data.pipeline !== undefined) {
        return `**${data.label}: ${formatCurrency(data.pipeline)}** (${data.deal_count} deals, avg ${formatCurrency(data.avg_deal)})`;
      }
      return JSON.stringify(data);
    }
    
    case 'table': {
      if (Array.isArray(data)) {
        // Rep table
        let text = '| Rep | Pipeline | Attainment | Flag |\n|---|---|---|---|\n';
        for (const r of data) {
          text += `| ${r.name} | ${formatCurrency(r.pipeline)} | ${r.attainment_pct ? r.attainment_pct + '%' : '—'} | ${r.flag || '✓'} |\n`;
        }
        return text;
      }
      if (data.rows) {
        // Segment table
        let text = `**Pipeline by ${data.dimension}**\n\n`;
        text += `| ${data.dimension} | Deals | Amount | Avg |\n|---|---|---|---|\n`;
        for (const r of data.rows) {
          text += `| ${r.label} | ${r.deal_count} | ${formatCurrency(r.pipeline)} | ${formatCurrency(r.avg_deal)} |\n`;
        }
        return text;
      }
      return JSON.stringify(data);
    }
    
    case 'card': {
      // Single entity (rep or deal)
      if (data.name && data.pipeline !== undefined) {
        // Rep card
        return `**${data.name}**\nPipeline: ${formatCurrency(data.pipeline)} (${data.deal_count} deals)\nAttainment: ${data.attainment_pct ? data.attainment_pct + '%' : 'No quota'}\n${data.flag ? `⚠️ ${data.flag}${data.flag_weeks > 1 ? ` (week ${data.flag_weeks})` : ''}` : '✓ No flags'}`;
      }
      if (data.name && data.amount !== undefined) {
        // Deal card
        const signalIcon = data.signal === 'positive' ? '✅' : data.signal === 'critical' ? '🔴' : '⚠️';
        return `**${data.name}**\n${formatCurrency(data.amount)} · ${data.stage} · ${data.owner}\n${signalIcon} ${data.signal_text}`;
      }
      return JSON.stringify(data);
    }
    
    case 'section': {
      // Full brief section — format based on which section
      if (data.delta !== undefined) {
        // What changed
        let text = `**This Week's Pipeline Movement**\n\n`;
        text += `Pipeline: ${formatCurrency(data.total_pipeline.current)} (${data.total_pipeline.delta >= 0 ? '+' : ''}${formatCurrency(data.total_pipeline.delta)} WoW)\n`;
        text += `Created: ${data.deals_created.count} deals (${formatCurrency(data.deals_created.amount)})\n`;
        text += `Won: ${data.deals_won.count} (${formatCurrency(data.deals_won.amount)})\n`;
        text += `Lost: ${data.deals_lost.count} (${formatCurrency(data.deals_lost.amount)})\n`;
        if (data.deals_pushed?.count) text += `Pushed: ${data.deals_pushed.count} (${formatCurrency(data.deals_pushed.amount)})\n`;
        if (data.streak) text += `\n_${data.streak}_`;
        return text;
      }
      if (data.pipeline_total !== undefined) {
        // The number
        let text = '';
        if (data.target) {
          text = `**${data.metric}: ${formatCurrency(data.weighted)} weighted against ${formatCurrency(data.target)} target (${data.attainment_pct?.toFixed(0)}%)**\n`;
          text += `Closed: ${formatCurrency(data.closed)}`;
          if (data.commit) text += ` · Commit: ${formatCurrency(data.commit)}`;
          if (data.best_case) text += ` · Best case: ${formatCurrency(data.best_case)}`;
          if (data.gap) text += `\nGap: ${formatCurrency(data.gap)}`;
          if (data.coverage_on_gap) text += ` · Coverage on gap: ${data.coverage_on_gap.toFixed(1)}×`;
        } else {
          text = `**Pipeline: ${formatCurrency(data.pipeline_total)}** across ${data.pipeline_count} deals`;
        }
        if (data.direction !== 'flat') {
          text += `\n${data.direction === 'improving' ? '▲' : '▼'} ${data.direction} ${data.direction_pts ? `(${data.direction_pts > 0 ? '+' : ''}${data.direction_pts}pts WoW)` : ''}`;
        }
        return text;
      }
      return JSON.stringify(data);
    }
  }
}
```

---

## Task 5: Brief API Endpoints

```
GET  /api/workspaces/:id/brief                 → get latest brief (or 404 if none)
POST /api/workspaces/:id/brief/assemble         → trigger assembly now
PUT  /api/workspaces/:id/brief/:briefId/edit    → save user edits to a section
POST /api/workspaces/:id/brief/:briefId/send    → send to Slack/email
GET  /api/workspaces/:id/brief/history          → list past briefs
```

### GET /brief — returns the latest ready brief

```typescript
router.get('/api/workspaces/:id/brief', async (req, res) => {
  const brief = await query(`
    SELECT * FROM weekly_briefs
    WHERE workspace_id = $1 AND status IN ('ready', 'sent', 'edited')
    ORDER BY generated_at DESC LIMIT 1
  `, [req.params.id]);
  
  if (brief.rows.length === 0) {
    return res.json({ available: false, message: 'No brief available yet. Briefs are assembled after operators run.' });
  }
  
  // Parse JSONB fields
  const b = brief.rows[0];
  res.json({
    available: true,
    brief: {
      ...b,
      the_number: JSON.parse(b.the_number),
      what_changed: JSON.parse(b.what_changed),
      segments: JSON.parse(b.segments),
      reps: JSON.parse(b.reps),
      deals_to_watch: JSON.parse(b.deals_to_watch),
      ai_blurbs: JSON.parse(b.ai_blurbs),
    },
  });
});
```

### POST /brief/:id/send — deliver to Slack

```typescript
router.post('/api/workspaces/:id/brief/:briefId/send', async (req, res) => {
  const { channel, format } = req.body; // channel: 'slack' | 'email', format: 'full' | 'summary'
  
  const brief = await getBriefById(req.params.briefId);
  if (!brief) return res.status(404).json({ error: 'Brief not found' });
  
  // Use existing Slack renderer to format the brief
  const slackBlocks = formatBriefForSlack(brief, format);
  
  // Send via existing Slack client
  const result = await slackClient.postMessage(workspaceId, channel, slackBlocks);
  
  // Track delivery
  await query(`
    UPDATE weekly_briefs SET 
      sent_to = sent_to || $2::jsonb,
      status = 'sent'
    WHERE id = $1
  `, [req.params.briefId, JSON.stringify([{ channel, timestamp: new Date().toISOString(), message_ts: result.ts }])]);
  
  res.json({ sent: true, message_ts: result.ts });
});
```

---

## Task 6: Brief Assembly Trigger

The brief should assemble automatically after overnight operator runs complete. Add a hook at the end of the agent execution cycle:

```typescript
// In server/agents/runtime.ts or wherever the scheduled agent run completes:

// After all agents have finished their scheduled runs:
async function onScheduledRunComplete(workspaceId: string) {
  // ... existing post-run logic
  
  // Assemble brief from latest run results
  try {
    console.log(`[brief-assembler] Assembling brief for workspace ${workspaceId}`);
    const brief = await assembleBrief(workspaceId);
    console.log(`[brief-assembler] Brief ready in ${brief.assembly_duration_ms}ms, ${brief.ai_tokens_used} tokens`);
  } catch (err) {
    console.error(`[brief-assembler] Failed to assemble brief:`, err);
  }
}
```

Also allow manual trigger via the API endpoint (POST /brief/assemble) for testing.

---

## Task 7: Assistant View Frontend — Brief as Hero

Redesign the Assistant View component so the brief is the primary content, with conversation below.

### Layout Structure

```
┌──────────────────────────────────────────────┐
│  ✦ Pandora    [Workspace ▼]    Mon Mar 2     │
│                                               │
│  ┌─ THE NUMBER ─────────────────────────────┐ │
│  │  Q1: $2.1M / $2.8M (75%)  ▲ +3pts WoW  │ │
│  │  Gap: $700K · Coverage: 0.8×             │ │
│  └──────────────────────────────────────────┘ │
│                                               │
│  ┌─ WHAT CHANGED ───────────────────────────┐ │
│  │  Pipeline: -$140K (3rd week ▼)           │ │
│  │  Created: 3 ($180K) Won: 1 ($45K)       │ │
│  │  [tap to expand full WoW table]          │ │
│  └──────────────────────────────────────────┘ │
│                                               │
│  ┌─ BY SEGMENT ─────────────────────────────┐ │
│  │  New Biz  $1.4M 1.2× ▼                  │ │
│  │  Renewal  $620K 3.1×                     │ │
│  │  Expand   $180K 0.9× ▼                  │ │
│  └──────────────────────────────────────────┘ │
│                                               │
│  ┌─ YOUR REPS ──────────────────────────────┐ │
│  │  Nate  $1.08M ⚠️ whale risk             │ │
│  │  Sarah $540K  🔴 gen stalled             │ │
│  │  Jack  $580K  🔴 activity cliff wk 3    │ │
│  │  [tap any rep for detail]                │ │
│  └──────────────────────────────────────────┘ │
│                                               │
│  ┌─ ASK ABOUT THIS ─────────────────────────┐ │
│  │  🔴 Apex Medical · $180K · Negotiation   │ │
│  │  Single-threaded, no exec sponsor.       │ │
│  │  [tap for deal detail]                   │ │
│  └──────────────────────────────────────────┘ │
│                                               │
│  [Send to CRO ✉️]  [Export PDF]  [Edit]      │
│                                               │
│  ─────────────────────────────────────────── │
│  ✦ Ask anything...                    Send   │
│                                               │
│  ✦ Assistant               ▦ Command        │
└──────────────────────────────────────────────┘
```

### Interaction Behaviors

**Tap any section card** → expands inline with full detail (tables, charts, additional metrics). No API call — the data is already in the brief JSON. Pure frontend expansion.

**Tap a rep name** → expands to show that rep's deals, activity, and conversation summary. If detail exists in the brief, show it. If deeper detail needed, auto-populates the Ask input with "Tell me more about [rep name]" and sends it.

**Tap a deal** → expands to show deal timeline, last activity, contact list, finding history. Same pattern — brief data first, Ask Pandora for deeper investigation.

**Ask a question in the input** → goes through brief-resolver first. If the brief answers it, the response appears inline in a conversation bubble below the brief. If not, triggers the Tier 0/1/2/3 flow with operator recruitment.

**Send to CRO button** → opens a send dialog:
- Channel selector (Slack channel, email address)
- Format: Full brief / Summary only / Custom section selection
- Preview the formatted output
- Edit option before sending
- Send button

**Export PDF** → generates a formatted PDF using existing renderer infrastructure

**Edit button** → makes all AI-generated text (narratives, recommendations) editable inline. User can adjust before sending. Edits are saved to `weekly_briefs.edited_sections`.

### When No Brief Exists

If the user opens Assistant View and no brief has been assembled yet (new workspace, operators haven't run):

```
┌──────────────────────────────────────────────┐
│  ✦ Pandora                                   │
│                                               │
│  Good morning, Jeff.                          │
│                                               │
│  Your brief will be ready after operators     │
│  run their first analysis. This usually       │
│  takes about 5 minutes after setup.           │
│                                               │
│  [Run operators now]                          │
│                                               │
│  In the meantime, you can ask me anything:    │
│                                               │
│  ✦ Ask anything...                    Send   │
└──────────────────────────────────────────────┘
```

### API Integration

```typescript
// Frontend fetches brief on mount:
const { data: brief, isLoading } = useQuery(
  ['brief', workspaceId],
  () => fetch(`/api/workspaces/${workspaceId}/brief`).then(r => r.json()),
  { refetchInterval: 60000 }  // Re-check every minute
);

// If brief.available → render brief sections
// If !brief.available → render empty state with "Run operators now"
```

---

## File Structure

```
server/briefing/
├── brief-assembler.ts          # Task 2: Assembles the five sections
├── brief-resolver.ts           # Task 3: Answers questions from brief cache
├── brief-narratives.ts         # Task 2: Single Claude call for AI blurbs
└── brief-formatter.ts          # Task 5: Format for Slack/PDF/email

server/routes/
└── briefs.ts                   # Task 5: API endpoints

server/db/migrations/
└── 124_weekly_briefs.sql       # Task 1: Schema

client/src/pages/
└── assistant-view.tsx          # Task 7: Brief-first layout (modify existing)

client/src/components/assistant/
├── BriefSection.tsx            # Collapsible section card
├── TheNumberCard.tsx           # Section 1 display
├── WhatChangedCard.tsx         # Section 2 display
├── SegmentsCard.tsx            # Section 3 display
├── RepsCard.tsx                # Section 4 display
├── DealsToWatchCard.tsx        # Section 5 display
├── SendBriefDialog.tsx         # Send to Slack/email modal
└── BriefEmptyState.tsx         # No brief available yet
```

## Modified Files

```
server/agents/runtime.ts        # Task 6: Add onScheduledRunComplete → assembleBrief
server/routes/index.ts          # Task 5: Mount brief routes
server/chat/orchestrator.ts     # Task 4: Insert brief-resolver before complexity gate
  (or conversation-stream.ts)
```

---

## Validation Checklist

1. **Migration runs** — weekly_briefs table created with unique constraint on workspace + period
2. **Assembly works** — POST /brief/assemble returns a complete brief with all five sections populated
3. **The Number** — shows pipeline total, closed, gap, coverage, direction (works with AND without quotas)
4. **What Changed** — WoW deltas for created, won, lost, pushed
5. **Segments** — auto-detects best dimension (pipeline name / deal type / record type)
6. **Reps** — shows pipeline, attainment (if quota exists), flags from findings with persistence weeks
7. **Deals to Watch** — top deals by amount + deals with risk findings + deals won this week
8. **AI blurbs** — single Claude call, under 200 words total, calm tone, specific names and numbers
9. **Brief resolver** — "How much pipeline?" returns from brief instantly, zero tokens
10. **Brief resolver** — "Break down by record type" returns segment table from brief if dimension matches
11. **Brief resolver** — "How's Nate doing?" returns Nate's rep card from brief
12. **Brief resolver fallthrough** — "Why did pipeline drop?" is NOT answered by brief, falls to investigation
13. **Assistant View** — opens with brief as primary content, not greeting + empty chat
14. **Tap to expand** — sections expand inline with detail, no API call
15. **Send to CRO** — formats brief for Slack and sends
16. **Edit before send** — AI narratives are editable, edits persist
17. **No brief state** — shows calm empty state with "Run operators now" button
18. **Auto-assembly** — brief assembles automatically after scheduled agent run completes
19. **Assembly performance** — full brief assembles in <10 seconds (mostly SQL, one AI call)
20. **Token budget** — AI blurbs use <500 tokens total

---

## What NOT to Build

- **Brief customization UI** (which sections to show, reorder) — fixed layout for now
- **Historical brief comparison** (this week vs last week's brief) — future
- **Per-role brief variants** (CRO sees different sections than manager) — future, uses the role system from the goals prompt
- **Auto-send** (brief sends to Slack without user review) — always require human review first
- **Brief scheduling** (custom assembly times) — runs after operator cycle, manual trigger via API
- **Multi-workspace summary** (one brief across all four clients) — each workspace gets its own brief
- **Brief comments/annotations** — edit is enough for v1
- **Conversation history below the brief** — brief is the page, conversation is ephemeral follow-up
