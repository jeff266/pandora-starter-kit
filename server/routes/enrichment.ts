import { Router, type Request, type Response } from 'express';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { query } from '../db.js';
import { enrichClosedDeal, enrichClosedDealsInBatch, reEnrichExistingDealContacts } from '../enrichment/closed-deal-enrichment.js';
import { getContactsForDeal } from '../enrichment/resolve-contact-roles.js';
import { getEnrichmentConfig } from '../enrichment/config.js';
import { backfillAccountsFromDealContacts } from '../enrichment/apollo-company.js';
import { runApolloEnrichment, getEnrichmentStats } from '../enrichment/apollo-enrichment-service.js';
import { testApolloApiKey } from '../enrichment/apollo-client.js';
import crypto from 'crypto';

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

router.post('/:workspaceId/enrichment/re-enrich', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const { resolveRoles, runApollo, runSerper, apolloLimit, serperLimit } = req.body || {};

    const wsCheck = await query('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
    if (wsCheck.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const result = await reEnrichExistingDealContacts(workspaceId, {
      resolveRoles: resolveRoles !== false,
      runApollo: runApollo !== false,
      runSerper: runSerper !== false,
      apolloLimit: parseInt(apolloLimit) || 500,
      serperLimit: parseInt(serperLimit) || 100,
    });

    res.json(result);
  } catch (err: any) {
    console.error('[Enrichment] Re-enrich error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:workspaceId/enrichment/accounts', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const { closedDealsOnly } = req.body || {};

    const wsCheck = await query('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
    if (wsCheck.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const result = await backfillAccountsFromDealContacts(workspaceId, {
      closedDealsOnly: closedDealsOnly !== false,
    });

    res.json(result);
  } catch (err: any) {
    console.error('[Enrichment] Account enrichment error:', err);
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

// ==========================================
// Apollo Account Enrichment Routes
// ==========================================

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-key-change-in-production-min-32-chars';
const ALGORITHM = 'aes-256-cbc';

function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text: string): string {
  const [ivHex, encryptedHex] = text.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

router.post('/:workspaceId/enrichment/apollo/connect', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const { api_key } = req.body;

    if (!api_key || typeof api_key !== 'string') {
      res.status(400).json({ error: 'API key is required' });
      return;
    }

    const wsCheck = await query('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
    if (wsCheck.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const validationResult = await testApolloApiKey(api_key);
    if (!validationResult.valid) {
      res.status(400).json({ error: validationResult.error || 'Invalid Apollo API key' });
      return;
    }

    const encryptedKey = encrypt(api_key);

    const existing = await query(
      'SELECT id FROM workspace_settings WHERE workspace_id = $1 AND key = $2',
      [workspaceId, 'apollo_api_key']
    );

    if (existing.rows.length > 0) {
      await query(
        'UPDATE workspace_settings SET value = $1, updated_at = NOW() WHERE workspace_id = $2 AND key = $3',
        [encryptedKey, workspaceId, 'apollo_api_key']
      );
    } else {
      await query(
        'INSERT INTO workspace_settings (workspace_id, key, value) VALUES ($1, $2, $3)',
        [workspaceId, 'apollo_api_key', encryptedKey]
      );
    }

    res.json({ success: true, message: 'Apollo API key saved successfully' });
  } catch (err: any) {
    console.error('[Apollo Enrichment] Connect error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:workspaceId/enrichment/apollo/disconnect', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;

    await query(
      'DELETE FROM workspace_settings WHERE workspace_id = $1 AND key = $2',
      [workspaceId, 'apollo_api_key']
    );

    res.json({ success: true, message: 'Apollo API key removed successfully' });
  } catch (err: any) {
    console.error('[Apollo Enrichment] Disconnect error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:workspaceId/enrichment/apollo/run', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;

    const wsCheck = await query('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
    if (wsCheck.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const apiKeyResult = await query(
      'SELECT value FROM workspace_settings WHERE workspace_id = $1 AND key = $2',
      [workspaceId, 'apollo_api_key']
    );

    if (apiKeyResult.rows.length === 0) {
      res.status(400).json({ error: 'Apollo API key not configured. Please connect Apollo first.' });
      return;
    }

    const encryptedKey = apiKeyResult.rows[0].value;
    const apiKey = decrypt(encryptedKey);

    const result = await runApolloEnrichment(workspaceId, apiKey);

    res.json(result);
  } catch (err: any) {
    console.error('[Apollo Enrichment] Run error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:workspaceId/enrichment/apollo/stats', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;

    const wsCheck = await query('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
    if (wsCheck.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const stats = await getEnrichmentStats(workspaceId);

    const apiKeyResult = await query(
      'SELECT value FROM workspace_settings WHERE workspace_id = $1 AND key = $2',
      [workspaceId, 'apollo_api_key']
    );

    res.json({
      ...stats,
      apollo_connected: apiKeyResult.rows.length > 0,
    });
  } catch (err: any) {
    console.error('[Apollo Enrichment] Stats error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:workspaceId/enrichment/enriched-accounts', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const { source, min_confidence, limit, offset } = req.query;

    const wsCheck = await query('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
    if (wsCheck.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const conditions = ['workspace_id = $1'];
    const params: any[] = [workspaceId];
    let paramIndex = 2;

    if (source) {
      conditions.push(`enrichment_source = $${paramIndex}`);
      params.push(source);
      paramIndex++;
    }

    if (min_confidence) {
      const minConf = parseFloat(min_confidence as string);
      if (!isNaN(minConf)) {
        conditions.push(`confidence_score >= $${paramIndex}`);
        params.push(minConf);
        paramIndex++;
      }
    }

    const whereClause = conditions.join(' AND ');
    const limitValue = Math.min(Math.max(parseInt(limit as string) || 50, 1), 500);
    const offsetValue = Math.max(parseInt(offset as string) || 0, 0);

    const countResult = await query(
      `SELECT COUNT(*) as count FROM enriched_accounts WHERE ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const dataResult = await query(
      `SELECT * FROM enriched_accounts WHERE ${whereClause} ORDER BY enriched_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limitValue, offsetValue]
    );

    res.json({
      accounts: dataResult.rows,
      total,
      limit: limitValue,
      offset: offsetValue,
    });
  } catch (err: any) {
    console.error('[Apollo Enrichment] List accounts error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
