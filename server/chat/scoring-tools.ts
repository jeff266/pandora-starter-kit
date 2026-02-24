import { query } from '../db.js';
import { callLLM } from '../utils/llm-router.js';

// ─── Tool 1: score_icp_fit ──────────────────────────────────────────────────

export async function scoreIcpFit(
  workspaceId: string,
  params: Record<string, any>
): Promise<any> {
  const { deal_id, account_id, account_name } = params;

  try {
    let resolvedAccountId = account_id;

    if (deal_id && !resolvedAccountId) {
      const dealRes = await query<any>(
        `SELECT account_id FROM deals WHERE workspace_id = $1 AND id = $2 LIMIT 1`,
        [workspaceId, deal_id]
      );
      resolvedAccountId = dealRes.rows[0]?.account_id;
      if (!resolvedAccountId) {
        return { score: null, error: 'Deal not found or has no linked account', query_description: 'score_icp_fit: deal lookup failed' };
      }
    }

    if (account_name && !resolvedAccountId) {
      const accRes = await query<any>(
        `SELECT id FROM accounts WHERE workspace_id = $1 AND name ILIKE $2 LIMIT 1`,
        [workspaceId, `%${account_name}%`]
      );
      resolvedAccountId = accRes.rows[0]?.id;
      if (!resolvedAccountId) {
        return { score: null, error: `Account "${account_name}" not found`, query_description: 'score_icp_fit: account lookup failed' };
      }
    }

    if (!resolvedAccountId) {
      return { score: null, error: 'Provide deal_id, account_id, or account_name', query_description: 'score_icp_fit: no input provided' };
    }

    const scoreRes = await query<any>(
      `SELECT s.total_score, s.grade, s.firmographic_score, s.engagement_score,
              s.signal_score, s.relationship_score, s.icp_fit_details,
              s.score_breakdown, s.scoring_mode, s.data_confidence,
              s.synthesis_text, s.scored_at,
              a.name as account_name, a.industry, a.domain,
              p.company_profile as icp_company_profile
       FROM account_scores s
       JOIN accounts a ON a.id = s.account_id AND a.workspace_id = s.workspace_id
       LEFT JOIN icp_profiles p ON p.id = s.icp_profile_id AND p.workspace_id = s.workspace_id
       WHERE s.workspace_id = $1 AND s.account_id = $2
       ORDER BY s.scored_at DESC NULLS LAST
       LIMIT 1`,
      [workspaceId, resolvedAccountId]
    );

    if (scoreRes.rows.length === 0) {
      const accInfo = await query<any>(
        `SELECT name, industry, domain FROM accounts WHERE workspace_id = $1 AND id = $2 LIMIT 1`,
        [workspaceId, resolvedAccountId]
      );
      return {
        account_id: resolvedAccountId,
        account_name: accInfo.rows[0]?.name || 'Unknown',
        score: null,
        grade: null,
        message: 'No ICP score exists for this account. ICP scoring may not have run yet, or this account may not have enough data.',
        query_description: 'score_icp_fit: no score found',
      };
    }

    const row = scoreRes.rows[0];
    const breakdown: any = {};

    if (row.icp_fit_details) {
      const details = typeof row.icp_fit_details === 'string' ? JSON.parse(row.icp_fit_details) : row.icp_fit_details;
      breakdown.firmographic = details.firmographic || details.firmographic_fit || null;
      breakdown.technographic = details.technographic || details.technographic_fit || null;
      breakdown.win_pattern = details.win_pattern || details.behavioral_fit || null;
      breakdown.raw = details;
    }

    if (row.score_breakdown) {
      const sb = typeof row.score_breakdown === 'string' ? JSON.parse(row.score_breakdown) : row.score_breakdown;
      breakdown.score_components = sb;
    }

    return {
      account_id: resolvedAccountId,
      account_name: row.account_name,
      industry: row.industry,
      domain: row.domain,
      score: row.total_score,
      grade: row.grade,
      scoring_mode: row.scoring_mode,
      data_confidence: row.data_confidence,
      firmographic_score: row.firmographic_score,
      engagement_score: row.engagement_score,
      signal_score: row.signal_score,
      relationship_score: row.relationship_score,
      breakdown,
      synthesis: row.synthesis_text || null,
      scored_at: row.scored_at,
      query_description: `ICP fit score for ${row.account_name}: ${row.total_score}/100 (${row.grade})`,
    };
  } catch (err: any) {
    console.error('[score_icp_fit] error:', err?.message);
    return { score: null, error: err?.message, query_description: 'score_icp_fit failed' };
  }
}

// ─── Tool 2: score_multithreading ────────────────────────────────────────────

export async function scoreMultithreading(
  workspaceId: string,
  params: Record<string, any>
): Promise<any> {
  const dealId = params.deal_id;
  if (!dealId) return { score: 0, error: 'deal_id is required', query_description: 'score_multithreading: no deal_id' };

  try {
    const dealRes = await query<any>(
      `SELECT d.id, d.name, d.stage, d.amount, d.owner as owner_email
       FROM deals d WHERE d.workspace_id = $1 AND d.id = $2 LIMIT 1`,
      [workspaceId, dealId]
    );
    if (dealRes.rows.length === 0) {
      return { score: 0, error: 'Deal not found', query_description: 'score_multithreading: deal not found' };
    }
    const deal = dealRes.rows[0];

    const contactsRes = await query<any>(
      `SELECT dc.contact_id, dc.role, dc.buying_role, dc.is_primary, dc.role_confidence,
              c.first_name, c.last_name, c.title, c.email, c.seniority, c.last_activity_date
       FROM deal_contacts dc
       JOIN contacts c ON c.id = dc.contact_id AND c.workspace_id = dc.workspace_id
       WHERE dc.workspace_id = $1 AND dc.deal_id = $2`,
      [workspaceId, dealId]
    );
    const contacts = contactsRes.rows;

    const convRes = await query<any>(
      `SELECT cv.id, cv.call_date, cv.participants, cv.summary, cv.title
       FROM conversations cv
       WHERE cv.workspace_id = $1
         AND (cv.deal_id = $2 OR cv.account_id = (SELECT account_id FROM deals WHERE id = $2 AND workspace_id = $1))
         AND cv.call_date >= NOW() - INTERVAL '90 days'
       ORDER BY cv.call_date DESC
       LIMIT 20`,
      [workspaceId, dealId]
    );
    const conversations = convRes.rows;

    const actRes = await query<any>(
      `SELECT a.contact_id, a.activity_type, a.timestamp, a.direction
       FROM activities a
       WHERE a.workspace_id = $1 AND a.deal_id = $2
         AND a.timestamp >= NOW() - INTERVAL '90 days'
       ORDER BY a.timestamp DESC`,
      [workspaceId, dealId]
    );

    const contactEngagement: Record<string, { calls: number; activities: number; last_active: string | null }> = {};
    for (const c of contacts) {
      contactEngagement[c.contact_id] = { calls: 0, activities: 0, last_active: c.last_activity_date };
    }

    for (const conv of conversations) {
      const participantStr = JSON.stringify(conv.participants || '');
      for (const c of contacts) {
        const searchTerm = c.email || `${c.first_name} ${c.last_name}`;
        if (participantStr.toLowerCase().includes(searchTerm.toLowerCase())) {
          if (contactEngagement[c.contact_id]) {
            contactEngagement[c.contact_id].calls++;
          }
        }
      }
    }

    for (const act of actRes.rows) {
      if (act.contact_id && contactEngagement[act.contact_id]) {
        contactEngagement[act.contact_id].activities++;
        const actDate = act.timestamp?.toISOString?.() || act.timestamp;
        if (!contactEngagement[act.contact_id].last_active || actDate > contactEngagement[act.contact_id].last_active!) {
          contactEngagement[act.contact_id].last_active = actDate;
        }
      }
    }

    const roleMap: Record<string, string> = {
      economic_buyer: 'Economic Buyer',
      champion: 'Champion',
      technical_evaluator: 'Technical Evaluator',
      coach: 'Coach',
      blocker: 'Blocker',
      legal: 'Legal',
      procurement: 'Procurement',
    };

    function inferRoleFromTitle(title: string | null): string | null {
      if (!title) return null;
      const t = title.toLowerCase();
      if (/\b(vp|vice president|c-level|ceo|cfo|coo|cto|cio|cro|chief|svp|evp)\b/.test(t) &&
          /\b(finance|procurement|purchasing|operations|revenue)\b/.test(t)) return 'economic_buyer';
      if (/\b(vp|vice president|director|head of|svp|evp)\b/.test(t)) return 'champion';
      if (/\b(engineer|architect|developer|technical|it manager|devops|sre|security)\b/.test(t)) return 'technical_evaluator';
      if (/\b(legal|counsel|attorney|compliance)\b/.test(t)) return 'legal';
      if (/\b(procurement|purchasing|vendor|sourcing)\b/.test(t)) return 'procurement';
      return null;
    }

    const engagementByContact: any[] = [];
    const rolesCovered = new Set<string>();
    const now = Date.now();
    let engagedCount = 0;

    for (const c of contacts) {
      const eng = contactEngagement[c.contact_id] || { calls: 0, activities: 0, last_active: null };
      const role = c.buying_role || c.role || inferRoleFromTitle(c.title) || 'unknown';
      if (role !== 'unknown') rolesCovered.add(role);

      const isEngaged = eng.calls > 0 || eng.activities > 0;
      if (isEngaged) engagedCount++;

      let engagementLevel: 'high' | 'medium' | 'low' | 'none' = 'none';
      if (eng.calls >= 2 || eng.activities >= 3) engagementLevel = 'high';
      else if (eng.calls >= 1 || eng.activities >= 1) engagementLevel = 'medium';
      else if (eng.last_active) {
        const daysSince = (now - new Date(eng.last_active).getTime()) / 86400000;
        engagementLevel = daysSince <= 14 ? 'low' : 'none';
      }

      engagementByContact.push({
        name: `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email || 'Unknown',
        title: c.title,
        role: roleMap[role] || role,
        calls_attended: eng.calls,
        activities: eng.activities,
        last_activity: eng.last_active,
        engagement_level: engagementLevel,
      });
    }

    const expectedRoles = ['economic_buyer', 'champion', 'technical_evaluator'];
    const rolesMissing = expectedRoles.filter(r => !rolesCovered.has(r)).map(r => roleMap[r] || r);

    let score = 0;

    const contactCount = contacts.length;
    if (contactCount === 1) score += 0;
    else if (contactCount === 2) score += 20;
    else if (contactCount >= 3) score += 30;

    const uniqueRoles = rolesCovered.size;
    score += Math.min(uniqueRoles * 15, 45);

    const recentlyActive = engagementByContact.filter(c => {
      if (!c.last_activity) return false;
      const daysSince = (now - new Date(c.last_activity).getTime()) / 86400000;
      return daysSince <= 14;
    }).length;
    const recencyRatio = contacts.length > 0 ? recentlyActive / contacts.length : 0;
    score += Math.round(recencyRatio * 25);

    score = Math.min(score, 100);

    const riskFactors: string[] = [];
    if (contactCount <= 1) riskFactors.push('Single-threaded — only 1 contact on this deal');
    if (!rolesCovered.has('economic_buyer')) riskFactors.push('No economic buyer identified');
    if (!rolesCovered.has('champion')) riskFactors.push('No champion identified');

    const champion = engagementByContact.find(c =>
      c.role.toLowerCase().includes('champion') && c.engagement_level === 'none'
    );
    if (champion) riskFactors.push(`Champion (${champion.name}) not engaged recently`);

    if (engagedCount === 0 && contactCount > 0) riskFactors.push('No contacts have recent engagement');

    return {
      deal_id: dealId,
      deal_name: deal.name,
      score,
      contacts_total: contactCount,
      contacts_engaged: engagedCount,
      roles_covered: [...rolesCovered].map(r => roleMap[r] || r),
      roles_missing: rolesMissing,
      engagement_by_contact: engagementByContact,
      risk_factors: riskFactors,
      conversations_analyzed: conversations.length,
      query_description: `Multithreading score for "${deal.name}": ${score}/100 (${contactCount} contacts, ${engagedCount} engaged, ${rolesCovered.size} roles)`,
    };
  } catch (err: any) {
    console.error('[score_multithreading] error:', err?.message);
    return { score: 0, error: err?.message, query_description: 'score_multithreading failed' };
  }
}

// ─── Tool 3: score_conversation_sentiment ────────────────────────────────────

export async function scoreConversationSentiment(
  workspaceId: string,
  params: Record<string, any>
): Promise<any> {
  const dealId = params.deal_id;
  const lastN = params.last_n_calls || 3;
  if (!dealId) return { score: 0, error: 'deal_id is required', query_description: 'score_conversation_sentiment: no deal_id' };

  try {
    const convRes = await query<any>(
      `SELECT cv.id, cv.title, cv.call_date, cv.summary,
              LEFT(cv.transcript_text, 3000) as transcript_excerpt,
              cv.sentiment_score, cv.objections, cv.competitor_mentions,
              cv.risk_signals, cv.pricing_discussed,
              cv.next_steps, cv.budget_signals, cv.timeline_signals
       FROM conversations cv
       WHERE cv.workspace_id = $1
         AND (cv.deal_id = $2 OR cv.account_id = (SELECT account_id FROM deals WHERE id = $2 AND workspace_id = $1))
         AND cv.is_internal = false
       ORDER BY cv.call_date DESC
       LIMIT $3`,
      [workspaceId, dealId, lastN]
    );

    if (convRes.rows.length === 0) {
      return {
        deal_id: dealId,
        score: 0,
        trend: 'unknown',
        signals: { positive: [], negative: [], neutral: [] },
        red_flags: [],
        buying_signals: [],
        per_call: [],
        message: 'No external conversations found for this deal',
        query_description: 'score_conversation_sentiment: no conversations found',
      };
    }

    const calls = convRes.rows;

    const callTexts = calls.map((c: any) => {
      const text = c.summary || (c.transcript_excerpt ? c.transcript_excerpt.substring(0, 2000) : '');
      return `Call: "${c.title}" (${c.call_date ? new Date(c.call_date).toISOString().split('T')[0] : 'unknown date'})\n${text}`;
    }).join('\n---\n');

    const promptText = `Analyze these ${calls.length} sales call summaries for deal sentiment.

${callTexts}

For each call, classify:
- sentiment: positive/neutral/negative (with score from -1.0 to 1.0)
- buying_signals: any statements indicating purchase intent
- red_flags: objections, delays, competitor mentions, budget concerns
- key_moments: the 2-3 most important exchanges

Then provide an overall assessment:
- overall_score: -1.0 to 1.0
- trend: improving/stable/declining
- positive_signals: list of positive indicators
- negative_signals: list of concerns
- buying_signals: strongest purchase intent indicators
- red_flags: most concerning items

Respond ONLY with JSON:
{"per_call":[{"call_title":"...","sentiment":"positive|neutral|negative","score":0.0,"buying_signals":["..."],"red_flags":["..."],"key_moments":["..."]}],"overall":{"score":0.0,"trend":"...","positive_signals":["..."],"negative_signals":["..."],"buying_signals":["..."],"red_flags":["..."]}}`;

    const llmRes = await callLLM(workspaceId, 'classify', {
      messages: [{ role: 'user', content: promptText }],
      maxTokens: 1500,
      temperature: 0,
    });

    let parsed: any = null;
    try {
      const jsonMatch = llmRes.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch {
      // fall through
    }

    if (!parsed) {
      const existingScores = calls.filter((c: any) => c.sentiment_score != null);
      if (existingScores.length > 0) {
        const avgScore = existingScores.reduce((sum: number, c: any) => sum + Number(c.sentiment_score), 0) / existingScores.length;
        return {
          deal_id: dealId,
          score: Math.round(avgScore * 100) / 100,
          trend: 'unknown',
          signals: { positive: [], negative: [], neutral: [] },
          red_flags: [],
          buying_signals: [],
          per_call: calls.map((c: any) => ({
            call_id: c.id,
            date: c.call_date,
            title: c.title,
            sentiment_score: c.sentiment_score,
          })),
          message: 'Used existing sentiment scores (LLM analysis unavailable)',
          query_description: `Conversation sentiment for deal: avg score ${avgScore.toFixed(2)} from ${existingScores.length} calls`,
        };
      }
      return { deal_id: dealId, score: 0, trend: 'unknown', error: 'LLM analysis failed and no existing sentiment data', query_description: 'score_conversation_sentiment: analysis failed' };
    }

    const overall = parsed.overall || {};
    const perCall = (parsed.per_call || []).map((pc: any, i: number) => ({
      call_id: calls[i]?.id,
      date: calls[i]?.call_date,
      title: pc.call_title || calls[i]?.title,
      sentiment: pc.sentiment,
      score: pc.score,
      buying_signals: pc.buying_signals || [],
      red_flags: pc.red_flags || [],
      key_moments: pc.key_moments || [],
    }));

    return {
      deal_id: dealId,
      score: overall.score ?? 0,
      trend: overall.trend || 'unknown',
      signals: {
        positive: overall.positive_signals || [],
        negative: overall.negative_signals || [],
        neutral: [],
      },
      red_flags: overall.red_flags || [],
      buying_signals: overall.buying_signals || [],
      per_call: perCall,
      calls_analyzed: calls.length,
      query_description: `Conversation sentiment for deal: score ${overall.score ?? 'N/A'}, trend ${overall.trend || 'unknown'}, ${calls.length} calls analyzed`,
    };
  } catch (err: any) {
    console.error('[score_conversation_sentiment] error:', err?.message);
    return { deal_id: dealId, score: 0, trend: 'unknown', error: err?.message, query_description: 'score_conversation_sentiment failed' };
  }
}
