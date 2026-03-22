import { query } from '../db.js';
import { callLLM } from '../utils/llm-router.js';
import { PANDORA_VOICE_STANDARD } from '../lib/voice-standard.js';
import { formatCurrency } from '../utils/format-currency.js';

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
  triggerQuery: string
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

You have heard both the bull and bear cases. Weigh the evidence.
State:
1. Expected value (weighted midpoint of the two probabilities x deal amount)
2. The key variable — the single factor that will determine the outcome
3. Re-evaluate by — a specific future date (must be in the future), not a vague timeframe
4. Recommended action — one sentence, specific, actionable this week

Do not repeat the arguments. Deliver a verdict only.`,
    messages: [{
      role: 'user',
      content: `DEAL: ${deal.name}
BULL CASE SAID: ${bullOutput}
BEAR CASE SAID: ${bearOutput}`,
    }],
    maxTokens: 350,
    temperature: 0.2,
    _tracking: { workspaceId, phase: 'chat', stepName: 'deliberation-verdict' },
  });

  const verdictOutput = verdictResult.content || '';
  const verdict = parseVerdictFields(verdictOutput, parseFloat(deal.amount || '0'), bullProb, bearProb);

  const tokenCost =
    (bullResult.usage?.input_tokens ?? 0) +
    (bullResult.usage?.output_tokens ?? 0) +
    (bearResult.usage?.input_tokens ?? 0) +
    (bearResult.usage?.output_tokens ?? 0) +
    (verdictResult.usage?.input_tokens ?? 0) +
    (verdictResult.usage?.output_tokens ?? 0);

  await query(
    `INSERT INTO deliberation_runs
     (workspace_id, pattern, trigger_surface, trigger_query, entity_type, entity_id, perspectives, verdict, token_cost)
     VALUES ($1, 'bull_bear', 'ask_pandora', $2, 'deal', $3, $4, $5, $6)`,
    [
      workspaceId,
      triggerQuery.slice(0, 500),
      dealId,
      JSON.stringify({
        bull: { role: 'bull', output: bullOutput, closeProbability: bullProb },
        bear: { role: 'bear', output: bearOutput, closeProbability: bearProb },
      }),
      JSON.stringify(verdict),
      tokenCost,
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

function formatMetricValue(value: number, metric: string): string {
  const m = metric.toLowerCase();
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
  tokenCost += (planResult.usage?.input_tokens ?? 0) + (planResult.usage?.output_tokens ?? 0);

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
  tokenCost += (redTeamResult.usage?.input_tokens ?? 0) + (redTeamResult.usage?.output_tokens ?? 0);

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
  tokenCost += (verdictResult.usage?.input_tokens ?? 0) + (verdictResult.usage?.output_tokens ?? 0);

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
// Boardroom Deliberation (CEO/CFO/VP Sales perspectives)
// ============================================================================

export interface BoardroomResult {
  question: string;
  panels: Array<{
    role: 'CEO' | 'CFO' | 'VP Sales';
    output: string;
    color_hint: 'synthesis' | 'bear' | 'bull';
  }>;
  synthesis: string;
  tokenCost: number;
}

export async function runBoardroomDeliberation(
  workspaceId: string,
  question: string,
  context: string
): Promise<BoardroomResult | null> {
  try {
    // Call 1: CEO perspective (revenue + growth lens)
    const ceoResult = await callLLM(workspaceId, 'reason', {
      systemPrompt: `You are the CEO of a B2B SaaS company reviewing a RevOps question.
Your lens: revenue growth, market position, long-term strategy.

Give your perspective in 3-4 sentences. Lead with the strategic implication. What matters most from a CEO lens?`,
      messages: [{
        role: 'user',
        content: `Question: ${question}\n\nContext: ${context}`,
      }],
      maxTokens: 400,
      temperature: 0.3,
      _tracking: { workspaceId, phase: 'chat', stepName: 'boardroom-ceo' },
    });

    // Call 2: CFO perspective (efficiency + risk lens)
    const cfoResult = await callLLM(workspaceId, 'reason', {
      systemPrompt: `You are the CFO of a B2B SaaS company reviewing a RevOps question.
Your lens: capital efficiency, forecast accuracy, risk management.

Give your perspective in 3-4 sentences. Lead with the financial or risk implication. What would you push back on?`,
      messages: [{
        role: 'user',
        content: `Question: ${question}\n\nContext: ${context}`,
      }],
      maxTokens: 400,
      temperature: 0.3,
      _tracking: { workspaceId, phase: 'chat', stepName: 'boardroom-cfo' },
    });

    // Call 3: VP Sales perspective (execution + team lens)
    const vpResult = await callLLM(workspaceId, 'reason', {
      systemPrompt: `You are the VP of Sales reviewing a RevOps question.
Your lens: rep performance, pipeline execution, quota attainment.

Give your perspective in 3-4 sentences. Lead with the execution implication. What does the team need to do differently?`,
      messages: [{
        role: 'user',
        content: `Question: ${question}\n\nContext: ${context}`,
      }],
      maxTokens: 400,
      temperature: 0.3,
      _tracking: { workspaceId, phase: 'chat', stepName: 'boardroom-vp' },
    });

    const ceoOutput = ceoResult.content || '';
    const cfoOutput = cfoResult.content || '';
    const vpOutput = vpResult.content || '';

    // Call 4: Synthesis
    const synthesisResult = await callLLM(workspaceId, 'reason', {
      systemPrompt: `Three perspectives on this question:
CEO: ${ceoOutput}
CFO: ${cfoOutput}
VP Sales: ${vpOutput}

Synthesize in 2-3 sentences. Where do they agree? What is the single most important consideration?`,
      messages: [{
        role: 'user',
        content: 'Synthesize the perspectives.',
      }],
      maxTokens: 350,
      temperature: 0.2,
      _tracking: { workspaceId, phase: 'chat', stepName: 'boardroom-synthesis' },
    });

    const synthesis = synthesisResult.content || '';

    const tokenCost =
      (ceoResult.usage?.input_tokens ?? 0) +
      (ceoResult.usage?.output_tokens ?? 0) +
      (cfoResult.usage?.input_tokens ?? 0) +
      (cfoResult.usage?.output_tokens ?? 0) +
      (vpResult.usage?.input_tokens ?? 0) +
      (vpResult.usage?.output_tokens ?? 0) +
      (synthesisResult.usage?.input_tokens ?? 0) +
      (synthesisResult.usage?.output_tokens ?? 0);

    // Write to deliberation_runs
    await query(
      `INSERT INTO deliberation_runs
       (workspace_id, pattern, trigger_surface, trigger_query, entity_type, entity_id, perspectives, verdict, token_cost)
       VALUES ($1, 'boardroom', 'ask_pandora', $2, NULL, NULL, $3, $4, $5)`,
      [
        workspaceId,
        question.slice(0, 500),
        JSON.stringify({
          ceo: { role: 'CEO', output: ceoOutput },
          cfo: { role: 'CFO', output: cfoOutput },
          vp_sales: { role: 'VP Sales', output: vpOutput },
        }),
        JSON.stringify({ synthesis }),
        tokenCost,
      ]
    );

    return {
      question,
      panels: [
        { role: 'CEO', output: ceoOutput, color_hint: 'synthesis' },
        { role: 'CFO', output: cfoOutput, color_hint: 'bear' },
        { role: 'VP Sales', output: vpOutput, color_hint: 'bull' },
      ],
      synthesis,
      tokenCost,
    };
  } catch (err) {
    console.error('[boardroom-deliberation] error:', err);
    return null;
  }
}

// ============================================================================
// Socratic Deliberation (assumption examination)
// ============================================================================

export interface SocraticResult {
  question: string;
  assumption: string;
  probing_questions: string;
  counter_hypothesis: string;
  synthesis: string;
  tokenCost: number;
}

export async function runSocraticDeliberation(
  workspaceId: string,
  question: string,
  context: string
): Promise<SocraticResult | null> {
  try {
    // Call 1: Surface the assumption
    const assumptionResult = await callLLM(workspaceId, 'reason', {
      systemPrompt: `You are a Socratic examiner reviewing a RevOps claim or question.

Identify the core assumption being made. State it clearly in 1-2 sentences. Then raise 2-3 questions that would test whether this assumption is valid. Be specific — reference the actual numbers and context provided.`,
      messages: [{
        role: 'user',
        content: `Question/claim: ${question}\n\nContext: ${context}`,
      }],
      maxTokens: 400,
      temperature: 0.3,
      _tracking: { workspaceId, phase: 'chat', stepName: 'socratic-assumption' },
    });

    const assumptionOutput = assumptionResult.content || '';

    // Call 2: Counter-hypothesis
    const counterResult = await callLLM(workspaceId, 'reason', {
      systemPrompt: `Propose an alternative explanation or hypothesis that fits the same data. Why might the assumption be wrong? What evidence would confirm or refute it? 3-4 sentences.`,
      messages: [{
        role: 'user',
        content: `Original claim: ${question}\n\nCore assumption identified: ${assumptionOutput}\n\nContext: ${context}`,
      }],
      maxTokens: 400,
      temperature: 0.3,
      _tracking: { workspaceId, phase: 'chat', stepName: 'socratic-counter' },
    });

    const counterOutput = counterResult.content || '';

    // Extract assumption and probing questions
    const lines = assumptionOutput.split('\n').filter(l => l.trim());
    const assumption = lines.slice(0, 2).join(' ').trim();
    const probing_questions = lines.slice(2).join('\n').trim();

    const synthesis = `To resolve this: ${probing_questions.split('\n')[0] || 'gather evidence'}`;

    const tokenCost =
      (assumptionResult.usage?.input_tokens ?? 0) +
      (assumptionResult.usage?.output_tokens ?? 0) +
      (counterResult.usage?.input_tokens ?? 0) +
      (counterResult.usage?.output_tokens ?? 0);

    // Write to deliberation_runs
    await query(
      `INSERT INTO deliberation_runs
       (workspace_id, pattern, trigger_surface, trigger_query, entity_type, entity_id, perspectives, verdict, token_cost)
       VALUES ($1, 'socratic', 'ask_pandora', $2, NULL, NULL, $3, $4, $5)`,
      [
        workspaceId,
        question.slice(0, 500),
        JSON.stringify({
          assumption: { output: assumption },
          probing: { output: probing_questions },
          counter: { output: counterOutput },
        }),
        JSON.stringify({ synthesis }),
        tokenCost,
      ]
    );

    return {
      question,
      assumption,
      probing_questions,
      counter_hypothesis: counterOutput,
      synthesis,
      tokenCost,
    };
  } catch (err) {
    console.error('[socratic-deliberation] error:', err);
    return null;
  }
}

// ============================================================================
// Prosecutor/Defense Deliberation (plan stress-testing)
// ============================================================================

export interface ProsecutorDefenseResult {
  plan: string;
  prosecution: string;
  defense: string;
  verdict: string;
  confidence: number;
  tokenCost: number;
}

export async function runProsecutorDefenseDeliberation(
  workspaceId: string,
  plan: string,
  context: string
): Promise<ProsecutorDefenseResult | null> {
  try {
    // Call 1: Prosecution (what will fail)
    const prosecutionResult = await callLLM(workspaceId, 'reason', {
      systemPrompt: `You are a ruthless critic stress-testing a revenue plan.

Make the strongest possible case for why this plan will fail. What are the 3 biggest risks? What assumptions are most likely wrong? What is the single most likely failure mode? 4-5 sentences.`,
      messages: [{
        role: 'user',
        content: `Plan: ${plan}\n\nContext: ${context}`,
      }],
      maxTokens: 400,
      temperature: 0.3,
      _tracking: { workspaceId, phase: 'chat', stepName: 'prosecutor-prosecution' },
    });

    const prosecutionOutput = prosecutionResult.content || '';

    // Call 2: Defense (why it will work)
    const defenseResult = await callLLM(workspaceId, 'reason', {
      systemPrompt: `You are defending a revenue plan against criticism.

Make the strongest possible case for why this plan will succeed. What evidence supports it? What mitigates the obvious risks? What is being underestimated? 4-5 sentences.`,
      messages: [{
        role: 'user',
        content: `Plan: ${plan}\n\nContext: ${context}`,
      }],
      maxTokens: 400,
      temperature: 0.3,
      _tracking: { workspaceId, phase: 'chat', stepName: 'prosecutor-defense' },
    });

    const defenseOutput = defenseResult.content || '';

    // Call 3: Verdict
    const verdictResult = await callLLM(workspaceId, 'reason', {
      systemPrompt: `Verdict: Is this plan sound? Rate confidence 0-1. What is the single change that would most improve its odds? What is the trip-wire to watch for — the early signal that it's failing? 3-4 sentences.`,
      messages: [{
        role: 'user',
        content: `Prosecution argument: ${prosecutionOutput}\n\nDefense argument: ${defenseOutput}\n\nPlan: ${plan}`,
      }],
      maxTokens: 350,
      temperature: 0.2,
      _tracking: { workspaceId, phase: 'chat', stepName: 'prosecutor-verdict' },
    });

    const verdictOutput = verdictResult.content || '';

    // Extract confidence from verdict (look for 0.X pattern)
    const confidenceMatch = verdictOutput.match(/\b0\.\d+\b/);
    const confidence = confidenceMatch ? parseFloat(confidenceMatch[0]) : 0.5;

    const tokenCost =
      (prosecutionResult.usage?.input_tokens ?? 0) +
      (prosecutionResult.usage?.output_tokens ?? 0) +
      (defenseResult.usage?.input_tokens ?? 0) +
      (defenseResult.usage?.output_tokens ?? 0) +
      (verdictResult.usage?.input_tokens ?? 0) +
      (verdictResult.usage?.output_tokens ?? 0);

    // Write to deliberation_runs
    await query(
      `INSERT INTO deliberation_runs
       (workspace_id, pattern, trigger_surface, trigger_query, entity_type, entity_id, perspectives, verdict, token_cost)
       VALUES ($1, 'prosecutor_defense', 'ask_pandora', $2, NULL, NULL, $3, $4, $5)`,
      [
        workspaceId,
        plan.slice(0, 500),
        JSON.stringify({
          prosecution: { output: prosecutionOutput },
          defense: { output: defenseOutput },
        }),
        JSON.stringify({ verdict: verdictOutput, confidence }),
        tokenCost,
      ]
    );

    return {
      plan,
      prosecution: prosecutionOutput,
      defense: defenseOutput,
      verdict: verdictOutput,
      confidence,
      tokenCost,
    };
  } catch (err) {
    console.error('[prosecutor-defense-deliberation] error:', err);
    return null;
  }
}
