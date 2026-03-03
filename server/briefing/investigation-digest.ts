/**
 * Investigation Weekly Digest Generator
 *
 * Generates weekly summary of investigation trends across all skills
 */

import { query } from '../db.js';

export interface CriticalFinding {
  dealName: string;
  amount: number;
  severity: string;
  message: string;
}

export interface InvestigationSummary {
  skillId: string;
  skillName: string;
  runsCount: number;
  trend: 'improving' | 'worsening' | 'stable';
  currentAtRisk: number;
  previousAtRisk: number;
  deltaAtRisk: number;
  criticalFindings: CriticalFinding[];
}

export interface DigestData {
  workspaceId: string;
  workspaceName: string;
  periodStart: string;
  periodEnd: string;
  investigations: InvestigationSummary[];
  topCriticalFindings: CriticalFinding[];
}

// Map skill IDs to human-readable names
function getSkillName(skillId: string): string {
  const skillNames: Record<string, string> = {
    'deal-risk-review': 'Deal Risk Review',
    'data-quality-audit': 'Data Quality Audit',
    'forecast-rollup': 'Forecast Rollup',
  };
  return skillNames[skillId] || skillId;
}

/**
 * Calculate trend direction using linear regression
 * Reused from timeline endpoint logic
 */
function calculateTrend(atRiskValues: number[]): 'improving' | 'worsening' | 'stable' {
  if (atRiskValues.length < 3) return 'stable';

  const n = atRiskValues.length;
  const xMean = (n - 1) / 2;
  const yMean = atRiskValues.reduce((sum, val) => sum + val, 0) / n;

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (i - xMean) * (atRiskValues[i] - yMean);
    denominator += (i - xMean) * (i - xMean);
  }

  const slope = denominator !== 0 ? numerator / denominator : 0;

  if (slope > 0.1) return 'worsening';
  if (slope < -0.1) return 'improving';
  return 'stable';
}

/**
 * Extract top critical findings from a run's output
 */
function extractCriticalFindings(output: any, limit: number = 3): CriticalFinding[] {
  const evaluatedRecords = output?.evidence?.evaluated_records || [];
  const criticalRecords = evaluatedRecords
    .filter((r: any) => r.severity === 'critical')
    .map((r: any) => ({
      dealName: r.entity_name || 'Unknown',
      amount: Number(r.fields?.amount || 0),
      severity: r.severity,
      message: r.finding_message || r.message || 'High risk detected',
    }))
    .sort((a: any, b: any) => b.amount - a.amount); // Sort by amount descending

  return criticalRecords.slice(0, limit);
}

/**
 * Generate weekly investigation digest for a workspace
 */
export async function generateWeeklyDigest(workspaceId: string): Promise<DigestData> {
  // Get workspace name
  const workspaceResult = await query<{ name: string }>(
    `SELECT name FROM workspaces WHERE id = $1`,
    [workspaceId]
  );
  const workspaceName = workspaceResult.rows[0]?.name || 'Unknown Workspace';

  // Define time range (last 7 days)
  const periodEnd = new Date().toISOString();
  const periodStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Known investigation skills
  const skillIds = ['deal-risk-review', 'data-quality-audit', 'forecast-rollup'];

  const investigations: InvestigationSummary[] = [];
  const allCriticalFindings: CriticalFinding[] = [];

  for (const skillId of skillIds) {
    // Query all completed runs for this skill in the past 7 days
    const result = await query<{
      run_id: string;
      completed_at: string;
      output: any;
    }>(
      `SELECT run_id, completed_at, output
       FROM skill_runs
       WHERE workspace_id = $1
         AND skill_id = $2
         AND status = 'completed'
         AND completed_at >= $3
         AND completed_at <= $4
       ORDER BY completed_at ASC`,
      [workspaceId, skillId, periodStart, periodEnd]
    );

    const runs = result.rows;

    // If no runs, skip this skill
    if (runs.length === 0) {
      investigations.push({
        skillId,
        skillName: getSkillName(skillId),
        runsCount: 0,
        trend: 'stable',
        currentAtRisk: 0,
        previousAtRisk: 0,
        deltaAtRisk: 0,
        criticalFindings: [],
      });
      continue;
    }

    // Calculate at-risk counts for each run
    const atRiskCounts = runs.map((run) => {
      const evaluatedRecords = run.output?.evidence?.evaluated_records || [];
      const criticalCount = evaluatedRecords.filter((r: any) => r.severity === 'critical').length;
      const warningCount = evaluatedRecords.filter((r: any) => r.severity === 'warning').length;
      return criticalCount + warningCount;
    });

    // Calculate trend using linear regression
    const trend = calculateTrend(atRiskCounts);

    // Get current and previous at-risk counts
    const currentAtRisk = atRiskCounts[atRiskCounts.length - 1] || 0;
    const previousAtRisk = atRiskCounts[0] || 0;
    const deltaAtRisk = currentAtRisk - previousAtRisk;

    // Extract critical findings from latest run
    const latestRun = runs[runs.length - 1];
    const criticalFindings = extractCriticalFindings(latestRun.output, 3);

    // Add to all critical findings for top findings section
    criticalFindings.forEach((finding) => {
      allCriticalFindings.push({
        ...finding,
        // We'll add skillId in the message for context
        message: `[${getSkillName(skillId)}] ${finding.message}`,
      });
    });

    investigations.push({
      skillId,
      skillName: getSkillName(skillId),
      runsCount: runs.length,
      trend,
      currentAtRisk,
      previousAtRisk,
      deltaAtRisk,
      criticalFindings,
    });
  }

  // Get top 5 critical findings across all skills (sorted by amount)
  const topCriticalFindings = allCriticalFindings
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  return {
    workspaceId,
    workspaceName,
    periodStart,
    periodEnd,
    investigations,
    topCriticalFindings,
  };
}
