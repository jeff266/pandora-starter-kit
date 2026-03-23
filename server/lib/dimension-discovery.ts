import { query } from '../db.js';
import { previewFilter } from './dimension-executor.js';
import type { DimensionFilter, FilterCondition } from './data-dictionary.js';

export interface DiscoveredDimension {
  suggested_key:     string;
  suggested_label:   string;
  filter:            DimensionFilter;
  value_field:       string;
  value_field_label: string;
  value_transform?:  { type: 'multiply' | 'divide'; factor: number };
  preview_count:     number;
  preview_value:     number;
  confidence:        'high' | 'medium' | 'low';
  reason:            string;
}

const NORMALIZED_STAGES = new Set([
  'prospecting', 'qualification', 'discovery', 'demo', 'evaluation',
  'proposal', 'negotiation', 'closed_won', 'closed_lost',
]);

const ARR_FIELD_PATTERNS = /\b(arr|acv|tcv|mrr|revenue)\b/i;

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

function confidence(dealCount: number): 'high' | 'medium' | 'low' {
  if (dealCount >= 50) return 'high';
  if (dealCount >= 10) return 'medium';
  return 'low';
}

export async function discoverDimensions(workspaceId: string): Promise<DiscoveredDimension[]> {
  const suggestions: DiscoveredDimension[] = [];

  const [
    stageRows,
    pipelineRows,
    leadSourceRows,
    recordTypeRows,
    customFieldRows,
    ownerEmailRows,
  ] = await Promise.all([
    discoverStages(workspaceId),
    discoverPipelines(workspaceId),
    discoverLeadSources(workspaceId),
    discoverRecordTypes(workspaceId),
    discoverCustomFields(workspaceId),
    discoverOwnerPatterns(workspaceId),
  ]);

  const candidates: Array<{
    key: string;
    label: string;
    filter: DimensionFilter;
    value_field: string;
    value_field_label: string;
    reason: string;
  }> = [
    ...stageRows,
    ...pipelineRows,
    ...leadSourceRows,
    ...recordTypeRows,
    ...customFieldRows,
    ...ownerEmailRows,
  ];

  const valueFields = await discoverValueFields(workspaceId);

  const previewed = await Promise.all(
    candidates.map(async candidate => {
      try {
        const preview = await previewFilter(
          workspaceId,
          candidate.filter,
          candidate.value_field,
          'standard'
        );
        if (preview.deal_count < 5) return null;

        return {
          suggested_key:     candidate.key,
          suggested_label:   candidate.label,
          filter:            candidate.filter,
          value_field:       candidate.value_field,
          value_field_label: candidate.value_field_label,
          preview_count:     preview.deal_count,
          preview_value:     preview.total_value,
          confidence:        confidence(preview.deal_count),
          reason:            candidate.reason,
        } satisfies DiscoveredDimension;
      } catch {
        return null;
      }
    })
  );

  for (const item of previewed) {
    if (item) suggestions.push(item);
  }

  for (const vf of valueFields) {
    suggestions.push(vf);
  }

  suggestions.sort((a, b) => {
    const confOrder = { high: 0, medium: 1, low: 2 };
    const confDiff = confOrder[a.confidence] - confOrder[b.confidence];
    if (confDiff !== 0) return confDiff;
    if (b.preview_count !== a.preview_count) return b.preview_count - a.preview_count;
    return b.preview_value - a.preview_value;
  });

  return suggestions;
}

async function discoverStages(workspaceId: string): Promise<Array<{
  key: string; label: string; filter: DimensionFilter;
  value_field: string; value_field_label: string; reason: string;
}>> {
  try {
    const result = await query(
      `SELECT DISTINCT stage_normalized FROM deals WHERE workspace_id = $1 AND stage_normalized IS NOT NULL`,
      [workspaceId]
    );

    const unmapped = result.rows
      .map((r: any) => r.stage_normalized as string)
      .filter(s => !NORMALIZED_STAGES.has(s));

    if (unmapped.length === 0) return [];

    const openStages = result.rows
      .map((r: any) => r.stage_normalized as string)
      .filter(s => s !== 'closed_won' && s !== 'closed_lost');

    if (openStages.length === 0) return [];

    const filter: DimensionFilter = {
      operator: 'AND',
      conditions: [
        {
          field:       'stage',
          field_type:  'standard',
          field_label: 'Stage',
          operator:    'not_in',
          value:       ['closed_won', 'closed_lost'],
        } as FilterCondition,
      ],
    };

    return [{
      key:             'active_pipeline',
      label:           'Active Pipeline',
      filter,
      value_field:     'amount',
      value_field_label: 'Amount',
      reason:          `Detected ${unmapped.length} stage(s) not in normalized list — active pipeline filter proposed`,
    }];
  } catch {
    return [];
  }
}

async function discoverPipelines(workspaceId: string): Promise<Array<{
  key: string; label: string; filter: DimensionFilter;
  value_field: string; value_field_label: string; reason: string;
}>> {
  try {
    const result = await query(
      `SELECT pipeline, COUNT(*) AS deal_count
       FROM deals WHERE workspace_id = $1 AND pipeline IS NOT NULL
       GROUP BY pipeline
       HAVING COUNT(*) >= 5`,
      [workspaceId]
    );

    if (result.rows.length <= 1) return [];

    return result.rows.map((r: any) => {
      const pipelineName = r.pipeline as string;
      const key = `pipeline_${slugify(pipelineName)}`;
      const label = `Pipeline: ${pipelineName}`;
      const filter: DimensionFilter = {
        operator: 'AND',
        conditions: [
          {
            field:       'pipeline',
            field_type:  'standard',
            field_label: 'Pipeline',
            operator:    'equals',
            value:       pipelineName,
          } as FilterCondition,
          {
            field:       'stage',
            field_type:  'standard',
            field_label: 'Stage',
            operator:    'not_in',
            value:       ['closed_won', 'closed_lost'],
          } as FilterCondition,
        ],
      };
      return {
        key,
        label,
        filter,
        value_field:      'amount',
        value_field_label: 'Amount',
        reason:           `Multiple pipelines detected; pipeline "${pipelineName}" has ${r.deal_count} deals`,
      };
    });
  } catch {
    return [];
  }
}

async function discoverLeadSources(workspaceId: string): Promise<Array<{
  key: string; label: string; filter: DimensionFilter;
  value_field: string; value_field_label: string; reason: string;
}>> {
  try {
    const result = await query(
      `SELECT lead_source, COUNT(*) AS deal_count
       FROM deals WHERE workspace_id = $1 AND lead_source IS NOT NULL
       GROUP BY lead_source
       HAVING COUNT(*) >= 5`,
      [workspaceId]
    );

    if (result.rows.length <= 1) return [];

    return result.rows.map((r: any) => {
      const src = r.lead_source as string;
      const key = `lead_source_${slugify(src)}`;
      const label = `Lead Source: ${src}`;
      const filter: DimensionFilter = {
        operator: 'AND',
        conditions: [
          {
            field:       'lead_source',
            field_type:  'standard',
            field_label: 'Lead Source',
            operator:    'equals',
            value:       src,
          } as FilterCondition,
          {
            field:       'stage',
            field_type:  'standard',
            field_label: 'Stage',
            operator:    'not_in',
            value:       ['closed_won', 'closed_lost'],
          } as FilterCondition,
        ],
      };
      return {
        key,
        label,
        filter,
        value_field:      'amount',
        value_field_label: 'Amount',
        reason:           `Multiple lead sources detected; "${src}" has ${r.deal_count} deals`,
      };
    });
  } catch {
    return [];
  }
}

async function discoverRecordTypes(workspaceId: string): Promise<Array<{
  key: string; label: string; filter: DimensionFilter;
  value_field: string; value_field_label: string; reason: string;
}>> {
  try {
    const result = await query(
      `SELECT kv.key, kv.value, COUNT(*) AS deal_count
       FROM deals,
            jsonb_each_text(custom_fields) AS kv(key, value)
       WHERE workspace_id = $1
         AND custom_fields IS NOT NULL
         AND kv.key ~* '(type|record_type|object_type|deal_type|opportunity_type)'
         AND kv.value IS NOT NULL
         AND kv.value != ''
       GROUP BY kv.key, kv.value
       HAVING COUNT(*) >= 5`,
      [workspaceId]
    );

    if (result.rows.length === 0) return [];

    const byKey = new Map<string, { value: string; count: number }[]>();
    for (const r of result.rows) {
      const k = r.key as string;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k)!.push({ value: r.value as string, count: Number(r.deal_count) });
    }

    const candidates: Array<{
      key: string; label: string; filter: DimensionFilter;
      value_field: string; value_field_label: string; reason: string;
    }> = [];

    for (const [fieldName, entries] of byKey.entries()) {
      if (entries.length <= 1) continue;
      for (const entry of entries) {
        const dimKey = `record_type_${slugify(fieldName)}_${slugify(entry.value)}`;
        const label = `${fieldName.replace(/_/g, ' ')}: ${entry.value}`;
        const filter: DimensionFilter = {
          operator: 'AND',
          conditions: [
            {
              field:       fieldName,
              field_type:  'custom',
              field_label: fieldName,
              operator:    'equals',
              value:       entry.value,
            } as FilterCondition,
            {
              field:       'stage',
              field_type:  'standard',
              field_label: 'Stage',
              operator:    'not_in',
              value:       ['closed_won', 'closed_lost'],
            } as FilterCondition,
          ],
        };
        candidates.push({
          key:              dimKey,
          label,
          filter,
          value_field:      'amount',
          value_field_label: 'Amount',
          reason:           `Record/object type field "${fieldName}" has multiple values; "${entry.value}" has ${entry.count} deals`,
        });
      }
    }

    return candidates;
  } catch {
    return [];
  }
}

async function discoverCustomFields(workspaceId: string): Promise<Array<{
  key: string; label: string; filter: DimensionFilter;
  value_field: string; value_field_label: string; reason: string;
}>> {
  try {
    const result = await query(
      `SELECT kv.key,
              COUNT(DISTINCT kv.value) AS distinct_values,
              array_agg(DISTINCT kv.value ORDER BY kv.value) AS values
       FROM deals,
            jsonb_each_text(custom_fields) AS kv(key, value)
       WHERE workspace_id = $1
         AND custom_fields IS NOT NULL
         AND kv.value IS NOT NULL
         AND kv.value != ''
       GROUP BY kv.key
       HAVING COUNT(DISTINCT kv.value) BETWEEN 2 AND 10`,
      [workspaceId]
    );

    const candidates: Array<{
      key: string; label: string; filter: DimensionFilter;
      value_field: string; value_field_label: string; reason: string;
    }> = [];

    for (const row of result.rows) {
      const fieldName = row.key as string;
      const values = row.values as string[];
      const distinctCount = Number(row.distinct_values);

      for (const val of values) {
        const key = `${slugify(fieldName)}_${slugify(val)}`;
        const label = `${fieldName.replace(/_/g, ' ')}: ${val}`;
        const filter: DimensionFilter = {
          operator: 'AND',
          conditions: [
            {
              field:       fieldName,
              field_type:  'custom',
              field_label: fieldName,
              operator:    'equals',
              value:       val,
            } as FilterCondition,
            {
              field:       'stage',
              field_type:  'standard',
              field_label: 'Stage',
              operator:    'not_in',
              value:       ['closed_won', 'closed_lost'],
            } as FilterCondition,
          ],
        };
        candidates.push({
          key,
          label,
          filter,
          value_field:      'amount',
          value_field_label: 'Amount',
          reason:           `Custom field "${fieldName}" has ${distinctCount} distinct values; "${val}" is a candidate dimension`,
        });
      }
    }

    return candidates;
  } catch {
    return [];
  }
}

async function discoverOwnerPatterns(workspaceId: string): Promise<Array<{
  key: string; label: string; filter: DimensionFilter;
  value_field: string; value_field_label: string; reason: string;
}>> {
  try {
    const result = await query(
      `SELECT owner_email, COUNT(*)::int AS deal_count
       FROM deals
       WHERE workspace_id = $1 AND owner_email IS NOT NULL
         AND stage_normalized NOT IN ('closed_won', 'closed_lost')
       GROUP BY owner_email`,
      [workspaceId]
    );

    const domainMap = new Map<string, { emails: string[]; count: number }>();
    for (const row of result.rows) {
      const email = row.owner_email as string;
      const parts = email.split('@');
      if (parts.length !== 2) continue;
      const domain = parts[1].toLowerCase();
      if (!domainMap.has(domain)) domainMap.set(domain, { emails: [], count: 0 });
      const entry = domainMap.get(domain)!;
      entry.emails.push(email);
      entry.count += Number(row.deal_count);
    }

    const regionDomains = Array.from(domainMap.entries())
      .filter(([domain]) => /\b(apac|emea|amer|latam|asia|europe|us|uk|au)\b/i.test(domain));

    if (regionDomains.length < 2) return [];

    return regionDomains.map(([domain, info]) => {
      const regionName = domain.split('.')[0].toUpperCase();
      const key = `region_${slugify(regionName)}`;
      const label = `${regionName} Region`;
      const filter: DimensionFilter = {
        operator: 'AND',
        conditions: [
          {
            field:       'owner_email',
            field_type:  'standard',
            field_label: 'Owner Email',
            operator:    'in',
            value:       info.emails,
          } as FilterCondition,
          {
            field:       'stage',
            field_type:  'standard',
            field_label: 'Stage',
            operator:    'not_in',
            value:       ['closed_won', 'closed_lost'],
          } as FilterCondition,
        ],
      };
      return {
        key,
        label,
        filter,
        value_field:      'amount',
        value_field_label: 'Amount',
        reason:           `Owner emails cluster under regional domain pattern "${domain}" — ${info.count} deals`,
      };
    });
  } catch {
    return [];
  }
}

async function discoverValueFields(workspaceId: string): Promise<DiscoveredDimension[]> {
  try {
    const result = await query(
      `SELECT DISTINCT kv.key
       FROM deals,
            jsonb_each_text(custom_fields) AS kv(key, value)
       WHERE workspace_id = $1
         AND custom_fields IS NOT NULL
         AND kv.key ~* '(arr|acv|tcv|mrr|revenue)'`,
      [workspaceId]
    );

    const valueFieldCandidates: DiscoveredDimension[] = [];

    for (const row of result.rows) {
      const fieldName = row.key as string;
      try {
        const filter: DimensionFilter = {
          operator: 'AND',
          conditions: [
            {
              field:       'stage',
              field_type:  'standard',
              field_label: 'Stage',
              operator:    'not_in',
              value:       ['closed_won', 'closed_lost'],
            } as FilterCondition,
          ],
        };

        const preview = await previewFilter(workspaceId, filter, fieldName, 'custom');
        if (preview.deal_count < 5) continue;

        const isMrr = /mrr/i.test(fieldName);
        const transform: { type: 'multiply'; factor: number } | undefined = isMrr
          ? { type: 'multiply', factor: 12 }
          : undefined;
        const label = isMrr
          ? `Active Pipeline (${fieldName} × 12 ARR)`
          : `Active Pipeline (${fieldName})`;
        const reason = isMrr
          ? `MRR field "${fieldName}" detected — suggesting ARR-equivalent pipeline (MRR × 12)`
          : `Custom numeric field "${fieldName}" detected — likely ARR/ACV value field`;

        valueFieldCandidates.push({
          suggested_key:     `active_pipeline_${slugify(fieldName)}`,
          suggested_label:   label,
          filter,
          value_field:       fieldName,
          value_field_label: fieldName.toUpperCase(),
          value_transform:   transform,
          preview_count:     preview.deal_count,
          preview_value:     preview.total_value,
          confidence:        confidence(preview.deal_count),
          reason,
        });
      } catch {
      }
    }

    return valueFieldCandidates;
  } catch {
    return [];
  }
}
