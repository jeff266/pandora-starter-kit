import { query } from '../db.js';
import type { ConfigPatch, ConfigArtifact } from './types.js';

type ConfigSource = 'confirmed' | 'default' | 'inferred';

interface ConfigMeta {
  source: ConfigSource;
  confidence?: number;
  evidence?: string;
  last_validated: string;
}

async function mergeDefinitions(workspaceId: string, patch: Record<string, unknown>): Promise<void> {
  const patchJson = JSON.stringify(patch);
  const existing = await query(
    `SELECT id FROM context_layer WHERE workspace_id = $1::uuid LIMIT 1`,
    [workspaceId]
  );
  if (existing.rows[0]) {
    await query(
      `UPDATE context_layer SET definitions = COALESCE(definitions, '{}'::jsonb) || $1::jsonb, updated_at = NOW() WHERE id = $2`,
      [patchJson, existing.rows[0].id]
    );
  } else {
    await query(
      `INSERT INTO context_layer (workspace_id, definitions, updated_at) VALUES ($1::uuid, $2::jsonb, NOW())`,
      [workspaceId, patchJson]
    );
  }
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

        await mergeDefinitions(workspaceId, {
          revenue_motions: { value: motions, _meta: meta },
          onboarding_named_filters: namedFiltersForConfig.length > 0
            ? { value: namedFiltersForConfig, _meta: meta }
            : undefined,
        });

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
      const cadencePatch: Record<string, unknown> = {};
      if (p.fiscal_year_start_month != null) cadencePatch['cadence_fiscal_year_start_month'] = { value: p.fiscal_year_start_month, _meta: meta };
      if (p.quota_period) cadencePatch['cadence_quota_period'] = { value: p.quota_period, _meta: meta };
      if (Object.keys(cadencePatch).length > 0) {
        await mergeDefinitions(workspaceId, cadencePatch);
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
      await mergeDefinitions(workspaceId, { stage_classification: { value: p, _meta: meta } });
      artifacts.push({
        type: 'stage_update',
        label: 'Stages Classified',
        detail: `Won: ${p.won_stages?.length ?? 0}, Lost: ${p.lost_stages?.length ?? 0}, Parking Lot: ${p.parking_lot_stages?.length ?? 0}`,
      });
      break;
    }

    case 'Q4_team': {
      const p = patch as { reps?: Array<{ name: string; motion?: string; is_new_hire?: boolean }>; excluded_owners?: string[]; managers?: string[] };
      await mergeDefinitions(workspaceId, {
        teams_reps: { value: p.reps ?? [], _meta: meta },
        teams_excluded_owners: { value: p.excluded_owners ?? [], _meta: meta },
        ...(p.managers?.length ? { teams_managers: { value: p.managers, _meta: meta } } : {}),
      });
      artifacts.push({
        type: 'rep_classified',
        label: 'Team Roster Saved',
        detail: `${p.reps?.length ?? 0} reps, ${p.excluded_owners?.length ?? 0} excluded`,
      });
      break;
    }

    case 'Q7_winrate': {
      const p = patch as { exclude_stage_0?: boolean; lookback_days?: number; segment_by_motion?: boolean; sao_stage?: string | null };
      const winRatePatch: Record<string, unknown> = {
        win_rate_config: {
          value: {
            exclude_stage_0: p.exclude_stage_0 ?? false,
            lookback_days: p.lookback_days ?? 180,
            segment_by_motion: p.segment_by_motion ?? false,
          },
          _meta: meta,
        },
      };
      if (p.sao_stage) {
        winRatePatch['sao_stage'] = { value: p.sao_stage, _meta: meta };
        await query(`ALTER TABLE stage_configs ADD COLUMN IF NOT EXISTS is_sao boolean DEFAULT false`).catch(() => null);
        await query(
          `UPDATE stage_configs SET is_sao = (stage_name = $2) WHERE workspace_id = $1::uuid`,
          [workspaceId, p.sao_stage]
        ).catch(() => null);
      }
      await mergeDefinitions(workspaceId, winRatePatch);
      const detail = [
        p.exclude_stage_0 ? 'Qualified deals only' : 'All deals',
        `${p.lookback_days ?? 180}d lookback`,
        p.sao_stage ? `SAO: ${p.sao_stage}` : null,
      ].filter(Boolean).join(', ');
      artifacts.push({ type: 'config_saved', label: 'Win Rate Configured', detail });
      break;
    }

    default: {
      const configKey = `onboarding_${questionId}`;
      await mergeDefinitions(workspaceId, { [configKey]: { value: patch, _meta: meta } });

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
