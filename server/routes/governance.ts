/**
 * Governance API Routes
 *
 * Admin-facing endpoints for reviewing, approving, rejecting,
 * and rolling back autonomously proposed changes.
 */

import express from 'express';
import { query } from '../db.js';
import { getGovernanceRecord, updateStatus } from '../governance/db.js';
import { applyChange } from '../governance/rollback-engine.js';
import { rollbackChange } from '../governance/rollback-engine.js';
import { compareBeforeAfter } from '../governance/comparison-engine.js';
import { updateComparison } from '../governance/db.js';

const router = express.Router();

const SLIM_FIELDS = `
  id, status, change_type, change_description,
  explanation_summary, explanation_impact,
  review_score, review_recommendation, review_concerns,
  comparison_improvement_score,
  deployed_at, trial_expires_at, monitoring_verdict,
  rolled_back_at, created_at, source_type, source_feedback_ids
`;

/**
 * GET /:workspaceId/governance/summary
 * Aggregate counts of governance records by status
 */
router.get('/:workspaceId/governance/summary', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const result = await query(
      `SELECT status, COUNT(*)::int as count 
       FROM skill_governance 
       WHERE workspace_id = $1 
       GROUP BY status`,
      [workspaceId]
    );

    const counts: Record<string, number> = {
      pending_approval: 0,
      deployed: 0,
      monitoring: 0,
      stable: 0,
      rejected: 0,
      rolled_back: 0,
      total: 0
    };

    let total = 0;
    result.rows.forEach(row => {
      if (row.status in counts) {
        counts[row.status] = row.count;
      }
      total += row.count;
    });
    counts.total = total;

    res.json(counts);
  } catch (err) {
    console.error('[Governance] Summary failed:', err);
    res.status(500).json({ error: 'Failed to fetch governance summary' });
  }
});

/**
 * GET /:workspaceId/governance
 * List governance records (default: pending_approval)
 */
router.get('/:workspaceId/governance', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const statusFilter = req.query.status as string || 'pending_approval';

    let whereClause = 'workspace_id = $1';
    const params: any[] = [workspaceId];

    if (statusFilter !== 'all') {
      whereClause += ' AND status = $2';
      params.push(statusFilter);
    }

    const result = await query(
      `SELECT ${SLIM_FIELDS}
       FROM skill_governance
       WHERE ${whereClause}
       ORDER BY created_at DESC
       LIMIT 100`,
      params
    );

    res.json({ records: result.rows, total: result.rows.length });
  } catch (err) {
    console.error('[Governance] List failed:', err);
    res.status(500).json({ error: 'Failed to list governance records' });
  }
});

/**
 * GET /:workspaceId/governance/history
 * All records that have been deployed (audit trail)
 */
router.get('/:workspaceId/governance/history', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const result = await query(
      `SELECT ${SLIM_FIELDS}
       FROM skill_governance
       WHERE workspace_id = $1
         AND deployed_at IS NOT NULL
       ORDER BY deployed_at DESC
       LIMIT 100`,
      [workspaceId]
    );
    res.json({ records: result.rows });
  } catch (err) {
    console.error('[Governance] History failed:', err);
    res.status(500).json({ error: 'Failed to fetch governance history' });
  }
});

/**
 * GET /:workspaceId/governance/:governanceId
 * Full record including all JSONB sub-results
 */
router.get('/:workspaceId/governance/:governanceId', async (req, res) => {
  try {
    const { workspaceId, governanceId } = req.params;
    const record = await getGovernanceRecord(governanceId);

    if (!record || record.workspace_id !== workspaceId) {
      return res.status(404).json({ error: 'Governance record not found' });
    }

    res.json(record);
  } catch (err) {
    console.error('[Governance] Get failed:', err);
    res.status(500).json({ error: 'Failed to fetch governance record' });
  }
});

/**
 * POST /:workspaceId/governance/:governanceId/approve
 * Deploy a pending change
 */
router.post('/:workspaceId/governance/:governanceId/approve', async (req, res) => {
  try {
    const { workspaceId, governanceId } = req.params;
    const { approved_by } = req.body;

    if (!approved_by) {
      return res.status(400).json({ error: 'approved_by is required' });
    }

    const record = await getGovernanceRecord(governanceId);
    if (!record || record.workspace_id !== workspaceId) {
      return res.status(404).json({ error: 'Governance record not found' });
    }
    if (record.status !== 'pending_approval') {
      return res.status(400).json({ error: `Cannot approve — status is "${record.status}"` });
    }

    // Capture pre-deploy feedback stats
    const beforeStats = await query(
      `SELECT
         COUNT(*) FILTER (WHERE signal = 'thumbs_down') as thumbs_down,
         COUNT(*) FILTER (WHERE signal = 'thumbs_up') as thumbs_up,
         COUNT(*) FILTER (WHERE signal = 'repeated_question') as repeats,
         COUNT(*) as total
       FROM agent_feedback
       WHERE workspace_id = $1
         AND created_at > NOW() - INTERVAL '7 days'`,
      [workspaceId]
    );

    // Apply the change
    await applyChange(workspaceId, record);

    // Update governance record to monitoring state
    const trialExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await query(
      `UPDATE skill_governance
       SET status = 'monitoring',
           deployed_at = NOW(),
           deployed_by = $2,
           trial_expires_at = $3,
           monitoring_start = NOW(),
           monitoring_feedback_before = $4::jsonb,
           status_history = status_history || $5::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [
        governanceId,
        approved_by,
        trialExpires,
        JSON.stringify(beforeStats.rows[0]),
        JSON.stringify([{
          status: 'monitoring',
          timestamp: new Date().toISOString(),
          actor: approved_by,
          reason: 'Approved by admin',
        }]),
      ]
    );

    res.json({
      deployed: true,
      trial_expires: trialExpires.toISOString(),
      message: `Change deployed. It will be monitored for 7 days and can be rolled back at any time.`,
    });
  } catch (err) {
    console.error('[Governance] Approve failed:', err);
    res.status(500).json({ error: 'Failed to approve governance record' });
  }
});

/**
 * POST /:workspaceId/governance/:governanceId/reject
 * Reject a pending change
 */
router.post('/:workspaceId/governance/:governanceId/reject', async (req, res) => {
  try {
    const { workspaceId, governanceId } = req.params;
    const { rejected_by, reason } = req.body;

    const record = await getGovernanceRecord(governanceId);
    if (!record || record.workspace_id !== workspaceId) {
      return res.status(404).json({ error: 'Governance record not found' });
    }
    if (!['pending_approval', 'reviewed', 'validated'].includes(record.status)) {
      return res.status(400).json({ error: `Cannot reject — status is "${record.status}"` });
    }

    await updateStatus(governanceId, 'rejected', rejected_by || 'admin', reason || 'Rejected by admin');
    res.json({ rejected: true });
  } catch (err) {
    console.error('[Governance] Reject failed:', err);
    res.status(500).json({ error: 'Failed to reject governance record' });
  }
});

/**
 * POST /:workspaceId/governance/:governanceId/rollback
 * Roll back a deployed change
 */
router.post('/:workspaceId/governance/:governanceId/rollback', async (req, res) => {
  try {
    const { workspaceId, governanceId } = req.params;
    const { rolled_back_by, reason } = req.body;

    const result = await rollbackChange(
      workspaceId,
      governanceId,
      rolled_back_by || 'admin',
      reason || 'Rolled back by admin'
    );

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({ rolled_back: true, restored: result.restored });
  } catch (err) {
    console.error('[Governance] Rollback failed:', err);
    res.status(500).json({ error: 'Failed to rollback governance record' });
  }
});

/**
 * DELETE /:workspaceId/governance/:governanceId
 * Delete a governance record (only if not deployed)
 */
router.delete('/:workspaceId/governance/:governanceId', async (req, res) => {
  try {
    const { workspaceId, governanceId } = req.params;

    const record = await getGovernanceRecord(governanceId);
    if (!record || record.workspace_id !== workspaceId) {
      return res.status(404).json({ error: 'Governance record not found' });
    }
    if (!['proposed', 'rejected', 'rolled_back', 'validating', 'validated', 'reviewing', 'reviewed'].includes(record.status)) {
      return res.status(400).json({ error: `Cannot delete record with status "${record.status}" — rollback first` });
    }

    await query(`DELETE FROM skill_governance WHERE id = $1`, [governanceId]);
    res.json({ deleted: true });
  } catch (err) {
    console.error('[Governance] Delete failed:', err);
    res.status(500).json({ error: 'Failed to delete governance record' });
  }
});

/**
 * POST /:workspaceId/governance/:governanceId/recompare
 * Re-run comparison for a pending change
 */
router.post('/:workspaceId/governance/:governanceId/recompare', async (req, res) => {
  try {
    const { workspaceId, governanceId } = req.params;

    const record = await getGovernanceRecord(governanceId);
    if (!record || record.workspace_id !== workspaceId) {
      return res.status(404).json({ error: 'Governance record not found' });
    }

    const comparison = await compareBeforeAfter(workspaceId, record);
    await updateComparison(governanceId, comparison);

    res.json({ comparison, updated: true });
  } catch (err) {
    console.error('[Governance] Recompare failed:', err);
    res.status(500).json({ error: 'Failed to recompare governance record' });
  }
});

export default router;
