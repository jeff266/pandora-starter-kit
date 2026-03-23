/**
 * Multi-Workspace Dimension Copy
 *
 * Enables RevOps consultants and enterprise customers to copy calibrated
 * dimension configurations between workspaces with compatibility checking.
 */

import { query } from '../db.js';
import { getDimensions, saveDimension, getStageMappings, saveStageMappings, updateCalibrationStatus } from './data-dictionary.js';
import type { BusinessDimension } from './data-dictionary.js';

export interface DimensionCopyOptions {
  source_workspace_id:  string;
  target_workspace_id:  string;
  dimension_keys?:      string[];  // If omitted, copies all confirmed
  copy_quota?:          boolean;   // Default false — quota is workspace-specific
  copy_targets?:        boolean;   // Copy coverage/win rate targets
  reset_confirmed?:     boolean;   // Default true — copied dims are unconfirmed
}

export interface DimensionCopyResult {
  dimensions_copied:    number;
  stage_mappings_copied: number;
  metrics_copied:       number;
  warnings:             string[];
}

async function checkCustomFieldCompatibility(
  targetWorkspaceId: string,
  dimension: BusinessDimension
): Promise<string[]> {
  const warnings: string[] = [];

  // Extract custom field names from filter conditions
  const customFields = new Set<string>();
  function extractCustomFields(conditions: any[]): void {
    for (const condition of conditions) {
      if ('conditions' in condition) {
        extractCustomFields(condition.conditions);
      } else if (condition.field_type === 'custom') {
        customFields.add(condition.field);
      }
    }
  }

  extractCustomFields(dimension.filter_definition.conditions);

  if (customFields.size === 0) {
    return warnings;
  }

  // Check if custom fields exist in target workspace
  for (const fieldName of customFields) {
    const result = await query(
      `SELECT COUNT(*) as cnt FROM deals
       WHERE workspace_id = $1
         AND custom_fields ? $2
       LIMIT 1`,
      [targetWorkspaceId, fieldName]
    );

    const count = parseInt(result.rows[0]?.cnt || '0', 10);
    if (count === 0) {
      warnings.push(`Custom field "${fieldName}" not found in target workspace`);
    }
  }

  return warnings;
}

async function checkStageCompatibility(
  targetWorkspaceId: string,
  stageMappings: Record<string, string>
): Promise<string[]> {
  const warnings: string[] = [];
  const stageNames = Object.keys(stageMappings);

  if (stageNames.length === 0) {
    return warnings;
  }

  // Check if stages exist in target workspace
  for (const stageName of stageNames) {
    const result = await query(
      `SELECT COUNT(*) as cnt FROM deals
       WHERE workspace_id = $1
         AND stage = $2
       LIMIT 1`,
      [targetWorkspaceId, stageName]
    );

    const count = parseInt(result.rows[0]?.cnt || '0', 10);
    if (count === 0) {
      warnings.push(`Stage "${stageName}" not found in target workspace`);
    }
  }

  return warnings;
}

export async function copyDimensions(
  options: DimensionCopyOptions
): Promise<DimensionCopyResult> {
  const result: DimensionCopyResult = {
    dimensions_copied: 0,
    stage_mappings_copied: 0,
    metrics_copied: 0,
    warnings: [],
  };

  const {
    source_workspace_id,
    target_workspace_id,
    dimension_keys,
    copy_quota = false,
    copy_targets = true,
    reset_confirmed = true,
  } = options;

  try {
    // Load dimensions from source
    let sourceDimensions = await getDimensions(source_workspace_id, { confirmedOnly: true });

    // Filter to specified keys if provided
    if (dimension_keys && dimension_keys.length > 0) {
      sourceDimensions = sourceDimensions.filter(d => dimension_keys.includes(d.dimension_key));
    }

    if (sourceDimensions.length === 0) {
      result.warnings.push('No confirmed dimensions found to copy');
      return result;
    }

    // Check compatibility for each dimension
    const dimensionWarnings: Map<string, string[]> = new Map();

    for (const dim of sourceDimensions) {
      const warnings = await checkCustomFieldCompatibility(target_workspace_id, dim);
      if (warnings.length > 0) {
        dimensionWarnings.set(dim.dimension_key, warnings);
        result.warnings.push(...warnings);
      }
    }

    // Copy dimensions
    for (const sourceDim of sourceDimensions) {
      const copied: Partial<BusinessDimension> = {
        dimension_key:       sourceDim.dimension_key,
        label:               sourceDim.label,
        description:         sourceDim.description,
        filter_definition:   sourceDim.filter_definition,
        value_field:         sourceDim.value_field,
        value_field_label:   sourceDim.value_field_label,
        value_field_type:    sourceDim.value_field_type,
        value_transform:     sourceDim.value_transform,
        quota_source:        copy_quota ? sourceDim.quota_source : 'none',
        quota_field:         copy_quota ? sourceDim.quota_field : undefined,
        quota_value:         copy_quota ? sourceDim.quota_value : undefined,
        quota_period:        sourceDim.quota_period,
        target_coverage_ratio:  copy_targets ? sourceDim.target_coverage_ratio : undefined,
        target_win_rate:        copy_targets ? sourceDim.target_win_rate : undefined,
        target_avg_sales_cycle: copy_targets ? sourceDim.target_avg_sales_cycle : undefined,
        target_avg_deal_size:   copy_targets ? sourceDim.target_avg_deal_size : undefined,
        exclusivity:         sourceDim.exclusivity,
        exclusivity_group:   sourceDim.exclusivity_group,
        parent_dimension:    sourceDim.parent_dimension,
        child_dimensions:    sourceDim.child_dimensions,
        confirmed:           reset_confirmed ? false : sourceDim.confirmed,
        calibration_source:  'manual',
        calibration_notes:   `Copied from workspace ${source_workspace_id}`,
        display_order:       sourceDim.display_order,
        is_default:          sourceDim.is_default,
      };

      // Mark as low confidence if custom field warnings exist
      if (dimensionWarnings.has(sourceDim.dimension_key)) {
        copied.calibration_notes += ` (warnings: ${dimensionWarnings.get(sourceDim.dimension_key)!.join(', ')})`;
      }

      await saveDimension(target_workspace_id, copied as any);
      result.dimensions_copied++;
    }

    // Copy stage mappings
    const sourceMappings = await getStageMappings(source_workspace_id);
    if (Object.keys(sourceMappings).length > 0) {
      const stageWarnings = await checkStageCompatibility(target_workspace_id, sourceMappings);
      result.warnings.push(...stageWarnings);

      await saveStageMappings(target_workspace_id, sourceMappings);
      result.stage_mappings_copied = Object.keys(sourceMappings).length;
    }

    // Set calibration status to in_progress on target workspace
    if (result.dimensions_copied > 0) {
      await updateCalibrationStatus(target_workspace_id, 'in_progress');
    }

    return result;
  } catch (err: any) {
    result.warnings.push(`Copy failed: ${err.message}`);
    return result;
  }
}
