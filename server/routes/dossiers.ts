/**
 * Dossier API Routes
 *
 * Layer 2 (composed lookup, near-instant): Cross-table joins assembling
 * everything known about one entity, with optional Claude narrative.
 */

import { Router } from 'express';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { assembleDealDossier } from '../dossiers/deal-dossier.js';
import { assembleAccountDossier } from '../dossiers/account-dossier.js';
import { synthesizeDealNarrative, synthesizeAccountNarrative } from '../dossiers/narrative.js';
import { query } from '../db.js';

const router = Router({ mergeParams: true });

/**
 * GET /api/workspaces/:workspaceId/deals/:dealId/dossier
 *
 * Assembles complete deal dossier from 6+ tables.
 * Optional narrative synthesis via ?narrative=true query param.
 *
 * Target latency: <2s without narrative, <5s with narrative
 */
router.get('/:workspaceId/deals/:dealId/dossier', async (req, res) => {
  const startTime = Date.now();
  try {
    const { workspaceId, dealId } = req.params;
    const includeNarrative = req.query.narrative === 'true' ||
      req.headers['x-include-narrative'] === 'true';

    const dossier = await assembleDealDossier(workspaceId, dealId, { includeNarrative });

    if (includeNarrative) {
      try {
        const narrative = await synthesizeDealNarrative(workspaceId, dossier);
        (dossier as any).narrative = narrative;
      } catch (err) {
        console.error('[Deal Dossier] Narrative synthesis failed:', (err as Error).message);
        (dossier as any).narrative = null;
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[Deal Dossier] ${dealId} assembled in ${duration}ms (narrative: ${includeNarrative})`);

    res.set('Cache-Control', 'private, max-age=300');
    res.json(dossier);
  } catch (err) {
    if ((err as Error).message.includes('not found')) {
      return res.status(404).json({ error: (err as Error).message });
    }
    console.error('[Deal Dossier]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/workspaces/:workspaceId/accounts/:accountId/dossier
 *
 * Assembles complete account dossier with deals, contacts, conversations,
 * relationship health, and findings.
 */
router.get('/:workspaceId/accounts/:accountId/dossier', async (req, res) => {
  const startTime = Date.now();
  try {
    const { workspaceId, accountId } = req.params;
    const includeNarrative = req.query.narrative === 'true' ||
      req.headers['x-include-narrative'] === 'true';

    const dossier = await assembleAccountDossier(workspaceId, accountId, { includeNarrative });

    if (includeNarrative) {
      try {
        const narrative = await synthesizeAccountNarrative(workspaceId, dossier);
        (dossier as any).narrative = narrative;
      } catch (err) {
        console.error('[Account Dossier] Narrative synthesis failed:', (err as Error).message);
        (dossier as any).narrative = null;
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[Account Dossier] ${accountId} assembled in ${duration}ms (narrative: ${includeNarrative})`);

    res.set('Cache-Control', 'private, max-age=300');
    res.json(dossier);
  } catch (err) {
    if ((err as Error).message.includes('not found')) {
      return res.status(404).json({ error: (err as Error).message });
    }
    console.error('[Account Dossier]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/workspaces/:workspaceId/accounts
 *
 * Account list view for Command Center with sorting and filtering.
 */
router.get('/:workspaceId/accounts', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { sort, industry, owner, limit, offset } = req.query;

    let orderBy = 'total_pipeline DESC NULLS LAST';
    switch (sort) {
      case 'name':
        orderBy = 'a.name ASC';
        break;
      case 'findings':
        orderBy = 'finding_count DESC NULLS LAST';
        break;
      case 'activity':
        orderBy = 'last_activity DESC NULLS LAST';
        break;
      case 'deals':
        orderBy = 'deal_count DESC';
        break;
    }

    let whereClause = 'a.workspace_id = $1';
    const params: any[] = [workspaceId];
    let paramIdx = 2;

    if (industry) {
      whereClause += ` AND a.industry = $${paramIdx++}`;
      params.push(industry);
    }
    if (owner) {
      whereClause += ` AND a.owner_email = $${paramIdx++}`;
      params.push(owner);
    }

    const result = await query(
      `SELECT a.id, a.name, a.domain, a.industry, a.owner_email,
              COUNT(DISTINCT d.id) as deal_count,
              COALESCE(SUM(d.amount) FILTER (WHERE d.stage_normalized NOT IN ('closed_won', 'closed_lost')), 0) as total_pipeline,
              COUNT(DISTINCT f.id) as finding_count,
              MAX(COALESCE(c.started_at, c.call_date)) as last_activity
       FROM accounts a
       LEFT JOIN deals d ON d.account_id = a.id AND d.workspace_id = a.workspace_id
       LEFT JOIN findings f ON f.account_id = a.id AND f.resolved_at IS NULL
       LEFT JOIN conversations c ON c.account_id = a.id AND c.workspace_id = a.workspace_id
       WHERE ${whereClause}
       GROUP BY a.id
       ORDER BY ${orderBy}
       LIMIT $${paramIdx++}
       OFFSET $${paramIdx++}`,
      [
        ...params,
        Math.min(parseInt(limit as string) || 50, 200),
        parseInt(offset as string) || 0,
      ]
    );

    res.json({ accounts: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('[Account List]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * GET /api/workspaces/:workspaceId/deals/:dealId/score-history
 *
 * Returns up to 12 weekly deal score snapshots in reverse chronological order.
 */
router.get('/:workspaceId/deals/:dealId/score-history', async (req, res) => {
  try {
    const { workspaceId, dealId } = req.params;

    // Validate workspace exists
    const wsCheck = await query(
      `SELECT id FROM workspaces WHERE id = $1 LIMIT 1`,
      [workspaceId]
    );
    if (wsCheck.rows.length === 0) {
      return res.status(404).json({ error: `Workspace ${workspaceId} not found` });
    }

    // Validate deal exists in workspace
    const dealCheck = await query(
      `SELECT id FROM deals WHERE id = $1 AND workspace_id = $2 LIMIT 1`,
      [dealId, workspaceId]
    );
    if (dealCheck.rows.length === 0) {
      return res.status(404).json({ error: `Deal ${dealId} not found in workspace ${workspaceId}` });
    }

    const result = await query(
      `SELECT snapshot_date, health_score, skill_score, active_score, active_source, grade, score_delta, commentary
       FROM deal_score_snapshots
       WHERE workspace_id = $1 AND deal_id = $2
       ORDER BY snapshot_date DESC
       LIMIT 12`,
      [workspaceId, dealId]
    );

    res.json({ snapshots: result.rows });
  } catch (err) {
    console.error('[Score History]', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
