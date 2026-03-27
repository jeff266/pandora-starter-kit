import { query } from '../db.js';
import { callLLM } from '../utils/llm-router.js';
import { PANDORA_VOICE_STANDARD } from '../lib/voice-standard.js';
import { formatCurrency } from '../utils/format-currency.js';
import { randomUUID } from 'crypto';
import type { SuggestedAction } from './action-extractor.js';

export interface BullEvidence {
  contactCount: number;
  seniorContactCount: number;
  engagedContactCount: number;
  conversationCount: number;
  mostRecentCallDate: string | null;
  behavioralStage: string | null;
  behavioralConfidence: number | null;
  multithreadingScore: number | null;
  dealAmountVsIcpMedian: 'above' | 'at' | 'below' | null;
  repHistoricalCloseRate: number | null;
}

export interface BearEvidence {
  daysSinceActivity: number | null;
  daysUntilClose: number;
  callCount: number;
  missingRoles: string[];
  priorDeals: {
    name: string;
    amount: number;
    outcome: 'closed_lost' | 'closed_won';
    daysSinceClose: number;
  }[];
  stageAgeVsMedian: number | null;
  forecastCategoryMismatch: boolean;
}

export interface DeliberationPerspective {
  role: 'bull' | 'bear';
  output: string;
  closeProbability: number;
}

export interface DeliberationVerdict {
  expectedValue: number;
  keyVariable: string;
  reevaluateBy: string;
  recommendedAction: string;
  rawOutput: string;
}

export interface DeliberationResult {
  dealId: string;
  dealName: string;
  dealAmount: number;
  dealStage: string;
  ownerName: string;
  perspectives: {
    bull: DeliberationPerspective;
    bear: DeliberationPerspective;
  };
  verdict: DeliberationVerdict;
  tokenCost: number;
  bullEvidence: BullEvidence;
  bearEvidence: BearEvidence;
  // Deal Viability lens additions
  currentCloseProbability?: number;   // current % estimate
  actionDeltaProbability?: number;    // % if highest-leverage action taken
  highestLeverageAction?: string;     // the single action that moves the needle most
  reevaluationSignal?: string;        // specific change to watch for
  suggestedAction?: SuggestedAction;  // auto-generated from verdict
}

function parseProbabilityFromOutput(output: string): number {
  const match = output.match(/close probability[:\s]+(\d+)%/i);
  if (match) return parseInt(match[1], 10);
  const numMatch = output.match(/(\d+)%\s*$/m);
  if (numMatch) return parseInt(numMatch[1], 10);
  return 50;
}

function futureDate(label: string): string {
  const parsed = new Date(label);
  if (!isNaN(parsed.getTime()) && parsed > new Date()) return label;
  const fallback = new Date();
  fallback.setDate(fallback.getDate() + 7);
  return fallback.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function parseVerdictFields(
  rawOutput: string,
  dealAmount: number,
  bullProb: number,
  bearProb: number
): DeliberationVerdict {
  const evMatch = rawOutput.match(/expected value[:\s]*\$?([\d,]+)/i);
  const kvMatch = rawOutput.match(/key variable[:\s]*([^\n.]+)/i);
  const reevMatch = rawOutput.match(/re.?evaluat[e\w]* by[:\s]*([^\n.]+)/i);
  const actionMatch = rawOutput.match(/recommended action[:\s]*([^\n]+)/i);

  const midpointProb = (bullProb + bearProb) / 2 / 100;
  const expectedValue = evMatch
    ? parseFloat(evMatch[1].replace(/,/g, ''))
    : Math.round(dealAmount * midpointProb);

  const rawReev = reevMatch ? reevMatch[1].trim() : '';
  const reevaluateBy = rawReev ? futureDate(rawReev) : (() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  })();

  return {
    expectedValue,
    keyVariable: kvMatch ? kvMatch[1].trim() : 'Engagement with economic buyer',
    reevaluateBy,
    recommendedAction:
      actionMatch ? actionMatch[1].trim() : rawOutput.split('\n').filter(l => l.trim()).pop() || '',
    rawOutput,
  };
}

async function gatherBearEvidence(
  workspaceId: string,
  dealId: string
): Promise<{ evidence: BearEvidence; deal: any }> {
  const [dealResult, priorDealsResult, medianResult, contactRolesResult] = await Promise.all([
    query(
      `SELECT
         id, name, amount, stage, stage_normalized, owner,
         close_date, last_activity_date, days_in_stage,
         forecast_category, inferred_phase, phase_confidence,
         account_id,
         EXTRACT(DAY FROM NOW() - last_activity_date)::int AS days_since_activity,
         EXTRACT(DAY FROM close_date - NOW())::int AS days_until_close,
         (SELECT COUNT(*)::int FROM conversations c
          WHERE c.deal_id = $1 AND c.workspace_id = $2) AS call_count
       FROM deals
       WHERE id = $1 AND workspace_id = $2`,
      [dealId, workspaceId]
    ),
    query(
      `SELECT d.name, d.amount, d.stage_normalized,
              EXTRACT(DAY FROM NOW() - d.close_date)::int AS days_since_close
       FROM deals d
       WHERE d.workspace_id = $1
         AND d.account_id = (SELECT account_id FROM deals WHERE id = $2 AND workspace_id = $1)
         AND d.stage_normalized IN ('closed_won', 'closed_lost')
         AND d.id != $2
       ORDER BY d.close_date DESC
       LIMIT 5`,
      [workspaceId, dealId]
    ),
    query(
      `SELECT COALESCE(AVG(days_in_stage), NULL)::int AS median_stage_days
       FROM deals
       WHERE workspace_id = $1
         AND stage_normalized = (SELECT stage_normalized FROM deals WHERE id = $2 AND workspace_id = $1)
         AND stage_normalized NOT IN ('closed_won', 'closed_lost')
         AND id != $2`,
      [workspaceId, dealId]
    ),
    query(
      `SELECT COUNT(DISTINCT dc.contact_id)::int AS contact_count,
              COUNT(DISTINCT CASE
                WHEN c.title ILIKE ANY(ARRAY['%VP%','%Chief%','%Director%','%SVP%','%EVP%','%President%','%C-Level%'])
                  OR c.seniority IN ('vp','c_suite','director')
                THEN dc.contact_id END)::int AS senior_count
       FROM deal_contacts dc
       LEFT JOIN contacts c ON c.id = dc.contact_id AND c.workspace_id = $1
       WHERE dc.deal_id = $2`,
      [workspaceId, dealId]
    ),
  ]);

  const deal = dealResult.rows[0];
  if (!deal) throw new Error(`Deal ${dealId} not found`);

  const missingRoles: string[] = [];
  const seniorCount = parseInt(contactRolesResult.rows[0]?.senior_count || '0', 10);
  if (seniorCount === 0) missingRoles.push('economic buyer (no VP+ contact)');

  const callCount = parseInt(deal.call_count || '0', 10);
  if (callCount === 0) missingRoles.push('call engagement (zero conversations recorded)');

  const FORECAST_STAGE_MAP: Record<string, string[]> = {
    awareness: ['pipeline', 'omitted'],
    discovery: ['pipeline', 'omitted'],
    evaluation: ['pipeline', 'best_case'],
    proposal: ['best_case', 'commit'],
    negotiation: ['commit'],
    decision: ['commit'],
  };
  const expectedCategories = FORECAST_STAGE_MAP[deal.stage_normalized] ?? [];
  const forecastCategoryMismatch =
    !!deal.forecast_category &&
    expectedCategories.length > 0 &&
    !expectedCategories.includes(deal.forecast_category);

  const medianDays = medianResult.rows[0]?.median_stage_days ?? null;
  const stageAgeVsMedian =
    medianDays != null && deal.days_in_stage != null
      ? parseInt(deal.days_in_stage, 10) - medianDays
      : null;

  const evidence: BearEvidence = {
    daysSinceActivity:
      deal.days_since_activity != null ? parseInt(deal.days_since_activity, 10) : null,
    daysUntilClose: parseInt(deal.days_until_close ?? '0', 10),
    callCount,
    missingRoles,
    priorDeals: priorDealsResult.rows.map((r: any) => ({
      name: r.name,
      amount: parseFloat(r.amount) || 0,
      outcome: r.stage_normalized as 'closed_won' | 'closed_lost',
      daysSinceClose: parseInt(r.days_since_close || '0', 10),
    })),
    stageAgeVsMedian,
    forecastCategoryMismatch,
  };

  return { evidence, deal };
}

async function gatherBullEvidence(
  workspaceId: string,
  dealId: string,
  deal: any
): Promise<BullEvidence> {
  const [contactsResult, convResult, icpResult, repResult] = await Promise.all([
    query(
      `SELECT
         COUNT(DISTINCT dc.contact_id)::int AS contact_count,
         COUNT(DISTINCT CASE
           WHEN c.title ILIKE ANY(ARRAY['%VP%','%Chief%','%Director%','%SVP%','%EVP%','%President%'])
             OR c.seniority IN ('vp','c_suite','director')
           THEN dc.contact_id END)::int AS senior_count,
         COUNT(DISTINCT CASE
           WHEN EXISTS (
             SELECT 1 FROM conversations cv
             WHERE cv.deal_id = $2
               AND cv.participants IS NOT NULL
               AND cv.participants::text ILIKE '%' || c.first_name || '%'
           ) THEN dc.contact_id END)::int AS engaged_count
       FROM deal_contacts dc
       LEFT JOIN contacts c ON c.id = dc.contact_id AND c.workspace_id = $1
       WHERE dc.deal_id = $2`,
      [workspaceId, dealId]
    ),
    query(
      `SELECT COUNT(*)::int AS conversation_count, MAX(call_date) AS most_recent_call_date
       FROM conversations
       WHERE deal_id = $1 AND workspace_id = $2`,
      [dealId, workspaceId]
    ),
    query(
      `SELECT AVG(amount) AS avg_won_amount
       FROM deals
       WHERE workspace_id = $1
         AND stage_normalized = 'closed_won'
         AND created_at > NOW() - INTERVAL '1 year'`,
      [workspaceId]
    ),
    query(
      `SELECT
         COUNT(CASE WHEN stage_normalized = 'closed_won' THEN 1 END)::float /
         NULLIF(COUNT(CASE WHEN stage_normalized IN ('closed_won','closed_lost') THEN 1 END), 0) AS close_rate
       FROM deals
       WHERE workspace_id = $1
         AND owner = $2
         AND stage_normalized IN ('closed_won','closed_lost')
         AND close_date > NOW() - INTERVAL '18 months'`,
      [workspaceId, deal.owner || '']
    ),
  ]);

  const avgWon = parseFloat(icpResult.rows[0]?.avg_won_amount || '0');
  const dealAmount = parseFloat(deal.amount || '0');
  let dealAmountVsIcpMedian: 'above' | 'at' | 'below' | null = null;
  if (avgWon > 0) {
    const ratio = dealAmount / avgWon;
    if (ratio > 1.2) dealAmountVsIcpMedian = 'above';
    else if (ratio < 0.8) dealAmountVsIcpMedian = 'below';
    else dealAmountVsIcpMedian = 'at';
  }

  const closeRate = repResult.rows[0]?.close_rate;

  return {
    contactCount: parseInt(contactsResult.rows[0]?.contact_count || '0', 10),
    seniorContactCount: parseInt(contactsResult.rows[0]?.senior_count || '0', 10),
    engagedContactCount: parseInt(contactsResult.rows[0]?.engaged_count || '0', 10),
    conversationCount: parseInt(convResult.rows[0]?.conversation_count || '0', 10),
    mostRecentCallDate: convResult.rows[0]?.most_recent_call_date ?? null,
    behavioralStage: deal.inferred_phase ?? null,
    behavioralConfidence:
      deal.phase_confidence != null ? parseFloat(deal.phase_confidence) : null,
    multithreadingScore:
      deal.rfm_threading_factor != null ? parseFloat(deal.rfm_threading_factor) : null,
    dealAmountVsIcpMedian,
    repHistoricalCloseRate:
      closeRate != null ? Math.round(parseFloat(closeRate) * 100) : null,
  };
}

export async function runDeliberation(
  workspaceId: string,
  dealId: string,
  triggerQuery: string,
  triggerSurface: string = 'ask_pandora'
): Promise<DeliberationResult> {
  const { evidence: bearEvidence, deal } = await gatherBearEvidence(workspaceId, dealId);
  const bullEvidence = await gatherBullEvidence(workspaceId, dealId, deal);

  const dealLabel = `${deal.name} — $${Number(deal.amount).toLocaleString()} — ${deal.stage} — Owner: ${deal.owner || 'Unknown'}`;

  const bullResult = await callLLM(workspaceId, 'reason', {
    systemPrompt: `${PANDORA_VOICE_STANDARD}

You are the Bull Case analyst. Build the case that this deal WILL close this quarter.
Use only the evidence provided. Cite specific data points. No hedging. No editorializing.
State 2-3 arguments. End with a close probability as a percentage.
Format: numbered arguments, then "Close probability: X%"`,
    messages: [{
      role: 'user',
      content: `DEAL: ${dealLabel}
BULL EVIDENCE: ${JSON.stringify(bullEvidence, null, 2)}`,
    }],
    maxTokens: 400,
    temperature: 0.3,
    _tracking: { workspaceId, phase: 'chat', stepName: 'deliberation-bull' },
  });

  const bearResult = await callLLM(workspaceId, 'reason', {
    systemPrompt: `${PANDORA_VOICE_STANDARD}

You are the Bear Case analyst. Build the case that this deal will NOT close this quarter.
Use only the evidence provided. Cite specific data points. No hedging. No editorializing.
State 2-3 arguments. End with a close probability as a percentage.
Format: numbered arguments, then "Close probability: X%"`,
    messages: [{
      role: 'user',
      content: `DEAL: ${dealLabel}
BEAR EVIDENCE: ${JSON.stringify(bearEvidence, null, 2)}`,
    }],
    maxTokens: 400,
    temperature: 0.3,
    _tracking: { workspaceId, phase: 'chat', stepName: 'deliberation-bear' },
  });

  const bullOutput = bullResult.content || '';
  const bearOutput = bearResult.content || '';
  const bullProb = parseProbabilityFromOutput(bullOutput);
  const bearProb = parseProbabilityFromOutput(bearOutput);

  const verdictResult = await callLLM(workspaceId, 'reason', {
    systemPrompt: `${PANDORA_VOICE_STANDARD}

You are the Chief of Staff delivering a deal viability verdict.
You have heard the bull case and the bear case. State exactly four things:

CURRENT_PROBABILITY: [X]% — the deal's close probability right now based on evidence
ACTION_DELTA: +[Y]% if [specific action] is taken — the highest-leverage single action and how much it would move the probability
LEVERAGE_ACTION: [one-sentence specific action the rep can take this week]
REEVALUATION_SIGNAL: [the specific observable change that would trigger re-assessment — not a date]

Also state: Expected value: $[N] and Re-evaluate by: [specific future date].

Format strictly as labeled lines. Do not explain or editorialize.`,
    messages: [{
      role: 'user',
      content: `DEAL: ${deal.name} — $${Number(deal.amount).toLocaleString()} — ${deal.stage}
BULL CASE (${bullProb}% close probability): ${bullOutput}
BEAR CASE (${bearProb}% close probability): ${bearOutput}`,
    }],
    maxTokens: 400,
    temperature: 0.2,
    _tracking: { workspaceId, phase: 'chat', stepName: 'deliberation-verdict' },
  });

  const verdictOutput = verdictResult.content || '';

  // Parse deal viability fields
  const currProbMatch = verdictOutput.match(/CURRENT_PROBABILITY:\s*(\d+)%/i);
  const actionDeltaMatch = verdictOutput.match(/ACTION_DELTA:\s*\+?(\d+)%\s*if\s*([^\n]+)/i);
  const leverageMatch = verdictOutput.match(/LEVERAGE_ACTION:\s*([^\n]+)/i);
  const reevalMatch = verdictOutput.match(/REEVALUATION_SIGNAL:\s*([^\n]+)/i);

  const currentCloseProbability = currProbMatch ? parseInt(currProbMatch[1], 10) : Math.round((bullProb + bearProb) / 2);
  const actionDeltaProbability = actionDeltaMatch ? parseInt(actionDeltaMatch[1], 10) : undefined;
  const highestLeverageAction = leverageMatch ? leverageMatch[1].trim() : undefined;
  const reevaluationSignal = reevalMatch ? reevalMatch[1].trim() : undefined;

  const verdict = parseVerdictFields(verdictOutput, parseFloat(deal.amount || '0'), bullProb, bearProb);

  const tokenCost =
    (bullResult.usage?.input ?? 0) +
    (bullResult.usage?.output ?? 0) +
    (bearResult.usage?.input ?? 0) +
    (bearResult.usage?.output ?? 0) +
    (verdictResult.usage?.input ?? 0) +
    (verdictResult.usage?.output ?? 0);

  // Auto-generate SuggestedAction from highest-leverage action
  const suggestedAction: SuggestedAction | undefined = highestLeverageAction ? {
    id: randomUUID(),
    type: 'create_crm_tasks',
    title: highestLeverageAction.slice(0, 80),
    description: `Deal Viability verdict: ${currentCloseProbability}% close probability${actionDeltaProbability ? ` → ${currentCloseProbability + actionDeltaProbability}% if actioned` : ''}. ${reevaluationSignal ? `Watch for: ${reevaluationSignal}` : ''}`,
    priority: currentCloseProbability < 30 ? 'P1' : currentCloseProbability < 60 ? 'P2' : 'P3',
    deal_id: dealId,
    deal_name: deal.name,
    execution_mode: 'hitl',
    action_payload: {
      deal_id: dealId,
      action: highestLeverageAction,
      close_probability: currentCloseProbability,
      probability_delta: actionDeltaProbability,
    },
    evidence: `Bull case (${bullProb}%): ${bullOutput.slice(0, 200)}... Bear case (${bearProb}%): ${bearOutput.slice(0, 200)}`,
  } : undefined;

  await query(
    `INSERT INTO deliberation_runs
     (workspace_id, pattern, trigger_surface, trigger_query, entity_type, entity_id, perspectives, verdict, token_cost)
     VALUES ($1, 'deal_viability', $7, $2, 'deal', $3, $4, $5, $6)`,
    [
      workspaceId,
      triggerQuery.slice(0, 500),
      dealId,
      JSON.stringify({
        bull: { role: 'bull', output: bullOutput, closeProbability: bullProb },
        bear: { role: 'bear', output: bearOutput, closeProbability: bearProb },
      }),
      JSON.stringify({
        ...verdict,
        currentCloseProbability,
        actionDeltaProbability,
        highestLeverageAction,
        reevaluationSignal,
      }),
      tokenCost,
      triggerSurface,
    ]
  );

  return {
    dealId,
    dealName: deal.name,
    dealAmount: parseFloat(deal.amount || '0'),
    dealStage: deal.stage,
    ownerName: deal.owner || 'Unknown',
    perspectives: {
      bull: { role: 'bull', output: bullOutput, closeProbability: bullProb },
      bear: { role: 'bear', output: bearOutput, closeProbability: bearProb },
    },
    verdict,
    tokenCost,
    bullEvidence,
    bearEvidence,
    currentCloseProbability,
    actionDeltaProbability,
    highestLeverageAction,
    reevaluationSignal,
    suggestedAction,
  };
}

// ============================================================================
// Hypothesis Red Team Deliberation
// ============================================================================

export interface HypothesisRedTeamResult {
  pattern: 'red_team';
  hypothesisId: string;
  perspectives: {
    agent: 'plan' | 'red_team';
    label: string;
    output: string;
  }[];
  verdict: {
    planSufficiency: string;      // "sufficient" | "insufficient" | "borderline"
    missingAction: string | null;  // the single most important gap, or null
    watchMetric: string;           // what to look for by end of next week
    raw: string;                   // full verdict text
  };
  tokenCost: number;
}

/**
 * Format metric value for display
 * @param value - The numeric value
 * @param metricOrUnit - Either a unit ('$', 'x', '%', 'days', 'count', 'multiple') or metric name as fallback
 * @returns Formatted string
 */
function formatMetricValue(value: number, metricOrUnit: string): string {
  // Try unit-based formatting first (explicit unit field from hypothesis)
  const validUnits = ['$', 'x', '%', 'days', 'count', 'multiple'];
  if (validUnits.includes(metricOrUnit)) {
    switch (metricOrUnit) {
      case '$':
        return formatCurrency(value);
      case 'x':
      case 'multiple':
        return `${value.toFixed(1)}x`;
      case '%':
        // Ratios stored as 0-1, display ×100
        return `${Math.round(value * 100)}%`;
      case 'days':
        return `${Math.round(value)} days`;
      case 'count':
        return value.toFixed(1);
    }
  }

  // Fall back to metric-name heuristics for backwards compatibility
  const m = metricOrUnit.toLowerCase();
  if (m.includes('ratio')) return `${value.toFixed(1)}x`;
  // cohort metrics store either a ratio (≤1, e.g. 0.6 = 60%) or a deal-close count (>1, e.g. 236).
  // Apply × 100 only for ratio values to avoid e.g. 236.1 → "23610%".
  if (m.includes('cohort')) return value <= 1 ? `${Math.round(value * 100)}%` : `${Math.round(value)}`;
  if (m.includes('rate') || m.includes('pct') || m.includes('win') || m.includes('conversion')) {
    return `${Math.round(value)}%`;
  }
  if (m.includes('days') || m.includes('cycle')) return `${Math.round(value)} days`;
  if (m.includes('count') || m.includes('closes')) return value.toFixed(1);
  return formatCurrency(value);
}

export async function runHypothesisRedTeam(
  workspaceId: string,
  hypothesisId: string
): Promise<HypothesisRedTeamResult> {

  // COMPUTE — gather evidence in parallel
  const [hypothesisResult, pipelineResult] = await Promise.all([
    query(
      `SELECT * FROM standing_hypotheses WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, hypothesisId]
    ),
    query(
      `SELECT
         COUNT(CASE WHEN stage_normalized NOT IN ('closed_won','closed_lost') THEN 1 END)::int AS open_deals,
         COALESCE(SUM(CASE WHEN stage_normalized NOT IN ('closed_won','closed_lost') THEN amount ELSE 0 END), 0)::numeric AS pipeline_value,
         COALESCE(SUM(CASE WHEN stage_normalized = 'closed_won'
                      AND close_date >= date_trunc('quarter', NOW())
                      THEN amount ELSE 0 END), 0)::numeric AS qtd_closed,
         COALESCE(SUM(CASE WHEN stage_normalized NOT IN ('closed_won','closed_lost')
                      AND close_date >= date_trunc('quarter', NOW())
                      AND close_date < date_trunc('quarter', NOW()) + INTERVAL '3 months'
                      THEN amount ELSE 0 END), 0)::numeric AS pipeline_this_quarter
       FROM deals
       WHERE workspace_id = $1`,
      [workspaceId]
    ),
  ]);

  if (hypothesisResult.rows.length === 0) {
    throw new Error(`Hypothesis ${hypothesisId} not found`);
  }

  const hyp = hypothesisResult.rows[0];
  const pipe = pipelineResult.rows[0] ?? {};

  // Sprint actions + sibling hypotheses in parallel
  const [sprintActionsResult, siblingsResult] = await Promise.all([
    query(
      `SELECT title, expected_value_delta, effort, state
       FROM actions
       WHERE workspace_id = $1
         AND hypothesis_id = $2
         AND sprint_week = date_trunc('week', NOW())
         AND state IN ('pending', 'in_progress')
       ORDER BY expected_value_delta DESC NULLS LAST`,
      [workspaceId, hypothesisId]
    ),
    query(
      `SELECT metric, current_value, alert_threshold, alert_direction
       FROM standing_hypotheses
       WHERE workspace_id = $1 AND id != $2
       ORDER BY metric`,
      [workspaceId, hypothesisId]
    ),
  ]);

  const totalSprintEV = sprintActionsResult.rows.reduce(
    (sum: number, a: any) => sum + (parseFloat(a.expected_value_delta) || 0),
    0
  );

  const currentValue = parseFloat(hyp.current_value || '0');
  const threshold = parseFloat(hyp.alert_threshold || '0');
  const gap = Math.abs(currentValue - threshold);
  const gapLabel = formatMetricValue(gap, hyp.metric);
  const currentLabel = formatMetricValue(currentValue, hyp.metric);
  const thresholdLabel = formatMetricValue(threshold, hyp.metric);
  const direction = hyp.alert_direction === 'below' ? '≥' : '≤';

  // Quarter week context
  const now = new Date();
  const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  const weeksIntoQuarter = Math.floor((now.getTime() - quarterStart.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
  const weeksLeftInQuarter = 13 - weeksIntoQuarter;

  // Pipeline snapshot string
  const pipelineValue = parseFloat(pipe.pipeline_value || '0');
  const qtdClosed = parseFloat(pipe.qtd_closed || '0');
  const pipelineThisQ = parseFloat(pipe.pipeline_this_quarter || '0');
  const pipelineBlock = pipelineValue > 0
    ? `PIPELINE SNAPSHOT:
- Open pipeline: ${formatCurrency(pipelineValue)} across ${pipe.open_deals} deals
- QTD closed: ${formatCurrency(qtdClosed)}
- Pipeline closing this quarter: ${formatCurrency(pipelineThisQ)}
- Week ${weeksIntoQuarter} of 13 (${weeksLeftInQuarter} weeks remaining)`
    : `PIPELINE SNAPSHOT: No pipeline data available. Week ${weeksIntoQuarter} of 13.`;

  // Other hypotheses snapshot
  const siblingsBlock = siblingsResult.rows.length > 0
    ? `OTHER TRACKED HYPOTHESES (context):\n${siblingsResult.rows.map((s: any) => {
        const cur = formatMetricValue(parseFloat(s.current_value || '0'), s.metric);
        const thr = formatMetricValue(parseFloat(s.alert_threshold || '0'), s.metric);
        const dir = s.alert_direction === 'below' ? '≥' : '≤';
        const breached = s.alert_direction === 'below'
          ? parseFloat(s.current_value) < parseFloat(s.alert_threshold)
          : parseFloat(s.current_value) > parseFloat(s.alert_threshold);
        return `- ${s.metric}: ${cur} (target: ${dir}${thr})${breached ? ' ⚠ BREACHED' : ''}`;
      }).join('\n')}`
    : '';

  const contextBlock = `
HYPOTHESIS: ${hyp.hypothesis}
METRIC: ${hyp.metric}
CURRENT VALUE: ${currentLabel}
THRESHOLD: ${direction} ${thresholdLabel}
GAP TO CLOSE: ${gapLabel}

${pipelineBlock}

CURRENT SPRINT ACTIONS (${sprintActionsResult.rows.length} actions, ${formatCurrency(totalSprintEV)} total expected value):
${
  sprintActionsResult.rows.length > 0
    ? sprintActionsResult.rows
        .map(
          (a: any) =>
            `- ${a.title} | EV: ${a.expected_value_delta ? formatCurrency(parseFloat(a.expected_value_delta)) : 'unknown'} | ${a.effort} | ${a.state}`
        )
        .join('\n')
    : '(no sprint actions have been linked to this hypothesis — the team has not explicitly assigned work to close this gap)'
}
${siblingsBlock ? '\n' + siblingsBlock : ''}
`.trim();

  let tokenCost = 0;

  // CALL 1 — Plan defense
  const planResult = await callLLM(workspaceId, 'reason', {
    systemPrompt: `${PANDORA_VOICE_STANDARD}

You are defending the current sprint plan for addressing this hypothesis breach.
Argue why the listed actions are sufficient to close the gap.
If there are no actions, argue why the gap is self-correcting or less urgent than it appears.
Cite specific action titles and their expected values.
2-3 arguments. End with one sentence: "Plan sufficiency: [X]%" where X is your estimate.`,
    messages: [{ role: 'user', content: contextBlock }],
    maxTokens: 400,
    temperature: 0.3,
    _tracking: { workspaceId, phase: 'chat', stepName: 'red-team-plan' },
  });
  tokenCost += (planResult.usage?.input ?? 0) + (planResult.usage?.output ?? 0);

  // CALL 2 — Red team attack
  const redTeamResult = await callLLM(workspaceId, 'reason', {
    systemPrompt: `${PANDORA_VOICE_STANDARD}

You are attacking the current sprint plan for this hypothesis breach.
Argue why the listed actions will NOT close the gap in time.
What root cause is being ignored? What is missing from the sprint?
Is the total expected value of actions sufficient to move the metric by the required amount?
Be specific. Cite the gap between sprint expected value and the threshold gap.
2-3 arguments. End with one sentence: "Estimated plan effectiveness: [X]%" where X is your estimate.`,
    messages: [{ role: 'user', content: contextBlock }],
    maxTokens: 400,
    temperature: 0.3,
    _tracking: { workspaceId, phase: 'chat', stepName: 'red-team-attack' },
  });
  tokenCost += (redTeamResult.usage?.input ?? 0) + (redTeamResult.usage?.output ?? 0);

  // CALL 3 — Verdict
  const verdictResult = await callLLM(workspaceId, 'reason', {
    systemPrompt: `${PANDORA_VOICE_STANDARD}

You have heard the plan defense and the red team attack on this hypothesis sprint.
State exactly four things:
1. Whether the plan is sufficient, insufficient, or borderline — one word
2. The single most important missing action if insufficient — one sentence, or "none" if sufficient
3. What metric movement to look for by end of next week — one sentence
4. Nothing else.

Format:
SUFFICIENCY: [sufficient|insufficient|borderline]
MISSING: [one sentence or "none"]
WATCH: [one sentence]`,
    messages: [
      {
        role: 'user',
        content: `
PLAN DEFENDED: ${planResult.content}

RED TEAM ATTACKED: ${redTeamResult.content}

HYPOTHESIS GAP: ${gapLabel} remaining to close.
    `.trim(),
      },
    ],
    maxTokens: 250,
    temperature: 0.2,
    _tracking: { workspaceId, phase: 'chat', stepName: 'red-team-verdict' },
  });
  tokenCost += (verdictResult.usage?.input ?? 0) + (verdictResult.usage?.output ?? 0);

  // Parse structured verdict
  const verdictText = verdictResult.content || '';
  const sufficiencyMatch = verdictText.match(/SUFFICIENCY:\s*(sufficient|insufficient|borderline)/i);
  const missingMatch = verdictText.match(/MISSING:\s*(.+?)(?:\n|$)/i);
  const watchMatch = verdictText.match(/WATCH:\s*(.+?)(?:\n|$)/i);

  const verdict = {
    planSufficiency: sufficiencyMatch?.[1]?.toLowerCase() ?? 'borderline',
    missingAction:
      missingMatch?.[1]?.trim().toLowerCase() === 'none' ? null : missingMatch?.[1]?.trim() ?? null,
    watchMetric: watchMatch?.[1]?.trim() ?? verdictText,
    raw: verdictText,
  };

  // Write to deliberation_runs
  await query(
    `INSERT INTO deliberation_runs (
      workspace_id, pattern, trigger_surface,
      entity_type, entity_id, hypothesis_id,
      perspectives, verdict, token_cost
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      workspaceId,
      'red_team',
      'hypothesis_card',
      'hypothesis',
      hypothesisId,
      hypothesisId,
      JSON.stringify([
        { agent: 'plan', label: 'Current Plan', output: planResult.content || '' },
        { agent: 'red_team', label: 'Red Team', output: redTeamResult.content || '' },
      ]),
      JSON.stringify(verdict),
      tokenCost,
    ]
  );

  return {
    pattern: 'red_team',
    hypothesisId,
    perspectives: [
      { agent: 'plan', label: 'Current Plan', output: planResult.content || '' },
      { agent: 'red_team', label: 'Red Team', output: redTeamResult.content || '' },
    ],
    verdict,
    tokenCost,
  };
}

// ============================================================================
// Triage Allocation Deliberation (replaces CEO/CFO/VP Boardroom)
// Ranks competing deals/priorities by close potential, rep capacity, and quarter phase.
// ============================================================================

export interface BoardroomResult {
  question: string;
  panels: Array<{
    role: string;
    output: string;
    color_hint: 'synthesis' | 'bear' | 'bull';
  }>;
  synthesis: string;
  tokenCost: number;
}

export async function runBoardroomDeliberation(
  workspaceId: string,
  question: string,
  context: string,
  triggerSurface: string = 'ask_pandora'
): Promise<BoardroomResult | null> {
  try {
    // Gather pipeline triage data
    const now = new Date();
    const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    const quarterEnd = new Date(quarterStart.getFullYear(), quarterStart.getMonth() + 3, 0);
    const weeksIntoQuarter = Math.floor((now.getTime() - quarterStart.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
    const weeksLeft = 13 - weeksIntoQuarter;
    const daysLeft = Math.ceil((quarterEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    const [openDealsResult, repLoadResult] = await Promise.all([
      query(
        `SELECT
           d.id, d.name, d.amount, d.stage, d.stage_normalized,
           d.owner, d.close_date, d.days_in_stage, d.forecast_category,
           EXTRACT(DAY FROM d.close_date - NOW())::int AS days_until_close,
           COUNT(conv.id)::int AS call_count,
           COUNT(dc.contact_id)::int AS contact_count
         FROM deals d
         LEFT JOIN conversations conv ON conv.deal_id = d.id AND conv.workspace_id = d.workspace_id
         LEFT JOIN deal_contacts dc ON dc.deal_id = d.id
         WHERE d.workspace_id = $1
           AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
           AND d.close_date <= $2
         GROUP BY d.id, d.name, d.amount, d.stage, d.stage_normalized,
                  d.owner, d.close_date, d.days_in_stage, d.forecast_category
         ORDER BY d.amount DESC NULLS LAST
         LIMIT 20`,
        [workspaceId, quarterEnd.toISOString().split('T')[0]]
      ),
      query(
        `SELECT owner, COUNT(*)::int AS open_deal_count, SUM(amount)::numeric AS total_pipeline
         FROM deals
         WHERE workspace_id = $1
           AND stage_normalized NOT IN ('closed_won', 'closed_lost')
         GROUP BY owner
         ORDER BY open_deal_count DESC`,
        [workspaceId]
      ),
    ]);

    const openDeals = openDealsResult.rows;
    const repLoads = repLoadResult.rows;

    const dealSummary = openDeals.slice(0, 10).map((d: any) =>
      `- ${d.name}: $${Number(d.amount).toLocaleString()} | ${d.stage} | ${d.days_until_close ?? '?'}d left | ${d.call_count} calls | ${d.contact_count} contacts | ${d.forecast_category ?? 'unset'} | Owner: ${d.owner ?? 'unassigned'}`
    ).join('\n');

    const repLoadSummary = repLoads.slice(0, 8).map((r: any) =>
      `- ${r.owner ?? 'Unknown'}: ${r.open_deal_count} open deals, $${Number(r.total_pipeline).toLocaleString()} pipeline`
    ).join('\n');

    const triageContext = `QUARTER: Week ${weeksIntoQuarter} of 13 (${weeksLeft} weeks / ${daysLeft} days remaining)
OPEN DEALS THIS QUARTER:
${dealSummary || '(no open deals closing this quarter)'}
REP CAPACITY:
${repLoadSummary || '(no rep data)'}`;

    // Call 1: Close potential ranking
    const closePotentialResult = await callLLM(workspaceId, 'reason', {
      systemPrompt: `${PANDORA_VOICE_STANDARD}

You are ranking deals by close potential this quarter.
Score each deal on: (1) days until close vs stage maturity, (2) call engagement, (3) contact coverage, (4) forecast category.
List the top 3-4 deals to prioritize and 1-2 to de-prioritize with one-line rationales. Be specific about numbers.`,
      messages: [{
        role: 'user',
        content: `Question: ${question}\n\n${triageContext}\n\nContext: ${context}`,
      }],
      maxTokens: 450,
      temperature: 0.2,
      _tracking: { workspaceId, phase: 'chat', stepName: 'triage-close-potential' },
    });

    // Call 2: Rep capacity analysis
    const repCapacityResult = await callLLM(workspaceId, 'reason', {
      systemPrompt: `${PANDORA_VOICE_STANDARD}

You are analyzing rep capacity and deal load for the quarter-end push.
Which reps are over-loaded (too many deals, risk of dropping attention)? Which have bandwidth?
What is the highest-value rebalancing move? Be specific about rep names and deal names.`,
      messages: [{
        role: 'user',
        content: `Question: ${question}\n\n${triageContext}\n\nContext: ${context}`,
      }],
      maxTokens: 350,
      temperature: 0.2,
      _tracking: { workspaceId, phase: 'chat', stepName: 'triage-rep-capacity' },
    });

    // Call 3: Trade-offs synthesis
    const synthesisResult = await callLLM(workspaceId, 'reason', {
      systemPrompt: `${PANDORA_VOICE_STANDARD}

Synthesize the triage into a ranked action order.
State: (1) Top 2 deals to close this week with specific next actions, (2) 1 deal to pause/deprioritize with rationale, (3) the single rep-level capacity move to make.
2-3 sentences total. No preamble.`,
      messages: [{
        role: 'user',
        content: `CLOSE POTENTIAL RANKING: ${closePotentialResult.content || ''}\n\nREP CAPACITY: ${repCapacityResult.content || ''}\n\nQuestion: ${question}`,
      }],
      maxTokens: 300,
      temperature: 0.2,
      _tracking: { workspaceId, phase: 'chat', stepName: 'triage-synthesis' },
    });

    const closePotentialOutput = closePotentialResult.content || '';
    const repCapacityOutput = repCapacityResult.content || '';
    const synthesis = synthesisResult.content || '';

    const tokenCost =
      (closePotentialResult.usage?.input ?? 0) +
      (closePotentialResult.usage?.output ?? 0) +
      (repCapacityResult.usage?.input ?? 0) +
      (repCapacityResult.usage?.output ?? 0) +
      (synthesisResult.usage?.input ?? 0) +
      (synthesisResult.usage?.output ?? 0);

    await query(
      `INSERT INTO deliberation_runs
       (workspace_id, pattern, trigger_surface, trigger_query, entity_type, entity_id, perspectives, verdict, token_cost)
       VALUES ($1, 'triage_allocation', $6, $2, NULL, NULL, $3, $4, $5)`,
      [
        workspaceId,
        question.slice(0, 500),
        JSON.stringify({
          close_potential: { role: 'Close Potential', output: closePotentialOutput },
          rep_capacity: { role: 'Rep Capacity', output: repCapacityOutput },
        }),
        JSON.stringify({ synthesis }),
        tokenCost,
        triggerSurface,
      ]
    );

    return {
      question,
      panels: [
        { role: 'Close Potential', output: closePotentialOutput, color_hint: 'bull' },
        { role: 'Rep Capacity', output: repCapacityOutput, color_hint: 'bear' },
      ],
      synthesis,
      tokenCost,
    };
  } catch (err) {
    console.error('[triage-allocation-deliberation] error:', err);
    return null;
  }
}

// ============================================================================
// Data Challenge Deliberation (replaces Socratic)
// Extracts the measurable claim, queries live data, verifies or contradicts.
// ============================================================================

export interface SocraticResult {
  question: string;
  assumption: string;         // the extracted claim
  probing_questions: string;  // live data evidence
  counter_hypothesis: string; // verdict with evidence
  synthesis: string;          // one-line verdict
  tokenCost: number;
  dataVerdict?: 'verified' | 'contradicted' | 'partial' | 'insufficient_data';
  liveDataSummary?: string;
}

export async function runDataChallengeDeliberation(
  workspaceId: string,
  claim: string,
  context: string,
  triggerSurface: string = 'ask_pandora'
): Promise<SocraticResult | null> {
  try {
    // ── Call 1: Extract the specific measurable claim ────────────────────────
    const extractResult = await callLLM(workspaceId, 'classify', {
      systemPrompt: `Extract the specific measurable claim from this message. Respond ONLY with JSON.

{
  "extracted_claim": "the specific assertion being made",
  "metric_type": "pipeline_health" | "win_rate" | "coverage" | "activity" | "deal_count" | "close_rate" | "other",
  "claimed_direction": "healthy" | "poor" | "improving" | "declining" | "sufficient" | "insufficient" | "unknown"
}`,
      messages: [{ role: 'user', content: `Message: ${claim}\nContext: ${context}` }],
      maxTokens: 200,
      temperature: 0,
      _tracking: { workspaceId, phase: 'chat', stepName: 'data-challenge-extract' },
    });

    let extractedClaim = claim;
    let metricType = 'other';
    let claimedDirection = 'unknown';
    try {
      const extracted = JSON.parse((extractResult.content || '').match(/\{[\s\S]*\}/)?.[0] || '{}');
      extractedClaim = extracted.extracted_claim || claim;
      metricType = extracted.metric_type || 'other';
      claimedDirection = extracted.claimed_direction || 'unknown';
    } catch { /* keep defaults */ }

    // ── Query live data based on metric type ─────────────────────────────────
    let liveDataSummary = '';
    try {
      if (metricType === 'pipeline_health' || metricType === 'deal_count') {
        const r = await query(
          `SELECT
             COUNT(CASE WHEN stage_normalized NOT IN ('closed_won','closed_lost') THEN 1 END)::int AS open_deals,
             COALESCE(SUM(CASE WHEN stage_normalized NOT IN ('closed_won','closed_lost') THEN amount ELSE 0 END), 0)::numeric AS total_pipeline,
             COALESCE(SUM(CASE WHEN stage_normalized = 'closed_won' AND close_date >= date_trunc('quarter', NOW()) THEN amount ELSE 0 END), 0)::numeric AS qtd_closed
           FROM deals WHERE workspace_id = $1`,
          [workspaceId]
        );
        const row = r.rows[0];
        liveDataSummary = `LIVE DATA: ${row.open_deals} open deals, $${Number(row.total_pipeline).toLocaleString()} total pipeline, $${Number(row.qtd_closed).toLocaleString()} closed QTD.`;
      } else if (metricType === 'win_rate') {
        const r = await query(
          `SELECT
             COUNT(CASE WHEN stage_normalized = 'closed_won' THEN 1 END)::int AS won,
             COUNT(CASE WHEN stage_normalized IN ('closed_won','closed_lost') THEN 1 END)::int AS total_closed,
             ROUND(100.0 * COUNT(CASE WHEN stage_normalized = 'closed_won' THEN 1 END) /
               NULLIF(COUNT(CASE WHEN stage_normalized IN ('closed_won','closed_lost') THEN 1 END), 0), 1) AS win_rate_pct
           FROM deals
           WHERE workspace_id = $1
             AND close_date > NOW() - INTERVAL '90 days'`,
          [workspaceId]
        );
        const row = r.rows[0];
        liveDataSummary = `LIVE DATA (last 90 days): ${row.won} won / ${row.total_closed} closed = ${row.win_rate_pct ?? 0}% win rate.`;
      } else if (metricType === 'coverage') {
        const [pipeResult, quotaResult] = await Promise.all([
          query(
            `SELECT COALESCE(SUM(amount), 0)::numeric AS pipeline
             FROM deals
             WHERE workspace_id = $1
               AND stage_normalized NOT IN ('closed_won','closed_lost')
               AND close_date >= date_trunc('quarter', NOW())
               AND close_date < date_trunc('quarter', NOW()) + INTERVAL '3 months'`,
            [workspaceId]
          ),
          query(
            `SELECT COALESCE(target_amount, 0) AS quota
             FROM targets
             WHERE workspace_id = $1
               AND period_label = to_char(date_trunc('quarter', NOW()), 'YYYY-"Q"Q')
             LIMIT 1`,
            [workspaceId]
          ),
        ]);
        const pipeline = Number(pipeResult.rows[0]?.pipeline ?? 0);
        const quota = Number(quotaResult.rows[0]?.quota ?? 0);
        const coverage = quota > 0 ? (pipeline / quota).toFixed(1) : 'unknown';
        liveDataSummary = `LIVE DATA: $${pipeline.toLocaleString()} pipeline this quarter vs $${quota.toLocaleString()} quota = ${coverage}x coverage ratio.`;
      } else if (metricType === 'activity') {
        const r = await query(
          `SELECT
             COUNT(CASE WHEN timestamp > NOW() - INTERVAL '30 days' THEN 1 END)::int AS recent_activities,
             COUNT(CASE WHEN timestamp > NOW() - INTERVAL '7 days' THEN 1 END)::int AS this_week
           FROM activities
           WHERE workspace_id = $1`,
          [workspaceId]
        );
        const row = r.rows[0];
        liveDataSummary = `LIVE DATA: ${row.recent_activities ?? 0} deal activities in last 30 days, ${row.this_week ?? 0} this week.`;
      } else if (metricType === 'close_rate') {
        const r = await query(
          `SELECT
             COUNT(CASE WHEN stage_normalized = 'closed_won' THEN 1 END)::int AS won,
             COUNT(*)::int AS total,
             ROUND(100.0 * COUNT(CASE WHEN stage_normalized = 'closed_won' THEN 1 END) / NULLIF(COUNT(*), 0), 1) AS close_rate_pct
           FROM deals
           WHERE workspace_id = $1
             AND stage_normalized IN ('closed_won','closed_lost')
             AND close_date > NOW() - INTERVAL '6 months'`,
          [workspaceId]
        );
        const row = r.rows[0];
        liveDataSummary = `LIVE DATA (last 6 months): ${row.won} won / ${row.total} closed = ${row.close_rate_pct ?? 0}% close rate.`;
      }
    } catch {
      liveDataSummary = '(live data query failed — responding from available context only)';
    }

    // ── Call 2: Verify or contradict with live data ───────────────────────────
    const verifyResult = await callLLM(workspaceId, 'reason', {
      systemPrompt: `${PANDORA_VOICE_STANDARD}

You are the Chief of Staff fact-checking an assertion against live pipeline data.
The user claimed: "${extractedClaim}" (direction: ${claimedDirection})
${liveDataSummary}

State:
VERDICT: verified | contradicted | partial | insufficient_data
EVIDENCE: [1-2 sentences citing specific numbers from the live data that support or contradict the claim]
COUNTER: [If contradicted or partial — what the data actually shows and what the user may be missing. If verified — what nuance or risk the data adds.]

No preamble. Be direct and specific.`,
      messages: [{ role: 'user', content: `Original message: ${claim}\nContext: ${context}` }],
      maxTokens: 400,
      temperature: 0.2,
      _tracking: { workspaceId, phase: 'chat', stepName: 'data-challenge-verify' },
    });

    const verifyOutput = verifyResult.content || '';

    // Parse verdict
    const verdictMatch = verifyOutput.match(/VERDICT:\s*(verified|contradicted|partial|insufficient_data)/i);
    const evidenceMatch = verifyOutput.match(/EVIDENCE:\s*([^\n]+(?:\n(?!COUNTER:)[^\n]+)*)/i);
    const counterMatch = verifyOutput.match(/COUNTER:\s*([^\n]+(?:\n(?!VERDICT:)[^\n]+)*)/i);

    const dataVerdict = (verdictMatch?.[1]?.toLowerCase() ?? 'insufficient_data') as SocraticResult['dataVerdict'];
    const evidenceText = evidenceMatch ? evidenceMatch[1].trim() : liveDataSummary;
    const counterText = counterMatch ? counterMatch[1].trim() : verifyOutput;

    const verdictLabel = dataVerdict === 'verified' ? '✓ Claim verified' :
      dataVerdict === 'contradicted' ? '✗ Claim contradicted' :
      dataVerdict === 'partial' ? '~ Partially supported' : 'Insufficient data to verify';

    const synthesis = `${verdictLabel}: ${evidenceText.slice(0, 150)}`;

    const tokenCost =
      (extractResult.usage?.input ?? 0) +
      (extractResult.usage?.output ?? 0) +
      (verifyResult.usage?.input ?? 0) +
      (verifyResult.usage?.output ?? 0);

    await query(
      `INSERT INTO deliberation_runs
       (workspace_id, pattern, trigger_surface, trigger_query, entity_type, entity_id, perspectives, verdict, token_cost)
       VALUES ($1, 'data_challenge', $6, $2, NULL, NULL, $3, $4, $5)`,
      [
        workspaceId,
        claim.slice(0, 500),
        JSON.stringify({
          claim: { role: 'claim', output: extractedClaim },
          evidence: { role: 'evidence', output: evidenceText },
          counter: { role: 'counter', output: counterText },
        }),
        JSON.stringify({ synthesis, dataVerdict, liveDataSummary }),
        tokenCost,
        triggerSurface,
      ]
    );

    return {
      question: claim,
      assumption: extractedClaim,
      probing_questions: liveDataSummary || evidenceText,
      counter_hypothesis: counterText,
      synthesis,
      tokenCost,
      dataVerdict,
      liveDataSummary,
    };
  } catch (err) {
    console.error('[data-challenge-deliberation] error:', err);
    return null;
  }
}

// Backward-compat alias for MCP tools and existing call sites
export async function runSocraticDeliberation(
  workspaceId: string,
  question: string,
  context: string,
  triggerSurface: string = 'ask_pandora'
): Promise<SocraticResult | null> {
  return runDataChallengeDeliberation(workspaceId, question, context, triggerSurface);
}

// ============================================================================
// Plan Stress-Test Deliberation (replaces Prosecutor/Defense)
// Grounds prosecution in historical closed deals before stress-testing.
// Writes a watch metric to standing_hypotheses after verdict.
// ============================================================================

export interface ProsecutorDefenseResult {
  plan: string;
  prosecution: string;
  defense: string;
  verdict: string;
  confidence: number;
  tokenCost: number;
  watchMetric?: string;
  historicalPattern?: string;
}

export async function runProsecutorDefenseDeliberation(
  workspaceId: string,
  plan: string,
  context: string,
  triggerSurface: string = 'ask_pandora'
): Promise<ProsecutorDefenseResult | null> {
  try {
    // ── Gather historical pattern from deal_outcomes ─────────────────────────
    // Look for similar recent closed deals to ground the prosecution in evidence.
    let historicalPattern = '';
    try {
      const historicalResult = await query(
        `SELECT
           outcome,
           COUNT(*)::int AS count,
           ROUND(AVG(amount)::numeric, 0)::int AS avg_amount,
           ROUND(AVG(days_open)::numeric, 0)::int AS avg_days_open,
           ROUND(AVG(composite_score)::numeric, 1) AS avg_score
         FROM deal_outcomes
         WHERE workspace_id = $1
           AND closed_at > NOW() - INTERVAL '12 months'
         GROUP BY outcome
         ORDER BY count DESC`,
        [workspaceId]
      );

      if (historicalResult.rows.length > 0) {
        const rows = historicalResult.rows;
        const totalDeals = rows.reduce((s: number, r: any) => s + r.count, 0);
        const winRow = rows.find((r: any) => r.outcome === 'closed_won');
        const lossRow = rows.find((r: any) => r.outcome === 'closed_lost');
        const winRate = winRow ? Math.round((winRow.count / totalDeals) * 100) : 0;
        historicalPattern = `HISTORICAL CONTEXT (last 12 months): ${totalDeals} deals closed — ${winRate}% win rate.` +
          (winRow ? ` Won deals: avg $${winRow.avg_amount?.toLocaleString()}, avg ${winRow.avg_days_open}d sales cycle.` : '') +
          (lossRow ? ` Lost deals: avg $${lossRow.avg_amount?.toLocaleString()}, avg ${lossRow.avg_days_open}d sales cycle.` : '');
      }
    } catch {
      // Non-fatal — proceed without historical context
    }

    // Call 1: Prosecution grounded in historical evidence
    const prosecutionResult = await callLLM(workspaceId, 'reason', {
      systemPrompt: `${PANDORA_VOICE_STANDARD}

You are stress-testing a revenue plan. Make the strongest case for why it will fail.
${historicalPattern ? `Use the historical win/loss pattern as evidence for your prosecution: ${historicalPattern}` : ''}
State: 3 specific failure risks, the single most likely failure mode, and what assumption is most fragile.
4-5 sentences. Cite specific data where available.`,
      messages: [{
        role: 'user',
        content: `Plan: ${plan}\n\nContext: ${context}`,
      }],
      maxTokens: 450,
      temperature: 0.3,
      _tracking: { workspaceId, phase: 'chat', stepName: 'stress-test-prosecution' },
    });

    const prosecutionOutput = prosecutionResult.content || '';

    // Call 2: Defense (why it will work)
    const defenseResult = await callLLM(workspaceId, 'reason', {
      systemPrompt: `${PANDORA_VOICE_STANDARD}

You are defending a revenue plan.
Make the strongest case for why it will succeed. What evidence supports it? What mitigates the obvious risks? What is being underestimated? 4-5 sentences.`,
      messages: [{
        role: 'user',
        content: `Plan: ${plan}\n\nContext: ${context}`,
      }],
      maxTokens: 400,
      temperature: 0.3,
      _tracking: { workspaceId, phase: 'chat', stepName: 'stress-test-defense' },
    });

    const defenseOutput = defenseResult.content || '';

    // Call 3: Verdict with watch metric
    const verdictResult = await callLLM(workspaceId, 'reason', {
      systemPrompt: `${PANDORA_VOICE_STANDARD}

Deliver the plan stress-test verdict. State exactly:
CONFIDENCE: [0.0-1.0]
HIGHEST_IMPACT_CHANGE: [one sentence — the single change that most improves odds]
WATCH_METRIC: [one specific observable metric to monitor weekly — e.g. "pipeline added per week", "new discovery calls booked", "stage advance rate"]
TRIP_WIRE: [the early signal that the plan is failing — specific and measurable]

No preamble. Format as labeled lines.`,
      messages: [{
        role: 'user',
        content: `Prosecution: ${prosecutionOutput}\n\nDefense: ${defenseOutput}\n\nPlan: ${plan}`,
      }],
      maxTokens: 350,
      temperature: 0.2,
      _tracking: { workspaceId, phase: 'chat', stepName: 'stress-test-verdict' },
    });

    const verdictOutput = verdictResult.content || '';

    // Parse verdict fields
    const confidenceMatch = verdictOutput.match(/CONFIDENCE:\s*(0?\.\d+|\d+(?:\.\d+)?)/i);
    const watchMetricMatch = verdictOutput.match(/WATCH_METRIC:\s*([^\n]+)/i);
    const tripWireMatch = verdictOutput.match(/TRIP_WIRE:\s*([^\n]+)/i);
    const highImpactMatch = verdictOutput.match(/HIGHEST_IMPACT_CHANGE:\s*([^\n]+)/i);

    const confidence = confidenceMatch ? Math.min(1, Math.max(0, parseFloat(confidenceMatch[1]))) : 0.5;
    const watchMetric = watchMetricMatch ? watchMetricMatch[1].trim() : undefined;
    const tripWire = tripWireMatch ? tripWireMatch[1].trim() : undefined;
    const highestImpactChange = highImpactMatch ? highImpactMatch[1].trim() : undefined;

    const tokenCost =
      (prosecutionResult.usage?.input ?? 0) +
      (prosecutionResult.usage?.output ?? 0) +
      (defenseResult.usage?.input ?? 0) +
      (defenseResult.usage?.output ?? 0) +
      (verdictResult.usage?.input ?? 0) +
      (verdictResult.usage?.output ?? 0);

    // Write watch metric to standing_hypotheses with 1-week trigger
    if (watchMetric) {
      try {
        await query(
          `INSERT INTO standing_hypotheses
             (workspace_id, hypothesis, metric, alert_direction, status)
           VALUES ($1, $2, $3, 'below', 'active')
           ON CONFLICT DO NOTHING`,
          [
            workspaceId,
            `Plan stress-test watch: ${plan.slice(0, 200)}`,
            watchMetric.slice(0, 100),
          ]
        );
      } catch {
        // Non-fatal — standing_hypotheses may have additional required columns
      }
    }

    // Write to deliberation_runs
    await query(
      `INSERT INTO deliberation_runs
       (workspace_id, pattern, trigger_surface, trigger_query, entity_type, entity_id, perspectives, verdict, token_cost)
       VALUES ($1, 'plan_stress_test', $6, $2, NULL, NULL, $3, $4, $5)`,
      [
        workspaceId,
        plan.slice(0, 500),
        JSON.stringify({
          prosecution: { output: prosecutionOutput },
          defense: { output: defenseOutput },
        }),
        JSON.stringify({
          verdict: verdictOutput,
          confidence,
          watchMetric,
          tripWire,
          highestImpactChange,
          historicalPattern,
        }),
        tokenCost,
        triggerSurface,
      ]
    );

    return {
      plan,
      prosecution: prosecutionOutput,
      defense: defenseOutput,
      verdict: verdictOutput,
      confidence,
      tokenCost,
      watchMetric,
      historicalPattern,
    };
  } catch (err) {
    console.error('[plan-stress-test-deliberation] error:', err);
    return null;
  }
}
