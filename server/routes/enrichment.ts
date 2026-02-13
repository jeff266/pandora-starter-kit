import { Router, type Request, type Response } from 'express';
import { query } from '../db.js';
import { enrichClosedDeal, enrichClosedDealsInBatch } from '../enrichment/closed-deal-enrichment.js';
import { getContactsForDeal } from '../enrichment/resolve-contact-roles.js';
import { getEnrichmentConfig } from '../enrichment/config.js';

const router = Router();

interface WorkspaceDealParams {
  workspaceId: string;
  dealId: string;
}

interface WorkspaceParams {
  workspaceId: string;
}

router.post('/:workspaceId/enrichment/deal/:dealId', async (req: Request<WorkspaceDealParams>, res: Response) => {
  try {
    const { workspaceId, dealId } = req.params;

    const wsCheck = await query('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
    if (wsCheck.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const dealCheck = await query(
      'SELECT id, name, stage_normalized FROM deals WHERE id = $1 AND workspace_id = $2',
      [dealId, workspaceId]
    );
    if (dealCheck.rows.length === 0) {
      res.status(404).json({ error: 'Deal not found' });
      return;
    }

    const result = await enrichClosedDeal(workspaceId, dealId);
    res.json(result);
  } catch (err: any) {
    console.error('[Enrichment] Error enriching deal:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:workspaceId/enrichment/batch', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const { lookbackMonths, limit } = req.body || {};

    const wsCheck = await query('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
    if (wsCheck.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const config = await getEnrichmentConfig(workspaceId);
    const months = Math.max(1, Math.min(parseInt(lookbackMonths) || config.lookbackMonths, 24));
    const maxDeals = Math.max(1, Math.min(parseInt(limit) || 50, 100));

    const result = await enrichClosedDealsInBatch(workspaceId, months, maxDeals);
    res.json(result);
  } catch (err: any) {
    console.error('[Enrichment] Batch error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:workspaceId/enrichment/status', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;

    const config = await getEnrichmentConfig(workspaceId);

    const stats = await query(`
      SELECT
        COUNT(DISTINCT d.id) FILTER (WHERE d.stage_normalized IN ('closed_won', 'closed_lost')) as total_closed_deals,
        COUNT(DISTINCT dc.deal_id) FILTER (WHERE dc.enrichment_status = 'enriched') as enriched_deals,
        COUNT(DISTINCT dc.deal_id) FILTER (WHERE dc.enrichment_status = 'partial') as partial_deals,
        COUNT(dc.id) as total_deal_contacts,
        COUNT(dc.id) FILTER (WHERE dc.buying_role IS NOT NULL) as roles_resolved,
        COUNT(dc.id) FILTER (WHERE dc.apollo_data IS NOT NULL) as apollo_enriched,
        COUNT(DISTINCT asi.account_id) as accounts_with_signals
      FROM deals d
      LEFT JOIN deal_contacts dc ON dc.deal_id = d.id AND dc.workspace_id = d.workspace_id
      LEFT JOIN account_signals asi ON asi.workspace_id = d.workspace_id
        AND asi.account_id = d.account_id
      WHERE d.workspace_id = $1
    `, [workspaceId]);

    const row = stats.rows[0];

    res.json({
      config: {
        apollo_configured: !!config.apolloApiKey,
        serper_configured: !!config.serperApiKey,
        auto_enrich_on_close: config.autoEnrichOnClose,
        lookback_months: config.lookbackMonths,
        cache_days: config.cacheDays,
      },
      stats: {
        total_closed_deals: parseInt(row.total_closed_deals) || 0,
        enriched_deals: parseInt(row.enriched_deals) || 0,
        partial_deals: parseInt(row.partial_deals) || 0,
        total_deal_contacts: parseInt(row.total_deal_contacts) || 0,
        roles_resolved: parseInt(row.roles_resolved) || 0,
        apollo_enriched: parseInt(row.apollo_enriched) || 0,
        accounts_with_signals: parseInt(row.accounts_with_signals) || 0,
      },
    });
  } catch (err: any) {
    console.error('[Enrichment] Status error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:workspaceId/deals/:dealId/buying-committee', async (req: Request<WorkspaceDealParams>, res: Response) => {
  try {
    const { workspaceId, dealId } = req.params;

    const contacts = await getContactsForDeal(workspaceId, dealId);

    const signalsResult = await query(`
      SELECT asi.signals, asi.signal_summary, asi.signal_score
      FROM account_signals asi
      JOIN deals d ON d.account_id = asi.account_id AND d.workspace_id = asi.workspace_id
      WHERE d.id = $1 AND d.workspace_id = $2
      LIMIT 1
    `, [dealId, workspaceId]);

    const accountSignals = signalsResult.rows[0] || null;

    res.json({
      deal_id: dealId,
      contacts,
      account_signals: accountSignals ? {
        signals: accountSignals.signals,
        summary: accountSignals.signal_summary,
        score: accountSignals.signal_score,
      } : null,
    });
  } catch (err: any) {
    console.error('[Enrichment] Buying committee error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
