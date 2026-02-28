import { Router, type Request, type Response } from 'express';
import { requirePermission, requireAnyPermission } from '../middleware/permissions.js';
import { query } from '../db.js';
import { getSalesRoster } from '../connectors/shared/tracked-users.js';

const router = Router();

interface WorkspaceParams {
  workspaceId: string;
}

interface RepNameParams extends WorkspaceParams {
  repName: string;
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

// Get all deal owners with rep status
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

// Update rep status
router.put('/:workspaceId/sales-reps/:repName', async (req: Request<RepNameParams>, res: Response) => {
  try {
    const { workspaceId, repName } = req.params;
    const { is_rep, org_role_id, quota_eligible, rep_email, hire_date, team, notes } = req.body;

    const result = await query(
      `INSERT INTO sales_reps (
        workspace_id, rep_name, is_rep, org_role_id, quota_eligible,
        rep_email, hire_date, team, notes, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      ON CONFLICT (workspace_id, rep_name)
      DO UPDATE SET
        is_rep = COALESCE($3, sales_reps.is_rep),
        org_role_id = COALESCE($4, sales_reps.org_role_id),
        quota_eligible = COALESCE($5, sales_reps.quota_eligible),
        rep_email = COALESCE($6, sales_reps.rep_email),
        hire_date = COALESCE($7, sales_reps.hire_date),
        team = COALESCE($8, sales_reps.team),
        notes = COALESCE($9, sales_reps.notes),
        updated_at = NOW()
      RETURNING *`,
      [workspaceId, repName, is_rep, org_role_id, quota_eligible, rep_email, hire_date, team, notes]
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
