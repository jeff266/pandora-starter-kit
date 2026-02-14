/**
 * Config Suggestions - Skill Feedback Signals (Prompt 3)
 *
 * Skills generate suggestions when they detect patterns that indicate
 * the config might be wrong or incomplete.
 */

import { query } from '../db.js';
import { configLoader } from './workspace-config-loader.js';
import { v4 as uuidv4 } from 'uuid';

export interface ConfigSuggestion {
  id: string;
  workspace_id: string;
  created_at: string;
  source_skill: string;
  source_run_id?: string;

  section: string;
  path: string;

  type: 'confirm' | 'adjust' | 'add' | 'remove' | 'alert';
  message: string;
  evidence: string;
  confidence: number;

  suggested_value?: any;
  current_value?: any;

  status: 'pending' | 'accepted' | 'dismissed';
  resolved_at?: string;
}

/**
 * Add a new config suggestion
 */
export async function addConfigSuggestion(
  workspaceId: string,
  suggestion: Omit<ConfigSuggestion, 'id' | 'workspace_id' | 'created_at' | 'status'>
): Promise<void> {
  const existing = await query<{ value: any }>(
    `SELECT value FROM context_layer
     WHERE workspace_id = $1 AND category = 'settings' AND key = 'config_suggestions'`,
    [workspaceId]
  );

  const suggestions: ConfigSuggestion[] = existing.rows[0]?.value || [];

  // Deduplicate: don't add if same section+path+type already pending
  const isDuplicate = suggestions.some(s =>
    s.status === 'pending' &&
    s.section === suggestion.section &&
    s.path === suggestion.path &&
    s.type === suggestion.type
  );
  if (isDuplicate) {
    console.log(`[Config Suggestions] Duplicate suggestion skipped: ${suggestion.path}`);
    return;
  }

  const newSuggestion: ConfigSuggestion = {
    ...suggestion,
    id: uuidv4(),
    workspace_id: workspaceId,
    created_at: new Date().toISOString(),
    status: 'pending',
  };

  suggestions.push(newSuggestion);

  // Keep only last 50 suggestions (prune oldest dismissed)
  const pruned = suggestions
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 50);

  await query(
    `INSERT INTO context_layer (workspace_id, category, key, value, updated_at)
     VALUES ($1, 'settings', 'config_suggestions', $2::jsonb, NOW())
     ON CONFLICT (workspace_id, category, key)
     DO UPDATE SET value = $2::jsonb, updated_at = NOW()`,
    [workspaceId, JSON.stringify(pruned)]
  );

  console.log(`[Config Suggestions] Added: ${suggestion.type} for ${suggestion.path} (confidence: ${suggestion.confidence})`);
}

/**
 * Get suggestions with optional filter
 */
export async function getSuggestions(
  workspaceId: string,
  status?: 'pending' | 'accepted' | 'dismissed' | 'all'
): Promise<ConfigSuggestion[]> {
  const result = await query<{ value: any }>(
    `SELECT value FROM context_layer
     WHERE workspace_id = $1 AND category = 'settings' AND key = 'config_suggestions'`,
    [workspaceId]
  );

  const all: ConfigSuggestion[] = result.rows[0]?.value || [];

  if (!status || status === 'all') return all;
  return all.filter(s => s.status === status);
}

/**
 * Get pending suggestions (convenience method)
 */
export async function getPendingSuggestions(workspaceId: string): Promise<ConfigSuggestion[]> {
  return getSuggestions(workspaceId, 'pending');
}

/**
 * Resolve a suggestion (accept or dismiss)
 */
export async function resolveSuggestion(
  workspaceId: string,
  suggestionId: string,
  action: 'accepted' | 'dismissed'
): Promise<boolean> {
  const result = await query<{ value: any }>(
    `SELECT value FROM context_layer
     WHERE workspace_id = $1 AND category = 'settings' AND key = 'config_suggestions'`,
    [workspaceId]
  );

  const suggestions: ConfigSuggestion[] = result.rows[0]?.value || [];
  const idx = suggestions.findIndex(s => s.id === suggestionId);

  if (idx < 0) {
    console.log(`[Config Suggestions] Suggestion not found: ${suggestionId}`);
    return false;
  }

  suggestions[idx].status = action;
  suggestions[idx].resolved_at = new Date().toISOString();

  // If accepted, apply the suggested value to config
  if (action === 'accepted' && suggestions[idx].suggested_value !== undefined) {
    await applyConfigSuggestion(workspaceId, suggestions[idx]);
  }

  await query(
    `UPDATE context_layer SET value = $2::jsonb, updated_at = NOW()
     WHERE workspace_id = $1 AND category = 'settings' AND key = 'config_suggestions'`,
    [workspaceId, JSON.stringify(suggestions)]
  );

  console.log(`[Config Suggestions] Resolved ${suggestionId} as ${action}`);
  return true;
}

/**
 * Apply a suggestion's value to the config
 */
async function applyConfigSuggestion(workspaceId: string, suggestion: ConfigSuggestion): Promise<void> {
  const config = await configLoader.getConfig(workspaceId);

  // Parse the path and apply the value
  const pathParts = suggestion.path.split('.');

  // Simple implementation - handle common cases
  if (suggestion.section === 'thresholds' && pathParts[pathParts.length - 1] === 'stale_deal_days') {
    config.thresholds.stale_deal_days = suggestion.suggested_value;
  } else if (suggestion.section === 'pipelines' && suggestion.path.includes('parking_lot_stages')) {
    if (config.pipelines[0]) {
      config.pipelines[0].parking_lot_stages = suggestion.suggested_value;
    }
  } else if (suggestion.section === 'teams' && suggestion.path.includes('excluded_owners')) {
    config.teams.excluded_owners = suggestion.suggested_value;
  } else if (suggestion.section === 'thresholds' && suggestion.path.includes('coverage_target')) {
    config.thresholds.coverage_target = suggestion.suggested_value;
  }

  // Update metadata
  config._meta[suggestion.path] = {
    source: 'confirmed',
    confidence: 1.0,
    evidence: `Accepted suggestion from ${suggestion.source_skill}`,
    last_validated: new Date().toISOString(),
  };

  config.updated_at = new Date().toISOString();

  // Save
  await query(
    `INSERT INTO context_layer (workspace_id, category, key, value, updated_at)
     VALUES ($1, 'settings', 'workspace_config', $2::jsonb, NOW())
     ON CONFLICT (workspace_id, category, key)
     DO UPDATE SET value = $2::jsonb, updated_at = NOW()`,
    [workspaceId, JSON.stringify(config)]
  );

  configLoader.clearCache(workspaceId);
  console.log(`[Config Suggestions] Applied suggestion to ${suggestion.path}`);
}

/**
 * Clear all suggestions for a workspace
 */
export async function clearAllSuggestions(workspaceId: string): Promise<void> {
  await query(
    `DELETE FROM context_layer
     WHERE workspace_id = $1 AND category = 'settings' AND key = 'config_suggestions'`,
    [workspaceId]
  );

  console.log(`[Config Suggestions] Cleared all suggestions for workspace ${workspaceId}`);
}

/**
 * Get top pending suggestion (for agent synthesis)
 */
export async function getTopSuggestion(workspaceId: string): Promise<ConfigSuggestion | null> {
  const pending = await getPendingSuggestions(workspaceId);
  if (pending.length === 0) return null;

  // Sort by confidence desc
  pending.sort((a, b) => b.confidence - a.confidence);
  return pending[0];
}
