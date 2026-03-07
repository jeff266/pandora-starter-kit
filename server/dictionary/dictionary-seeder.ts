import { query } from '../db.js';
import { configLoader } from '../config/workspace-config-loader.js';

export interface DictionaryEntry {
  term: string;
  definition: string;
  technical_definition?: string;
  source: 'user' | 'filter' | 'scope' | 'metric' | 'stage' | 'system';
  source_id?: string;
  created_by?: string;
}

const STOCK_METRICS: DictionaryEntry[] = [
  {
    term: 'Coverage Ratio',
    definition: 'The ratio of total open pipeline to the remaining revenue gap. A measure of whether there is enough pipeline to meet the target.',
    technical_definition: 'Total Open Pipeline / (Target - Closed Won)',
    source: 'system',
    created_by: 'system',
  },
  {
    term: 'Win Rate',
    definition: 'The percentage of closed deals that were won. Calculated based on historical performance over a set lookback period.',
    technical_definition: 'Closed Won / (Closed Won + Closed Lost)',
    source: 'system',
    created_by: 'system',
  },
  {
    term: 'Attainment',
    definition: 'Current progress towards the revenue target for the period.',
    technical_definition: 'Closed Won / Target Amount',
    source: 'system',
    created_by: 'system',
  },
  {
    term: 'Pipeline',
    definition: 'The total value of all active, non-closed opportunities.',
    technical_definition: 'Sum of Amount for all deals not in closed_won or closed_lost',
    source: 'system',
    created_by: 'system',
  },
  {
    term: 'Weighted Pipeline',
    definition: 'The total value of all active opportunities, adjusted by their individual close probabilities.',
    technical_definition: 'Sum of (Amount * Probability)',
    source: 'system',
    created_by: 'system',
  },
  {
    term: 'Average Deal Size',
    definition: 'The mean value of all won deals within the period.',
    technical_definition: 'Total Closed Won Value / Number of Won Deals',
    source: 'system',
    created_by: 'system',
  },
  {
    term: 'Average Sales Cycle',
    definition: 'The average number of days it takes for a deal to move from creation to closed-won.',
    technical_definition: 'Average(Won Date - Created Date)',
    source: 'system',
    created_by: 'system',
  },
  {
    term: 'Forecast Accuracy',
    definition: 'A measure of how closely a rep or team\'s commit matches their final closed-won performance.',
    technical_definition: 'Final Won Amount / Initial Commit',
    source: 'system',
    created_by: 'system',
  },
  {
    term: 'Shrink Rate',
    definition: 'The percentage of pipeline value that is lost or pushed out of the period over time.',
    technical_definition: '(Starting Pipeline - Ending Pipeline) / Starting Pipeline',
    source: 'system',
    created_by: 'system',
  },
  {
    term: 'Ramp Rate',
    definition: 'The speed at which a new rep reaches full productivity (full quota attainment).',
    technical_definition: 'Time from start date to first month of >80% attainment',
    source: 'system',
    created_by: 'system',
  },
];

export async function seedDictionary(workspaceId: string): Promise<void> {
  const config = await configLoader.getConfig(workspaceId).catch(() => null);
  if (!config) return;

  const entries: DictionaryEntry[] = [...STOCK_METRICS];

  // 1. Pipelines from analysis_scopes
  const scopesResult = await query<{ id: string; name: string; filter_field: string; filter_values: string[] }>(
    `SELECT id, name, filter_field, filter_values FROM analysis_scopes WHERE workspace_id = $1`,
    [workspaceId]
  ).catch(() => ({ rows: [] }));

  for (const scope of scopesResult.rows) {
    entries.push({
      term: scope.name,
      definition: `Pipeline scope for ${scope.name} deals.`,
      technical_definition: `${scope.filter_field} IN (${scope.filter_values.join(', ')})`,
      source: 'scope',
      source_id: scope.id,
      created_by: 'system',
    });
  }

  // 2. Stages from stage_configs / stage_mappings
  const stagesResult = await query<{ stage_name: string; stage_normalized: string }>(
    `SELECT stage_name, stage_normalized FROM stage_mappings WHERE workspace_id = $1`,
    [workspaceId]
  ).catch(() => ({ rows: [] }));

  for (const stage of stagesResult.rows) {
    entries.push({
      term: stage.stage_name,
      definition: `CRM stage mapped to normalized ${stage.stage_normalized} status.`,
      technical_definition: `stage_normalized = ${stage.stage_normalized}`,
      source: 'stage',
      created_by: 'system',
    });
  }

  // 3. Named filters
  if (config.named_filters) {
    for (const filter of config.named_filters) {
      if (filter.description) {
        entries.push({
          term: filter.label,
          definition: filter.description,
          technical_definition: JSON.stringify(filter.conditions),
          source: 'filter',
          source_id: filter.id,
          created_by: 'system',
        });
      }
    }
  }

  // Upsert all entries
  for (const entry of entries) {
    await query(
      `INSERT INTO data_dictionary (workspace_id, term, definition, technical_definition, source, source_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (workspace_id, term) DO UPDATE SET
         definition = EXCLUDED.definition,
         technical_definition = EXCLUDED.technical_definition,
         source = EXCLUDED.source,
         source_id = EXCLUDED.source_id,
         updated_at = NOW()`,
      [workspaceId, entry.term, entry.definition, entry.technical_definition, entry.source, entry.source_id, entry.created_by]
    ).catch(err => console.error(`[dictionary-seeder] Failed to upsert term ${entry.term}:`, err));
  }
}
