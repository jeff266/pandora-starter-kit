import { query } from '../../db.js';

export async function loadProjectUpdates(workspaceId: string) {
  try {
    const currentWeek = await query(
      `SELECT updates, notes, week_of
       FROM project_updates
       WHERE workspace_id = $1
         AND week_of = DATE_TRUNC('week', NOW())::date
       ORDER BY updated_at DESC
       LIMIT 1`,
      [workspaceId]
    );

    if (currentWeek.rows.length > 0) {
      return { ...currentWeek.rows[0], source: 'current_week' };
    }

    const latest = await query(
      `SELECT updates, notes, week_of
       FROM project_updates
       WHERE workspace_id = $1
       ORDER BY week_of DESC
       LIMIT 1`,
      [workspaceId]
    );

    if (latest.rows.length > 0) {
      return { ...latest.rows[0], source: 'previous_week', stale: true };
    }

    return {
      updates: null,
      notes: null,
      source: 'none',
      message: 'No project updates submitted. Submit via POST /api/workspaces/:id/project-updates'
    };
  } catch (err: any) {
    console.log('[ProjectRecap] Error loading updates:', err.message);
    return { updates: null, notes: null, source: 'error', message: err.message };
  }
}

export function formatProjectUpdates(data: any) {
  if (!data.updates) {
    return data.message || 'No project updates available.';
  }

  const weekOf = data.week_of ? new Date(data.week_of).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown';
  let output = `## RevOps Project Updates — Week of ${weekOf}\n\n`;

  if (data.stale) {
    output += `⚠️ No updates for current week. Showing most recent (${weekOf}).\n\n`;
  }

  const updates = typeof data.updates === 'string' ? JSON.parse(data.updates) : data.updates;

  for (const section of updates) {
    const categoryTitle = section.category
      .split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    output += `### ${categoryTitle}\n`;
    for (const item of section.items || []) {
      output += `- ${item}\n`;
    }
    output += '\n';
  }

  if (data.notes) {
    output += `### Notes\n${data.notes}\n`;
  }

  return output;
}

export async function loadCrossWorkspaceSummary() {
  try {
    const result = await query(`
      SELECT 
        w.id,
        w.name as workspace_name,
        (SELECT COUNT(*)::int FROM deals WHERE workspace_id = w.id 
          AND stage_normalized = 'closed_won' 
          AND close_date >= DATE_TRUNC('week', NOW())) as deals_won_this_week,
        (SELECT COALESCE(SUM(amount), 0)::numeric FROM deals WHERE workspace_id = w.id 
          AND stage_normalized = 'closed_won' 
          AND close_date >= DATE_TRUNC('week', NOW())) as amount_won_this_week,
        (SELECT COUNT(*)::int FROM deals WHERE workspace_id = w.id
          AND stage_normalized NOT IN ('closed_won', 'closed_lost')) as open_pipeline_count,
        (SELECT COUNT(*)::int FROM skill_runs WHERE workspace_id = w.id 
          AND started_at >= DATE_TRUNC('week', NOW())) as skill_runs_this_week
      FROM workspaces w
      WHERE w.id IN (SELECT DISTINCT workspace_id FROM connector_configs)
    `);
    return result.rows;
  } catch (err: any) {
    console.log('[ProjectRecap] Error loading cross-workspace summary:', err.message);
    return [];
  }
}

export async function prepareProjectRecap(workspaceId: string) {
  try {
    console.log('[ProjectRecap] Preparing project recap for workspace', workspaceId);

    const rawUpdates = await loadProjectUpdates(workspaceId);
    const formattedUpdates = formatProjectUpdates(rawUpdates);
    const crossWorkspace = await loadCrossWorkspaceSummary();

    return {
      projectUpdates: formattedUpdates,
      rawUpdates: rawUpdates.updates,
      crossWorkspaceSummary: crossWorkspace,
      hasUpdates: rawUpdates.source !== 'none' && rawUpdates.source !== 'error',
      source: rawUpdates.source,
    };
  } catch (err: any) {
    console.log('[ProjectRecap] Error preparing recap:', err.message);
    return {
      projectUpdates: 'Error loading project updates.',
      rawUpdates: null,
      crossWorkspaceSummary: [],
      hasUpdates: false,
      source: 'error',
    };
  }
}
