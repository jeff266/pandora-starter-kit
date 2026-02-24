import { query } from '../db.js';
import { callLLM } from '../utils/llm-router.js';

// ─── Tool 1: compute_rep_conversions ─────────────────────────────────────────

export async function computeRepConversions(
  workspaceId: string,
  params: Record<string, any>
): Promise<any> {
  const { rep_email, date_range, pipeline } = params;

  try {
    const sinceDate = date_range || new Date(Date.now() - 180 * 86400000).toISOString().split('T')[0];

    const sqlParams: any[] = [workspaceId, sinceDate];
    let repFilter = '';
    if (rep_email) {
      repFilter = ' AND d.owner = $3';
      sqlParams.push(rep_email);
    }
    let pipelineFilter = '';
    if (pipeline) {
      pipelineFilter = ` AND d.pipeline ILIKE $${sqlParams.length + 1}`;
      sqlParams.push(`%${pipeline}%`);
    }

    const res = await query<any>(
      `WITH ordered_history AS (
        SELECT
          dsh.deal_id,
          dsh.stage,
          dsh.stage_normalized,
          dsh.entered_at,
          d.owner as owner_email,
          d.owner as owner_name,
          LAG(dsh.stage) OVER (PARTITION BY dsh.deal_id ORDER BY dsh.entered_at) as prev_stage,
          LAG(dsh.stage_normalized) OVER (PARTITION BY dsh.deal_id ORDER BY dsh.entered_at) as prev_stage_normalized
        FROM deal_stage_history dsh
        JOIN deals d ON d.id = dsh.deal_id AND d.workspace_id = dsh.workspace_id
        WHERE dsh.workspace_id = $1
          AND dsh.entered_at >= $2::date
          ${repFilter}
          ${pipelineFilter}
      ),
      transitions AS (
        SELECT
          owner_email,
          owner_name,
          prev_stage as from_stage,
          stage as to_stage,
          prev_stage_normalized as from_normalized,
          stage_normalized as to_normalized,
          CASE
            WHEN stage_normalized IN ('closed_won') AND prev_stage_normalized NOT IN ('closed_won') THEN 'won'
            WHEN stage_normalized IN ('closed_lost') AND prev_stage_normalized NOT IN ('closed_lost') THEN 'lost'
            WHEN prev_stage IS NULL THEN 'initial'
            ELSE 'advanced'
          END AS direction
        FROM ordered_history
        WHERE prev_stage IS NOT NULL
      ),
      rep_stats AS (
        SELECT
          owner_email,
          owner_name,
          from_stage,
          COUNT(*) as total_transitions,
          COUNT(*) FILTER (WHERE direction = 'advanced' OR direction = 'won') as advanced,
          COUNT(*) FILTER (WHERE direction = 'lost') as lost,
          ROUND(
            COUNT(*) FILTER (WHERE direction = 'advanced' OR direction = 'won')::numeric
            / NULLIF(COUNT(*), 0), 3
          ) as conversion_rate
        FROM transitions
        GROUP BY owner_email, owner_name, from_stage
      ),
      team_stats AS (
        SELECT
          from_stage,
          ROUND(
            COUNT(*) FILTER (WHERE direction = 'advanced' OR direction = 'won')::numeric
            / NULLIF(COUNT(*), 0), 3
          ) as team_rate
        FROM transitions
        GROUP BY from_stage
      )
      SELECT
        rs.owner_email,
        rs.owner_name,
        rs.from_stage,
        rs.total_transitions,
        rs.advanced,
        rs.lost,
        rs.conversion_rate as rep_rate,
        ts.team_rate,
        ROUND(rs.conversion_rate - ts.team_rate, 3) as delta
      FROM rep_stats rs
      JOIN team_stats ts ON ts.from_stage = rs.from_stage
      ORDER BY rs.owner_email, rs.from_stage`,
      sqlParams
    );

    if (res.rows.length === 0) {
      return {
        stages: [],
        reps: [],
        message: 'No stage transitions found for the given filters',
        query_description: `compute_rep_conversions: no data (since ${sinceDate})`,
      };
    }

    const repMap = new Map<string, { name: string; stages: any[]; total_transitions: number }>();
    for (const row of res.rows) {
      if (!repMap.has(row.owner_email)) {
        repMap.set(row.owner_email, { name: row.owner_name, stages: [], total_transitions: 0 });
      }
      const rep = repMap.get(row.owner_email)!;
      rep.total_transitions += Number(row.total_transitions);
      rep.stages.push({
        from_stage: row.from_stage,
        total: Number(row.total_transitions),
        advanced: Number(row.advanced),
        lost: Number(row.lost),
        rep_rate: Number(row.rep_rate),
        team_rate: Number(row.team_rate),
        delta: Number(row.delta),
      });
    }

    const reps = [...repMap.entries()].map(([email, data]) => {
      const bestStage = data.stages.reduce((best, s) => s.delta > best.delta ? s : best, data.stages[0]);
      const worstStage = data.stages.reduce((worst, s) => s.delta < worst.delta ? s : worst, data.stages[0]);
      const avgDelta = data.stages.reduce((sum, s) => sum + s.delta, 0) / data.stages.length;

      return {
        rep_email: email,
        rep_name: data.name,
        total_transitions: data.total_transitions,
        stages: data.stages,
        best_conversion_stage: bestStage?.from_stage,
        worst_conversion_stage: worstStage?.from_stage,
        vs_team: avgDelta > 0.03 ? 'above' : avgDelta < -0.03 ? 'below' : 'on_par',
      };
    });

    return {
      reps,
      period_start: sinceDate,
      total_reps: reps.length,
      query_description: `Stage conversion rates for ${reps.length} rep(s) since ${sinceDate}`,
    };
  } catch (err: any) {
    console.error('[compute_rep_conversions] error:', err?.message);
    return { reps: [], error: err?.message, query_description: 'compute_rep_conversions failed' };
  }
}

// ─── Tool 2: compute_source_conversion ───────────────────────────────────────

export async function computeSourceConversion(
  workspaceId: string,
  params: Record<string, any>
): Promise<any> {
  const { date_range, source } = params;

  try {
    const sinceDate = date_range || new Date(Date.now() - 365 * 86400000).toISOString().split('T')[0];
    const sqlParams: any[] = [workspaceId, sinceDate];

    let sourceFilter = '';
    if (source) {
      sourceFilter = ` AND d.lead_source ILIKE $3`;
      sqlParams.push(`%${source}%`);
    }

    const res = await query<any>(
      `SELECT
        COALESCE(NULLIF(d.lead_source, ''), 'Unknown') as source_name,
        COUNT(*) as total_deals,
        COUNT(*) FILTER (WHERE d.stage_normalized = 'closed_won') as won_count,
        COUNT(*) FILTER (WHERE d.stage_normalized = 'closed_lost') as lost_count,
        COUNT(*) FILTER (WHERE d.stage_normalized NOT IN ('closed_won', 'closed_lost')) as open_count,
        ROUND(
          COUNT(*) FILTER (WHERE d.stage_normalized = 'closed_won')::numeric
          / NULLIF(COUNT(*) FILTER (WHERE d.stage_normalized IN ('closed_won', 'closed_lost')), 0), 3
        ) as win_rate,
        ROUND(AVG(d.amount) FILTER (WHERE d.stage_normalized = 'closed_won'), 0) as avg_won_deal_size,
        ROUND(SUM(d.amount) FILTER (WHERE d.stage_normalized = 'closed_won'), 0) as total_won_revenue,
        ROUND(AVG(
          EXTRACT(EPOCH FROM (
            CASE WHEN d.close_date IS NOT NULL AND d.created_at IS NOT NULL
              THEN d.close_date::timestamp - d.created_at::timestamp
            END
          )) / 86400
        ) FILTER (WHERE d.stage_normalized = 'closed_won'), 0) as avg_cycle_days
      FROM deals d
      WHERE d.workspace_id = $1
        AND d.created_at >= $2::date
        ${sourceFilter}
      GROUP BY COALESCE(NULLIF(d.lead_source, ''), 'Unknown')
      ORDER BY total_won_revenue DESC NULLS LAST`,
      sqlParams
    );

    if (res.rows.length === 0) {
      return {
        sources: [],
        message: 'No deals found with lead source data',
        query_description: `compute_source_conversion: no data (since ${sinceDate})`,
      };
    }

    const sources = res.rows.map((r: any) => ({
      source: r.source_name,
      total_deals: Number(r.total_deals),
      won_count: Number(r.won_count),
      lost_count: Number(r.lost_count),
      open_count: Number(r.open_count),
      win_rate: Number(r.win_rate) || 0,
      avg_won_deal_size: Number(r.avg_won_deal_size) || 0,
      total_won_revenue: Number(r.total_won_revenue) || 0,
      avg_cycle_days: Number(r.avg_cycle_days) || null,
    }));

    const bestWinRate = sources.filter(s => s.won_count >= 2).sort((a, b) => b.win_rate - a.win_rate)[0];
    const highestVolume = sources.sort((a, b) => b.total_deals - a.total_deals)[0];
    const bestROI = sources
      .filter(s => s.won_count >= 1)
      .sort((a, b) => (b.avg_won_deal_size * b.win_rate) - (a.avg_won_deal_size * a.win_rate))[0];

    return {
      sources: sources.sort((a, b) => b.total_won_revenue - a.total_won_revenue),
      best_win_rate: bestWinRate?.source || null,
      highest_volume: highestVolume?.source || null,
      best_roi: bestROI?.source || null,
      period_start: sinceDate,
      total_sources: sources.length,
      query_description: `Source conversion analysis: ${sources.length} sources, best win rate: ${bestWinRate?.source || 'N/A'} (${bestWinRate?.win_rate ? (bestWinRate.win_rate * 100).toFixed(0) + '%' : 'N/A'})`,
    };
  } catch (err: any) {
    console.error('[compute_source_conversion] error:', err?.message);
    return { sources: [], error: err?.message, query_description: 'compute_source_conversion failed' };
  }
}

// ─── Tool 3: detect_process_blockers ─────────────────────────────────────────

export async function detectProcessBlockers(
  workspaceId: string,
  params: Record<string, any>
): Promise<any> {
  const dealId = params.deal_id;
  if (!dealId) return { blockers: [], error: 'deal_id is required', query_description: 'detect_process_blockers: no deal_id' };

  try {
    const dealRes = await query<any>(
      `SELECT d.id, d.name, d.stage, d.stage_normalized, d.amount, d.close_date,
              d.owner as owner_email, d.source_data, d.custom_fields,
              EXTRACT(EPOCH FROM (NOW() - dsh_last.entered_at)) / 86400 as days_in_current_stage
       FROM deals d
       LEFT JOIN LATERAL (
         SELECT entered_at FROM deal_stage_history
         WHERE deal_id = d.id AND workspace_id = d.workspace_id
         ORDER BY entered_at DESC LIMIT 1
       ) dsh_last ON true
       WHERE d.workspace_id = $1 AND d.id = $2 LIMIT 1`,
      [workspaceId, dealId]
    );

    if (dealRes.rows.length === 0) {
      return { blockers: [], error: 'Deal not found', query_description: 'detect_process_blockers: deal not found' };
    }
    const deal = dealRes.rows[0];

    const convRes = await query<any>(
      `SELECT cv.summary, cv.title, cv.call_date, cv.next_steps, cv.risk_signals,
              cv.objections, cv.timeline_signals
       FROM conversations cv
       WHERE cv.workspace_id = $1
         AND (cv.deal_id = $2 OR cv.account_id = (SELECT account_id FROM deals WHERE id = $2 AND workspace_id = $1))
         AND cv.is_internal = false
       ORDER BY cv.call_date DESC
       LIMIT 5`,
      [workspaceId, dealId]
    );

    const actRes = await query<any>(
      `SELECT a.activity_type, a.timestamp, a.subject, a.body, a.direction
       FROM activities a
       WHERE a.workspace_id = $1 AND a.deal_id = $2
       ORDER BY a.timestamp DESC
       LIMIT 10`,
      [workspaceId, dealId]
    );

    const evidence: string[] = [];

    const customFields = deal.custom_fields || {};
    const sourceData = deal.source_data || {};
    const allFields = { ...sourceData, ...customFields };
    const blockerKeywords = ['security', 'legal', 'procurement', 'IT review', 'vendor assessment',
      'compliance', 'infosec', 'SOC2', 'GDPR', 'contract', 'redline', 'MSA', 'NDA',
      'budget approval', 'board approval', 'committee'];

    for (const [key, val] of Object.entries(allFields)) {
      if (typeof val === 'string' && val.length > 2) {
        for (const kw of blockerKeywords) {
          if (val.toLowerCase().includes(kw.toLowerCase())) {
            evidence.push(`CRM field "${key}": "${val.substring(0, 200)}"`);
            break;
          }
        }
      }
    }

    for (const conv of convRes.rows) {
      const text = [conv.summary, conv.title, JSON.stringify(conv.next_steps), JSON.stringify(conv.risk_signals)].filter(Boolean).join(' ');
      for (const kw of blockerKeywords) {
        if (text.toLowerCase().includes(kw.toLowerCase())) {
          evidence.push(`Call "${conv.title}" (${conv.call_date ? new Date(conv.call_date).toISOString().split('T')[0] : '?'}): mentions "${kw}"`);
          break;
        }
      }
    }

    if (deal.days_in_current_stage > 30 && deal.stage_normalized && !deal.stage_normalized.includes('closed')) {
      evidence.push(`Deal has been in "${deal.stage}" for ${Math.round(deal.days_in_current_stage)} days (potential stall)`);
    }

    const lastActivity = actRes.rows[0]?.timestamp;
    if (lastActivity) {
      const daysSinceActivity = (Date.now() - new Date(lastActivity).getTime()) / 86400000;
      if (daysSinceActivity > 14) {
        evidence.push(`No activity for ${Math.round(daysSinceActivity)} days — possible process delay`);
      }
    }

    if (evidence.length === 0) {
      return {
        deal_id: dealId,
        deal_name: deal.name,
        blockers: [],
        has_active_blockers: false,
        estimated_total_delay_days: 0,
        message: 'No process blockers detected from available data',
        query_description: `detect_process_blockers for "${deal.name}": no blockers found`,
      };
    }

    const promptText = `Given this deal context, identify procurement/approval blockers.

Deal: "${deal.name}" (Stage: ${deal.stage}, Amount: $${Number(deal.amount || 0).toLocaleString()})
Days in current stage: ${Math.round(deal.days_in_current_stage || 0)}

Evidence found:
${evidence.map((e, i) => `${i + 1}. ${e}`).join('\n')}

Classify each blocker by type and estimate days to clear.

Respond ONLY with JSON:
{"blockers":[{"type":"security_review|legal|procurement|budget_approval|technical_validation|other","description":"what the blocker is","evidence":"which evidence item(s)","estimated_days":0,"status":"active|cleared|unknown"}]}`;

    const llmRes = await callLLM(workspaceId, 'classify', {
      messages: [{ role: 'user', content: promptText }],
      maxTokens: 800,
      temperature: 0,
    });

    let parsed: any = null;
    try {
      const jsonMatch = llmRes.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch {
      // fall through
    }

    const blockers = (parsed?.blockers || []).map((b: any) => ({
      type: b.type || 'other',
      description: b.description || '',
      evidence: b.evidence || '',
      detected_from: b.evidence?.toLowerCase().includes('crm') ? 'crm_field' :
                     b.evidence?.toLowerCase().includes('call') ? 'call_transcript' : 'activity_pattern',
      estimated_days: b.estimated_days ?? null,
      status: b.status || 'unknown',
    }));

    const activeBlockers = blockers.filter((b: any) => b.status === 'active' || b.status === 'unknown');
    const totalDelay = activeBlockers.reduce((sum: number, b: any) => sum + (b.estimated_days || 0), 0);

    return {
      deal_id: dealId,
      deal_name: deal.name,
      blockers,
      has_active_blockers: activeBlockers.length > 0,
      estimated_total_delay_days: totalDelay,
      evidence_count: evidence.length,
      query_description: `detect_process_blockers for "${deal.name}": ${activeBlockers.length} active blocker(s), est. ${totalDelay} day delay`,
    };
  } catch (err: any) {
    console.error('[detect_process_blockers] error:', err?.message);
    return { blockers: [], error: err?.message, query_description: 'detect_process_blockers failed' };
  }
}

// ─── Tool 4: detect_buyer_signals ────────────────────────────────────────────

export async function detectBuyerSignals(
  workspaceId: string,
  params: Record<string, any>
): Promise<any> {
  const dealId = params.deal_id;
  if (!dealId) return { signals: [], error: 'deal_id is required', query_description: 'detect_buyer_signals: no deal_id' };

  try {
    const dealRes = await query<any>(
      `SELECT d.id, d.name, d.stage, d.stage_normalized, d.amount, d.close_date,
              d.owner as owner_email, d.custom_fields, d.source_data
       FROM deals d WHERE d.workspace_id = $1 AND d.id = $2 LIMIT 1`,
      [workspaceId, dealId]
    );

    if (dealRes.rows.length === 0) {
      return { signals: [], error: 'Deal not found', query_description: 'detect_buyer_signals: deal not found' };
    }
    const deal = dealRes.rows[0];

    const convRes = await query<any>(
      `SELECT cv.id, cv.title, cv.call_date, cv.summary,
              LEFT(cv.transcript_text, 2000) as transcript_excerpt,
              cv.next_steps, cv.budget_signals, cv.timeline_signals,
              cv.pricing_discussed, cv.pricing_signals,
              cv.decision_makers_mentioned, cv.risk_signals
       FROM conversations cv
       WHERE cv.workspace_id = $1
         AND (cv.deal_id = $2 OR cv.account_id = (SELECT account_id FROM deals WHERE id = $2 AND workspace_id = $1))
         AND cv.is_internal = false
       ORDER BY cv.call_date DESC
       LIMIT 5`,
      [workspaceId, dealId]
    );

    const actRes = await query<any>(
      `SELECT a.activity_type, a.timestamp, a.subject, a.direction, a.actor
       FROM activities a
       WHERE a.workspace_id = $1 AND a.deal_id = $2
         AND a.timestamp >= NOW() - INTERVAL '30 days'
       ORDER BY a.timestamp DESC
       LIMIT 20`,
      [workspaceId, dealId]
    );

    const dcRes = await query<any>(
      `SELECT dc.role, dc.buying_role, c.title, c.seniority
       FROM deal_contacts dc
       JOIN contacts c ON c.id = dc.contact_id AND c.workspace_id = dc.workspace_id
       WHERE dc.workspace_id = $1 AND dc.deal_id = $2`,
      [workspaceId, dealId]
    );

    const evidenceParts: string[] = [];

    const inboundActivities = actRes.rows.filter((a: any) => a.direction === 'inbound');
    if (inboundActivities.length > 0) {
      evidenceParts.push(`Inbound activities (last 30d): ${inboundActivities.length} — types: ${[...new Set(inboundActivities.map((a: any) => a.activity_type))].join(', ')}`);
    }

    for (const conv of convRes.rows) {
      const parts: string[] = [];
      if (conv.pricing_discussed) parts.push('pricing discussed');
      if (conv.budget_signals && Object.keys(conv.budget_signals).length) parts.push('budget signals present');
      if (conv.timeline_signals && Object.keys(conv.timeline_signals).length) parts.push('timeline discussed');
      if (conv.decision_makers_mentioned && Array.isArray(conv.decision_makers_mentioned) && conv.decision_makers_mentioned.length) parts.push('decision makers mentioned');
      if (conv.next_steps && Array.isArray(conv.next_steps) && conv.next_steps.length) parts.push(`next steps: ${JSON.stringify(conv.next_steps).substring(0, 200)}`);

      if (parts.length > 0) {
        evidenceParts.push(`Call "${conv.title}" (${conv.call_date ? new Date(conv.call_date).toISOString().split('T')[0] : '?'}): ${parts.join(', ')}`);
      }

      if (conv.summary) {
        evidenceParts.push(`Summary excerpt: ${conv.summary.substring(0, 300)}`);
      }
    }

    const seniorContacts = dcRes.rows.filter((dc: any) => {
      const role = dc.buying_role || dc.role || '';
      const seniority = dc.seniority || '';
      return role === 'economic_buyer' || seniority === 'executive' || seniority === 'vp';
    });
    if (seniorContacts.length > 0) {
      evidenceParts.push(`Senior stakeholders engaged: ${seniorContacts.length} (includes ${seniorContacts.map((c: any) => c.title).filter(Boolean).join(', ')})`);
    }

    const customFields = { ...deal.source_data, ...deal.custom_fields };
    const signalKeywords = ['procurement', 'security questionnaire', 'legal review', 'contract sent',
      'verbal commit', 'budget approved', 'reference check', 'selected vendor', 'RFP', 'SOW'];
    for (const [key, val] of Object.entries(customFields)) {
      if (typeof val === 'string') {
        for (const kw of signalKeywords) {
          if (val.toLowerCase().includes(kw.toLowerCase())) {
            evidenceParts.push(`CRM "${key}": "${val.substring(0, 150)}"`);
            break;
          }
        }
      }
    }

    if (evidenceParts.length === 0) {
      return {
        deal_id: dealId,
        deal_name: deal.name,
        signals: [],
        signal_strength: 'none',
        strongest_signal: null,
        message: 'No buyer signals detected from available data',
        query_description: `detect_buyer_signals for "${deal.name}": no signals found`,
      };
    }

    const promptText = `Analyze this deal evidence for buyer purchase signals.

Deal: "${deal.name}" (Stage: ${deal.stage}, Amount: $${Number(deal.amount || 0).toLocaleString()}, Close: ${deal.close_date || 'not set'})

Evidence:
${evidenceParts.map((e, i) => `${i + 1}. ${e}`).join('\n')}

Identify buyer signals from: buyer_scheduled_followup, rfp_received, procurement_intro, security_review_started, budget_allocated, verbal_commitment, reference_request, contract_redline, executive_sponsor_engaged

For each signal found:
- type: one of the signal types above
- evidence: what data supports this
- confidence: 0.0-1.0
- source: call | email | crm_field | activity

Then assess overall signal_strength: strong | moderate | weak | none

Respond ONLY with JSON:
{"signals":[{"type":"...","evidence":"...","confidence":0.0,"source":"..."}],"signal_strength":"...","strongest_signal":"type of strongest signal or null"}`;

    const llmRes = await callLLM(workspaceId, 'classify', {
      messages: [{ role: 'user', content: promptText }],
      maxTokens: 1000,
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
      return {
        deal_id: dealId,
        deal_name: deal.name,
        signals: [],
        signal_strength: 'unknown',
        strongest_signal: null,
        evidence_found: evidenceParts.length,
        message: 'Evidence found but LLM classification failed',
        query_description: `detect_buyer_signals for "${deal.name}": classification failed`,
      };
    }

    return {
      deal_id: dealId,
      deal_name: deal.name,
      signals: (parsed.signals || []).map((s: any) => ({
        type: s.type,
        evidence: s.evidence,
        confidence: s.confidence ?? 0.5,
        source: s.source || 'unknown',
      })),
      signal_strength: parsed.signal_strength || 'unknown',
      strongest_signal: parsed.strongest_signal || null,
      evidence_analyzed: evidenceParts.length,
      query_description: `detect_buyer_signals for "${deal.name}": ${parsed.signal_strength || 'unknown'} signals, ${(parsed.signals || []).length} detected`,
    };
  } catch (err: any) {
    console.error('[detect_buyer_signals] error:', err?.message);
    return { signals: [], error: err?.message, query_description: 'detect_buyer_signals failed' };
  }
}

// ─── Tool 5: check_stakeholder_status ────────────────────────────────────────

export async function checkStakeholderStatus(
  workspaceId: string,
  params: Record<string, any>
): Promise<any> {
  const { deal_id, check_all_roles = false, role_filter } = params;

  if (!deal_id) {
    return {
      error: 'deal_id is required',
      query_description: 'check_stakeholder_status: missing deal_id parameter',
    };
  }

  try {
    // Check if LinkedIn API is configured
    const { getLinkedInClient } = await import('../connectors/linkedin/client.js');
    const linkedInClient = getLinkedInClient();

    if (!linkedInClient.isConfigured()) {
      return {
        deal_id,
        contacts: [],
        error: 'LinkedIn API not configured (RAPIDAPI_KEY missing)',
        message: 'LinkedIn stakeholder checking requires RAPIDAPI_KEY environment variable',
        query_description: `check_stakeholder_status for deal ${deal_id}: API not configured`,
      };
    }

    // Verify deal exists and is open
    const dealResult = await query<{ name: string; stage_normalized: string }>(
      `SELECT name, stage_normalized FROM deals WHERE id = $1 AND workspace_id = $2`,
      [deal_id, workspaceId]
    );

    if (dealResult.rows.length === 0) {
      return {
        deal_id,
        error: 'Deal not found',
        query_description: `check_stakeholder_status: deal ${deal_id} not found`,
      };
    }

    const deal = dealResult.rows[0];

    // Only check open deals
    if (deal.stage_normalized === 'closed_won' || deal.stage_normalized === 'closed_lost') {
      return {
        deal_id,
        deal_name: deal.name,
        contacts: [],
        message: 'Stakeholder checking only runs on open deals',
        query_description: `check_stakeholder_status for "${deal.name}": deal is closed, skipping check`,
      };
    }

    // Determine role filter mode
    let roleFilterMode: 'critical_only' | 'business_roles' | 'all' = 'critical_only';
    if (check_all_roles === true) {
      roleFilterMode = 'all';
    } else if (role_filter) {
      roleFilterMode = role_filter;
    }

    // Run stakeholder check with role filtering
    const { getStakeholderChecker } = await import('../connectors/linkedin/stakeholder-checker.js');
    const checker = getStakeholderChecker();

    console.log(`[check_stakeholder_status] Checking stakeholders for deal: ${deal_id} (roleFilter: ${roleFilterMode})`);
    const result = await checker.checkDeal(workspaceId, deal_id, {
      roleFilter: roleFilterMode,
    });

    return {
      deal_id: result.deal_id,
      deal_name: result.deal_name,
      deal_amount: result.deal_amount,
      contacts_checked: result.contacts_checked,
      role_filter_applied: result.role_filter_applied,
      roles_checked_description: result.roles_checked_description,
      contacts: result.contacts.map((c) => ({
        contact_name: c.contact_name,
        role: c.role || 'unknown',
        linkedin_status: c.linkedin_status,
        stored_company: c.stored_company,
        stored_title: c.stored_title,
        current_company: c.current_company,
        current_title: c.current_title,
        current_duration: c.current_duration,
        risk_level: c.risk_level,
        risk_reason: c.risk_reason,
        linkedin_url: c.linkedin_url,
      })),
      risk_summary: result.risk_summary,
      overall_risk: result.overall_risk,
      recommendations: result.recommendations,
      query_description: `check_stakeholder_status for "${deal.name}": ${result.overall_risk} risk, ${result.risk_summary.departed_count} departed, ${result.risk_summary.role_changes} role changes (${result.roles_checked_description})`,
    };
  } catch (err: any) {
    console.error('[check_stakeholder_status] error:', err?.message);
    return {
      deal_id,
      error: err?.message,
      query_description: `check_stakeholder_status failed: ${err?.message}`,
    };
  }
}

// ─── Tool 6: enrich_market_signals ───────────────────────────────────────────

export async function enrichMarketSignals(
  workspaceId: string,
  params: Record<string, any>
): Promise<any> {
  const { account_id, account_name, force_check = false, lookback_months = 3 } = params;

  if (!account_id && !account_name) {
    return {
      error: 'account_id or account_name is required',
      query_description: 'enrich_market_signals: missing account parameter',
    };
  }

  try {
    // Check if Serper API is configured
    const { getMarketSignalsCollector } = await import('../connectors/serper/market-signals.js');
    const collector = getMarketSignalsCollector();

    if (!collector.isConfigured()) {
      return {
        account_id,
        account_name,
        signals: [],
        error: 'Serper API not configured (SERPER_API_KEY missing)',
        message: 'Market signals require SERPER_API_KEY environment variable',
        query_description: 'enrich_market_signals: API not configured',
      };
    }

    // Get account ID if name was provided
    let resolvedAccountId = account_id;
    if (!resolvedAccountId && account_name) {
      const accountResult = await query<{ id: string; name: string }>(
        `SELECT id, name FROM accounts WHERE workspace_id = $1 AND name ILIKE $2 LIMIT 1`,
        [workspaceId, `%${account_name}%`]
      );

      if (accountResult.rows.length === 0) {
        return {
          account_name,
          error: 'Account not found',
          query_description: `enrich_market_signals: account "${account_name}" not found`,
        };
      }

      resolvedAccountId = accountResult.rows[0].id;
    }

    // Fetch market signals
    console.log(`[enrich_market_signals] Fetching signals for account: ${resolvedAccountId}`);
    const result = await collector.getSignalsForAccount(workspaceId, resolvedAccountId, {
      force_check,
      lookback_months,
    });

    // Check if account doesn't qualify (C/D tier without force_check)
    if (!force_check && result.signals.length === 0 && result.icp_tier && !['A', 'B'].includes(result.icp_tier)) {
      return {
        account_id: result.account_id,
        account_name: result.account_name,
        icp_tier: result.icp_tier,
        icp_score: result.icp_score,
        signals: [],
        message: `Market signals only check A/B tier accounts (this account is ${result.icp_tier} tier with ICP score ${result.icp_score}/100). This saves API costs and focuses on high-value accounts. Use force_check=true to override.`,
        suggestion: 'Focus on A/B tier accounts for signal monitoring, or improve ICP fit to auto-qualify.',
        query_description: `enrich_market_signals for "${result.account_name}": ${result.icp_tier} tier, skipped (cost optimization)`,
      };
    }

    // Store signals if any found
    if (result.signals.length > 0) {
      await collector.storeSignals(workspaceId, resolvedAccountId, result.signals);
    }

    return {
      account_id: result.account_id,
      account_name: result.account_name,
      domain: result.domain,
      icp_tier: result.icp_tier,
      icp_score: result.icp_score,
      signals: result.signals.map((s) => ({
        type: s.type,
        headline: s.headline,
        description: s.description,
        date: s.date,
        source: s.source,
        url: s.url,
        relevance: s.relevance,
        buying_trigger: s.buying_trigger,
        priority: s.priority,
      })),
      signal_strength: result.signal_strength,
      strongest_signal: result.strongest_signal
        ? {
            type: result.strongest_signal.type,
            headline: result.strongest_signal.headline,
            priority: result.strongest_signal.priority,
            buying_trigger: result.strongest_signal.buying_trigger,
          }
        : null,
      news_articles_found: result.news_articles_found,
      checked_at: result.checked_at,
      query_description: `enrich_market_signals for "${result.account_name}" (${result.icp_tier} tier): ${result.signal_strength} signals, ${result.signals.length} events detected`,
    };
  } catch (err: any) {
    console.error('[enrich_market_signals] error:', err?.message);
    return {
      account_id,
      account_name,
      error: err?.message,
      query_description: `enrich_market_signals failed: ${err?.message}`,
    };
  }
}
