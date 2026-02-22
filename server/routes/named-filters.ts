import { Router, type Request, type Response } from 'express';
import { query } from '../db.js';
import { configLoader, WorkspaceConfigLoader } from '../config/workspace-config-loader.js';
import { filterResolver, FilterNotFoundError } from '../tools/filter-resolver.js';
import type { NamedFilter } from '../types/workspace-config.js';

const router = Router();

interface WorkspaceParams {
  workspaceId: string;
}

interface FilterParams extends WorkspaceParams {
  filterId: string;
}

async function saveWorkspaceFilters(workspaceId: string, filters: NamedFilter[]): Promise<void> {
  await query(
    `UPDATE context_layer
     SET definitions = jsonb_set(
       jsonb_set(
         COALESCE(definitions, '{}'::jsonb),
         '{workspace_config}',
         COALESCE(definitions->'workspace_config', '{}'::jsonb)
       ),
       '{workspace_config,named_filters}',
       $2::jsonb
     ),
     updated_at = NOW()
     WHERE workspace_id = $1`,
    [workspaceId, JSON.stringify(filters)]
  );
  configLoader.clearCache(workspaceId);
}

router.get('/:workspaceId/filters', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const objectFilter = req.query.object as string | undefined;

    const config = await configLoader.getConfig(workspaceId);
    let filters = config.named_filters || [];

    if (objectFilter) {
      filters = filters.filter(f => f.object === objectFilter);
    }

    res.json({ success: true, filters });
  } catch (error) {
    console.error('[NamedFilters] Error fetching filters:', error);
    res.status(500).json({ error: 'Failed to fetch filters' });
  }
});

const FIELD_SCHEMAS: Record<string, { field: string; label: string; type: string; values_query?: string }[]> = {
  deals: [
    { field: 'amount', label: 'Amount', type: 'number' },
    { field: 'stage_normalized', label: 'Stage', type: 'text', values_query: 'SELECT DISTINCT stage_normalized as val FROM deals WHERE workspace_id = $1 AND stage_normalized IS NOT NULL ORDER BY stage_normalized LIMIT 50' },
    { field: 'pipeline_name', label: 'Pipeline', type: 'text', values_query: 'SELECT DISTINCT pipeline_name as val FROM deals WHERE workspace_id = $1 AND pipeline_name IS NOT NULL ORDER BY pipeline_name LIMIT 50' },
    { field: 'owner_name', label: 'Owner', type: 'text', values_query: 'SELECT DISTINCT owner_name as val FROM deals WHERE workspace_id = $1 AND owner_name IS NOT NULL ORDER BY owner_name LIMIT 50' },
    { field: 'owner_email', label: 'Owner Email', type: 'text', values_query: 'SELECT DISTINCT owner_email as val FROM deals WHERE workspace_id = $1 AND owner_email IS NOT NULL ORDER BY owner_email LIMIT 50' },
    { field: 'close_date', label: 'Close Date', type: 'date' },
    { field: 'created_at', label: 'Created At', type: 'date' },
    { field: 'probability', label: 'Probability', type: 'number' },
    { field: 'days_in_current_stage', label: 'Days in Current Stage', type: 'number' },
    { field: 'days_since_last_activity', label: 'Days Since Last Activity', type: 'number' },
    { field: 'is_open', label: 'Is Open', type: 'boolean' },
    { field: 'contact_count', label: 'Contact Count', type: 'number' },
    { field: 'source', label: 'Source', type: 'text', values_query: 'SELECT DISTINCT source as val FROM deals WHERE workspace_id = $1 AND source IS NOT NULL ORDER BY source LIMIT 50' },
  ],
  contacts: [
    { field: 'email', label: 'Email', type: 'text' },
    { field: 'first_name', label: 'First Name', type: 'text' },
    { field: 'last_name', label: 'Last Name', type: 'text' },
    { field: 'title', label: 'Title', type: 'text', values_query: 'SELECT DISTINCT title as val FROM contacts WHERE workspace_id = $1 AND title IS NOT NULL ORDER BY title LIMIT 50' },
    { field: 'lifecycle_stage', label: 'Lifecycle Stage', type: 'text', values_query: 'SELECT DISTINCT lifecycle_stage as val FROM contacts WHERE workspace_id = $1 AND lifecycle_stage IS NOT NULL ORDER BY lifecycle_stage LIMIT 50' },
    { field: 'lead_status', label: 'Lead Status', type: 'text', values_query: 'SELECT DISTINCT lead_status as val FROM contacts WHERE workspace_id = $1 AND lead_status IS NOT NULL ORDER BY lead_status LIMIT 50' },
    { field: 'created_at', label: 'Created At', type: 'date' },
  ],
  accounts: [
    { field: 'name', label: 'Name', type: 'text' },
    { field: 'domain', label: 'Domain', type: 'text' },
    { field: 'industry', label: 'Industry', type: 'text', values_query: 'SELECT DISTINCT industry as val FROM accounts WHERE workspace_id = $1 AND industry IS NOT NULL ORDER BY industry LIMIT 50' },
    { field: 'owner_name', label: 'Owner', type: 'text', values_query: 'SELECT DISTINCT owner_name as val FROM accounts WHERE workspace_id = $1 AND owner_name IS NOT NULL ORDER BY owner_name LIMIT 50' },
    { field: 'created_at', label: 'Created At', type: 'date' },
  ],
  conversations: [
    { field: 'title', label: 'Title', type: 'text' },
    { field: 'call_date', label: 'Call Date', type: 'date' },
    { field: 'source', label: 'Source', type: 'text', values_query: 'SELECT DISTINCT source as val FROM conversations WHERE workspace_id = $1 AND source IS NOT NULL ORDER BY source LIMIT 50' },
    { field: 'duration_minutes', label: 'Duration (min)', type: 'number' },
    { field: 'created_at', label: 'Created At', type: 'date' },
  ],
};

router.get('/:workspaceId/filters/field-options', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const object = req.query.object as string || 'deals';

    const validObjects = ['deals', 'contacts', 'accounts', 'conversations'];
    if (!validObjects.includes(object)) {
      res.status(400).json({ error: `object must be one of: ${validObjects.join(', ')}` });
      return;
    }

    const schema = FIELD_SCHEMAS[object] || [];
    const standardFields: any[] = [];

    for (const field of schema) {
      const entry: any = { field: field.field, label: field.label, type: field.type };
      if (field.values_query) {
        try {
          const result = await query<{ val: string }>(field.values_query, [workspaceId]);
          entry.values = result.rows.map(r => r.val).filter(Boolean);
        } catch {
          entry.values = [];
        }
      }
      standardFields.push(entry);
    }

    const EXCLUDED_CUSTOM_KEYS = new Set([
      'hs_object_id', 'hs_createdate', 'hs_lastmodifieddate', 'hs_all_owner_ids',
      'hs_all_team_ids', 'hs_all_accessible_team_ids', 'hs_updated_by_user_id',
      'hs_created_by_user_id', 'hs_user_ids_of_all_owners', 'hs_merged_object_ids',
      'hs_unique_creation_key', 'hs_pipeline', 'hs_pipeline_stage',
      'hs_deal_stage_probability', 'hs_is_closed', 'hs_is_closed_won',
      'hs_num_associated_contacts', 'hs_num_associated_companies',
      'hs_num_associated_deal_registrations', 'hs_num_associated_deal_splits',
      'hs_v2_date_entered_*', 'hs_v2_date_exited_*',
    ]);

    function isExcludedKey(key: string): boolean {
      if (EXCLUDED_CUSTOM_KEYS.has(key)) return true;
      if (key.startsWith('hs_v2_date_entered_') || key.startsWith('hs_v2_date_exited_')) return true;
      if (key.startsWith('hs_date_entered_') || key.startsWith('hs_date_exited_')) return true;
      if (key.startsWith('hs_time_in_')) return true;
      if (key.endsWith('_object_id') || key.endsWith('_object_ids')) return true;
      return false;
    }

    function looksLikeIds(values: string[]): boolean {
      if (values.length === 0) return false;
      return values.length > 5 && values.every(v => /^\d{5,}$/.test(v));
    }

    let customFields: any[] = [];
    if (object === 'deals' || object === 'contacts' || object === 'accounts') {
      try {
        const keysResult = await query<{ key: string }>(
          `SELECT DISTINCT k as key FROM ${object}, jsonb_object_keys(COALESCE(custom_fields, '{}'::jsonb)) k WHERE workspace_id = $1 LIMIT 50`,
          [workspaceId]
        );
        for (const row of keysResult.rows) {
          if (isExcludedKey(row.key)) continue;

          const safeKey = row.key.replace(/'/g, "''");
          const valuesResult = await query<{ val: string }>(
            `SELECT DISTINCT custom_fields->>$2 as val FROM ${object} WHERE workspace_id = $1 AND custom_fields->>$2 IS NOT NULL ORDER BY 1 LIMIT 20`,
            [workspaceId, row.key]
          );
          const values = valuesResult.rows.map(r => r.val).filter(Boolean);

          if (looksLikeIds(values)) continue;

          customFields.push({
            field: `custom_fields->>'${safeKey}'`,
            label: row.key.replace(/^hs_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            type: 'text',
            values,
          });
        }
      } catch {
        customFields = [];
      }
    }

    res.json({ success: true, standard_fields: standardFields, custom_fields: customFields });
  } catch (error) {
    console.error('[NamedFilters] Error fetching field options:', error);
    res.status(500).json({ error: 'Failed to fetch field options' });
  }
});

router.get('/:workspaceId/filters/:filterId', async (req: Request<FilterParams>, res: Response) => {
  try {
    const { workspaceId, filterId } = req.params;

    const config = await configLoader.getConfig(workspaceId);
    const filters = config.named_filters || [];
    const filter = filters.find(f => f.id === filterId);

    if (!filter) {
      res.status(404).json({ error: `Filter "${filterId}" not found` });
      return;
    }

    const usageResult = await query<{ count: string; last_used: string }>(
      `SELECT COUNT(*)::text as count, MAX(used_at)::text as last_used
       FROM filter_usage_log
       WHERE workspace_id = $1 AND filter_id = $2`,
      [workspaceId, filterId]
    );

    const usage = usageResult.rows[0];

    res.json({
      success: true,
      filter: {
        ...filter,
        usage_count: parseInt(usage?.count || '0', 10),
        last_used_at: usage?.last_used || null,
      },
    });
  } catch (error) {
    console.error('[NamedFilters] Error fetching filter:', error);
    res.status(500).json({ error: 'Failed to fetch filter' });
  }
});

router.post('/:workspaceId/filters', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const { id, label, description, object, conditions } = req.body;

    if (!id || !label || !object || !conditions) {
      res.status(400).json({ error: 'id, label, object, and conditions are required' });
      return;
    }

    if (!/^[a-z0-9_]+$/.test(id)) {
      res.status(400).json({ error: 'Filter ID must be lowercase alphanumeric with underscores' });
      return;
    }

    const validObjects = ['deals', 'contacts', 'accounts', 'conversations'];
    if (!validObjects.includes(object)) {
      res.status(400).json({ error: `object must be one of: ${validObjects.join(', ')}` });
      return;
    }

    const config = await configLoader.getConfig(workspaceId);
    const filters = [...(config.named_filters || [])];

    if (filters.find(f => f.id === id)) {
      res.status(409).json({ error: `Filter "${id}" already exists` });
      return;
    }

    const now = new Date().toISOString();
    const newFilter: NamedFilter = {
      id,
      label,
      description: description || undefined,
      object,
      conditions,
      source: 'user_defined',
      confidence: 1.0,
      confirmed: true,
      created_at: now,
      updated_at: now,
      created_by: (req as any).user?.email || 'api',
    };

    filters.push(newFilter);
    await saveWorkspaceFilters(workspaceId, filters);

    res.status(201).json({ success: true, filter: newFilter });
  } catch (error) {
    console.error('[NamedFilters] Error creating filter:', error);
    res.status(500).json({ error: 'Failed to create filter' });
  }
});

router.put('/:workspaceId/filters/:filterId', async (req: Request<FilterParams>, res: Response) => {
  try {
    const { workspaceId, filterId } = req.params;
    const { label, description, conditions, object } = req.body;

    const config = await configLoader.getConfig(workspaceId);
    const filters = [...(config.named_filters || [])];
    const idx = filters.findIndex(f => f.id === filterId);

    if (idx === -1) {
      res.status(404).json({ error: `Filter "${filterId}" not found` });
      return;
    }

    const updated: NamedFilter = {
      ...filters[idx],
      ...(label !== undefined && { label }),
      ...(description !== undefined && { description }),
      ...(conditions !== undefined && { conditions }),
      ...(object !== undefined && { object }),
      source: 'user_defined',
      updated_at: new Date().toISOString(),
    };

    filters[idx] = updated;
    await saveWorkspaceFilters(workspaceId, filters);

    res.json({ success: true, filter: updated });
  } catch (error) {
    console.error('[NamedFilters] Error updating filter:', error);
    res.status(500).json({ error: 'Failed to update filter' });
  }
});

router.delete('/:workspaceId/filters/:filterId', async (req: Request<FilterParams>, res: Response) => {
  try {
    const { workspaceId, filterId } = req.params;

    const config = await configLoader.getConfig(workspaceId);
    const filters = [...(config.named_filters || [])];
    const idx = filters.findIndex(f => f.id === filterId);

    if (idx === -1) {
      res.status(404).json({ error: `Filter "${filterId}" not found` });
      return;
    }

    const agentCheck = await query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM agents
       WHERE workspace_id = $1
       AND (filter_config::text ILIKE $2 OR filter_config::text ILIKE $3)`,
      [workspaceId, `%"${filterId}"%`, `%${filterId}%`]
    );

    if (parseInt(agentCheck.rows[0]?.count || '0', 10) > 0) {
      res.status(409).json({ error: `Filter "${filterId}" is referenced by active agents. Remove it from agent configurations first.` });
      return;
    }

    filters.splice(idx, 1);
    await saveWorkspaceFilters(workspaceId, filters);

    res.json({ success: true, deleted: filterId });
  } catch (error) {
    console.error('[NamedFilters] Error deleting filter:', error);
    res.status(500).json({ error: 'Failed to delete filter' });
  }
});

router.post('/:workspaceId/filters/:filterId/confirm', async (req: Request<FilterParams>, res: Response) => {
  try {
    const { workspaceId, filterId } = req.params;

    const config = await configLoader.getConfig(workspaceId);
    const filters = [...(config.named_filters || [])];
    const idx = filters.findIndex(f => f.id === filterId);

    if (idx === -1) {
      res.status(404).json({ error: `Filter "${filterId}" not found` });
      return;
    }

    filters[idx] = {
      ...filters[idx],
      confirmed: true,
      updated_at: new Date().toISOString(),
    };

    await saveWorkspaceFilters(workspaceId, filters);

    res.json({ success: true, filter: filters[idx] });
  } catch (error) {
    console.error('[NamedFilters] Error confirming filter:', error);
    res.status(500).json({ error: 'Failed to confirm filter' });
  }
});

router.post('/:workspaceId/filters/:filterId/preview', async (req: Request<FilterParams>, res: Response) => {
  try {
    const { workspaceId, filterId } = req.params;

    const config = await configLoader.getConfig(workspaceId);
    const filters = config.named_filters || [];
    const filter = filters.find(f => f.id === filterId);

    if (!filter) {
      res.status(404).json({ error: `Filter "${filterId}" not found` });
      return;
    }

    const resolution = await filterResolver.resolve(workspaceId, filterId, {
      parameter_offset: 2,
    });

    const table = filter.object;
    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM ${table} WHERE workspace_id = $1 AND ${resolution.sql}`,
      [workspaceId, ...resolution.params]
    );

    const sampleResult = await query(
      `SELECT id, ${table === 'deals' ? 'name, amount, stage, owner' : table === 'contacts' ? 'email, first_name, last_name, title' : table === 'accounts' ? 'name, domain, industry' : 'title, call_date, source'}
       FROM ${table} WHERE workspace_id = $1 AND ${resolution.sql}
       LIMIT 5`,
      [workspaceId, ...resolution.params]
    );

    res.json({
      success: true,
      filter_id: filterId,
      filter_label: filter.label,
      count: parseInt(countResult.rows[0]?.count || '0', 10),
      sample_records: sampleResult.rows,
      sql_preview: resolution.sql,
      conditions_summary: resolution.filter_metadata.conditions_summary,
      metadata: resolution.filter_metadata,
    });
  } catch (error) {
    if (error instanceof FilterNotFoundError) {
      res.status(404).json({ error: error.message });
      return;
    }
    console.error('[NamedFilters] Error previewing filter:', error);
    res.status(500).json({ error: 'Failed to preview filter' });
  }
});

router.post('/:workspaceId/filters/resolve', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const { filter_ids } = req.body;

    if (!Array.isArray(filter_ids) || filter_ids.length === 0) {
      res.status(400).json({ error: 'filter_ids array is required' });
      return;
    }

    const result = await filterResolver.resolveMultiple(workspaceId, filter_ids, {
      parameter_offset: 2,
    });

    const config = await configLoader.getConfig(workspaceId);
    const filters = config.named_filters || [];
    const firstFilter = filters.find(f => f.id === filter_ids[0]);
    const table = firstFilter?.object || 'deals';

    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM ${table} WHERE workspace_id = $1 ${result.sql}`,
      [workspaceId, ...result.params]
    );

    const sampleResult = await query(
      `SELECT id, ${table === 'deals' ? 'name, amount, stage' : table === 'contacts' ? 'email, first_name, last_name' : table === 'accounts' ? 'name, domain' : 'title, call_date'}
       FROM ${table} WHERE workspace_id = $1 ${result.sql}
       LIMIT 5`,
      [workspaceId, ...result.params]
    );

    res.json({
      success: true,
      sql_preview: result.sql,
      record_count: parseInt(countResult.rows[0]?.count || '0', 10),
      sample: sampleResult.rows,
      metadata: result.filter_metadata,
    });
  } catch (error) {
    if (error instanceof FilterNotFoundError) {
      res.status(404).json({ error: error.message });
      return;
    }
    console.error('[NamedFilters] Error resolving filters:', error);
    res.status(500).json({ error: 'Failed to resolve filters' });
  }
});

router.post('/:workspaceId/filters/preview-inline', async (req: Request<WorkspaceParams>, res: Response) => {
  try {
    const { workspaceId } = req.params;
    const { object, conditions } = req.body;

    if (!object || !conditions) {
      res.status(400).json({ error: 'object and conditions are required' });
      return;
    }

    const validObjects = ['deals', 'contacts', 'accounts', 'conversations'];
    if (!validObjects.includes(object)) {
      res.status(400).json({ error: `object must be one of: ${validObjects.join(', ')}` });
      return;
    }

    const resolution = await filterResolver.resolve(workspaceId, conditions, {
      parameter_offset: 2,
    });

    const table = object;
    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM ${table} WHERE workspace_id = $1 AND ${resolution.sql}`,
      [workspaceId, ...resolution.params]
    );

    const sampleColumns: Record<string, string> = {
      deals: 'name, amount, stage_normalized, owner_name, close_date',
      contacts: 'email, first_name, last_name, title',
      accounts: 'name, domain, industry',
      conversations: 'title, call_date, source',
    };

    const sampleResult = await query(
      `SELECT id, ${sampleColumns[table] || 'id'}
       FROM ${table} WHERE workspace_id = $1 AND ${resolution.sql}
       ORDER BY created_at DESC NULLS LAST
       LIMIT 5`,
      [workspaceId, ...resolution.params]
    );

    res.json({
      success: true,
      record_count: parseInt(countResult.rows[0]?.count || '0', 10),
      sample_records: sampleResult.rows,
      sql_preview: resolution.sql,
    });
  } catch (error) {
    console.error('[NamedFilters] Error previewing inline filter:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to preview filter' });
  }
});

export default router;
