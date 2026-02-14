/**
 * Config Drift Detection
 *
 * Lightweight checks after each sync to detect changes that might invalidate config:
 * - New deal owners not in any role
 * - New stage values not in funnel
 * - New pipeline/record type values
 * - Win rate shifts
 */

import { query } from '../db.js';
import { configLoader } from './workspace-config-loader.js';

export interface ConfigSuggestion {
  type: 'new_rep' | 'new_stage' | 'new_pipeline' | 'win_rate_shift' | 'stale_threshold_shift';
  section: string;
  message: string;
  suggested_action: any;
  confidence: number;
  detected_at: string;
}

/**
 * Check for config drift after sync
 */
export async function checkConfigDrift(workspaceId: string): Promise<ConfigSuggestion[]> {
  console.log(`[Drift Detection] Checking workspace ${workspaceId}`);

  const config = await configLoader.getConfig(workspaceId);
  const suggestions: ConfigSuggestion[] = [];

  // 1. New deal owners not in any role or exclusion list
  const knownPeople = new Set([
    ...config.teams.roles.flatMap(r => r.members),
    ...config.teams.excluded_owners,
  ].map(e => e.toLowerCase()));

  const newOwners = await query<{
    owner_email: string;
    owner_name: string;
    deal_count: number;
  }>(
    `SELECT DISTINCT owner_email, owner_name, COUNT(*) as deal_count
     FROM deals
     WHERE workspace_id = $1
       AND owner_email IS NOT NULL
       AND created_date >= NOW() - INTERVAL '14 days'
     GROUP BY 1, 2
     HAVING COUNT(*) >= 3`,
    [workspaceId]
  );

  for (const row of newOwners.rows) {
    const email = row.owner_email.toLowerCase();
    if (!knownPeople.has(email)) {
      suggestions.push({
        type: 'new_rep',
        section: 'teams',
        message: `New deal owner detected: ${row.owner_name} (${row.owner_email}) with ${row.deal_count} deals in last 2 weeks. Add to a team role or exclude.`,
        suggested_action: {
          add_to_role: 'ae',
          email: row.owner_email,
          name: row.owner_name,
        },
        confidence: 0.8,
        detected_at: new Date().toISOString(),
      });
    }
  }

  // 2. Win rate shift detection
  const winRateShift = await detectWinRateShift(workspaceId, config);
  if (winRateShift) {
    suggestions.push(winRateShift);
  }

  // 3. Stale threshold validation
  const staleShift = await detectStaleThresholdShift(workspaceId, config);
  if (staleShift) {
    suggestions.push(staleShift);
  }

  // Store suggestions if any found
  if (suggestions.length > 0) {
    await storeSuggestions(workspaceId, suggestions);
    console.log(`[Drift Detection] ${suggestions.length} suggestions generated`);
  }

  return suggestions;
}

/**
 * Detect win rate shifts
 */
async function detectWinRateShift(workspaceId: string, config: any): Promise<ConfigSuggestion | null> {
  const result = await query<{
    current_win_rate: number;
    deals_counted: number;
  }>(
    `SELECT
      COUNT(*) FILTER (WHERE stage_normalized = 'closed_won')::float /
        NULLIF(COUNT(*), 0) as current_win_rate,
      COUNT(*) as deals_counted
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized IN ('closed_won', 'closed_lost')
       AND close_date >= NOW() - INTERVAL '30 days'`,
    [workspaceId]
  );

  const row = result.rows[0];
  if (!row || row.deals_counted < 10) return null;

  // Get previously calculated win rate from config meta
  const previousRate = config._meta?.['win_rate.current_rate']?.value;
  if (!previousRate) return null;

  const currentRate = row.current_win_rate;
  const shift = Math.abs(currentRate - previousRate);

  if (shift > 0.10) {
    // >10pp shift
    return {
      type: 'win_rate_shift',
      section: 'win_rate',
      message: `Win rate shifted from ${(previousRate * 100).toFixed(0)}% to ${(currentRate * 100).toFixed(0)}% (${shift > 0 ? '+' : ''}${(shift * 100).toFixed(0)}pp) in last 30 days. Review if Stage 0 exclusion or segmentation needs adjustment.`,
      suggested_action: {
        previous_rate: previousRate,
        current_rate: currentRate,
        shift_pp: shift * 100,
      },
      confidence: 0.75,
      detected_at: new Date().toISOString(),
    };
  }

  return null;
}

/**
 * Detect stale threshold shifts
 */
async function detectStaleThresholdShift(workspaceId: string, config: any): Promise<ConfigSuggestion | null> {
  // Check if deals are aging significantly beyond configured threshold
  const threshold = typeof config.thresholds.stale_deal_days === 'number'
    ? config.thresholds.stale_deal_days
    : config.thresholds.stale_deal_days.default || 14;

  const result = await query<{
    avg_days_no_activity: number;
    p50_days: number;
    p75_days: number;
  }>(
    `SELECT
      AVG(EXTRACT(DAY FROM NOW() - last_activity_date))::int as avg_days_no_activity,
      PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY EXTRACT(DAY FROM NOW() - last_activity_date))::int as p50_days,
      PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY EXTRACT(DAY FROM NOW() - last_activity_date))::int as p75_days
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized NOT IN ('closed_won', 'closed_lost')
       AND last_activity_date < NOW() - INTERVAL '7 days'`,
    [workspaceId]
  );

  const row = result.rows[0];
  if (!row) return null;

  // If p75 is significantly higher than threshold, suggest adjustment
  if (row.p75_days > threshold * 2) {
    return {
      type: 'stale_threshold_shift',
      section: 'thresholds',
      message: `75% of deals with no activity are aging beyond ${row.p75_days} days (current threshold: ${threshold} days). Consider adjusting stale threshold for your sales cycle.`,
      suggested_action: {
        current_threshold: threshold,
        suggested_threshold: row.p75_days,
        p50: row.p50_days,
        p75: row.p75_days,
      },
      confidence: 0.7,
      detected_at: new Date().toISOString(),
    };
  }

  return null;
}

/**
 * Store suggestions in database
 */
async function storeSuggestions(workspaceId: string, suggestions: ConfigSuggestion[]) {
  // Get existing suggestions
  const existing = await query<{ value: any }>(
    `SELECT value FROM context_layer
     WHERE workspace_id = $1 AND category = 'settings' AND key = 'config_suggestions'`,
    [workspaceId]
  );

  let allSuggestions: ConfigSuggestion[] = existing.rows[0]?.value || [];

  // Append new suggestions (dedup by type + section)
  for (const suggestion of suggestions) {
    const exists = allSuggestions.some(
      s => s.type === suggestion.type && s.section === suggestion.section
    );
    if (!exists) {
      allSuggestions.push(suggestion);
    }
  }

  // Keep only last 50 suggestions
  if (allSuggestions.length > 50) {
    allSuggestions = allSuggestions.slice(-50);
  }

  await query(
    `INSERT INTO context_layer (workspace_id, category, key, value, updated_at)
     VALUES ($1, 'settings', 'config_suggestions', $2::jsonb, NOW())
     ON CONFLICT (workspace_id, category, key)
     DO UPDATE SET value = $2::jsonb, updated_at = NOW()`,
    [workspaceId, JSON.stringify(allSuggestions)]
  );
}

/**
 * Get pending suggestions
 */
export async function getConfigSuggestions(workspaceId: string): Promise<ConfigSuggestion[]> {
  const result = await query<{ value: any }>(
    `SELECT value FROM context_layer
     WHERE workspace_id = $1 AND category = 'settings' AND key = 'config_suggestions'`,
    [workspaceId]
  );

  return result.rows[0]?.value || [];
}

/**
 * Clear all suggestions
 */
export async function clearConfigSuggestions(workspaceId: string) {
  await query(
    `DELETE FROM context_layer
     WHERE workspace_id = $1 AND category = 'settings' AND key = 'config_suggestions'`,
    [workspaceId]
  );
}
