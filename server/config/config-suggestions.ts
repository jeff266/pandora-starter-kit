import { query } from '../db.js';
import { configLoader } from './workspace-config-loader.js';

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

export async function addConfigSuggestion(
  workspaceId: string,
  suggestion: Omit<ConfigSuggestion, 'id' | 'workspace_id' | 'created_at' | 'status'>
): Promise<void> {
  const existing = await query(
    `SELECT id FROM config_suggestions
     WHERE workspace_id = $1 AND section = $2 AND path = $3 AND type = $4 AND status = 'pending'`,
    [workspaceId, suggestion.section, suggestion.path, suggestion.type]
  );

  if (existing.rows.length > 0) {
    console.log(`[Config Suggestions] Duplicate suggestion skipped: ${suggestion.path}`);
    return;
  }

  await query(
    `INSERT INTO config_suggestions
       (workspace_id, source_skill, source_run_id, section, path, type, message, evidence, confidence, suggested_value, current_value)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      workspaceId,
      suggestion.source_skill,
      suggestion.source_run_id || null,
      suggestion.section,
      suggestion.path,
      suggestion.type,
      suggestion.message,
      suggestion.evidence || '',
      suggestion.confidence,
      suggestion.suggested_value ? JSON.stringify(suggestion.suggested_value) : null,
      suggestion.current_value ? JSON.stringify(suggestion.current_value) : null,
    ]
  );

  const countResult = await query<{ cnt: string }>(
    `SELECT COUNT(*) as cnt FROM config_suggestions WHERE workspace_id = $1`,
    [workspaceId]
  );
  const total = parseInt(countResult.rows[0]?.cnt || '0', 10);
  if (total > 50) {
    await query(
      `DELETE FROM config_suggestions
       WHERE id IN (
         SELECT id FROM config_suggestions
         WHERE workspace_id = $1 AND status = 'dismissed'
         ORDER BY created_at ASC
         LIMIT $2
       )`,
      [workspaceId, total - 50]
    );
  }

  console.log(`[Config Suggestions] Added: ${suggestion.type} for ${suggestion.path} (confidence: ${suggestion.confidence})`);
}

export async function getSuggestions(
  workspaceId: string,
  status?: 'pending' | 'accepted' | 'dismissed' | 'all'
): Promise<ConfigSuggestion[]> {
  let sql = `SELECT * FROM config_suggestions WHERE workspace_id = $1`;
  const params: any[] = [workspaceId];

  if (status && status !== 'all') {
    sql += ` AND status = $2`;
    params.push(status);
  }

  sql += ` ORDER BY created_at DESC`;

  const result = await query<any>(sql, params);
  return result.rows.map(mapRow);
}

export async function getPendingSuggestions(workspaceId: string): Promise<ConfigSuggestion[]> {
  return getSuggestions(workspaceId, 'pending');
}

export async function resolveSuggestion(
  workspaceId: string,
  suggestionId: string,
  action: 'accepted' | 'dismissed'
): Promise<boolean> {
  const result = await query<any>(
    `UPDATE config_suggestions SET status = $3, resolved_at = NOW()
     WHERE id = $2 AND workspace_id = $1
     RETURNING *`,
    [workspaceId, suggestionId, action]
  );

  if (result.rows.length === 0) {
    console.log(`[Config Suggestions] Suggestion not found: ${suggestionId}`);
    return false;
  }

  if (action === 'accepted' && result.rows[0].suggested_value !== null) {
    await applyConfigSuggestion(workspaceId, mapRow(result.rows[0]));
  }

  console.log(`[Config Suggestions] Resolved ${suggestionId} as ${action}`);
  return true;
}

async function applyConfigSuggestion(workspaceId: string, suggestion: ConfigSuggestion): Promise<void> {
  const config = await configLoader.getConfig(workspaceId);

  if (suggestion.section === 'thresholds' && suggestion.path.endsWith('stale_deal_days')) {
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

  config._meta[suggestion.path] = {
    source: 'confirmed',
    confidence: 1.0,
    evidence: `Accepted suggestion from ${suggestion.source_skill}`,
    last_validated: new Date().toISOString(),
  };

  config.updated_at = new Date().toISOString();

  await query(
    `UPDATE context_layer
     SET definitions = jsonb_set(COALESCE(definitions, '{}'::jsonb), '{workspace_config}', $2::jsonb),
         updated_at = NOW()
     WHERE workspace_id = $1`,
    [workspaceId, JSON.stringify(config)]
  );

  configLoader.clearCache(workspaceId);
  console.log(`[Config Suggestions] Applied suggestion to ${suggestion.path}`);
}

export async function clearAllSuggestions(workspaceId: string): Promise<void> {
  await query(
    `DELETE FROM config_suggestions WHERE workspace_id = $1`,
    [workspaceId]
  );
  console.log(`[Config Suggestions] Cleared all suggestions for workspace ${workspaceId}`);
}

export async function getTopSuggestion(workspaceId: string): Promise<ConfigSuggestion | null> {
  const result = await query<any>(
    `SELECT * FROM config_suggestions
     WHERE workspace_id = $1 AND status = 'pending'
     ORDER BY confidence DESC
     LIMIT 1`,
    [workspaceId]
  );
  if (result.rows.length === 0) return null;
  return mapRow(result.rows[0]);
}

function mapRow(row: any): ConfigSuggestion {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    created_at: row.created_at,
    source_skill: row.source_skill,
    source_run_id: row.source_run_id,
    section: row.section,
    path: row.path,
    type: row.type,
    message: row.message,
    evidence: row.evidence,
    confidence: parseFloat(row.confidence),
    suggested_value: row.suggested_value,
    current_value: row.current_value,
    status: row.status,
    resolved_at: row.resolved_at,
  };
}
