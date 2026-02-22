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
       COALESCE(definitions, '{}'::jsonb),
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

export default router;
