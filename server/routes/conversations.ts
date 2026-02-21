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
import { query } from '../db.js';

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

export default router;
