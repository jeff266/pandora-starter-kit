import { query } from '../db.js';
import { callLLM } from '../utils/llm-router.js';
import { PANDORA_VOICE_STANDARD } from '../lib/voice-standard.js';

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
