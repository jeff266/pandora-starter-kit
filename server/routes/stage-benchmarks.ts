/**
 * Stage Velocity Benchmarks API Routes
 *
 * GET  /:workspaceId/stage-benchmarks         — full benchmark grid data
 * GET  /:workspaceId/deals/:dealId/coaching   — per-deal coaching payload
 * POST /:workspaceId/stage-benchmarks/refresh — trigger recompute
 * POST /:workspaceId/deals/:dealId/coaching-script — generate Claude coaching script
 */

import { Router, type Request, type Response } from 'express';
import { query } from '../db.js';
import {
  computeAndStoreStageBenchmarks,
  lookupBenchmark,
  computeVelocitySignal,
  computeCompositeLabel,
  autoDetectSegmentBoundaries,
} from '../coaching/stage-benchmarks.js';
import Anthropic from '@anthropic-ai/sdk';

const router = Router();

// ─── GET /:workspaceId/stage-benchmarks ──────────────────────────────────────

router.get('/:workspaceId/stage-benchmarks', async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.params;
    const rawPipeline = req.query.pipeline as string | undefined;
    const pipelineFilter = rawPipeline && rawPipeline !== 'all' ? rawPipeline : null;

    const benchRows = await query<{
      pipeline: string;
      stage_normalized: string;
      segment: string;
      outcome: string;
      median_days: string;
      p75_days: string;
      p90_days: string;
      sample_size: string;
      confidence_tier: string;
      is_inverted: boolean;
      computed_at: string;
    }>(
      `SELECT pipeline, stage_normalized, segment, outcome,
              median_days, p75_days, p90_days, sample_size, confidence_tier, is_inverted, computed_at
       FROM stage_velocity_benchmarks
       WHERE workspace_id = $1
         AND segment = 'all'
         ${pipelineFilter ? 'AND pipeline = $2' : ''}
       ORDER BY stage_normalized, segment, outcome`,
      pipelineFilter ? [workspaceId, pipelineFilter] : [workspaceId]
    );

    // Get open deal averages, distinct pipelines, raw-stage benchmarks, and cycle time in parallel
    const [openAvgResult, pipelinesResult, rawBenchResult, cycleTimeResult] = await Promise.all([
      query<{ stage_normalized: string; open_avg: string; open_count: string }>(
        `SELECT stage_normalized,
                AVG(COALESCE(days_in_stage, EXTRACT(days FROM NOW() - stage_changed_at)::integer))::numeric(10,1) AS open_avg,
                COUNT(*) AS open_count
         FROM deals
         WHERE workspace_id = $1
           AND stage_normalized NOT IN ('closed_won', 'closed_lost')
           AND stage_normalized IS NOT NULL
         GROUP BY stage_normalized`,
        [workspaceId]
      ),
      query<{ pipeline: string }>(
        `SELECT DISTINCT pipeline FROM stage_velocity_benchmarks WHERE workspace_id = $1 AND pipeline != 'all' ORDER BY pipeline`,
        [workspaceId]
      ),
      query<{ stage_name: string; pipeline_name: string; stage_normalized: string; outcome: string; median_days: string; sample_size: string; display_order: string | null }>(
        `SELECT sc.stage_name, sc.pipeline_name, dsh.stage_normalized,
                CASE WHEN d.stage_normalized = 'closed_won' THEN 'won' ELSE 'lost' END AS outcome,
                PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY dsh.duration_days)::numeric(10,2) AS median_days,
                COUNT(*)::text AS sample_size,
                MIN(sc.display_order)::text AS display_order
         FROM deal_stage_history dsh
         JOIN deals d ON d.id = dsh.deal_id
         LEFT JOIN stage_configs sc ON sc.workspace_id = dsh.workspace_id
           AND (sc.stage_id = dsh.stage OR sc.stage_name = dsh.stage)
           AND COALESCE(sc.pipeline_name, '') = COALESCE(d.pipeline, '')
         WHERE dsh.workspace_id = $1
           AND d.stage_normalized IN ('closed_won', 'closed_lost')
           AND dsh.stage_normalized NOT IN ('closed_won', 'closed_lost', 'unknown')
           AND dsh.duration_days IS NOT NULL
           AND sc.stage_name IS NOT NULL
           AND sc.is_active = true
           ${pipelineFilter ? 'AND d.pipeline = $2' : ''}
         GROUP BY sc.stage_name, sc.pipeline_name, dsh.stage_normalized, outcome
         HAVING COUNT(*) >= 1
         ORDER BY MIN(sc.display_order) ASC NULLS LAST, sc.stage_name, outcome`,
        pipelineFilter ? [workspaceId, pipelineFilter] : [workspaceId]
      ),
      query<{ outcome: string; median_total_days: string; sample_size: string }>(
        `SELECT
           CASE WHEN d.stage_normalized = 'closed_won' THEN 'won' ELSE 'lost' END AS outcome,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY totals.total_days)::numeric(10,1) AS median_total_days,
           COUNT(*)::text AS sample_size
         FROM (
           SELECT dsh.deal_id, SUM(dsh.duration_days) AS total_days
           FROM deal_stage_history dsh
           JOIN deals d ON d.id = dsh.deal_id AND d.workspace_id = dsh.workspace_id
           WHERE dsh.workspace_id = $1
             AND d.stage_normalized IN ('closed_won', 'closed_lost')
             AND dsh.duration_days > 0
             ${pipelineFilter ? 'AND d.pipeline = $2' : ''}
           GROUP BY dsh.deal_id
         ) totals
         JOIN deals d ON d.id = totals.deal_id
         GROUP BY outcome`,
        pipelineFilter ? [workspaceId, pipelineFilter] : [workspaceId]
      ),
    ]);

    // Derive display name from stage_normalized (stage_configs uses raw names, not normalized codes)
    const toDisplayName = (s: string) =>
      s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    const openAverages: Record<string, { avg: number; count: number }> = {};
    for (const r of openAvgResult.rows) {
      openAverages[r.stage_normalized] = {
        avg: parseFloat(r.open_avg),
        count: parseInt(r.open_count, 10),
      };
    }

    const pipelines = pipelinesResult.rows.map(r => r.pipeline);

    // Pivot won/lost rows into flat StageBenchmark objects matching the frontend interface
    const benchMap: Record<string, {
      stage: string;
      stage_normalized: string;
      display_order: number | null;
      pipeline: string;
      segment: string;
      won_median: number | null;
      won_p75: number | null;
      won_sample: number;
      won_confidence: string;
      lost_median: number | null;
      lost_sample: number;
      lost_confidence: string;
      is_inverted: boolean;
      computed_at: string;
    }> = {};

    for (const r of benchRows.rows) {
      const key = `${r.pipeline}||${r.stage_normalized}||${r.segment}`;
      if (!benchMap[key]) {
        benchMap[key] = {
          stage: toDisplayName(r.stage_normalized),
          stage_normalized: r.stage_normalized,
          display_order: null,
          pipeline: r.pipeline,
          segment: r.segment,
          won_median: null,
          won_p75: null,
          won_sample: 0,
          won_confidence: 'insufficient',
          lost_median: null,
          lost_sample: 0,
          lost_confidence: 'insufficient',
          is_inverted: r.is_inverted,
          computed_at: r.computed_at,
        };
      }
      if (r.outcome === 'won') {
        benchMap[key].won_median = parseFloat(r.median_days);
        benchMap[key].won_p75 = parseFloat(r.p75_days);
        benchMap[key].won_sample = parseInt(r.sample_size, 10);
        benchMap[key].won_confidence = r.confidence_tier;
      } else {
        benchMap[key].lost_median = parseFloat(r.median_days);
        benchMap[key].lost_sample = parseInt(r.sample_size, 10);
        benchMap[key].lost_confidence = r.confidence_tier;
      }
    }

    const benchmarks = Object.values(benchMap).sort((a, b) =>
      a.stage_normalized.localeCompare(b.stage_normalized)
    );

    // Pivot raw-stage benchmark rows into flat objects
    const rawBenchMap: Record<string, {
      stage: string;
      pipeline: string;
      stage_normalized: string;
      display_order: number | null;
      won_median: number | null;
      won_sample: number;
      lost_median: number | null;
      lost_sample: number;
    }> = {};
    for (const r of rawBenchResult.rows) {
      const key = `${r.pipeline_name}||${r.stage_name}`;
      if (!rawBenchMap[key]) {
        rawBenchMap[key] = {
          stage: r.stage_name,
          pipeline: r.pipeline_name,
          stage_normalized: r.stage_normalized,
          display_order: r.display_order !== null ? parseInt(r.display_order, 10) : null,
          won_median: null,
          won_sample: 0,
          lost_median: null,
          lost_sample: 0,
        };
      }
      if (r.outcome === 'won') {
        rawBenchMap[key].won_median = parseFloat(r.median_days);
        rawBenchMap[key].won_sample = parseInt(r.sample_size, 10);
      } else {
        rawBenchMap[key].lost_median = parseFloat(r.median_days);
        rawBenchMap[key].lost_sample = parseInt(r.sample_size, 10);
      }
    }
    const rawBenchmarks = Object.values(rawBenchMap).sort((a, b) =>
      (a.display_order ?? 999) - (b.display_order ?? 999) || a.stage.localeCompare(b.stage)
    );

    const lastComputedAt = benchRows.rows.length > 0 ? benchRows.rows[0].computed_at : null;

    const cycleTime: { won_median: number | null; won_sample: number; lost_median: number | null; lost_sample: number } = {
      won_median: null, won_sample: 0, lost_median: null, lost_sample: 0,
    };
    for (const r of cycleTimeResult.rows) {
      if (r.outcome === 'won') {
        cycleTime.won_median = parseFloat(r.median_total_days);
        cycleTime.won_sample = parseInt(r.sample_size, 10);
      } else {
        cycleTime.lost_median = parseFloat(r.median_total_days);
        cycleTime.lost_sample = parseInt(r.sample_size, 10);
      }
    }

    res.json({ benchmarks, raw_benchmarks: rawBenchmarks, open_averages: openAverages, pipelines, last_computed_at: lastComputedAt, cycle_time: cycleTime });
  } catch (err) {
    console.error('[StageBenchmarks] GET error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── GET /:workspaceId/stage-benchmarks/math ─────────────────────────────────

router.get('/:workspaceId/stage-benchmarks/math', async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.params;
    const { stage_normalized, segment, outcome, pipeline } = req.query as Record<string, string>;

    if (!stage_normalized || !outcome) {
      res.status(400).json({ error: 'stage_normalized and outcome are required' });
      return;
    }

    const [lowCutoff, highCutoff] = await autoDetectSegmentBoundaries(workspaceId);
    const outcomeVal = outcome === 'won' ? 'closed_won' : 'closed_lost';

    // Special case: _cycle_total returns per-deal total cycle time (SUM of all stages)
    if (stage_normalized === '_cycle_total') {
      const params: (string | number)[] = [workspaceId, outcomeVal];
      let paramIdx = 3;
      let pipelineFilter = '';
      if (pipeline && pipeline !== 'all') {
        params.push(pipeline);
        pipelineFilter = `AND d.pipeline = $${paramIdx++}`;
      }
      const result = await query<{
        id: string; name: string; amount: string | null; outcome: string;
        pipeline: string; duration_days: string; entered_at: string; exited_at: string | null; stage_display_name: string;
      }>(
        `SELECT d.id,
                COALESCE(d.name, 'Unnamed deal') AS name,
                d.amount,
                d.stage_normalized AS outcome,
                COALESCE(d.pipeline, '') AS pipeline,
                SUM(dsh.duration_days)::text AS duration_days,
                MIN(dsh.entered_at)::text AS entered_at,
                MAX(dsh.exited_at)::text AS exited_at,
                'Total Sales Cycle' AS stage_display_name
         FROM deals d
         JOIN deal_stage_history dsh ON dsh.deal_id = d.id AND dsh.workspace_id = d.workspace_id
         WHERE d.workspace_id = $1
           AND d.stage_normalized = $2
           AND dsh.duration_days > 0
           ${pipelineFilter}
         GROUP BY d.id, d.name, d.amount, d.stage_normalized, d.pipeline
         ORDER BY SUM(dsh.duration_days) ASC
         LIMIT 100`,
        params
      );
      res.json({ deals: result.rows });
      return;
    }

    const params: (string | number)[] = [workspaceId, stage_normalized];
    let paramIdx = 3;

    let segFilter = '';
    if (segment === 'smb') segFilter = `AND COALESCE(d.amount::numeric, 0) < ${lowCutoff}`;
    else if (segment === 'mid_market') segFilter = `AND COALESCE(d.amount::numeric, 0) >= ${lowCutoff} AND COALESCE(d.amount::numeric, 0) < ${highCutoff}`;
    else if (segment === 'enterprise') segFilter = `AND COALESCE(d.amount::numeric, 0) >= ${highCutoff}`;

    params.push(outcomeVal);
    const outcomeFilter = `AND d.stage_normalized = $${paramIdx++}`;

    let pipelineFilter = '';
    if (pipeline && pipeline !== 'all') {
      params.push(pipeline);
      pipelineFilter = `AND d.pipeline = $${paramIdx++}`;
    }

    const result = await query<{
      id: string;
      name: string;
      amount: string | null;
      outcome: string;
      pipeline: string;
      duration_days: string;
      entered_at: string;
      exited_at: string | null;
      stage_display_name: string;
    }>(
      `SELECT d.id,
              COALESCE(d.name, 'Unnamed deal') AS name,
              d.amount,
              d.stage_normalized AS outcome,
              COALESCE(d.pipeline, '') AS pipeline,
              dsh.duration_days::text,
              dsh.entered_at::text,
              dsh.exited_at::text,
              COALESCE(sc.stage_name, dsh.stage) AS stage_display_name
       FROM deal_stage_history dsh
       JOIN deals d ON d.id = dsh.deal_id
       LEFT JOIN stage_configs sc ON sc.workspace_id = dsh.workspace_id
         AND (sc.stage_id = dsh.stage OR sc.stage_name = dsh.stage)
         AND sc.pipeline_name = d.pipeline
       WHERE dsh.workspace_id = $1
         AND dsh.stage_normalized = $2
         AND dsh.duration_days IS NOT NULL
         ${outcomeFilter}
         ${segFilter}
         ${pipelineFilter}
       ORDER BY dsh.duration_days ASC
       LIMIT 100`,
      params
    );

    res.json({ deals: result.rows });
  } catch (err) {
    console.error('[StageBenchmarks] Math error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── POST /:workspaceId/stage-benchmarks/refresh ─────────────────────────────

router.post('/:workspaceId/stage-benchmarks/refresh', async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.params;
    const result = await computeAndStoreStageBenchmarks(workspaceId);
    res.json({ ...result, computed_at: new Date().toISOString() });
  } catch (err) {
    console.error('[StageBenchmarks] Refresh error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── GET /:workspaceId/deals/:dealId/coaching ─────────────────────────────────

router.get('/:workspaceId/deals/:dealId/coaching', async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId, dealId } = req.params;

    // Fetch deal basics
    const dealResult = await query<{
      stage: string;
      stage_normalized: string;
      stage_changed_at: string | null;
      amount: string | null;
      days_in_stage: number | null;
      pipeline: string | null;
      owner: string | null;
    }>(
      `SELECT stage, stage_normalized, stage_changed_at, amount, days_in_stage, pipeline, owner
       FROM deals WHERE id = $1 AND workspace_id = $2`,
      [dealId, workspaceId]
    );
    if (dealResult.rows.length === 0) {
      res.status(404).json({ error: 'Deal not found' });
      return;
    }
    const deal = dealResult.rows[0];
    const amount = parseFloat(deal.amount ?? '0') || 0;

    // Determine segment
    const [lowCutoff, highCutoff] = await autoDetectSegmentBoundaries(workspaceId);
    const segment = amount <= 0 ? 'all' : amount < lowCutoff ? 'smb' : amount < highCutoff ? 'mid_market' : 'enterprise';

    // Fetch stage history
    const historyResult = await query<{
      stage: string;
      stage_normalized: string;
      entered_at: string;
      exited_at: string | null;
      duration_days: number | null;
    }>(
      `SELECT stage, stage_normalized, entered_at, exited_at, duration_days
       FROM deal_stage_history
       WHERE deal_id = $1 AND workspace_id = $2
         AND stage_normalized NOT IN ('closed_won', 'closed_lost', 'unknown')
       ORDER BY entered_at ASC`,
      [dealId, workspaceId]
    );

    // Compute current stage days
    const currentDaysInStage = deal.days_in_stage ??
      (deal.stage_changed_at
        ? Math.floor((Date.now() - new Date(deal.stage_changed_at).getTime()) / 86400000)
        : null);

    // Build stage journey
    const stageJourney = await Promise.all(
      historyResult.rows.map(async (h, i) => {
        const isCurrentStage = !h.exited_at || i === historyResult.rows.length - 1;
        const daysInStage = isCurrentStage
          ? (currentDaysInStage ?? h.duration_days ?? 0)
          : (h.duration_days ?? 0);
        const benchmark = await lookupBenchmark(workspaceId, h.stage_normalized, segment, deal.pipeline ?? 'all');
        const velocitySignal = computeVelocitySignal(daysInStage, h.stage, benchmark, undefined);
        return {
          stage: h.stage,
          stage_normalized: h.stage_normalized,
          entered_at: h.entered_at,
          exited_at: h.exited_at,
          duration_days: daysInStage,
          is_current: isCurrentStage,
          benchmark: benchmark ? {
            won_median: benchmark.won?.median_days ?? null,
            won_p75: benchmark.won?.p75_days ?? null,
            lost_median: benchmark.lost?.median_days ?? null,
            confidence_tier: benchmark.confidence_tier,
            is_inverted: benchmark.is_inverted,
            inversion_note: benchmark.inversion_note,
            won_sample_size: benchmark.won?.sample_size ?? 0,
          } : null,
          signal: velocitySignal.signal,
          ratio: velocitySignal.ratio,
          explanation: velocitySignal.explanation,
          countdown_days: velocitySignal.countdown_days,
        };
      })
    );

    // Current velocity (current stage)
    const currentStageHistory = historyResult.rows[historyResult.rows.length - 1];
    const currentBenchmark = currentStageHistory
      ? await lookupBenchmark(workspaceId, currentStageHistory.stage_normalized, segment, deal.pipeline ?? 'all')
      : null;
    const currentVelocity = currentBenchmark && currentDaysInStage !== null
      ? computeVelocitySignal(currentDaysInStage, deal.stage, currentBenchmark)
      : { signal: 'watch' as const, ratio: null, explanation: 'No benchmark data for current stage.', countdown_days: null };

    // Engagement signals
    const lastCallResult = await query<{ call_date: string }>(
      `SELECT call_date FROM conversations
       WHERE deal_id = $1 AND workspace_id = $2 AND is_internal = FALSE AND call_date IS NOT NULL
       ORDER BY call_date DESC LIMIT 1`,
      [dealId, workspaceId]
    );
    const lastCallAt = lastCallResult.rows[0]?.call_date ?? null;
    const daysSinceCall = lastCallAt
      ? Math.floor((Date.now() - new Date(lastCallAt).getTime()) / 86400000)
      : null;

    const engagementSignal: 'active' | 'cooling' | 'dark' | 'no_data' =
      daysSinceCall === null ? 'no_data'
        : daysSinceCall <= 14 ? 'active'
          : daysSinceCall <= 30 ? 'cooling'
            : 'dark';

    // Multi-threading: unique participants from last 60 days
    const participantsResult = await query<{ cnt: string }>(
      `SELECT COUNT(DISTINCT part->>'email') AS cnt
       FROM conversations c,
            jsonb_array_elements(
              CASE jsonb_typeof(c.participants) WHEN 'array' THEN c.participants ELSE '[]'::jsonb END
            ) AS part
       WHERE c.deal_id = $1 AND c.workspace_id = $2
         AND c.call_date > NOW() - INTERVAL '60 days'`,
      [dealId, workspaceId]
    );
    const contactCount = parseInt(participantsResult.rows[0]?.cnt ?? '0', 10);

    // Missing stakeholders
    const missingResult = await query<{ name: string; title: string | null; role: string | null }>(
      `SELECT c.name, c.title, COALESCE(dc.buying_role, 'unknown') AS role
       FROM contacts c
       JOIN deal_contacts dc ON dc.contact_id = c.id AND dc.deal_id = $1
       WHERE c.workspace_id = $2
         AND c.email IS NOT NULL
         AND c.email NOT IN (
           SELECT DISTINCT part->>'email'
           FROM conversations conv,
                jsonb_array_elements(
                  CASE jsonb_typeof(conv.participants) WHEN 'array' THEN conv.participants ELSE '[]'::jsonb END
                ) AS part
           WHERE conv.deal_id = $1 AND conv.workspace_id = $2
         )`,
      [dealId, workspaceId]
    );
    const missingStakeholders = missingResult.rows.map(r => ({
      name: r.name,
      title: r.title,
      role: r.role ?? 'unknown',
      is_critical: ['decision_maker', 'executive_sponsor'].includes(r.role ?? ''),
    }));

    // Recent conversations
    const recentConvsResult = await query<{ id: string; title: string; call_date: string | null; duration: number | null }>(
      `SELECT id, title, call_date, duration_seconds / 60.0 AS duration
       FROM conversations
       WHERE deal_id = $1 AND workspace_id = $2 AND is_internal = FALSE AND call_date IS NOT NULL
       ORDER BY call_date DESC LIMIT 3`,
      [dealId, workspaceId]
    );

    // Action items from Fireflies
    const actionItemsResult = await query<{ source_title: string; source_date: string | null; item: unknown }>(
      `SELECT c.title AS source_title, c.call_date AS source_date,
              jsonb_array_elements(c.action_items) AS item
       FROM conversations c
       WHERE c.deal_id = $1 AND c.workspace_id = $2
         AND c.action_items IS NOT NULL AND jsonb_typeof(c.action_items) = 'array'
       ORDER BY c.call_date DESC`,
      [dealId, workspaceId]
    );

    const actionItems = actionItemsResult.rows.map(r => {
      const item = r.item as Record<string, unknown>;
      const daysSinceSource = Math.floor(
        (Date.now() - new Date(r.source_date).getTime()) / 86400000
      );
      return {
        text: String(item.text ?? item.action_item ?? item.description ?? ''),
        owner: String(item.owner ?? item.assignee ?? deal.owner ?? ''),
        source_conversation_title: r.source_title,
        source_date: r.source_date,
        context: String(item.context ?? item.transcript_context ?? ''),
        status: daysSinceSource > 14 ? 'overdue' : 'open',
        days_overdue: daysSinceSource > 14 ? daysSinceSource - 14 : 0,
      };
    });

    // Composite health
    const composite = computeCompositeLabel(currentVelocity.signal, engagementSignal);
    const compositeNextStep =
      composite.label === 'Healthy' ? 'Keep momentum — maintain call cadence.'
        : composite.label === 'Running Long, But Active' ? 'Schedule a timeline conversation. Acknowledge the length and set a mutual close plan.'
          : composite.label === 'Watch Closely' ? 'Re-engage the buyer with a specific next step in the next 7 days.'
            : composite.label === 'At Risk' || composite.label === 'At Risk (But Active)' ? 'Bring in a second voice — manager or executive — to reset momentum.'
              : 'Qualify or disqualify. Holding a stalled deal costs more than losing it cleanly.';

    res.json({
      stage_journey: stageJourney,
      current_velocity: currentVelocity,
      engagement: {
        last_call_at: lastCallAt,
        last_call_days_ago: daysSinceCall,
        signal: engagementSignal,
        contact_count: contactCount,
        missing_stakeholders: missingStakeholders,
      },
      composite: {
        label: composite.label,
        color: composite.color,
        summary: currentVelocity.explanation,
        next_step: compositeNextStep,
      },
      action_items: actionItems,
      benchmarks_confidence: currentBenchmark?.confidence_tier ?? 'insufficient',
      recent_conversations: recentConvsResult.rows,
    });
  } catch (err) {
    console.error('[StageBenchmarks] Coaching endpoint error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── POST /:workspaceId/deals/:dealId/coaching-script ────────────────────────

router.post('/:workspaceId/deals/:dealId/coaching-script', async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId, dealId } = req.params;

    // Fetch deal basics
    const dealResult = await query<{ name: string; stage: string; amount: string | null; owner: string | null; days_in_stage: number | null }>(
      `SELECT name, stage, amount, owner, days_in_stage FROM deals WHERE id = $1 AND workspace_id = $2`,
      [dealId, workspaceId]
    );
    if (dealResult.rows.length === 0) {
      res.status(404).json({ error: 'Deal not found' });
      return;
    }
    const deal = dealResult.rows[0];

    // Fetch coaching data (reuse the coaching endpoint logic inline)
    const coachingRes = await fetch(
      `http://localhost:3001/api/workspaces/${workspaceId}/deals/${dealId}/coaching`
    );
    const coaching = coachingRes.ok ? await coachingRes.json() as Record<string, unknown> : null;

    // Build compact context (~2K tokens)
    const stageJourney = (coaching?.stage_journey as Array<Record<string, unknown>> | undefined) ?? [];
    const actionItems = (coaching?.action_items as Array<Record<string, unknown>> | undefined) ?? [];
    const overdueItems = actionItems.filter(a => a.status === 'overdue');
    const missing = (coaching?.engagement as Record<string, unknown> | undefined)?.missing_stakeholders as Array<Record<string, unknown>> | undefined ?? [];

    const context = `DEAL: ${deal.name}
Stage: ${deal.stage} (${deal.days_in_stage ?? '?'}d in stage)
Amount: $${deal.amount ? Number(deal.amount).toLocaleString() : '?'}
Owner: ${deal.owner ?? 'Unknown'}
Health: ${(coaching?.composite as Record<string, unknown> | undefined)?.label ?? 'Unknown'}

STAGE JOURNEY:
${stageJourney.map((s: Record<string, unknown>) =>
  `  ${s.stage}: ${s.duration_days}d — ${s.signal} (${s.explanation})`
).join('\n')}

OPEN/OVERDUE ACTION ITEMS (${overdueItems.length} overdue):
${overdueItems.slice(0, 5).map((a: Record<string, unknown>) =>
  `  - ${a.text} [${a.days_overdue}d overdue] — owner: ${a.owner}, from: ${a.source_conversation_title}`
).join('\n') || '  None'}

MISSING STAKEHOLDERS:
${missing.slice(0, 5).map((s: Record<string, unknown>) =>
  `  - ${s.name} (${s.title ?? s.role})${s.is_critical ? ' ⚠️ Critical' : ''}`
).join('\n') || '  None'}

RECENT CONVERSATIONS:
${((coaching?.recent_conversations as Array<Record<string, unknown>> | undefined) ?? []).map((c: Record<string, unknown>) =>
  `  - ${c.title} (${new Date(c.started_at as string).toLocaleDateString()})`
).join('\n') || '  None recorded'}`;

    const client = new Anthropic();
    const message = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `You are a sales manager preparing for a 1:1 coaching conversation about a deal.

${context}

Generate a coaching script with:
1. An opener (2 sentences) that acknowledges what's working before addressing concerns
2. Three numbered coaching points, each with:
   - focus: the specific area to address (e.g., "Executive access", "Overdue follow-up")
   - evidence: the specific data point from the context (use names, dates, numbers)
   - question: a coaching question for the rep — not a directive, a question that prompts self-reflection
3. A closing note (1 sentence) reinforcing confidence in the rep

Respond ONLY with valid JSON in this exact shape:
{
  "opener": "string",
  "points": [
    { "focus": "string", "evidence": "string", "question": "string" },
    { "focus": "string", "evidence": "string", "question": "string" },
    { "focus": "string", "evidence": "string", "question": "string" }
  ],
  "closing_note": "string"
}

Be specific. Never be generic. Every sentence must reference the actual deal data above.`,
      }],
    });

    const responseText = message.content[0].type === 'text' ? message.content[0].text : '{}';
    let script: unknown;
    try {
      script = JSON.parse(responseText);
    } catch {
      script = { opener: responseText, points: [], closing_note: '' };
    }

    res.json({ script });
  } catch (err) {
    console.error('[StageBenchmarks] Coaching script error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
