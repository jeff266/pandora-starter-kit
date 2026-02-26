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

const router = Router({ mergeParams: true });

router.post('/:id/conversations/extract-signals', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.id;
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
    const workspaceId = req.params.id;

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
    const workspaceId = req.params.id;
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
    const workspaceId = req.params.id;
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
    const workspaceId = req.params.id;

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
    const workspaceId = req.params.id;
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
    const workspaceId = req.params.id;

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
    const { id: workspaceId, conversationId } = req.params;
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
    const { id: workspaceId, conversationId } = req.params;
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
 * GET /api/workspaces/:id/conversations
 * Returns all conversations with optional filters
 */
router.get('/:id/conversations', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.id;
    const {
      deal_id,
      account_id,
      rep_email,
      from_date,
      to_date,
      has_deal,
      is_internal,
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

    const limitNum = parseInt(limit as string, 10);
    const offsetNum = parseInt(offset as string, 10);

    const result = await query(
      `SELECT
         c.id,
         c.title,
         c.call_date,
         c.duration_seconds,
         c.rep_email,
         c.account_id,
         c.deal_id,
         c.is_internal,
         c.call_disposition,
         c.engagement_quality,
         c.source_type,
         c.signals_extracted_at,
         a.name as account_name,
         d.name as deal_name,
         d.stage as deal_stage,
         d.amount as deal_amount
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

    res.json({
      conversations: result.rows.map((row: any) => ({
        id: row.id,
        title: row.title || 'Untitled Call',
        call_date: row.call_date ? new Date(row.call_date).toISOString() : null,
        duration_seconds: row.duration_seconds || null,
        rep_email: row.rep_email || null,
        account_id: row.account_id || null,
        account_name: row.account_name || null,
        deal_id: row.deal_id || null,
        deal_name: row.deal_name || null,
        deal_stage: row.deal_stage || null,
        deal_amount: row.deal_amount != null ? Number(row.deal_amount) : null,
        is_internal: row.is_internal || false,
        call_disposition: row.call_disposition || null,
        engagement_quality: row.engagement_quality || null,
        source_type: row.source_type || null,
        signals_extracted: row.signals_extracted_at != null,
      })),
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
 * GET /api/workspaces/:id/conversations/next-action-gaps
 * Returns deals with stale conversations (no follow-up within 3+ days)
 */
router.get('/:id/conversations/next-action-gaps', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.id;
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
    const { id: workspaceId, conversationId } = req.params;
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

export default router;
