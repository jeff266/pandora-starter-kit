/**
 * Methodology Config Resolver
 *
 * Resolves the most specific methodology configuration for a workspace + deal context
 * using scope cascade: segment_product > product > segment > workspace > system default
 */

import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';
import { ALL_FRAMEWORKS } from '../config/methodology-frameworks.js';
import type { MethodologyFramework } from '../config/methodology-frameworks.js';

const logger = createLogger('MethodologyConfigResolver');

export interface MethodologyConfig {
  id: string;
  workspace_id: string;
  scope_type: 'workspace' | 'segment' | 'product' | 'segment_product';
  scope_segment: string | null;
  scope_product: string | null;
  base_methodology: string;
  display_name: string | null;
  config: MethodologyConfigJSON;
  version: number;
  is_current: boolean;
  parent_version_id: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface MethodologyConfigJSON {
  problem_definition?: string;
  champion_signals?: string;
  economic_buyer_signals?: string;
  disqualifying_signals?: string;
  qualifying_questions?: string[];
  stage_criteria?: Record<string, string>;
  framework_fields?: Record<string, FrameworkFieldConfig>;
  call_scoring_rubric?: Record<string, DimensionRubric>;
}

export interface FrameworkFieldConfig {
  label?: string;
  description?: string;
  detection_hints?: string;
  crm_field_key?: string;
}

export interface DimensionRubric {
  weight: number;
  pass_signals: string[];
  fail_signals: string[];
}

export interface ResolvedMethodologyConfig {
  id: string;
  workspace_id: string;
  scope_type: string;
  scope_segment: string | null;
  scope_product: string | null;
  base_methodology: string;
  display_name: string | null;
  version: number;
  resolution_source: 'segment_product' | 'product' | 'segment' | 'workspace' | 'system_default';
}

export interface MergedMethodologyConfig extends ResolvedMethodologyConfig {
  base_framework: MethodologyFramework;
  config: MethodologyConfigJSON;
  merged_fields: Record<string, any>;
}

export interface MethodologyConfigSummary {
  id: string;
  scope_type: string;
  scope_segment: string | null;
  scope_product: string | null;
  base_methodology: string;
  display_name: string | null;
  version: number;
  is_current: boolean;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export class MethodologyConfigResolver {
  /**
   * Resolves the most specific config for a workspace + deal context
   * Cascade: segment_product > product > segment > workspace > system default
   */
  async resolve(
    workspaceId: string,
    context?: { segment?: string; product?: string }
  ): Promise<ResolvedMethodologyConfig> {
    const segment = context?.segment;
    const product = context?.product;

    // Try segment_product
    if (segment && product) {
      const config = await this.findConfig(workspaceId, 'segment_product', segment, product);
      if (config) {
        logger.debug('Resolved config via segment_product', { workspaceId, segment, product, configId: config.id });
        return {
          ...config,
          resolution_source: 'segment_product',
        };
      }
    }

    // Try product
    if (product) {
      const config = await this.findConfig(workspaceId, 'product', null, product);
      if (config) {
        logger.debug('Resolved config via product', { workspaceId, product, configId: config.id });
        return {
          ...config,
          resolution_source: 'product',
        };
      }
    }

    // Try segment
    if (segment) {
      const config = await this.findConfig(workspaceId, 'segment', segment, null);
      if (config) {
        logger.debug('Resolved config via segment', { workspaceId, segment, configId: config.id });
        return {
          ...config,
          resolution_source: 'segment',
        };
      }
    }

    // Try workspace
    const config = await this.findConfig(workspaceId, 'workspace', null, null);
    if (config) {
      logger.debug('Resolved config via workspace', { workspaceId, configId: config.id });
      return {
        ...config,
        resolution_source: 'workspace',
      };
    }

    // Fall back to system default
    logger.debug('Resolved config via system_default', { workspaceId });
    return {
      id: 'system_default',
      workspace_id: workspaceId,
      scope_type: 'workspace',
      scope_segment: null,
      scope_product: null,
      base_methodology: 'meddpicc', // Default framework
      display_name: null,
      version: 0,
      resolution_source: 'system_default',
    };
  }

  /**
   * Returns the merged config: base framework defaults + workspace customizations
   * User config fields override base framework fields
   */
  async getMergedConfig(configId: string): Promise<MergedMethodologyConfig> {
    // Handle system default
    if (configId === 'system_default') {
      const baseFramework = ALL_FRAMEWORKS.find(f => f.id === 'meddpicc');
      if (!baseFramework) {
        throw new Error('System default framework not found');
      }

      return {
        id: 'system_default',
        workspace_id: '',
        scope_type: 'workspace',
        scope_segment: null,
        scope_product: null,
        base_methodology: 'meddpicc',
        display_name: null,
        version: 0,
        resolution_source: 'system_default',
        base_framework: baseFramework,
        config: {},
        merged_fields: this.buildMergedFields(baseFramework, {}),
      };
    }

    // Fetch config from database
    const result = await query<MethodologyConfig>(
      `SELECT * FROM methodology_configs WHERE id = $1`,
      [configId]
    );

    if (result.rows.length === 0) {
      throw new Error(`Methodology config not found: ${configId}`);
    }

    const config = result.rows[0];

    // Get base framework
    const baseFramework = ALL_FRAMEWORKS.find(f => f.id === config.base_methodology);
    if (!baseFramework) {
      throw new Error(`Base framework not found: ${config.base_methodology}`);
    }

    // Merge base framework with workspace customizations
    const merged: MergedMethodologyConfig = {
      id: config.id,
      workspace_id: config.workspace_id,
      scope_type: config.scope_type,
      scope_segment: config.scope_segment,
      scope_product: config.scope_product,
      base_methodology: config.base_methodology,
      display_name: config.display_name,
      version: config.version,
      resolution_source: 'workspace', // Will be overridden by resolve()
      base_framework: baseFramework,
      config: config.config,
      merged_fields: this.buildMergedFields(baseFramework, config.config),
    };

    return merged;
  }

  /**
   * Returns all active configs for a workspace (for the settings UI)
   */
  async listConfigs(workspaceId: string): Promise<MethodologyConfigSummary[]> {
    const result = await query<MethodologyConfig>(
      `SELECT id, workspace_id, scope_type, scope_segment, scope_product,
              base_methodology, display_name, version, is_current,
              created_by, created_at, updated_at
       FROM methodology_configs
       WHERE workspace_id = $1 AND is_current = true
       ORDER BY
         CASE scope_type
           WHEN 'segment_product' THEN 1
           WHEN 'product' THEN 2
           WHEN 'segment' THEN 3
           WHEN 'workspace' THEN 4
         END,
         created_at DESC`,
      [workspaceId]
    );

    return result.rows;
  }

  /**
   * Returns version history for a config
   */
  async getVersionHistory(configId: string): Promise<MethodologyConfig[]> {
    // Get the current config to find its workspace and scope
    const currentResult = await query<MethodologyConfig>(
      `SELECT * FROM methodology_configs WHERE id = $1`,
      [configId]
    );

    if (currentResult.rows.length === 0) {
      throw new Error(`Config not found: ${configId}`);
    }

    const current = currentResult.rows[0];

    // Get all versions for the same workspace + scope
    const result = await query<MethodologyConfig>(
      `SELECT * FROM methodology_configs
       WHERE workspace_id = $1
         AND scope_type = $2
         AND COALESCE(scope_segment, '') = COALESCE($3, '')
         AND COALESCE(scope_product, '') = COALESCE($4, '')
       ORDER BY version DESC`,
      [current.workspace_id, current.scope_type, current.scope_segment, current.scope_product]
    );

    return result.rows;
  }

  /**
   * Private: Find a config by workspace + scope
   */
  private async findConfig(
    workspaceId: string,
    scopeType: string,
    segment: string | null,
    product: string | null
  ): Promise<MethodologyConfig | null> {
    const result = await query<MethodologyConfig>(
      `SELECT * FROM methodology_configs
       WHERE workspace_id = $1
         AND scope_type = $2
         AND COALESCE(scope_segment, '') = COALESCE($3, '')
         AND COALESCE(scope_product, '') = COALESCE($4, '')
         AND is_current = true
       LIMIT 1`,
      [workspaceId, scopeType, segment || '', product || '']
    );

    return result.rows[0] || null;
  }

  /**
   * Private: Build merged fields from base framework + workspace config
   */
  private buildMergedFields(
    baseFramework: MethodologyFramework,
    workspaceConfig: MethodologyConfigJSON
  ): Record<string, any> {
    const merged: Record<string, any> = {};

    // Start with base framework dimensions
    for (const dimension of baseFramework.dimensions) {
      merged[dimension.id] = {
        label: dimension.label,
        description: dimension.description,
        qualifying_questions: dimension.qualifying_questions,
        positive_signals: dimension.positive_signals,
        negative_signals: dimension.negative_signals,
        crmFieldHints: dimension.crmFieldHints,
      };
    }

    // Override with workspace customizations from framework_fields
    if (workspaceConfig.framework_fields) {
      for (const [fieldKey, fieldConfig] of Object.entries(workspaceConfig.framework_fields)) {
        if (merged[fieldKey]) {
          // Merge customizations into existing field
          if (fieldConfig.label) merged[fieldKey].label = fieldConfig.label;
          if (fieldConfig.description) merged[fieldKey].description = fieldConfig.description;
          if (fieldConfig.detection_hints) {
            merged[fieldKey].detection_hints = fieldConfig.detection_hints;
          }
          if (fieldConfig.crm_field_key) {
            merged[fieldKey].crm_field_key = fieldConfig.crm_field_key;
          }
        } else {
          // Add new custom field
          merged[fieldKey] = fieldConfig;
        }
      }
    }

    return merged;
  }
}

// Singleton instance
let resolverInstance: MethodologyConfigResolver | null = null;

export function getMethodologyConfigResolver(): MethodologyConfigResolver {
  if (!resolverInstance) {
    resolverInstance = new MethodologyConfigResolver();
  }
  return resolverInstance;
}
