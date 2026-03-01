import { Router, type Request, type Response } from 'express';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { query } from '../db.js';
import { getSalesRoster } from '../connectors/shared/tracked-users.js';

const router = Router();

const VALID_PANDORA_ROLES = ['cro', 'manager', 'ae', 'revops', 'admin', null];

const JUNK_REP_FILTER = `
  AND sr.rep_name NOT LIKE '%@%'
  AND sr.rep_name !~ '^[0-9]+$'
  AND sr.rep_name NOT IN ('Render Shared', 'GrowthX RevOps', 'sfdc-legacy-connections')
`;

interface WorkspaceParams {
  workspaceId: string;
}

interface RepNameParams extends WorkspaceParams {
  repName: string;
}

interface RepIdParams extends WorkspaceParams {
  repId: string;
}

// Legacy: Get tracked users from Gong/Fireflies
router.get('/:workspaceId/sales-roster', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const workspaceId = req.params.workspaceId;

    const wsCheck = await query('SELECT id FROM workspaces WHERE id = $1', [workspaceId]);
    if (wsCheck.rows.length === 0) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const roster = await getSalesRoster(workspaceId);
    res.json(roster);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Sales Roster] Error:', message);
    res.status(500).json({ error: message });
  }
});

// Get all deal owners with rep status (via view — legacy)
router.get('/:workspaceId/sales-reps', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const { is_rep, org_role } = req.query;

    let filterClause = '';
    const params: any[] = [workspaceId];
    let paramCount = 1;

    if (is_rep === 'true') {
      paramCount++;
      filterClause += ` AND is_rep = $${paramCount}`;
      params.push(true);
    } else if (is_rep === 'false') {
      paramCount++;
      filterClause += ` AND is_rep = $${paramCount}`;
      params.push(false);
    }

    if (org_role) {
      paramCount++;
      filterClause += ` AND org_role = $${paramCount}`;
      params.push(org_role);
    }

    const result = await query(
      `SELECT
        workspace_id,
        rep_name,
        sales_rep_id,
        is_rep,
        quota_eligible,
        org_role_id,
        org_role,
        rep_email,
        hire_date,
        team,
        open_deal_count,
        total_deal_count,
        last_activity
       FROM v_deal_owners_with_rep_status
       WHERE workspace_id = $1 ${filterClause}
       ORDER BY rep_name`,
      params
    );

    res.json({ reps: result.rows, total: result.rows.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Sales Reps] Error:', message);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /:workspaceId/sales-reps/roster
 * Full roster from sales_reps table with claim/invite status.
 * Used by Settings → Sales Roster tab, Members page stubs, and Targets assignment dropdown.
 */
router.get('/:workspaceId/sales-reps/roster', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;

    const result = await query(
      `SELECT
        sr.id,
        sr.workspace_id,
        sr.rep_name,
        sr.rep_email,
        sr.team,
        sr.pandora_role,
        sr.pandora_user_id,
        sr.quota_eligible,
        sr.is_manager,
        sr.org_role_id,
        sr.hire_date,
        sr.notes,
        sr.created_at,
        sr.updated_at,
        wm.status AS member_status,
        wm.id AS member_id,
        CASE
          WHEN sr.pandora_user_id IS NOT NULL AND wm.status = 'active' THEN true
          WHEN wm.status = 'active' THEN true
          ELSE false
        END AS claimed,
        CASE
          WHEN wm.status = 'pending' THEN true
          ELSE false
        END AS invited
       FROM sales_reps sr
       LEFT JOIN workspace_members wm
         ON wm.workspace_id = sr.workspace_id
         AND (
           (sr.pandora_user_id IS NOT NULL AND wm.user_id = sr.pandora_user_id)
           OR (sr.rep_email IS NOT NULL AND EXISTS (
             SELECT 1 FROM users u WHERE u.id = wm.user_id AND u.email = sr.rep_email
           ))
         )
       WHERE sr.workspace_id = $1
         AND sr.is_rep = true
         ${JUNK_REP_FILTER}
       ORDER BY sr.rep_name`,
      [workspaceId]
    );

    res.json({ reps: result.rows, total: result.rows.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Sales Roster] Error:', message);
    res.status(500).json({ error: message });
  }
});

/**
 * POST /:workspaceId/sales-reps
 * Create a new roster entry.
 */
router.post('/:workspaceId/sales-reps', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const { rep_name, rep_email, team, pandora_role, quota_eligible } = req.body;

    if (!rep_name || typeof rep_name !== 'string' || rep_name.trim() === '') {
      res.status(400).json({ error: 'rep_name is required' });
      return;
    }

    const cleanName = rep_name.trim();

    if (cleanName.includes('@') || /^\d+$/.test(cleanName)) {
      res.status(400).json({ error: 'rep_name must be a person\'s name, not an email or ID' });
      return;
    }

    if (pandora_role !== undefined && !VALID_PANDORA_ROLES.includes(pandora_role)) {
      res.status(400).json({ error: 'Invalid pandora_role' });
      return;
    }

    const result = await query(
      `INSERT INTO sales_reps (workspace_id, rep_name, rep_email, team, pandora_role, quota_eligible, is_rep)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       ON CONFLICT (workspace_id, rep_name)
       DO UPDATE SET
         rep_email = COALESCE($3, sales_reps.rep_email),
         team = COALESCE($4, sales_reps.team),
         pandora_role = COALESCE($5, sales_reps.pandora_role),
         quota_eligible = COALESCE($6, sales_reps.quota_eligible),
         updated_at = NOW()
       RETURNING *`,
      [workspaceId, cleanName, rep_email || null, team || null, pandora_role || null, quota_eligible !== false]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Sales Reps] Create error:', message);
    res.status(500).json({ error: message });
  }
});

/**
 * DELETE /:workspaceId/sales-reps/:repId
 * Remove a roster entry by UUID primary key.
 */
router.delete('/:workspaceId/sales-reps/:repId', async (req: Request<RepIdParams>, res: Response) => {
  try {
    const { workspaceId, repId } = req.params;

    const result = await query(
      `DELETE FROM sales_reps WHERE id = $1 AND workspace_id = $2 RETURNING id`,
      [repId, workspaceId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Rep not found' });
      return;
    }

    res.json({ ok: true, deleted_id: repId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Sales Reps] Delete error:', message);
    res.status(500).json({ error: message });
  }
});

/**
 * PATCH /:workspaceId/sales-reps/:repId/pandora-role
 * Update the pandora_role on a roster entry.
 */
router.patch('/:workspaceId/sales-reps/:repId/pandora-role', async (req: Request<RepIdParams>, res: Response) => {
  try {
    const { workspaceId, repId } = req.params;
    const { pandora_role } = req.body as { pandora_role: string | null };

    if (!VALID_PANDORA_ROLES.includes(pandora_role)) {
      res.status(400).json({ error: 'Invalid pandora_role' });
      return;
    }

    const result = await query(
      `UPDATE sales_reps SET pandora_role = $1, updated_at = NOW()
       WHERE id = $2 AND workspace_id = $3
       RETURNING id, rep_name, pandora_role`,
      [pandora_role, repId, workspaceId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Rep not found' });
      return;
    }

    res.json({ ok: true, ...result.rows[0] });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Sales Reps] Pandora role update error:', message);
    res.status(500).json({ error: message });
  }
});

// Update rep status (legacy — by rep_name)
router.put('/:workspaceId/sales-reps/:repName', async (req: Request<RepNameParams>, res: Response) => {
  try {
    const { workspaceId, repName } = req.params;
    const { is_rep, org_role_id, quota_eligible, rep_email, hire_date, team, notes, pandora_role } = req.body;

    const result = await query(
      `INSERT INTO sales_reps (
        workspace_id, rep_name, is_rep, org_role_id, quota_eligible,
        rep_email, hire_date, team, notes, pandora_role, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      ON CONFLICT (workspace_id, rep_name)
      DO UPDATE SET
        is_rep = COALESCE($3, sales_reps.is_rep),
        org_role_id = COALESCE($4, sales_reps.org_role_id),
        quota_eligible = COALESCE($5, sales_reps.quota_eligible),
        rep_email = COALESCE($6, sales_reps.rep_email),
        hire_date = COALESCE($7, sales_reps.hire_date),
        team = COALESCE($8, sales_reps.team),
        notes = COALESCE($9, sales_reps.notes),
        pandora_role = COALESCE($10, sales_reps.pandora_role),
        updated_at = NOW()
      RETURNING *`,
      [workspaceId, repName, is_rep, org_role_id, quota_eligible, rep_email, hire_date, team, notes, pandora_role || null]
    );

    res.json(result.rows[0]);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Update Sales Rep] Error:', message);
    res.status(500).json({ error: message });
  }
});

// Get org roles for workspace
router.get('/:workspaceId/org-roles', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;

    const result = await query(
      `SELECT id, role_name, display_order, is_active, is_default
       FROM org_roles
       WHERE workspace_id = $1 AND is_active = true
       ORDER BY display_order, role_name`,
      [workspaceId]
    );

    res.json({ roles: result.rows, total: result.rows.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Org Roles] Error:', message);
    res.status(500).json({ error: message });
  }
});

// Create custom org role
router.post('/:workspaceId/org-roles', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const { role_name, display_order } = req.body;

    if (!role_name || role_name.trim() === '') {
      res.status(400).json({ error: 'role_name is required' });
      return;
    }

    const result = await query(
      `INSERT INTO org_roles (workspace_id, role_name, display_order, is_default, is_active)
       VALUES ($1, $2, $3, false, true)
       ON CONFLICT (workspace_id, role_name) DO NOTHING
       RETURNING *`,
      [workspaceId, role_name.trim(), display_order || 100]
    );

    if (result.rows.length === 0) {
      res.status(409).json({ error: 'Role already exists' });
      return;
    }

    res.status(201).json(result.rows[0]);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Create Org Role] Error:', message);
    res.status(500).json({ error: message });
  }
});

export default router;
