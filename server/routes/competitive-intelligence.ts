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

const OPEN_STAGES = ['closed_won', 'closed_lost'];

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

/**
 * GET /:workspaceId/intelligence/competitive
 * Returns the full competitive intelligence page payload.
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
      prevMentionTotalsResult,
    ] = await Promise.all([

      // Query 1: last 2 completed skill runs (for last_run_at + pattern extraction from steps)
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

      // Query 2: open deal exposure — uses stage_normalized NOT IN closed states
      query<any>(
        `SELECT
           d.id AS deal_id,
           d.name AS deal_name,
           d.amount,
           d.stage,
           d.stage_normalized,
           d.owner AS owner_email,
           comp_name AS competitor_name,
           COUNT(DISTINCT cv.id)::int AS mention_count,
           MAX(cv.call_date) AS last_mention_at
         FROM deals d
         JOIN conversations cv ON cv.deal_id = d.id AND cv.workspace_id = $1
         CROSS JOIN LATERAL jsonb_array_elements_text(cv.competitor_mentions) AS comp_name
         WHERE d.workspace_id = $1
           AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
           AND cv.competitor_mentions IS NOT NULL
           AND jsonb_array_length(cv.competitor_mentions) > 0
         GROUP BY d.id, d.name, d.amount, d.stage, d.stage_normalized, d.owner, comp_name
         ORDER BY d.amount DESC NULLS LAST`,
        [workspaceId]
      ).catch(() => ({ rows: [] as any[] })),

      // Query 3: field intel from deal_insights
      query<any>(
        `SELECT
           di.insight_value AS competitor_name,
           di.source_quote,
           di.confidence,
           di.extracted_at AS created_at,
           d.name AS deal_name,
           d.owner AS owner_email
         FROM deal_insights di
         JOIN deals d ON d.id = di.deal_id AND d.workspace_id = $1
         WHERE di.workspace_id = $1
           AND di.insight_type = 'competition'
           AND di.source_quote IS NOT NULL
           AND di.source_quote != ''
           AND di.is_current = true
         ORDER BY di.confidence DESC, di.extracted_at DESC
         LIMIT 20`,
        [workspaceId]
      ).catch(() => ({ rows: [] as any[] })),

      // Query 4: competitor win rates computed directly from DB
      query<any>(
        `SELECT
           comp_name AS competitor_name,
           COUNT(DISTINCT d.id)::int AS deals_mentioned,
           COUNT(DISTINCT CASE WHEN d.stage_normalized = 'closed_won' THEN d.id END)::float /
             NULLIF(COUNT(DISTINCT CASE WHEN d.stage_normalized IN ('closed_won','closed_lost') THEN d.id END), 0)
             AS win_rate
         FROM deals d
         JOIN conversations cv ON cv.deal_id = d.id AND cv.workspace_id = $1
         CROSS JOIN LATERAL jsonb_array_elements_text(cv.competitor_mentions) AS comp_name
         WHERE d.workspace_id = $1
           AND cv.competitor_mentions IS NOT NULL
           AND jsonb_array_length(cv.competitor_mentions) > 0
         GROUP BY comp_name
         ORDER BY deals_mentioned DESC`,
        [workspaceId]
      ).catch(() => ({ rows: [] as any[] })),

      // Query 5: baseline win rate (all closed deals, no filter)
      query<any>(
        `SELECT
           COUNT(CASE WHEN stage_normalized = 'closed_won' THEN 1 END)::float /
             NULLIF(COUNT(CASE WHEN stage_normalized IN ('closed_won','closed_lost') THEN 1 END), 0)
             AS baseline_win_rate
         FROM deals
         WHERE workspace_id = $1`,
        [workspaceId]
      ).catch(() => ({ rows: [] as any[] })),

      // Query 6: previous period mention totals (30–60 days ago) for change pct
      query<any>(
        `SELECT COUNT(DISTINCT cv.id)::int AS prev_mention_count
         FROM conversations cv
         CROSS JOIN LATERAL jsonb_array_elements_text(cv.competitor_mentions) AS comp_name
         WHERE cv.workspace_id = $1
           AND cv.competitor_mentions IS NOT NULL
           AND jsonb_array_length(cv.competitor_mentions) > 0
           AND cv.call_date BETWEEN NOW() - INTERVAL '60 days' AND NOW() - INTERVAL '30 days'`,
        [workspaceId]
      ).catch(() => ({ rows: [] as any[] })),
    ]);

    // ── Skill run metadata (last_run_at + patterns from steps) ─────────────
    const newestRun = skillRunsResult.rows[0] ?? null;
    const lastRunAt: string | null = newestRun?.created_at ?? null;
    const patternByName: Record<string, CompetitorPattern | null> = {};

    if (newestRun) {
      const steps: any[] = Array.isArray(newestRun.steps) ? newestRun.steps : [];
      const patternStep = steps.find(
        (s: any) => s.stepId === 'analyze-competitive-patterns' && s.output
      );
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

    // ── Competitor leaderboard (from DB win rates) ─────────────────────────
    const competitors: CompetitorRow[] = competitorWinRatesResult.rows.map((r: any) => {
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

    // ── Mention change pct (current 30d vs prev 30d) ───────────────────────
    let mentionChangePctVal: number | null = null;
    const prevMentionCount: number = prevMentionTotalsResult.rows[0]?.prev_mention_count ?? 0;
    if (prevMentionCount > 0) {
      const currentMentionCountResult = await query<any>(
        `SELECT COUNT(DISTINCT cv.id)::int AS current_mention_count
         FROM conversations cv
         CROSS JOIN LATERAL jsonb_array_elements_text(cv.competitor_mentions) AS comp_name
         WHERE cv.workspace_id = $1
           AND cv.competitor_mentions IS NOT NULL
           AND jsonb_array_length(cv.competitor_mentions) > 0
           AND cv.call_date >= NOW() - INTERVAL '30 days'`,
        [workspaceId]
      ).catch(() => ({ rows: [] as any[] }));
      const currentMentionCount: number = currentMentionCountResult.rows[0]?.current_mention_count ?? 0;
      mentionChangePctVal = mentionChangePct(currentMentionCount, prevMentionCount);
    }

    // ── Open deal exposure ─────────────────────────────────────────────────
    const openDeals: OpenDealRow[] = openDealsResult.rows.map((r: any) => ({
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
        {
          stage_normalized: r.stage_normalized ?? '',
          mention_count: r.mention_count ?? 1,
          last_mention_at: r.last_mention_at,
        },
        patternByName,
        r.competitor_name ?? ''
      ),
    }));

    const pipelineAtRisk = openDeals.reduce((sum, d) => sum + d.amount, 0);
    const highRiskPipeline = openDeals
      .filter(d => d.risk === 'high')
      .reduce((sum, d) => sum + d.amount, 0);

    // ── Hardest competitor (most negative delta) ───────────────────────────
    let hardestCompetitor: string | null = null;
    let hardestCompetitorDelta: number | null = null;
    if (competitors.length > 0) {
      const sorted = [...competitors].sort((a, b) => a.delta - b.delta);
      hardestCompetitor = sorted[0].name;
      hardestCompetitorDelta = sorted[0].delta;
    }

    // ── Field intel ─────────────────────────────────────────────────────────
    const fieldIntel: FieldIntelRow[] = fieldIntelResult.rows
      .filter((r: any) => r.competitor_name && r.source_quote)
      .map((r: any) => ({
        competitor_name: r.competitor_name,
        deal_name: r.deal_name ?? '',
        owner_email: r.owner_email ?? '',
        source_quote: r.source_quote,
        confidence_score: parseFloat(r.confidence ?? '0') || 0,
        created_at: r.created_at
          ? new Date(r.created_at).toISOString()
          : new Date().toISOString(),
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
