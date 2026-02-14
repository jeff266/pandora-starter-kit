/**
 * Instant Audit - First-Run Experience
 *
 * After first sync + inference, auto-run four skills in parallel to give
 * the user immediate value and demonstrate that Pandora understands their pipeline.
 */

import { query } from '../db.js';

interface InstantAuditResult {
  skill_id: string;
  success: boolean;
  data?: any;
  error?: string;
}

interface InstantAuditSummary {
  completed_at: string;
  elapsed_ms: number;
  results: Record<string, InstantAuditResult>;
  findings_count: number;
  top_finding: string;
}

/**
 * Trigger instant audit for first-time workspace
 */
export async function triggerInstantAudit(workspaceId: string): Promise<void> {
  // Check if instant audit has already run for this workspace
  const auditRan = await query(
    `SELECT 1 FROM context_layer
     WHERE workspace_id = $1 AND category = 'settings' AND key = 'instant_audit_complete'`,
    [workspaceId]
  );

  if (auditRan.rows[0]) {
    console.log(`[Instant Audit] Already completed for workspace ${workspaceId}`);
    return;
  }

  console.log(`[Instant Audit] Starting for workspace ${workspaceId}`);
  const startTime = Date.now();

  // Run 4 skills in parallel
  const skills = [
    'pipeline-hygiene',
    'data-quality-audit',
    'single-thread-alert',
    'pipeline-coverage',
  ];

  const results = await Promise.allSettled(
    skills.map(skillId => runSkillForInstantAudit(workspaceId, skillId))
  );

  // Collect results
  const auditResults: Record<string, InstantAuditResult> = {};
  for (let i = 0; i < skills.length; i++) {
    const result = results[i];
    auditResults[skills[i]] = result.status === 'fulfilled'
      ? { skill_id: skills[i], success: true, data: result.value }
      : { skill_id: skills[i], success: false, error: (result.reason as Error)?.message };
  }

  const elapsed = Date.now() - startTime;
  console.log(`[Instant Audit] Complete in ${elapsed}ms`);

  // Count findings
  const findingsCount = countFindings(auditResults);
  const topFinding = extractTopFinding(auditResults);

  const summary: InstantAuditSummary = {
    completed_at: new Date().toISOString(),
    elapsed_ms: elapsed,
    results: auditResults,
    findings_count: findingsCount,
    top_finding: topFinding,
  };

  // Mark as complete
  await query(
    `INSERT INTO context_layer (workspace_id, category, key, value, updated_at)
     VALUES ($1, 'settings', 'instant_audit_complete', $2::jsonb, NOW())`,
    [workspaceId, JSON.stringify(summary)]
  );

  console.log(`[Instant Audit] Stored results: ${findingsCount} findings`);
}

/**
 * Run a skill for instant audit (simplified - no full skill runner needed)
 */
async function runSkillForInstantAudit(workspaceId: string, skillId: string): Promise<any> {
  // For now, return mock data structure
  // In production, this would call the actual skill runner
  // TODO: Wire to actual skill execution when skill runner is available

  console.log(`[Instant Audit] Running skill: ${skillId}`);

  switch (skillId) {
    case 'pipeline-hygiene':
      return await mockPipelineHygiene(workspaceId);
    case 'data-quality-audit':
      return await mockDataQualityAudit(workspaceId);
    case 'single-thread-alert':
      return await mockSingleThreadAlert(workspaceId);
    case 'pipeline-coverage':
      return await mockPipelineCoverage(workspaceId);
    default:
      throw new Error(`Unknown skill: ${skillId}`);
  }
}

/**
 * Mock implementations - replace with actual skill calls
 */
async function mockPipelineHygiene(workspaceId: string) {
  const result = await query<{ stale_count: number; stale_value: number }>(
    `SELECT
      COUNT(*) FILTER (WHERE last_activity_date < NOW() - INTERVAL '14 days') as stale_count,
      COALESCE(SUM(amount) FILTER (WHERE last_activity_date < NOW() - INTERVAL '14 days'), 0) as stale_value
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized NOT IN ('closed_won', 'closed_lost')`,
    [workspaceId]
  );

  return {
    stale_deals: result.rows[0]?.stale_count || 0,
    stale_value: result.rows[0]?.stale_value || 0,
  };
}

async function mockDataQualityAudit(workspaceId: string) {
  const result = await query<{ missing_count: number }>(
    `SELECT
      COUNT(*) FILTER (WHERE amount IS NULL OR amount = 0) +
      COUNT(*) FILTER (WHERE close_date IS NULL) as missing_count
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized NOT IN ('closed_won', 'closed_lost')`,
    [workspaceId]
  );

  return {
    data_quality_issues: result.rows[0]?.missing_count || 0,
  };
}

async function mockSingleThreadAlert(workspaceId: string) {
  const result = await query<{ single_threaded: number }>(
    `SELECT COUNT(DISTINCT d.id) as single_threaded
     FROM deals d
     LEFT JOIN contact_roles cr ON cr.deal_id = d.id AND cr.workspace_id = d.workspace_id
     WHERE d.workspace_id = $1
       AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
     GROUP BY d.id
     HAVING COUNT(cr.id) < 2`,
    [workspaceId]
  );

  return {
    single_threaded_deals: result.rows.length,
  };
}

async function mockPipelineCoverage(workspaceId: string) {
  const result = await query<{
    open_pipeline: number;
    quota: number;
  }>(
    `SELECT
      COALESCE(SUM(d.amount), 0) as open_pipeline,
      (SELECT COALESCE(SUM(rq.quota_amount), 0)
       FROM rep_quotas rq
       JOIN quota_periods qp ON qp.id = rq.period_id
       WHERE qp.workspace_id = $1
         AND qp.period_start <= NOW()
         AND qp.period_end >= NOW()) as quota
     FROM deals d
     WHERE d.workspace_id = $1
       AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')`,
    [workspaceId]
  );

  const row = result.rows[0];
  const coverage = row?.quota > 0 ? row.open_pipeline / row.quota : 0;

  return {
    coverage_ratio: coverage,
    open_pipeline: row?.open_pipeline || 0,
    quota: row?.quota || 0,
  };
}

/**
 * Count total findings across all skills
 */
function countFindings(results: Record<string, InstantAuditResult>): number {
  let count = 0;

  for (const [skillId, result] of Object.entries(results)) {
    if (!result.success || !result.data) continue;

    switch (skillId) {
      case 'pipeline-hygiene':
        count += result.data.stale_deals || 0;
        break;
      case 'data-quality-audit':
        count += result.data.data_quality_issues || 0;
        break;
      case 'single-thread-alert':
        count += result.data.single_threaded_deals || 0;
        break;
      case 'pipeline-coverage':
        if (result.data.coverage_ratio < 3.0) count += 1;
        break;
    }
  }

  return count;
}

/**
 * Extract the most impactful finding
 */
function extractTopFinding(results: Record<string, InstantAuditResult>): string {
  const hygiene = results['pipeline-hygiene'];
  const quality = results['data-quality-audit'];
  const threading = results['single-thread-alert'];
  const coverage = results['pipeline-coverage'];

  // Find highest-value issue
  const findings: { type: string; value: number; message: string }[] = [];

  if (hygiene?.success && hygiene.data?.stale_value > 0) {
    findings.push({
      type: 'stale',
      value: hygiene.data.stale_value,
      message: `$${Math.round(hygiene.data.stale_value).toLocaleString()} in ${hygiene.data.stale_deals} stale deals`,
    });
  }

  if (quality?.success && quality.data?.data_quality_issues > 0) {
    findings.push({
      type: 'quality',
      value: quality.data.data_quality_issues * 1000, // arbitrary weighting
      message: `${quality.data.data_quality_issues} data quality issues`,
    });
  }

  if (threading?.success && threading.data?.single_threaded_deals > 0) {
    findings.push({
      type: 'threading',
      value: threading.data.single_threaded_deals * 5000, // arbitrary weighting
      message: `${threading.data.single_threaded_deals} single-threaded deals`,
    });
  }

  if (coverage?.success && coverage.data?.coverage_ratio < 3.0) {
    findings.push({
      type: 'coverage',
      value: 10000, // fixed high priority
      message: `Coverage ratio ${coverage.data.coverage_ratio.toFixed(1)}x (target: 3.0x)`,
    });
  }

  if (findings.length === 0) {
    return 'Pipeline looks healthy - no major issues detected';
  }

  // Sort by value and return top finding
  findings.sort((a, b) => b.value - a.value);
  return findings[0].message;
}

/**
 * Get instant audit results if they exist
 */
export async function getInstantAuditResults(workspaceId: string): Promise<InstantAuditSummary | null> {
  const result = await query<{ value: any }>(
    `SELECT value FROM context_layer
     WHERE workspace_id = $1 AND category = 'settings' AND key = 'instant_audit_complete'`,
    [workspaceId]
  );

  return result.rows[0]?.value || null;
}
