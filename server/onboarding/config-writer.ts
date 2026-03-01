import { query } from '../db.js';
import type { ConfigPatch, ConfigArtifact } from './types.js';

type ConfigSource = 'confirmed' | 'default' | 'inferred';

interface ConfigMeta {
  source: ConfigSource;
  confidence?: number;
  evidence?: string;
  last_validated: string;
}

async function setContextLayer(
  workspaceId: string,
  category: string,
  key: string,
  value: unknown,
  meta: ConfigMeta,
): Promise<void> {
  const valueWithMeta = { value, _meta: meta };
  await query(`
    INSERT INTO context_layer (workspace_id, category, key, value, updated_at)
    VALUES ($1, $2, $3, $4, NOW())
    ON CONFLICT (workspace_id, category, key)
    DO UPDATE SET value = $4, updated_at = NOW()
  `, [workspaceId, category, key, JSON.stringify(valueWithMeta)]);
}

export async function writeConfigPatch(
  workspaceId: string,
  questionId: string,
  patch: ConfigPatch,
  source: ConfigSource,
  hypothesisConfidence = 0.5,
): Promise<ConfigArtifact[]> {
  const artifacts: ConfigArtifact[] = [];
  const meta: ConfigMeta = {
    source,
    confidence: hypothesisConfidence,
    last_validated: new Date().toISOString(),
  };

  if (patch.parse_error) {
    return [];
  }

  switch (questionId) {
    case 'Q1_motions': {
      const motions = (patch as { motions?: Array<{ name: string; filter_field?: string; filter_values?: string[]; amount_threshold_min?: number; amount_threshold_max?: number }> }).motions;
      if (Array.isArray(motions)) {
        await setContextLayer(workspaceId, 'config', 'revenue_motions', motions, meta);

        const namedFiltersForConfig = motions.map(motion => {
          const filterRules: Record<string, unknown>[] = [];
          if (motion.filter_field === 'pipeline' || motion.filter_field === 'deal_type') {
            filterRules.push({ field: motion.filter_field, op: 'in', values: motion.filter_values ?? [] });
          } else if (motion.filter_field === 'amount') {
            if (motion.amount_threshold_min != null) filterRules.push({ field: 'amount', op: 'gte', value: motion.amount_threshold_min });
            if (motion.amount_threshold_max != null) filterRules.push({ field: 'amount', op: 'lte', value: motion.amount_threshold_max });
          }
          return { name: motion.name, rules: filterRules };
        }).filter(f => f.rules.length > 0);

        if (namedFiltersForConfig.length > 0) {
          await setContextLayer(workspaceId, 'config', 'onboarding_named_filters', namedFiltersForConfig, meta);
        }

        artifacts.push({
          type: 'named_filter',
          label: `${motions.length} Revenue Motion${motions.length > 1 ? 's' : ''} configured`,
          detail: motions.map(m => m.name).join(', '),
          items: motions.map(m => `${m.name}: ${m.filter_field ? `${m.filter_field} filter` : 'all deals'}`),
        });
      }
      break;
    }

    case 'Q2_calendar': {
      const p = patch as { fiscal_year_start_month?: number; quota_period?: string; quarterly_target?: number; motion_targets?: Array<{ motion: string; target: number }> };
      if (p.fiscal_year_start_month != null) {
        await setContextLayer(workspaceId, 'config', 'cadence.fiscal_year_start_month', p.fiscal_year_start_month, meta);
      }
      if (p.quota_period) {
        await setContextLayer(workspaceId, 'config', 'cadence.quota_period', p.quota_period, meta);
      }
      if (p.quarterly_target != null) {
        await query(`
          INSERT INTO goals (workspace_id, period, type, target, source, created_at)
          VALUES ($1, $2, 'bookings', $3, 'onboarding', NOW())
          ON CONFLICT (workspace_id, period, type) DO UPDATE SET target = $3
        `, [workspaceId, 'current_quarter', p.quarterly_target]).catch(() => null);
        artifacts.push({
          type: 'goal_set',
          label: 'Quarterly Target Set',
          detail: `$${(p.quarterly_target / 1_000_000).toFixed(1)}M quarterly target`,
        });
      }
      break;
    }

    case 'Q3_stages': {
      const p = patch as {
        won_stages?: string[]; lost_stages?: string[]; stage_0_stages?: string[];
        parking_lot_stages?: string[]; retired_stages?: string[];
      };
      const updates: Array<{ stage: string; col: string; val: boolean }> = [];
      for (const s of p.won_stages ?? []) updates.push({ stage: s, col: 'is_won', val: true });
      for (const s of p.lost_stages ?? []) updates.push({ stage: s, col: 'is_lost', val: true });
      for (const s of p.stage_0_stages ?? []) updates.push({ stage: s, col: 'is_stage_0', val: true });
      for (const s of p.parking_lot_stages ?? []) updates.push({ stage: s, col: 'is_parking_lot', val: true });
      for (const s of p.retired_stages ?? []) updates.push({ stage: s, col: 'is_retired', val: true });

      for (const u of updates) {
        await query(`
          UPDATE stage_configs SET ${u.col} = $3
          WHERE workspace_id = $1 AND stage_name = $2
        `, [workspaceId, u.stage, u.val]).catch(() => null);
      }
      await setContextLayer(workspaceId, 'config', 'stage_classification', p, meta);
      artifacts.push({
        type: 'stage_update',
        label: 'Stages Classified',
        detail: `Won: ${p.won_stages?.length ?? 0}, Lost: ${p.lost_stages?.length ?? 0}, Parking Lot: ${p.parking_lot_stages?.length ?? 0}`,
      });
      break;
    }

    case 'Q4_team': {
      const p = patch as { reps?: Array<{ name: string; motion?: string; is_new_hire?: boolean }>; excluded_owners?: string[]; managers?: string[] };
      await setContextLayer(workspaceId, 'config', 'teams.reps', p.reps ?? [], meta);
      await setContextLayer(workspaceId, 'config', 'teams.excluded_owners', p.excluded_owners ?? [], meta);
      if (p.managers?.length) {
        await setContextLayer(workspaceId, 'config', 'teams.managers', p.managers, meta);
      }
      artifacts.push({
        type: 'rep_classified',
        label: 'Team Roster Saved',
        detail: `${p.reps?.length ?? 0} reps, ${p.excluded_owners?.length ?? 0} excluded`,
      });
      break;
    }

    default: {
      const configKey = `onboarding.${questionId}`;
      await setContextLayer(workspaceId, 'onboarding', configKey, patch, meta);

      const targetsWritten = Object.keys(patch).filter(k => !k.startsWith('_') && k !== 'parse_error');
      artifacts.push({
        type: 'config_saved',
        label: 'Settings Saved',
        detail: targetsWritten.join(', '),
      });
      break;
    }
  }

  return artifacts;
}
