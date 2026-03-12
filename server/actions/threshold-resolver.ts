/**
 * Action Threshold Resolver
 *
 * Determines the effective threshold for any CRM write based on:
 * - Workspace default threshold
 * - Field-specific overrides
 * - Stage protection rules
 * - Field protection rules
 */

import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ThresholdResolver');

export interface WorkspaceActionSettings {
  id: string;
  workspace_id: string;
  action_threshold: 'high' | 'medium' | 'low';
  protected_stages: string[];
  field_overrides: Record<string, 'high' | 'medium' | 'low'>;
  protected_fields: string[];
  notify_on_auto_write: boolean;
  notify_channel: string | null;
  notify_rep: boolean;
  notify_manager: boolean;
  undo_window_hours: number;
  audit_webhook_url: string | null;
  audit_webhook_secret: string | null;
  audit_webhook_enabled: boolean;
}

export interface WritePolicy {
  canWrite: boolean;
  threshold: 'high' | 'medium' | 'low';
  requiresApproval: boolean;
  reason?: string;
}

export class ActionThresholdResolver {
  private settingsCache: Map<string, { settings: WorkspaceActionSettings; cachedAt: number }> = new Map();
  private CACHE_TTL = 60_000; // 1 minute

  /**
   * Get workspace action settings (cached)
   */
  async getSettings(workspaceId: string): Promise<WorkspaceActionSettings | null> {
    // Check cache
    const cached = this.settingsCache.get(workspaceId);
    if (cached && Date.now() - cached.cachedAt < this.CACHE_TTL) {
      return cached.settings;
    }

    // Fetch from database
    const result = await query<any>(
      `SELECT * FROM workspace_action_settings WHERE workspace_id = $1`,
      [workspaceId]
    );

    if (result.rows.length === 0) {
      // No settings found - create default
      await query(
        `INSERT INTO workspace_action_settings (workspace_id, action_threshold, protected_stages)
         VALUES ($1, 'medium', '["Closed Won", "Closed Lost"]'::jsonb)
         ON CONFLICT (workspace_id) DO NOTHING`,
        [workspaceId]
      );

      // Fetch again
      const retry = await query<any>(
        `SELECT * FROM workspace_action_settings WHERE workspace_id = $1`,
        [workspaceId]
      );

      if (retry.rows.length === 0) {
        logger.error('Failed to create default settings', { workspaceId });
        return null;
      }

      const settings = this.normalizeSettings(retry.rows[0]);
      this.settingsCache.set(workspaceId, { settings, cachedAt: Date.now() });
      return settings;
    }

    const settings = this.normalizeSettings(result.rows[0]);
    this.settingsCache.set(workspaceId, { settings, cachedAt: Date.now() });
    return settings;
  }

  /**
   * Normalize database row to settings object
   */
  private normalizeSettings(row: any): WorkspaceActionSettings {
    return {
      id: row.id,
      workspace_id: row.workspace_id,
      action_threshold: row.action_threshold,
      protected_stages: Array.isArray(row.protected_stages) ? row.protected_stages : [],
      field_overrides: typeof row.field_overrides === 'object' && row.field_overrides !== null
        ? row.field_overrides
        : {},
      protected_fields: Array.isArray(row.protected_fields) ? row.protected_fields : [],
      notify_on_auto_write: row.notify_on_auto_write,
      notify_channel: row.notify_channel,
      notify_rep: row.notify_rep,
      notify_manager: row.notify_manager,
      undo_window_hours: row.undo_window_hours,
      audit_webhook_url: row.audit_webhook_url,
      audit_webhook_secret: row.audit_webhook_secret,
      audit_webhook_enabled: row.audit_webhook_enabled,
    };
  }

  /**
   * Clear cache for a workspace (call after settings update)
   */
  clearCache(workspaceId: string): void {
    this.settingsCache.delete(workspaceId);
  }

  /**
   * Returns the effective threshold for a given field + workspace
   * Field override > workspace default
   */
  async resolveThreshold(
    workspaceId: string,
    fieldKey: string
  ): Promise<'high' | 'medium' | 'low'> {
    const settings = await this.getSettings(workspaceId);
    if (!settings) {
      return 'medium'; // Safe default
    }

    // Check field override
    if (settings.field_overrides[fieldKey]) {
      return settings.field_overrides[fieldKey];
    }

    // Return workspace default
    return settings.action_threshold;
  }

  /**
   * Returns true if this stage is protected (never write)
   */
  async isStageProtected(workspaceId: string, stageName: string): Promise<boolean> {
    const settings = await this.getSettings(workspaceId);
    if (!settings) {
      return false;
    }

    // Normalize stage name for comparison
    const normalizedStage = stageName.toLowerCase().trim();
    const protectedStagesNormalized = settings.protected_stages.map(s => s.toLowerCase().trim());

    return protectedStagesNormalized.includes(normalizedStage);
  }

  /**
   * Returns true if this field is protected (never write)
   */
  async isFieldProtected(workspaceId: string, fieldKey: string): Promise<boolean> {
    const settings = await this.getSettings(workspaceId);
    if (!settings) {
      return false;
    }

    return settings.protected_fields.includes(fieldKey);
  }

  /**
   * Returns the full resolved write policy for a field:
   * { canWrite: boolean, threshold: string, requiresApproval: boolean, reason: string }
   */
  async resolveWritePolicy(
    workspaceId: string,
    fieldKey: string,
    targetStage?: string
  ): Promise<WritePolicy> {
    // Check field protection first
    const isFieldProtected = await this.isFieldProtected(workspaceId, fieldKey);
    if (isFieldProtected) {
      return {
        canWrite: false,
        threshold: 'low',
        requiresApproval: false,
        reason: `Field ${fieldKey} is protected - Pandora cannot write to this field`,
      };
    }

    // Check stage protection
    if (targetStage) {
      const isStageProtected = await this.isStageProtected(workspaceId, targetStage);
      if (isStageProtected) {
        return {
          canWrite: false,
          threshold: 'low',
          requiresApproval: false,
          reason: `Stage "${targetStage}" is protected - Pandora cannot write to deals in this stage`,
        };
      }
    }

    // Get threshold
    const threshold = await this.resolveThreshold(workspaceId, fieldKey);

    // Determine if approval is required
    const requiresApproval = threshold === 'medium';

    // Low threshold = no write capability at all
    if (threshold === 'low') {
      return {
        canWrite: false,
        threshold: 'low',
        requiresApproval: false,
        reason: `Field ${fieldKey} has "low" threshold - Pandora can only recommend, not write`,
      };
    }

    return {
      canWrite: true,
      threshold,
      requiresApproval,
    };
  }
}

// Singleton instance
let resolverInstance: ActionThresholdResolver | null = null;

export function getActionThresholdResolver(): ActionThresholdResolver {
  if (!resolverInstance) {
    resolverInstance = new ActionThresholdResolver();
  }
  return resolverInstance;
}
