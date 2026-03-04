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

function deriveRisk(row: { stage_normalized: string; mention_count: number; last_mention_at: string }, patterns: Record<string, CompetitorPattern | null>, competitorName: string): RiskLevel {
  const daysSinceLastMention = row.last_mention_at
    ? (Date.now() - new Date(row.last_mention_at).getTime()) / (1000 * 60 * 60 * 24)
    : 999;

  const pattern = patterns[competitorName.toLowerCase()] ?? null;
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
    const [skillRunsResult, openDealsResult, fieldIntelResult] = await Promise.all([
      // Query 1: last 2 completed skill runs
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

      // Query 2: open deal exposure via conversations.competitor_mentions JSONB
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
           AND d.is_closed = false
           AND cv.competitor_mentions IS NOT NULL
           AND jsonb_array_length(cv.competitor_mentions) > 0
         GROUP BY d.id, d.name, d.amount, d.stage, d.stage_normalized, d.owner, comp_name
         ORDER BY d.amount DESC NULLS LAST`,
        [workspaceId]
      ).catch(() => ({ rows: [] as any[] })),

      // Query 3: field intel from deal_insights (competition type, has source quote)
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
    ]);

    // ── Extract from skill run output ──────────────────────────────────────
    const newestRun = skillRunsResult.rows[0] ?? null;
    const prevRun = skillRunsResult.rows[1] ?? null;
    const lastRunAt: string | null = newestRun?.created_at ?? null;

    let competitors: CompetitorRow[] = [];
    let baselineWinRate = 0;
    const patternByName: Record<string, CompetitorPattern | null> = {};

    if (newestRun) {
      const output = newestRun.output ?? {};
      const evidence = output.evidence ?? {};
      const records: any[] = evidence.evaluated_records ?? [];

      // Build leaderboard from evidence records
      if (records.length > 0) {
        baselineWinRate = records[0]?.win_rate_without ?? 0;
        competitors = records.map((r: any) => ({
          name: r.competitor_name ?? '',
          deal_count: r.deals_mentioned ?? 0,
          win_rate: r.win_rate ?? 0,
          win_rate_without: r.win_rate_without ?? baselineWinRate,
          delta: r.win_rate_delta ?? 0,
          trend: 'stable' as Trend,
          mention_trend: '',
          pattern: null,
        }));
      }

      // Extract patterns from steps JSONB
      const steps = newestRun.steps ?? {};
      const patternStepKey = Object.keys(steps).find(k => k.includes('pattern') || k.includes('analyze'));
      if (patternStepKey) {
        const patternOutput = steps[patternStepKey]?.output ?? steps[patternStepKey] ?? [];
        const patternArr: any[] = Array.isArray(patternOutput) ? patternOutput : (patternOutput.patterns ?? []);
        for (const p of patternArr) {
          const key = (p.competitor_name ?? '').toLowerCase().trim();
          if (key) {
            patternByName[key] = p.pattern ?? null;
            const trend = p.trend === 'increasing' ? 'up' : p.trend === 'decreasing' ? 'down' : 'stable';
            const comp = competitors.find(c => c.name.toLowerCase() === key);
            if (comp) {
              comp.pattern = p.pattern ?? null;
              comp.trend = trend;
            }
          }
        }
      }
    }

    // ── Trend: mention change between runs ─────────────────────────────────
    let mentionChangePctVal: number | null = null;
    if (newestRun && prevRun) {
      const getTotal = (run: any) => {
        const records: any[] = run.output?.evidence?.evaluated_records ?? [];
        return records.reduce((sum: number, r: any) => sum + (r.deals_mentioned ?? 0), 0);
      };
      mentionChangePctVal = mentionChangePct(getTotal(newestRun), getTotal(prevRun));
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
      last_mention_at: r.last_mention_at ? new Date(r.last_mention_at).toISOString() : new Date().toISOString(),
      risk: deriveRisk(
        { stage_normalized: r.stage_normalized ?? '', mention_count: r.mention_count ?? 1, last_mention_at: r.last_mention_at },
        patternByName,
        r.competitor_name ?? ''
      ),
    }));

    // ── Pipeline stats ──────────────────────────────────────────────────────
    const pipelineAtRisk = openDeals.reduce((sum, d) => sum + d.amount, 0);
    const highRiskPipeline = openDeals.filter(d => d.risk === 'high').reduce((sum, d) => sum + d.amount, 0);

    // ── Hardest competitor (most negative delta) ───────────────────────────
    let hardestCompetitor: string | null = null;
    let hardestCompetitorDelta: number | null = null;
    if (competitors.length > 0) {
      const sorted = [...competitors].sort((a, b) => a.delta - b.delta);
      hardestCompetitor = sorted[0].name;
      hardestCompetitorDelta = Math.round(sorted[0].delta * 100); // convert fraction to pp
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
        created_at: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
      }));

    // ── Baseline from open deals fallback (if no skill run) ───────────────
    // If no skill run data but we have open deals, we can at least show pipeline
    // baseline_win_rate stays 0 if skill hasn't run

    return res.json({
      last_run_at: lastRunAt,
      competitors_tracked: competitors.length,
      baseline_win_rate: Math.round(baselineWinRate * 100),
      mention_change_pct: mentionChangePctVal,
      pipeline_at_risk: pipelineAtRisk,
      high_risk_pipeline: highRiskPipeline,
      hardest_competitor: hardestCompetitor,
      hardest_competitor_delta: hardestCompetitorDelta,
      competitors: competitors.map(c => ({
        ...c,
        win_rate: Math.round(c.win_rate * 100),
        delta: Math.round(c.delta * 100),
        mention_trend: c.trend === 'up' ? '+MoM' : c.trend === 'down' ? '-MoM' : 'stable',
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
