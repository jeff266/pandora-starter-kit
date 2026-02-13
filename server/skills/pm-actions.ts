/**
 * PM Action Helpers for Skills
 *
 * Helper functions that skills can call to generate RevOps operator work items
 * that get pushed to PM tools.
 */

import type { OpsWorkItem, OpsCategory, OpsPriority } from '../connectors/pm-tools/types.js';
import { createPMTask } from '../services/pm-task-service.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('PMActions');

export interface DataQualityFinding {
  field: string;
  missingCount: number;
  affectedRecords: number;
  severity: 'critical' | 'moderate' | 'minor';
  recommendedFix: 'training' | 'required_field_enforcement' | 'bulk_cleanup' | 'process_change' | 'tool_config';
  impactMetric?: string;
}

/**
 * Generate PM work items from data quality audit results
 *
 * This is called by the data-quality-audit skill after analysis completes
 */
export async function generateDataQualityWorkItems(
  workspaceId: string,
  findings: DataQualityFinding[],
  skillRunId: string
): Promise<void> {
  logger.info('Generating data quality work items', {
    workspaceId,
    findingCount: findings.length,
  });

  // Filter to actionable findings (critical and moderate severity)
  const actionableFindings = findings.filter(f => f.severity === 'critical' || f.severity === 'moderate');

  for (const finding of actionableFindings) {
    const workItem = buildDataQualityWorkItem(finding, skillRunId);

    try {
      const result = await createPMTask(workspaceId, workItem);

      if (result.success) {
        logger.info('Data quality work item created', {
          workspaceId,
          field: finding.field,
          url: result.url,
        });
      } else {
        logger.warn('Failed to create data quality work item', {
          workspaceId,
          field: finding.field,
          error: result.error,
        });
      }
    } catch (error) {
      logger.error('Error creating data quality work item', {
        workspaceId,
        field: finding.field,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Build OpsWorkItem from data quality finding
 */
function buildDataQualityWorkItem(
  finding: DataQualityFinding,
  skillRunId: string
): OpsWorkItem {
  // Map severity to priority
  const priority: OpsPriority = finding.severity === 'critical' ? 'critical' : 'high';

  // Map recommended fix to category
  const category: OpsCategory = mapFixToCategory(finding.recommendedFix);

  // Build task name
  const name = buildTaskName(finding);

  // Build description with context
  const description = buildDescription(finding);

  // Calculate due date (critical = 7 days, moderate = 14 days)
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + (finding.severity === 'critical' ? 7 : 14));

  return {
    name,
    description,
    category,
    priority,
    dueDate: dueDate.toISOString().split('T')[0],
    sourceSkill: 'data-quality-audit',
    sourceActionId: `dq_${skillRunId}_${finding.field}`,
    findingSummary: `${finding.missingCount} records missing ${finding.field} (${finding.affectedRecords} total records audited)`,
    impactMetric: finding.impactMetric,
    affectedRecordCount: finding.missingCount,
    recommendedApproach: getRecommendedApproach(finding),
    labels: ['data-quality', 'pipeline-hygiene', finding.field],
    dataPoints: {
      field: finding.field,
      missingCount: finding.missingCount,
      affectedRecords: finding.affectedRecords,
      severity: finding.severity,
      fillRate: ((1 - finding.missingCount / finding.affectedRecords) * 100).toFixed(1) + '%',
    },
  };
}

/**
 * Map recommended fix to OpsCategory
 */
function mapFixToCategory(fix: DataQualityFinding['recommendedFix']): OpsCategory {
  const mapping: Record<string, OpsCategory> = {
    training: 'enablement_gap',
    required_field_enforcement: 'system_config',
    bulk_cleanup: 'data_cleanup',
    process_change: 'process_fix',
    tool_config: 'system_config',
  };

  return mapping[fix] || 'data_cleanup';
}

/**
 * Build task name from finding
 */
function buildTaskName(finding: DataQualityFinding): string {
  const action = getActionVerb(finding.recommendedFix);
  return `${action} ${finding.field} field (${finding.missingCount} missing)`;
}

/**
 * Get action verb for task name
 */
function getActionVerb(fix: DataQualityFinding['recommendedFix']): string {
  const verbs: Record<string, string> = {
    training: 'Train team on',
    required_field_enforcement: 'Enforce required',
    bulk_cleanup: 'Bulk cleanup',
    process_change: 'Update process for',
    tool_config: 'Configure',
  };

  return verbs[fix] || 'Fix';
}

/**
 * Build detailed description with context and recommendations
 */
function buildDescription(finding: DataQualityFinding): string {
  const fillRate = ((1 - finding.missingCount / finding.affectedRecords) * 100).toFixed(1);

  let description = `## Data Quality Issue: ${finding.field}\n\n`;
  description += `**Current State:**\n`;
  description += `- ${finding.missingCount} out of ${finding.affectedRecords} records are missing this field\n`;
  description += `- Fill rate: ${fillRate}%\n`;
  description += `- Severity: ${finding.severity}\n`;

  if (finding.impactMetric) {
    description += `- Impact: ${finding.impactMetric}\n`;
  }

  description += `\n**Why This Matters:**\n`;
  description += getImpactExplanation(finding.field);

  return description;
}

/**
 * Get recommended approach text
 */
function getRecommendedApproach(finding: DataQualityFinding): string {
  const approaches: Record<string, string> = {
    training: `Schedule training session with the team to emphasize importance of ${finding.field} field. Create quick reference guide.`,
    required_field_enforcement: `Configure ${finding.field} as required field in CRM. Add validation rule to prevent deal progression without this field.`,
    bulk_cleanup: `Run bulk update job to backfill ${finding.field} for existing records. Use deal context/patterns to infer values where possible.`,
    process_change: `Update sales process documentation to require ${finding.field} entry at specific stage. Add to stage entry checklist.`,
    tool_config: `Check CRM field visibility and permissions. Ensure ${finding.field} is visible in all relevant layouts and accessible to all users.`,
  };

  return approaches[finding.recommendedFix] || `Address ${finding.field} data quality issue.`;
}

/**
 * Explain why a field matters (impact on other analyses)
 */
function getImpactExplanation(field: string): string {
  const explanations: Record<string, string> = {
    close_date: 'Close dates are critical for accurate forecasting, pipeline velocity analysis, and deal health scoring. Missing close dates make it impossible to prioritize deals by urgency.',
    amount: 'Deal amounts drive pipeline coverage calculations, quota attainment tracking, and win rate analysis. Missing amounts render most revenue metrics unreliable.',
    stage: 'Stage tracking enables pipeline movement analysis, conversion rate calculations, and stage duration metrics. Missing stages break funnel analysis.',
    owner: 'Owner assignments are essential for rep-level metrics, territory analysis, and accountability tracking. Missing owners make it impossible to evaluate individual performance.',
    account: 'Account linkage enables account-level revenue rollup, multi-deal tracking, and account health scoring. Missing accounts fragment deal context.',
    contact_role: 'Contact roles identify key stakeholders and multi-threading. Missing contact roles hide single-threading risks and make it impossible to track decision-maker engagement.',
  };

  return explanations[field] || 'This field is used by multiple Pandora analyses. Missing data degrades insight quality.';
}
