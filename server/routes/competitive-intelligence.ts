import { Router, Request, Response } from 'express';
import { query } from '../db.js';

const router = Router();

type CompetitorPattern =
  | 'displacement_threat'
  | 'pricing_pressure'
  | 'feature_gap'
  | 'emerging_threat'
  | 'declining_threat'
  | 'segment_specific';

type RiskLevel = 'high' | 'med' | 'low';
type Trend = 'up' | 'down' | 'stable';

interface CompetitorRow {
  name: string;
  deal_count: number;
  win_rate: number;
  win_rate_without: number;
  delta: number;
  trend: Trend;
  mention_trend: string;
  pattern: CompetitorPattern | null;
}

interface OpenDealRow {
  deal_id: string;
  deal_name: string;
  competitor_name: string;
  amount: number;
  stage: string;
  owner_email: string;
  mention_count: number;
  last_mention_at: string;
  risk: RiskLevel;
}

interface FieldIntelRow {
  competitor_name: string;
  deal_name: string;
  owner_email: string;
  source_quote: string;
  confidence_score: number;
  created_at: string;
}

function deriveRisk(
  row: { stage_normalized: string; mention_count: number; last_mention_at: string },
  patternByName: Record<string, CompetitorPattern | null>,
  competitorName: string
): RiskLevel {
  const daysSinceLastMention = row.last_mention_at
    ? (Date.now() - new Date(row.last_mention_at).getTime()) / (1000 * 60 * 60 * 24)
    : 999;
  const pattern = patternByName[competitorName.toLowerCase()] ?? null;
  const lateStages = ['evaluation', 'decision', 'negotiation'];
  const isLateStage = lateStages.includes(row.stage_normalized);
  const isHighRiskPattern = pattern === 'displacement_threat' || pattern === 'emerging_threat';
  if (isHighRiskPattern && daysSinceLastMention <= 7 && isLateStage) return 'high';
  if (isLateStage && daysSinceLastMention <= 7) return 'high';
  if (daysSinceLastMention <= 14 || row.mention_count >= 2) return 'med';
  return 'low';
}

function mentionChangePct(current: number, prev: number): number | null {
  if (prev === 0) return null;
  return Math.round(((current - prev) / prev) * 100);
}

async function loadExclusions(workspaceId: string): Promise<string[]> {
  const result = await query<any>(
    `SELECT value FROM workspace_settings WHERE workspace_id = $1 AND key = 'competitor_exclusions'`,
    [workspaceId]
  ).catch(() => ({ rows: [] as any[] }));
  if (!result.rows[0]?.value) return [];
  try { return JSON.parse(result.rows[0].value) as string[]; } catch { return []; }
}

async function saveExclusions(workspaceId: string, exclusions: string[]): Promise<void> {
  await query(
    `INSERT INTO workspace_settings (id, workspace_id, key, value, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, 'competitor_exclusions', $2, NOW(), NOW())
     ON CONFLICT (workspace_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [workspaceId, JSON.stringify(exclusions)]
  );
}

// ── Exclusion management routes ────────────────────────────────────────────────

router.get('/:workspaceId/intelligence/competitive/exclusions', async (req: Request, res: Response) => {
  try {
    const exclusions = await loadExclusions(req.params.workspaceId);
    return res.json({ exclusions });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to load exclusions' });
  }
});

router.post('/:workspaceId/intelligence/competitive/exclusions', async (req: Request, res: Response) => {
  try {
    const { name } = req.body ?? {};
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name is required' });
    const key = name.toLowerCase().trim();
    const exclusions = await loadExclusions(req.params.workspaceId);
    if (!exclusions.includes(key)) {
      exclusions.push(key);
      await saveExclusions(req.params.workspaceId, exclusions);
    }
    return res.json({ exclusions });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to add exclusion' });
  }
});

router.delete('/:workspaceId/intelligence/competitive/exclusions/:name', async (req: Request, res: Response) => {
  try {
    const key = decodeURIComponent(req.params.name).toLowerCase().trim();
    const exclusions = await loadExclusions(req.params.workspaceId);
    const updated = exclusions.filter(e => e !== key);
    await saveExclusions(req.params.workspaceId, updated);
    return res.json({ exclusions: updated });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to remove exclusion' });
  }
});

// ── Main page payload ──────────────────────────────────────────────────────────

/**
 * GET /:workspaceId/intelligence/competitive
 * Primary source: conversation_signals (signal_type = 'competitor_mention')
 * Supplementary: skill_runs (last_run_at + patterns), workspace_settings (exclusions)
 */
router.get('/:workspaceId/intelligence/competitive', async (req: Request, res: Response) => {
  const workspaceId = req.params.workspaceId as string;

  try {
    const [
      skillRunsResult,
      openDealsResult,
      fieldIntelResult,
      competitorWinRatesResult,
      baselineResult,
      prevPeriodResult,
      currentPeriodResult,
      exclusionsResult,
    ] = await Promise.all([

      // Q1: last 2 skill runs — for last_run_at and pattern step output
      query<any>(
        `SELECT output, steps, created_at
         FROM skill_runs
         WHERE workspace_id = $1
           AND skill_id = 'competitive-intelligence'
           AND status IN ('completed', 'partial')
         ORDER BY created_at DESC
         LIMIT 2`,
        [workspaceId]
      ).catch(() => ({ rows: [] as any[] })),

      // Q2: open deal exposure — via conversation_signals
      query<any>(
        `SELECT
           d.id AS deal_id,
           d.name AS deal_name,
           d.amount,
           d.stage,
           d.stage_normalized,
           d.owner AS owner_email,
           cs.signal_value AS competitor_name,
           COUNT(DISTINCT cv.id)::int AS mention_count,
           MAX(cv.call_date) AS last_mention_at
         FROM conversation_signals cs
         JOIN conversations cv ON cv.id = cs.conversation_id AND cv.workspace_id = $1
         JOIN deals d ON d.id = cv.deal_id AND d.workspace_id = $1
         WHERE cs.workspace_id = $1
           AND cs.signal_type = 'competitor_mention'
           AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
         GROUP BY d.id, d.name, d.amount, d.stage, d.stage_normalized, d.owner, cs.signal_value
         ORDER BY d.amount DESC NULLS LAST`,
        [workspaceId]
      ).catch(() => ({ rows: [] as any[] })),

      // Q3: field intel — from conversation_signals source_quotes
      query<any>(
        `SELECT
           cs.signal_value AS competitor_name,
           cs.source_quote,
           cs.confidence,
           cs.created_at,
           d.name AS deal_name,
           d.owner AS owner_email
         FROM conversation_signals cs
         JOIN conversations cv ON cv.id = cs.conversation_id AND cv.workspace_id = $1
         JOIN deals d ON d.id = cv.deal_id AND d.workspace_id = $1
         WHERE cs.workspace_id = $1
           AND cs.signal_type = 'competitor_mention'
           AND cs.source_quote IS NOT NULL
           AND cs.source_quote != ''
         ORDER BY cs.confidence DESC, cs.created_at DESC
         LIMIT 30`,
        [workspaceId]
      ).catch(() => ({ rows: [] as any[] })),

      // Q4: competitor win rates
      query<any>(
        `SELECT
           cs.signal_value AS competitor_name,
           COUNT(DISTINCT d.id)::int AS deals_mentioned,
           COUNT(DISTINCT CASE WHEN d.stage_normalized = 'closed_won' THEN d.id END)::float /
             NULLIF(COUNT(DISTINCT CASE WHEN d.stage_normalized IN ('closed_won','closed_lost') THEN d.id END), 0)
             AS win_rate
         FROM conversation_signals cs
         JOIN conversations cv ON cv.id = cs.conversation_id AND cv.workspace_id = $1
         JOIN deals d ON d.id = cv.deal_id AND d.workspace_id = $1
         WHERE cs.workspace_id = $1
           AND cs.signal_type = 'competitor_mention'
         GROUP BY cs.signal_value
         ORDER BY deals_mentioned DESC`,
        [workspaceId]
      ).catch(() => ({ rows: [] as any[] })),

      // Q5: baseline win rate
      query<any>(
        `SELECT
           COUNT(CASE WHEN stage_normalized = 'closed_won' THEN 1 END)::float /
             NULLIF(COUNT(CASE WHEN stage_normalized IN ('closed_won','closed_lost') THEN 1 END), 0)
             AS baseline_win_rate
         FROM deals
         WHERE workspace_id = $1`,
        [workspaceId]
      ).catch(() => ({ rows: [] as any[] })),

      // Q6: prev 30-day competitor signal count
      query<any>(
        `SELECT COUNT(DISTINCT cs.id)::int AS count
         FROM conversation_signals cs
         JOIN conversations cv ON cv.id = cs.conversation_id AND cv.workspace_id = $1
         WHERE cs.workspace_id = $1
           AND cs.signal_type = 'competitor_mention'
           AND cv.call_date BETWEEN NOW() - INTERVAL '60 days' AND NOW() - INTERVAL '30 days'`,
        [workspaceId]
      ).catch(() => ({ rows: [] as any[] })),

      // Q7: current 30-day competitor signal count
      query<any>(
        `SELECT COUNT(DISTINCT cs.id)::int AS count
         FROM conversation_signals cs
         JOIN conversations cv ON cv.id = cs.conversation_id AND cv.workspace_id = $1
         WHERE cs.workspace_id = $1
           AND cs.signal_type = 'competitor_mention'
           AND cv.call_date >= NOW() - INTERVAL '30 days'`,
        [workspaceId]
      ).catch(() => ({ rows: [] as any[] })),

      // Q8: workspace exclusions
      query<any>(
        `SELECT value FROM workspace_settings WHERE workspace_id = $1 AND key = 'competitor_exclusions'`,
        [workspaceId]
      ).catch(() => ({ rows: [] as any[] })),
    ]);

    // ── Exclusions ─────────────────────────────────────────────────────────
    let exclusions: string[] = [];
    if (exclusionsResult.rows[0]?.value) {
      try { exclusions = JSON.parse(exclusionsResult.rows[0].value); } catch { exclusions = []; }
    }
    const isExcluded = (name: string) => exclusions.includes(name.toLowerCase().trim());

    // ── Skill run metadata ─────────────────────────────────────────────────
    const newestRun = skillRunsResult.rows[0] ?? null;
    const lastRunAt: string | null = newestRun?.created_at ?? null;
    const patternByName: Record<string, CompetitorPattern | null> = {};

    if (newestRun) {
      const steps: any[] = Array.isArray(newestRun.steps) ? newestRun.steps : [];
      const patternStep = steps.find((s: any) => s.stepId === 'analyze-competitive-patterns' && s.output);
      if (patternStep) {
        const patternArr: any[] = Array.isArray(patternStep.output)
          ? patternStep.output
          : (patternStep.output?.patterns ?? []);
        for (const p of patternArr) {
          const key = (p.competitor_name ?? '').toLowerCase().trim();
          if (key) patternByName[key] = p.pattern ?? null;
        }
      }
    }

    // ── Baseline win rate ──────────────────────────────────────────────────
    const rawBaseline = baselineResult.rows[0]?.baseline_win_rate;
    const baselineWinRate = rawBaseline != null ? Math.round(parseFloat(rawBaseline) * 100) : 0;

    // ── Competitor leaderboard (exclusions filtered) ───────────────────────
    const competitors: CompetitorRow[] = competitorWinRatesResult.rows
      .filter((r: any) => !isExcluded(r.competitor_name ?? ''))
      .map((r: any) => {
        const winRate = r.win_rate != null ? Math.round(parseFloat(r.win_rate) * 100) : 0;
        const delta = winRate - baselineWinRate;
        const key = (r.competitor_name ?? '').toLowerCase().trim();
        const pattern = patternByName[key] ?? null;
        return {
          name: r.competitor_name ?? '',
          deal_count: r.deals_mentioned ?? 0,
          win_rate: winRate,
          win_rate_without: baselineWinRate,
          delta,
          trend: 'stable' as Trend,
          mention_trend: delta > 0 ? '+MoM' : delta < 0 ? '-MoM' : 'stable',
          pattern,
        };
      });

    // ── MoM mention change ─────────────────────────────────────────────────
    const prevCount: number = prevPeriodResult.rows[0]?.count ?? 0;
    const currentCount: number = currentPeriodResult.rows[0]?.count ?? 0;
    const mentionChangePctVal: number | null = mentionChangePct(currentCount, prevCount);

    // ── Open deal exposure (exclusions filtered) ───────────────────────────
    const openDeals: OpenDealRow[] = openDealsResult.rows
      .filter((r: any) => !isExcluded(r.competitor_name ?? ''))
      .map((r: any) => ({
        deal_id: r.deal_id,
        deal_name: r.deal_name ?? '',
        competitor_name: r.competitor_name ?? '',
        amount: parseFloat(r.amount ?? '0') || 0,
        stage: r.stage ?? '',
        owner_email: r.owner_email ?? '',
        mention_count: r.mention_count ?? 1,
        last_mention_at: r.last_mention_at
          ? new Date(r.last_mention_at).toISOString()
          : new Date().toISOString(),
        risk: deriveRisk(
          { stage_normalized: r.stage_normalized ?? '', mention_count: r.mention_count ?? 1, last_mention_at: r.last_mention_at },
          patternByName,
          r.competitor_name ?? ''
        ),
      }));

    const pipelineAtRisk = openDeals.reduce((sum, d) => sum + d.amount, 0);
    const highRiskPipeline = openDeals.filter(d => d.risk === 'high').reduce((sum, d) => sum + d.amount, 0);

    // ── Hardest competitor ─────────────────────────────────────────────────
    let hardestCompetitor: string | null = null;
    let hardestCompetitorDelta: number | null = null;
    if (competitors.length > 0) {
      const sorted = [...competitors].sort((a, b) => a.delta - b.delta);
      hardestCompetitor = sorted[0].name;
      hardestCompetitorDelta = sorted[0].delta;
    }

    // ── Field intel (exclusions filtered) ─────────────────────────────────
    const fieldIntel: FieldIntelRow[] = fieldIntelResult.rows
      .filter((r: any) => r.competitor_name && r.source_quote && !isExcluded(r.competitor_name))
      .map((r: any) => ({
        competitor_name: r.competitor_name,
        deal_name: r.deal_name ?? '',
        owner_email: r.owner_email ?? '',
        source_quote: r.source_quote,
        confidence_score: parseFloat(r.confidence ?? '0') || 0,
        created_at: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
      }));

    return res.json({
      last_run_at: lastRunAt,
      competitors_tracked: competitors.length,
      baseline_win_rate: baselineWinRate,
      mention_change_pct: mentionChangePctVal,
      pipeline_at_risk: pipelineAtRisk,
      high_risk_pipeline: highRiskPipeline,
      hardest_competitor: hardestCompetitor,
      hardest_competitor_delta: hardestCompetitorDelta,
      exclusions,
      competitors: competitors.map(c => ({
        name: c.name,
        deal_count: c.deal_count,
        win_rate: c.win_rate,
        delta: c.delta,
        trend: c.trend,
        mention_trend: c.mention_trend,
        pattern: c.pattern,
      })),
      open_deals: openDeals,
      field_intel: fieldIntel,
    });
  } catch (err: any) {
    console.error('[CompetitiveIntelligence] Error assembling payload:', err);
    return res.status(500).json({ error: 'Failed to load competitive intelligence data' });
  }
});

export default router;
