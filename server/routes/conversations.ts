/**
 * Conversations API
 *
 * Signal extraction endpoints — backfill, status, and manual re-extraction.
 *
 * Mounted under /api/workspaces (via workspaceApiRouter)
 */

import { Router, type Request, type Response } from 'express';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { extractConversationSignals } from '../conversations/signal-extractor.js';
import { extractConversationSignals as extractStructuredSignals } from '../signals/extract-conversation-signals.js';
import { queryConversationSignals } from '../signals/query-conversation-signals.js';
import { query } from '../db.js';
import { computeFieldsForDeal } from '../computed-fields/engine.js';
import { generateConversationSummary } from '../conversations/summarizer.js';
import { assembleConversationDossier } from '../dossiers/conversation-dossier.js';

const router = Router({ mergeParams: true });

// ============================================================================
// Rate Limiting for Summary Generation
// ============================================================================

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const summarizeRateLimit = new Map<string, RateLimitEntry>();
const RATE_LIMIT_WINDOW_MS = 3600000; // 1 hour
const RATE_LIMIT_MAX = 10;

function checkRateLimit(workspaceId: string): boolean {
  const now = Date.now();
  const entry = summarizeRateLimit.get(workspaceId);

  // Reset if window expired or first request
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    summarizeRateLimit.set(workspaceId, { count: 1, windowStart: now });
    return true;
  }

  // Check limit
  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }

  // Increment count
  entry.count++;
  return true;
}

router.post('/:id/conversations/extract-signals', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const force = req.body.force === true;
    const limit = typeof req.body.limit === 'number' ? req.body.limit : 100;

    const result = await extractConversationSignals(workspaceId, { force, limit });

    res.json({
      ...result,
      message: `${result.extracted} conversations extracted, ${result.skipped} skipped`,
    });
  } catch (err) {
    console.error('[ConversationSignals]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/:id/conversations/signal-status', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId as string;

    const [countRow, statsRow, lastExtractionRow] = await Promise.all([
      query<{
        total: string;
        extracted: string;
        pending: string;
        pricing_count: string;
        competitor_count: string;
        risk_count: string;
      }>(
        `SELECT
           COUNT(*) as total,
           COUNT(*) FILTER (WHERE signals_extracted_at IS NOT NULL) as extracted,
           COUNT(*) FILTER (WHERE signals_extracted_at IS NULL
             AND (summary IS NOT NULL OR transcript_text IS NOT NULL)) as pending,
           COUNT(*) FILTER (WHERE pricing_discussed = TRUE) as pricing_count,
           COUNT(*) FILTER (
             WHERE competitive_context IS NOT NULL
               AND competitive_context != '{}'::jsonb
               AND (competitive_context->>'evaluating_others')::boolean = TRUE
           ) as competitor_count,
           COUNT(*) FILTER (WHERE risk_signals IS NOT NULL AND risk_signals != '[]'::jsonb) as risk_count
         FROM conversations
         WHERE workspace_id = $1
           AND is_internal = FALSE
           AND source_type IS DISTINCT FROM 'consultant'`,
        [workspaceId]
      ),

      query<{ call_disposition: string | null; engagement_quality: string | null; cnt: string }>(
        `SELECT call_disposition, engagement_quality, COUNT(*) as cnt
         FROM conversations
         WHERE workspace_id = $1
           AND signals_extracted_at IS NOT NULL
           AND is_internal = FALSE
         GROUP BY call_disposition, engagement_quality`,
        [workspaceId]
      ),

      query<{ signals_extracted_at: string; signals_extraction_version: string }>(
        `SELECT signals_extracted_at, signals_extraction_version
         FROM conversations
         WHERE workspace_id = $1 AND signals_extracted_at IS NOT NULL
         ORDER BY signals_extracted_at DESC LIMIT 1`,
        [workspaceId]
      ),
    ]);

    const r = countRow.rows[0] || { total: '0', extracted: '0', pending: '0', pricing_count: '0', competitor_count: '0', risk_count: '0' };

    const by_disposition: Record<string, number> = {};
    const by_engagement: Record<string, number> = {};
    for (const row of statsRow.rows) {
      if (row.call_disposition) {
        by_disposition[row.call_disposition] = (by_disposition[row.call_disposition] || 0) + parseInt(row.cnt);
      }
      if (row.engagement_quality) {
        by_engagement[row.engagement_quality] = (by_engagement[row.engagement_quality] || 0) + parseInt(row.cnt);
      }
    }

    res.json({
      total_conversations: parseInt(r.total),
      extracted: parseInt(r.extracted),
      pending: parseInt(r.pending),
      extraction_version: lastExtractionRow.rows[0]?.signals_extraction_version || null,
      last_extraction: lastExtractionRow.rows[0]?.signals_extracted_at || null,
      pricing_discussed_count: parseInt(r.pricing_count),
      competitors_mentioned_count: parseInt(r.competitor_count),
      risk_signals_count: parseInt(r.risk_count),
      by_disposition,
      by_engagement,
    });
  } catch (err) {
    console.error('[ConversationSignalStatus]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================================
// Structured Signals Endpoints (conversation_signals table)
// ============================================================================

/**
 * POST /api/workspaces/:id/signals/extract
 * On-demand extraction of structured signals
 */
router.post('/:id/signals/extract', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const force = req.body.force === true;
    const limit = typeof req.body.limit === 'number' ? req.body.limit : 50;

    const result = await extractStructuredSignals(workspaceId, { force, limit });

    res.json({
      ...result,
      message: `${result.extracted} signals extracted from ${result.processed - result.skipped} conversations, ${result.skipped} skipped`,
    });
  } catch (err) {
    console.error('[ConversationSignals Extract]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/workspaces/:id/signals
 * Query structured signals with filters
 */
router.get('/:id/signals', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const {
      signal_type,
      signal_value,
      deal_id,
      account_id,
      rep_email,
      from_date,
      to_date,
      min_confidence,
      sentiment,
      limit,
      offset,
    } = req.query;

    const result = await queryConversationSignals(workspaceId, {
      signal_type: signal_type as any,
      signal_value: signal_value as string,
      deal_id: deal_id as string,
      account_id: account_id as string,
      rep_email: rep_email as string,
      from_date: from_date as string,
      to_date: to_date as string,
      min_confidence: min_confidence ? parseFloat(min_confidence as string) : undefined,
      sentiment: sentiment as any,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      offset: offset ? parseInt(offset as string, 10) : undefined,
    });

    res.json(result);
  } catch (err) {
    console.error('[ConversationSignals Query]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/workspaces/:id/signals/status
 * Get status of structured signal extraction
 */
router.get('/:id/signals/status', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId as string;

    const [runsResult, signalsResult] = await Promise.all([
      query<{ status: string; count: string }>(
        `SELECT status, COUNT(*) as count
         FROM conversation_signal_runs
         WHERE workspace_id = $1
         GROUP BY status`,
        [workspaceId]
      ),
      query<{ signal_type: string; count: string; avg_confidence: string }>(
        `SELECT signal_type, COUNT(*) as count, AVG(confidence) as avg_confidence
         FROM conversation_signals
         WHERE workspace_id = $1
         GROUP BY signal_type
         ORDER BY count DESC`,
        [workspaceId]
      ),
    ]);

    const statusCounts: Record<string, number> = {};
    for (const row of runsResult.rows) {
      statusCounts[row.status] = parseInt(row.count, 10);
    }

    const signalBreakdown = signalsResult.rows.map(row => ({
      signal_type: row.signal_type,
      count: parseInt(row.count, 10),
      avg_confidence: parseFloat(row.avg_confidence),
    }));

    const totalSignals = signalBreakdown.reduce((sum, s) => sum + s.count, 0);

    res.json({
      runs: {
        success: statusCounts.success || 0,
        skipped: statusCounts.skipped || 0,
        error: statusCounts.error || 0,
        total: Object.values(statusCounts).reduce((sum, n) => sum + n, 0),
      },
      signals: {
        total: totalSignals,
        by_type: signalBreakdown,
      },
    });
  } catch (err) {
    console.error('[ConversationSignals Status]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================================
// CWD (Conversations Without Deals) Endpoints
// ============================================================================

/**
 * GET /api/workspaces/:id/conversations/without-deals
 * Returns conversations linked to accounts but not deals
 */
router.get('/:id/conversations/without-deals', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const { status = 'pending', severity = 'all', limit = '25', offset = '0' } = req.query;

    const { findConversationsWithoutDeals } = await import('../analysis/conversation-without-deals.js');

    const daysBack = 90; // TODO: make configurable
    const result = await findConversationsWithoutDeals(workspaceId, daysBack);

    // Filter by status and severity
    let filtered = result.conversations;

    if (severity !== 'all') {
      filtered = filtered.filter(c => c.severity === severity);
    }

    // Apply pagination
    const start = parseInt(offset as string, 10);
    const end = start + parseInt(limit as string, 10);
    const paginated = filtered.slice(start, end);

    res.json({
      conversations: paginated,
      summary: result.summary,
      pagination: {
        total: filtered.length,
        limit: parseInt(limit as string, 10),
        offset: parseInt(offset as string, 10),
      },
    });
  } catch (err) {
    console.error('[CWD List]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/workspaces/:id/conversations/without-deals/summary
 * Returns aggregate counts
 */
router.get('/:id/conversations/without-deals/summary', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId as string;

    const { findConversationsWithoutDeals } = await import('../analysis/conversation-without-deals.js');

    const result = await findConversationsWithoutDeals(workspaceId, 90);

    // Calculate additional metrics
    const createdThisMonth = result.conversations.filter(c => {
      // Placeholder - would need actual created_deal tracking
      return false;
    }).length;

    const dismissedThisMonth = 0; // TODO: implement dismissal tracking

    res.json({
      total_pending: result.summary.total_cwd,
      high_severity: result.summary.by_severity.high || 0,
      medium_severity: result.summary.by_severity.medium || 0,
      low_severity: result.summary.by_severity.low || 0,
      created_this_month: createdThisMonth,
      dismissed_this_month: dismissedThisMonth,
    });
  } catch (err) {
    console.error('[CWD Summary]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/workspaces/:id/conversations/without-deals/:conversationId/create-deal
 * Creates a deal in CRM from a CWD conversation
 */
router.post('/:id/conversations/without-deals/:conversationId/create-deal', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.id as string;
    const conversationId = req.params.conversationId as string;
    const {
      deal_name,
      amount,
      stage,
      close_date,
      owner_email,
      pipeline_id,
      contacts_to_associate = [],
      contacts_to_create = [],
      notes,
    } = req.body;

    // Get conversation details
    const conversationResult = await query(
      `SELECT * FROM conversations WHERE id = $1 AND workspace_id = $2`,
      [conversationId, workspaceId]
    );

    if (conversationResult.rows.length === 0) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const conversation = conversationResult.rows[0];

    // Determine CRM type
    const { getConnectorCredentials } = await import('../lib/credential-store.js');
    const hubspotCreds = await getConnectorCredentials(workspaceId, 'hubspot');
    const salesforceCreds = await getConnectorCredentials(workspaceId, 'salesforce');

    let dealCrmId: string;
    let dealUrl: string;

    if (hubspotCreds?.accessToken) {
      // Create HubSpot deal
      const { createDealFromCWD } = await import('../crm-writeback/cwd-deal-creator.js');
      const result = await createDealFromCWD({
        workspaceId,
        crmType: 'hubspot',
        dealName: deal_name,
        amount,
        stage,
        closeDate: close_date,
        ownerEmail: owner_email,
        pipelineId: pipeline_id,
        accountId: conversation.account_id,
        contactsToAssociate: contacts_to_associate,
        contactsToCreate: contacts_to_create,
        notes: notes || `Deal created from conversation: ${conversation.title}`,
        conversationId,
      });

      dealCrmId = result.deal_crm_id;
      dealUrl = result.deal_url;
    } else if (salesforceCreds?.accessToken) {
      // Create Salesforce opportunity
      const { createDealFromCWD } = await import('../crm-writeback/cwd-deal-creator.js');
      const result = await createDealFromCWD({
        workspaceId,
        crmType: 'salesforce',
        dealName: deal_name,
        amount,
        stage,
        closeDate: close_date,
        ownerEmail: owner_email,
        accountId: conversation.account_id,
        contactsToAssociate: contacts_to_associate,
        contactsToCreate: contacts_to_create,
        notes: notes || `Opportunity created from conversation: ${conversation.title}`,
        conversationId,
      });

      dealCrmId = result.deal_crm_id;
      dealUrl = result.deal_url;
    } else {
      return res.status(400).json({ error: 'No CRM connected' });
    }

    // Update conversation with deal link
    await query(
      `UPDATE conversations SET deal_id = $1 WHERE id = $2`,
      [dealCrmId, conversationId]
    );

    // Trigger compute to update conversation modifier immediately
    try {
      await computeFieldsForDeal(workspaceId, dealCrmId);
    } catch (err) {
      console.warn('[CWD] Failed to compute fields after conversation link:', err);
    }

    res.json({
      success: true,
      deal_crm_id: dealCrmId,
      deal_url: dealUrl,
      message: 'Deal created successfully',
    });
  } catch (err) {
    console.error('[CWD Create Deal]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/workspaces/:id/conversations/without-deals/:conversationId/dismiss
 * Dismisses a CWD conversation
 */
router.post('/:id/conversations/without-deals/:conversationId/dismiss', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.id as string;
    const conversationId = req.params.conversationId as string;
    const { reason } = req.body;

    // For now, we'll add a flag to the conversation
    // In production, you might want a separate dismissed_cwds table
    await query(
      `UPDATE conversations
       SET custom_data = jsonb_set(
         COALESCE(custom_data, '{}'::jsonb),
         '{cwd_dismissed}',
         'true'::jsonb
       ),
       custom_data = jsonb_set(
         COALESCE(custom_data, '{}'::jsonb),
         '{cwd_dismiss_reason}',
         $2::jsonb
       ),
       custom_data = jsonb_set(
         COALESCE(custom_data, '{}'::jsonb),
         '{cwd_dismissed_at}',
         to_jsonb(NOW()::text)
       )
       WHERE id = $1 AND workspace_id = $3`,
      [conversationId, JSON.stringify(reason || ''), workspaceId]
    );

    res.json({ success: true, message: 'Conversation dismissed' });
  } catch (err) {
    console.error('[CWD Dismiss]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ============================================================================
// General Conversations List Endpoint
// ============================================================================

/**
 * GET /api/workspaces/:workspaceId/conversations/list
 * Returns all conversations with optional filters
 */
router.get('/:workspaceId/conversations/list', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const {
      deal_id,
      account_id,
      rep_email,
      from_date,
      to_date,
      has_deal,
      is_internal,
      search,
      deal_stage,
      deal_owner,
      limit = '50',
      offset = '0',
    } = req.query;

    const params: any[] = [workspaceId];
    const whereConditions: string[] = ['c.workspace_id = $1'];
    let paramIndex = 2;

    if (deal_id) {
      whereConditions.push(`c.deal_id = $${paramIndex}`);
      params.push(deal_id);
      paramIndex++;
    }

    if (account_id) {
      whereConditions.push(`c.account_id = $${paramIndex}`);
      params.push(account_id);
      paramIndex++;
    }

    if (rep_email) {
      whereConditions.push(`c.rep_email = $${paramIndex}`);
      params.push(rep_email);
      paramIndex++;
    }

    if (from_date) {
      whereConditions.push(`c.call_date >= $${paramIndex}`);
      params.push(from_date);
      paramIndex++;
    }

    if (to_date) {
      whereConditions.push(`c.call_date <= $${paramIndex}`);
      params.push(to_date);
      paramIndex++;
    }

    if (has_deal === 'true') {
      whereConditions.push('c.deal_id IS NOT NULL');
    } else if (has_deal === 'false') {
      whereConditions.push('c.deal_id IS NULL');
    }

    if (is_internal === 'true') {
      whereConditions.push('c.is_internal = TRUE');
    } else if (is_internal === 'false') {
      whereConditions.push('c.is_internal = FALSE');
    }

    if (search) {
      whereConditions.push(`c.title ILIKE $${paramIndex}`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (deal_stage) {
      whereConditions.push(`d.stage = $${paramIndex}`);
      params.push(deal_stage);
      paramIndex++;
    }

    if (deal_owner) {
      whereConditions.push(`d.owner = $${paramIndex}`);
      params.push(deal_owner);
      paramIndex++;
    }

    const has_coaching = req.query.has_coaching as string | undefined;
    if (has_coaching === 'true') {
      whereConditions.push(
        `(c.deal_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM win_patterns wp
          WHERE wp.workspace_id = c.workspace_id
            AND wp.superseded_at IS NULL
            AND (wp.segment_size_min IS NULL OR COALESCE(d.amount, 0) >= wp.segment_size_min)
            AND (wp.segment_size_max IS NULL OR COALESCE(d.amount, 0) < wp.segment_size_max)
        ))`
      );
    }

    const limitNum = parseInt(limit as string, 10);
    const offsetNum = parseInt(offset as string, 10);

    console.log('[Conversations] query params:', req.query, 'workspace:', workspaceId);

    const result = await query(
      `SELECT
         c.id,
         c.title,
         c.call_date,
         c.duration_seconds,
         c.participants,
         c.account_id,
         c.deal_id,
         c.source,
         c.custom_fields,
         c.summary,
         (c.transcript_text IS NOT NULL) AS has_transcript,
         (c.deal_id IS NOT NULL AND EXISTS (
           SELECT 1 FROM win_patterns wp
           WHERE wp.workspace_id = c.workspace_id
             AND wp.superseded_at IS NULL
             AND (wp.segment_size_min IS NULL OR COALESCE(d.amount, 0) >= wp.segment_size_min)
             AND (wp.segment_size_max IS NULL OR COALESCE(d.amount, 0) < wp.segment_size_max)
         )) AS has_coaching,
         a.name as account_name,
         d.name as deal_name,
         d.stage as deal_stage,
         d.amount as deal_amount,
         d.owner as deal_owner
       FROM conversations c
       LEFT JOIN accounts a ON a.id = c.account_id AND a.workspace_id = c.workspace_id
       LEFT JOIN deals d ON d.id = c.deal_id AND d.workspace_id = c.workspace_id
       WHERE ${whereConditions.join(' AND ')}
       ORDER BY c.call_date DESC NULLS LAST
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limitNum, offsetNum]
    );

    // Get total count for pagination
    const countResult = await query(
      `SELECT COUNT(*) as total
       FROM conversations c
       WHERE ${whereConditions.join(' AND ')}`,
      params
    );

    console.log('[Conversations] result count:', result.rows.length, 'total:', countResult.rows[0]?.total);

    res.json({
      conversations: result.rows.map((row: any) => {
        // Extract rep email from participants (could be array of objects or strings)
        let rep_email = null;
        if (row.participants && Array.isArray(row.participants)) {
          const participant = row.participants.find((p: any) =>
            typeof p === 'object' ? p.email : p.includes('@')
          );
          rep_email = typeof participant === 'object' ? participant.email : participant;
        }
        // If no participants, try to get from deal owner
        if (!rep_email && row.deal_owner) {
          rep_email = row.deal_owner;
        }

        return {
          id: row.id,
          title: row.title || 'Untitled Call',
          call_date: row.call_date ? new Date(row.call_date).toISOString() : null,
          duration_seconds: row.duration_seconds || null,
          rep_email: rep_email || null,
          account_id: row.account_id || null,
          account_name: row.account_name || null,
          deal_id: row.deal_id || null,
          deal_name: row.deal_name || null,
          deal_stage: row.deal_stage || null,
          deal_owner: row.deal_owner || null,
          deal_amount: row.deal_amount != null ? Number(row.deal_amount) : null,
          is_internal: row.custom_fields?.is_internal || false,
          call_disposition: row.custom_fields?.call_disposition || null,
          engagement_quality: row.custom_fields?.engagement_quality || null,
          source_type: row.source || null,
          signals_extracted: row.summary != null && row.summary.length > 0,
          summary: row.summary || null,
          has_transcript: Boolean(row.has_transcript),
          has_coaching: Boolean(row.has_coaching),
        };
      }),
      pagination: {
        total: parseInt(countResult.rows[0]?.total || '0', 10),
        limit: limitNum,
        offset: offsetNum,
      },
    });
  } catch (err) {
    console.error('[Conversations List]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/workspaces/:workspaceId/conversations/filter-options
 * Returns distinct filter option values (owners, stages) for the filter bar.
 * Used in server-side filter mode when the full dataset isn't loaded into memory.
 */
router.get('/:workspaceId/conversations/filter-options', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId as string;

    const [ownersResult, stagesResult] = await Promise.all([
      query<{ owner: string }>(
        `SELECT DISTINCT d.owner
         FROM conversations c
         JOIN deals d ON d.id = c.deal_id AND d.workspace_id = c.workspace_id
         WHERE c.workspace_id = $1
           AND d.owner IS NOT NULL
           AND ((c.custom_fields->>'is_internal')::boolean = FALSE OR c.custom_fields->>'is_internal' IS NULL)
         ORDER BY d.owner`,
        [workspaceId]
      ),
      query<{ stage: string }>(
        `SELECT DISTINCT d.stage
         FROM conversations c
         JOIN deals d ON d.id = c.deal_id AND d.workspace_id = c.workspace_id
         WHERE c.workspace_id = $1
           AND d.stage IS NOT NULL
           AND ((c.custom_fields->>'is_internal')::boolean = FALSE OR c.custom_fields->>'is_internal' IS NULL)
         ORDER BY d.stage`,
        [workspaceId]
      ),
    ]);

    res.json({
      owners: ownersResult.rows.map(r => r.owner),
      stages: stagesResult.rows.map(r => r.stage),
    });
  } catch (err) {
    console.error('[Conversations Filter Options]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/workspaces/:workspaceId/conversations/coaching-breakdown
 * Returns open pipeline segmented by deal stage × coaching signal type.
 * Signal types: action (lagging), neutral (on track), strength (ahead).
 */
router.get('/:workspaceId/conversations/coaching-breakdown', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const scopeId = req.query.scope_id as string | undefined;

    // Read fiscal year start month from workspace config (defaults to 2 = February)
    let fiscalYearStartMonth = 2;
    try {
      const cfgRes = await query<{ v: string }>(
        `SELECT definitions->'workspace_config'->'cadence'->>'fiscal_year_start_month' AS v
         FROM context_layer WHERE workspace_id = $1 LIMIT 1`,
        [workspaceId]
      );
      const parsed = parseInt(cfgRes.rows[0]?.v ?? '', 10);
      if (!isNaN(parsed) && parsed >= 1 && parsed <= 12) fiscalYearStartMonth = parsed;
    } catch (_) { /* table may not exist in older migrations — fall back to default */ }

    // Build optional scope WHERE clause — filter_values come from admin-configured DB rows, not raw user input
    let scopeWhereClause = '';
    if (scopeId && scopeId !== 'default') {
      try {
        const scopeRes = await query<{ filter_field: string; filter_values: string[] }>(
          `SELECT filter_field, filter_values FROM analysis_scopes WHERE workspace_id = $1 AND scope_id = $2`,
          [workspaceId, scopeId]
        );
        if (scopeRes.rows.length > 0) {
          const { filter_field, filter_values } = scopeRes.rows[0];
          if (filter_field !== '1=1' && filter_values.length > 0) {
            const escaped = filter_values.map(v => `'${v.replace(/'/g, "''")}'`).join(', ');
            // filter_field may be a plain column ('pipeline_id') or JSONB path expression
            const col = filter_field.includes('->') ? filter_field : `d.${filter_field}`;
            scopeWhereClause = `AND ${col} IN (${escaped})`;
          }
        }
      } catch (_) { /* analysis_scopes table missing — ignore scope filter */ }
    }

    // Fetch segment boundaries for deal size classification
    let segLow = 10000;
    let segHigh = 50000;
    try {
      const segResult = await query<{ low_cutoff: string | null; high_cutoff: string | null }>(
        `SELECT PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY amount) AS low_cutoff,
                PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY amount) AS high_cutoff
         FROM deals WHERE workspace_id = $1 AND amount > 0 AND amount IS NOT NULL`,
        [workspaceId]
      );
      const low = parseFloat(segResult.rows[0]?.low_cutoff ?? '');
      const high = parseFloat(segResult.rows[0]?.high_cutoff ?? '');
      if (!isNaN(low) && !isNaN(high) && low > 0 && high > low) { segLow = low; segHigh = high; }
    } catch (_) { /* use defaults */ }

    // Shared CTE: stage-specific velocity signal per open deal with composite health classification.
    // Falls back to legacy global sales_cycle_days signal when no stage benchmark exists.
    const COACHED_DEALS_CTE = `
      WITH coached_deals AS (
        SELECT DISTINCT ON (d.id)
          d.id                                                                    AS deal_id,
          d.stage,
          d.stage_normalized,
          COALESCE(d.amount, 0)                                                   AS amount,
          COALESCE(d.days_in_stage,
            EXTRACT(days FROM NOW() - d.stage_changed_at)::integer, 0)           AS days_in_stage,
          EXTRACT(days FROM NOW() - d.created_at::timestamp)::integer             AS sales_cycle_days,
          CASE
            WHEN COALESCE(d.amount, 0) <= 0 THEN 'all'
            WHEN d.amount < ${segLow} THEN 'smb'
            WHEN d.amount < ${segHigh} THEN 'mid_market'
            ELSE 'enterprise'
          END                                                                     AS segment,
          wp.won_median,
          wp.won_p75,
          wp.direction
        FROM deals d
        JOIN conversations c
          ON c.deal_id = d.id
         AND c.workspace_id = d.workspace_id
         AND c.is_internal = FALSE
        LEFT JOIN win_patterns wp
          ON wp.workspace_id = d.workspace_id
         AND wp.superseded_at IS NULL
         AND (wp.segment_size_min IS NULL OR d.amount >= wp.segment_size_min)
         AND (wp.segment_size_max IS NULL OR d.amount < wp.segment_size_max)
         AND wp.separation_score >= 0.5
        WHERE d.workspace_id = $1
          AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
          ${scopeWhereClause}
        ORDER BY d.id, wp.separation_score DESC
      ),
      signal_typed AS (
        SELECT
          cd.deal_id,
          cd.stage,
          cd.amount,
          cd.days_in_stage,
          cd.sales_cycle_days,
          cd.won_median,
          cd.won_p75,
          CASE
            -- Stage-specific benchmark available (specific segment match)
            WHEN svb_won_seg.median_days IS NOT NULL THEN
              CASE
                WHEN svb_won_seg.is_inverted AND cd.days_in_stage < svb_won_seg.median_days * 0.5
                  THEN 'at_risk'
                WHEN svb_lost_seg.median_days IS NOT NULL AND cd.days_in_stage > svb_lost_seg.median_days
                  THEN 'critical'
                WHEN cd.days_in_stage > svb_won_seg.median_days * 2.0
                  THEN 'at_risk'
                WHEN cd.days_in_stage > svb_won_seg.median_days * 1.2
                  THEN 'watch'
                ELSE 'healthy'
              END
            -- Stage-specific benchmark available ('all' segment fallback)
            WHEN svb_won_all.median_days IS NOT NULL THEN
              CASE
                WHEN svb_won_all.is_inverted AND cd.days_in_stage < svb_won_all.median_days * 0.5
                  THEN 'at_risk'
                WHEN svb_lost_all.median_days IS NOT NULL AND cd.days_in_stage > svb_lost_all.median_days
                  THEN 'critical'
                WHEN cd.days_in_stage > svb_won_all.median_days * 2.0
                  THEN 'at_risk'
                WHEN cd.days_in_stage > svb_won_all.median_days * 1.2
                  THEN 'watch'
                ELSE 'healthy'
              END
            -- No stage benchmark: fall back to legacy global signal, mapped to new category names
            WHEN cd.won_median IS NOT NULL THEN
              CASE
                WHEN cd.direction = 'lower_wins' AND cd.sales_cycle_days > (cd.won_p75 * 2) THEN 'critical'
                WHEN cd.direction = 'lower_wins' AND cd.sales_cycle_days > cd.won_p75        THEN 'at_risk'
                WHEN cd.direction = 'lower_wins' AND cd.sales_cycle_days <= cd.won_median    THEN 'healthy'
                WHEN cd.direction = 'higher_wins' AND cd.sales_cycle_days < cd.won_median    THEN 'critical'
                WHEN cd.direction = 'higher_wins' AND cd.sales_cycle_days >= (cd.won_median * 2) THEN 'healthy'
                ELSE 'watch'
              END
            ELSE 'watch'
          END AS signal_type
        FROM coached_deals cd
        LEFT JOIN stage_velocity_benchmarks svb_won_seg
          ON svb_won_seg.workspace_id = $1
         AND svb_won_seg.stage_normalized = cd.stage_normalized
         AND svb_won_seg.segment = cd.segment
         AND svb_won_seg.outcome = 'won'
         AND svb_won_seg.pipeline = 'all'
        LEFT JOIN stage_velocity_benchmarks svb_lost_seg
          ON svb_lost_seg.workspace_id = $1
         AND svb_lost_seg.stage_normalized = cd.stage_normalized
         AND svb_lost_seg.segment = cd.segment
         AND svb_lost_seg.outcome = 'lost'
         AND svb_lost_seg.pipeline = 'all'
        LEFT JOIN stage_velocity_benchmarks svb_won_all
          ON svb_won_all.workspace_id = $1
         AND svb_won_all.stage_normalized = cd.stage_normalized
         AND svb_won_all.segment = 'all'
         AND svb_won_all.outcome = 'won'
         AND svb_won_all.pipeline = 'all'
        LEFT JOIN stage_velocity_benchmarks svb_lost_all
          ON svb_lost_all.workspace_id = $1
         AND svb_lost_all.stage_normalized = cd.stage_normalized
         AND svb_lost_all.segment = 'all'
         AND svb_lost_all.outcome = 'lost'
         AND svb_lost_all.pipeline = 'all'
      )`;

    const [breakdownResult, convsResult] = await Promise.all([
      query<{ stage: string; signal_type: string; deal_count: string; deal_value: string; display_order: string | null }>(
        `${COACHED_DEALS_CTE}
        SELECT
          st.stage,
          st.signal_type,
          COUNT(*)          AS deal_count,
          SUM(st.amount)    AS deal_value,
          MIN(sc.display_order) AS display_order
        FROM signal_typed st
        LEFT JOIN stage_configs sc ON sc.workspace_id = $1 AND sc.stage_name = st.stage
        GROUP BY st.stage, st.signal_type
        ORDER BY MIN(sc.display_order) ASC NULLS LAST, st.stage, st.signal_type`,
        [workspaceId]
      ),
      query<{ id: string; stage: string; signal_type: string; days_old: string; won_median: string }>(
        `${COACHED_DEALS_CTE}
        SELECT
          c.id,
          st.stage,
          st.signal_type,
          st.days_in_stage AS days_old,
          COALESCE(st.won_median, 0) AS won_median
        FROM signal_typed st
        JOIN conversations c ON c.deal_id = st.deal_id
                             AND c.workspace_id = $1
                             AND c.is_internal = FALSE`,
        [workspaceId]
      ),
    ]);

    const breakdown = breakdownResult.rows.map(r => ({
      stage: r.stage,
      signal_type: r.signal_type,
      deal_count: parseInt(r.deal_count, 10),
      deal_value: parseFloat(r.deal_value),
      display_order: r.display_order !== null ? parseInt(r.display_order, 10) : null,
    }));

    const convSignals = convsResult.rows.map(r => ({
      id: r.id,
      stage: r.stage,
      signal_type: r.signal_type,
      days_old: parseInt(r.days_old, 10),
      won_median: parseFloat(r.won_median),
    }));

    const totalAtRisk = breakdown
      .filter(r => r.signal_type === 'critical' || r.signal_type === 'at_risk')
      .reduce((sum, r) => sum + r.deal_value, 0);

    const totalAtRiskCount = breakdown
      .filter(r => r.signal_type === 'critical' || r.signal_type === 'at_risk')
      .reduce((sum, r) => sum + r.deal_count, 0);

    res.json({
      breakdown,
      conversations: convSignals,
      total_at_risk_value: totalAtRisk,
      total_at_risk_count: totalAtRiskCount,
      fiscal_year_start_month: fiscalYearStartMonth,
    });
  } catch (err) {
    console.error('[Coaching Breakdown]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/workspaces/:workspaceId/conversations/next-action-gaps
 * Returns deals with stale conversations (no follow-up within 3+ days)
 */
router.get('/:workspaceId/conversations/next-action-gaps', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const { min_days = '3' } = req.query;

    const { detectNextActionGaps } = await import('../analysis/next-action-gaps.js');
    const { gaps, summary } = await detectNextActionGaps(workspaceId, parseInt(min_days as string, 10));

    res.json({
      gaps,
      summary,
    });
  } catch (err) {
    console.error('[Next Action Gaps]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/workspaces/:id/conversations/:conversationId/link
 * Link a conversation to a deal or dismiss the link suggestion
 */
router.post('/:id/conversations/:conversationId/link', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.id as string;
    const conversationId = req.params.conversationId as string;
    const { deal_id, link_method = 'manual', action = 'link' } = req.body;

    if (action === 'dismiss') {
      // Dismiss the link suggestion (for CWD workflow)
      await query(
        `UPDATE conversations
         SET custom_data = jsonb_set(
           COALESCE(custom_data, '{}'::jsonb),
           '{link_dismissed}',
           'true'::jsonb
         ),
         custom_data = jsonb_set(
           COALESCE(custom_data, '{}'::jsonb),
           '{link_dismissed_at}',
           to_jsonb(NOW()::text)
         )
         WHERE id = $1 AND workspace_id = $2`,
        [conversationId, workspaceId]
      );

      return res.json({ success: true, message: 'Link suggestion dismissed' });
    }

    if (!deal_id) {
      return res.status(400).json({ error: 'deal_id is required when action is "link"' });
    }

    // Link the conversation to the deal
    await query(
      `UPDATE conversations
       SET deal_id = $1,
           custom_data = jsonb_set(
             COALESCE(custom_data, '{}'::jsonb),
             '{link_method}',
             $2::jsonb
           ),
           custom_data = jsonb_set(
             COALESCE(custom_data, '{}'::jsonb),
             '{linked_at}',
             to_jsonb(NOW()::text)
           )
       WHERE id = $3 AND workspace_id = $4`,
      [deal_id, JSON.stringify(link_method), conversationId, workspaceId]
    );

    res.json({ success: true, message: 'Conversation linked to deal', deal_id });
  } catch (err) {
    console.error('[Link Conversation]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/workspaces/:id/conversations/:conversationId/summarize
 * Generate or regenerate summary for a single conversation
 */
router.post('/:id/conversations/:conversationId/summarize', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.id as string;
    const conversationId = req.params.conversationId as string;
    const force = req.query.force === 'true';

    // 1. Fetch conversation
    const convResult = await query<{
      id: string;
      title: string | null;
      transcript_text: string | null;
      summary: string | null;
      duration_seconds: number | null;
      participants: any;
      deal_id: string | null;
      workspace_id: string;
    }>(
      `SELECT id, title, transcript_text, summary, duration_seconds,
              participants, deal_id, workspace_id
       FROM conversations
       WHERE id = $1 AND workspace_id = $2`,
      [conversationId, workspaceId]
    );

    if (convResult.rows.length === 0) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const conv = convResult.rows[0];

    // 2. Check transcript
    if (!conv.transcript_text || conv.transcript_text.trim().length === 0) {
      return res.status(400).json({ error: 'No transcript available — cannot generate summary' });
    }

    // 3. Check existing summary
    if (conv.summary && !force) {
      return res.json({
        summary: conv.summary,
        regenerated: false,
        deal_updated: false,
      });
    }

    // 4. Rate limit check
    if (!checkRateLimit(workspaceId)) {
      return res.status(429).json({
        error: 'Rate limit exceeded — max 10 summaries per workspace per hour',
      });
    }

    // 5. Generate summary
    console.log(`[Summarize] Generating summary for conversation ${conversationId}`);
    const summary = await generateConversationSummary(workspaceId, {
      id: conv.id,
      title: conv.title,
      transcript_text: conv.transcript_text,
      duration_seconds: conv.duration_seconds,
      participants: conv.participants || [],
    });

    // 6. Write to DB
    await query(
      `UPDATE conversations SET summary = $1, updated_at = NOW() WHERE id = $2`,
      [summary, conversationId]
    );

    console.log(`[Summarize] Summary generated for conversation ${conversationId} (${summary.length} chars)`);

    // 7. Trigger deal score update if linked
    let dealUpdated = false;
    if (conv.deal_id) {
      try {
        await computeFieldsForDeal(workspaceId, conv.deal_id);
        dealUpdated = true;
        console.log(`[Summarize] Triggered compute for deal ${conv.deal_id}`);
      } catch (err) {
        console.warn(`[Summarize] Failed to compute fields for deal ${conv.deal_id}:`, err);
        // Don't fail the request if compute fails
      }
    }

    return res.json({
      summary,
      regenerated: true,
      deal_updated: dealUpdated,
    });
  } catch (err) {
    console.error('[Summarize]', err);
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ============================================================================
// Conversation Dossier — full context for conversation detail page
// ============================================================================

router.get('/:id/conversations/:conversationId/dossier', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.id as string;
    const conversationId = req.params.conversationId as string;

    const dossier = await assembleConversationDossier(workspaceId, conversationId);

    return res.json(dossier);
  } catch (err) {
    console.error('[ConversationDossier]', err);
    const msg = err instanceof Error ? err.message : String(err);

    if (msg.includes('not found')) {
      return res.status(404).json({ error: msg });
    }

    res.status(500).json({ error: 'Failed to load conversation dossier' });
  }
});

// ============================================================================
// Conversation Arc — lightweight timeline for deal pages
// ============================================================================

router.get('/:id/deals/:dealId/conversation-arc', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.id as string;
    const dealId = req.params.dealId as string;

    // Load all conversations for this deal
    const result = await query<{
      id: string;
      title: string;
      started_at: string;
      duration_seconds: number;
      summary: string | null;
      deal_health_before: number | null;
      deal_health_after: number | null;
      resolved_participants: any;
    }>(
      `SELECT id, title, call_date as started_at, duration_seconds, summary,
              deal_health_before, deal_health_after, resolved_participants
       FROM conversations
       WHERE workspace_id = $1 AND deal_id = $2
       ORDER BY call_date ASC`,
      [workspaceId, dealId]
    );

    const arc = result.rows.map(c => {
      const healthBefore = c.deal_health_before;
      const healthAfter = c.deal_health_after;
      const healthDelta = healthBefore !== null && healthAfter !== null
        ? Math.round((healthAfter - healthBefore) * 10) / 10
        : null;

      const resolvedParticipants = c.resolved_participants || [];
      const externalCount = Array.isArray(resolvedParticipants)
        ? resolvedParticipants.filter((p: any) => p.role === 'external' && p.confidence >= 0.7).length
        : 0;

      const summaryOneLiner = c.summary
        ? c.summary.split('.')[0] + (c.summary.includes('.') ? '.' : '')
        : null;

      return {
        id: c.id,
        title: c.title || 'Untitled conversation',
        call_date: (c as any).call_date,
        duration_seconds: c.duration_seconds || 0,
        health_delta: healthDelta,
        participant_count_external: externalCount,
        summary_one_liner: summaryOneLiner,
      };
    });

    return res.json({ arc });
  } catch (err) {
    console.error('[ConversationArc]', err);
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'Failed to load conversation arc' });
  }
});

export default router;
