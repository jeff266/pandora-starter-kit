/**
 * Account Synthesis
 *
 * Generates and caches the "Why this matters" LLM synthesis for the score drawer.
 * Cached per account per day in account_scores.synthesis_text.
 */

import { query } from '../db.js';
import { callLLM } from '../utils/llm-router.js';

export async function getOrGenerateSynthesis(
  workspaceId: string,
  accountId: string
): Promise<string> {
  // Load current cached synthesis
  const cacheResult = await query<{
    synthesis_text: string | null;
    synthesis_generated_at: string | null;
    total_score: number;
    grade: string;
    score_breakdown: any;
    data_confidence: number;
  }>(
    `SELECT synthesis_text, synthesis_generated_at, total_score, grade, score_breakdown, data_confidence
     FROM account_scores
     WHERE workspace_id = $1 AND account_id = $2`,
    [workspaceId, accountId]
  );

  const scoreRow = cacheResult.rows[0];
  if (!scoreRow) {
    return 'This account has not been scored yet. Click "Re-enrich" to analyze.';
  }

  // Return cached synthesis if < 24 hours old
  if (scoreRow.synthesis_text && scoreRow.synthesis_generated_at) {
    const ageMs = Date.now() - new Date(scoreRow.synthesis_generated_at).getTime();
    if (ageMs < 24 * 60 * 60 * 1000) {
      return scoreRow.synthesis_text;
    }
  }

  // Load context for synthesis
  const [accountResult, signalsResult, icpResult, dealsResult] = await Promise.all([
    query<{ name: string; domain: string; industry: string }>(
      `SELECT name, domain, industry FROM accounts WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, accountId]
    ),
    query<{ industry: string; employee_range: string; growth_stage: string; signals: any; signal_score: number; business_model: string }>(
      `SELECT industry, employee_range, growth_stage, signals, signal_score, business_model
       FROM account_signals WHERE workspace_id = $1 AND account_id = $2`,
      [workspaceId, accountId]
    ),
    query<{ id: string; won_deals: number; company_profile: any; scoring_method: string }>(
      `SELECT id, won_deals, company_profile, scoring_method
       FROM icp_profiles WHERE workspace_id = $1 AND status = 'active'
       ORDER BY generated_at DESC LIMIT 1`,
      [workspaceId]
    ),
    query<{ name: string; amount: number; stage: string }>(
      `SELECT name, amount, stage FROM deals
       WHERE workspace_id = $1 AND account_id = $2
         AND stage NOT IN ('closed_won', 'closed_lost', 'closedwon', 'closedlost')
       LIMIT 3`,
      [workspaceId, accountId]
    ),
  ]);

  const account = accountResult.rows[0];
  const signals = signalsResult.rows[0];
  const icp = icpResult.rows[0];
  const openDeals = dealsResult.rows;
  const breakdown = scoreRow.score_breakdown ?? {};

  if (!account) return 'Account not found.';

  const icpContext = icp
    ? `ICP match context (from ${icp.won_deals ?? 0} closed-won deals):
- Winning industries: ${(icp.company_profile?.industries ?? []).join(', ') || 'not specified'}
- Winning size ranges: ${(icp.company_profile?.size_ranges ?? []).join(', ') || 'not specified'}
- Key correlated signals: ${(icp.company_profile?.signals_correlated ?? []).join(', ') || 'none'}`
    : 'ICP context: generic scoring (no ICP profile active)';

  const signalList = Array.isArray(signals?.signals) && signals.signals.length > 0
    ? signals.signals.slice(0, 3).map((s: any) => `- ${s.signal ?? JSON.stringify(s)}`).join('\n')
    : '- No signals detected';

  const dealList = openDeals.length > 0
    ? openDeals.map(d => `${d.name} ($${(d.amount ?? 0).toLocaleString()})`).join(', ')
    : 'None';

  const bkFirmo = breakdown.firmographic_fit ?? {};
  const bkEngage = breakdown.engagement ?? {};
  const bkSignals = breakdown.signals ?? {};
  const bkRel = breakdown.relationship ?? {};

  const prompt = `You are a RevOps analyst. Write 2-3 sentences explaining why this account scored ${scoreRow.grade} (${scoreRow.total_score}/100) and what action the rep should take. Be specific. Use actual numbers. Do not start with "This account".

Account: ${account.name}
Industry: ${signals?.industry ?? account.industry ?? 'unknown'}
Employee range: ${signals?.employee_range ?? 'unknown'}
Growth stage: ${signals?.growth_stage ?? 'unknown'}
Score: ${scoreRow.total_score}/100 (${scoreRow.grade})

Score breakdown:
- Firmographic fit: ${bkFirmo.score ?? 0}/${bkFirmo.max ?? 30}
- Engagement: ${bkEngage.score ?? 0}/${bkEngage.max ?? 35}
- Signals: ${bkSignals.score ?? 0}/${bkSignals.max ?? 20}
- Relationship: ${bkRel.score ?? 0}/${bkRel.max ?? 15}

${icpContext}

Top signals detected:
${signalList}

Open deals: ${dealList}

Write the synthesis now (2-3 sentences, plain text, no markdown):`;

  const response = await callLLM(workspaceId, 'generate', {
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 180,
    temperature: 0.3,
  });

  const synthesis = response.content?.trim() || 'Unable to generate synthesis at this time.';

  // Cache to DB
  await query(
    `UPDATE account_scores
     SET synthesis_text = $3, synthesis_generated_at = now()
     WHERE workspace_id = $1 AND account_id = $2`,
    [workspaceId, accountId, synthesis]
  ).catch(err => console.warn('[Synthesis] Cache write failed:', err.message));

  return synthesis;
}
