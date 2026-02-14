import { query } from '../../db.js';

export async function gatherRecentSkillOutputs(workspaceId: string) {
  try {
    console.log('[StrategyInsights] Gathering recent skill outputs for workspace', workspaceId);
    
    const skillRuns = await query(`
      SELECT DISTINCT ON (skill_id)
        skill_id,
        output_text,
        started_at
      FROM skill_runs
      WHERE workspace_id = $1
        AND status = 'completed'
        AND started_at >= NOW() - INTERVAL '14 days'
      ORDER BY skill_id, started_at DESC
    `, [workspaceId]);
    
    const agentRuns = await query(`
      SELECT DISTINCT ON (agent_id)
        agent_id,
        synthesized_output,
        started_at
      FROM agent_runs
      WHERE workspace_id = $1
        AND status = 'completed'
        AND started_at >= NOW() - INTERVAL '14 days'
      ORDER BY agent_id, started_at DESC
    `, [workspaceId]);
    
    const skills: Record<string, { output: string; ran: string }> = {};
    for (const row of skillRuns.rows) {
      skills[row.skill_id] = {
        output: truncateOutput(row.output_text || ''),
        ran: row.started_at?.toISOString?.() || String(row.started_at),
      };
    }
    
    const agents: Record<string, { output: string; ran: string }> = {};
    for (const row of agentRuns.rows) {
      agents[row.agent_id] = {
        output: truncateOutput(row.synthesized_output || ''),
        ran: row.started_at?.toISOString?.() || String(row.started_at),
      };
    }
    
    return {
      skills,
      agents,
      skillCount: Object.keys(skills).length,
      agentCount: Object.keys(agents).length,
    };
  } catch (err: any) {
    console.log('[StrategyInsights] Error gathering skill outputs:', err.message);
    return { skills: {}, agents: {}, skillCount: 0, agentCount: 0 };
  }
}

export async function gatherCrossWorkspaceContext() {
  try {
    const result = await query(`
      SELECT 
        w.id,
        w.name,
        (SELECT COUNT(*)::int FROM deals WHERE workspace_id = w.id 
          AND stage_normalized NOT IN ('closed_won', 'closed_lost')) as open_deals,
        (SELECT COALESCE(SUM(amount), 0)::numeric FROM deals WHERE workspace_id = w.id 
          AND stage_normalized NOT IN ('closed_won', 'closed_lost')) as open_pipeline,
        (SELECT COUNT(*)::int FROM deals WHERE workspace_id = w.id 
          AND stage_normalized = 'closed_won'
          AND close_date >= NOW() - INTERVAL '30 days') as won_this_month,
        (SELECT COALESCE(SUM(amount), 0)::numeric FROM deals WHERE workspace_id = w.id 
          AND stage_normalized = 'closed_won'
          AND close_date >= NOW() - INTERVAL '30 days') as won_amount_this_month
      FROM workspaces w
      WHERE w.id IN (SELECT DISTINCT workspace_id FROM connector_configs)
    `);
    
    const icpProfiles = await query(`
      SELECT workspace_id, model_data, created_at
      FROM icp_profiles
      WHERE status = 'active'
    `);
    
    const leadScores = await query(`
      SELECT 
        workspace_id,
        score_grade,
        COUNT(*)::int as count
      FROM lead_scores
      WHERE scoring_method = 'icp_point_based'
      GROUP BY 1, 2
    `);
    
    return {
      workspaces: result.rows,
      icpProfiles: icpProfiles.rows,
      leadScoreDistribution: leadScores.rows,
    };
  } catch (err: any) {
    console.log('[StrategyInsights] Error gathering cross-workspace context:', err.message);
    return { workspaces: [], icpProfiles: [], leadScoreDistribution: [] };
  }
}

export async function gatherTrendAnalysis(workspaceId: string) {
  try {
    const trendData = await query(`
      WITH ranked AS (
        SELECT 
          skill_id,
          output_text,
          result,
          started_at,
          ROW_NUMBER() OVER (PARTITION BY skill_id ORDER BY started_at DESC) as rn
        FROM skill_runs
        WHERE workspace_id = $1
          AND status = 'completed'
          AND started_at >= NOW() - INTERVAL '30 days'
      )
      SELECT 
        curr.skill_id,
        curr.started_at as current_run,
        prev.started_at as previous_run
      FROM ranked curr
      LEFT JOIN ranked prev ON curr.skill_id = prev.skill_id AND prev.rn = 2
      WHERE curr.rn = 1
    `, [workspaceId]);
    
    const stageMovement = await query(`
      SELECT 
        stage_normalized,
        COUNT(*) FILTER (WHERE stage_changed_at >= NOW() - INTERVAL '7 days')::int as moved_this_week,
        COUNT(*) FILTER (
          WHERE stage_changed_at >= NOW() - INTERVAL '14 days'
          AND stage_changed_at < NOW() - INTERVAL '7 days'
        )::int as moved_last_week
      FROM deals
      WHERE workspace_id = $1
        AND stage_changed_at IS NOT NULL
      GROUP BY 1
    `, [workspaceId]);
    
    return {
      skillRunFrequency: trendData.rows,
      stageMovement: stageMovement.rows,
    };
  } catch (err: any) {
    console.log('[StrategyInsights] Error gathering trend analysis:', err.message);
    return { skillRunFrequency: [], stageMovement: [] };
  }
}

function truncateOutput(output: string, maxChars: number = 500): string {
  if (!output || output.length <= maxChars) return output || '';
  
  const summaryMatch = output.match(/## Summary|## Key Findings|BOTTOM LINE|THE CALL/i);
  if (summaryMatch && summaryMatch.index !== undefined) {
    const fromSummary = output.substring(summaryMatch.index, summaryMatch.index + maxChars);
    return fromSummary + '...';
  }
  
  return output.substring(0, maxChars) + '...';
}

export async function prepareStrategyInsights(workspaceId: string) {
  try {
    console.log('[StrategyInsights] Preparing strategy insights for workspace', workspaceId);
    
    const recentOutputs = await gatherRecentSkillOutputs(workspaceId);
    const crossWorkspace = await gatherCrossWorkspaceContext();
    const trends = await gatherTrendAnalysis(workspaceId);
    
    return {
      recentOutputs,
      crossWorkspace,
      trends,
      dataAvailable: recentOutputs.skillCount > 0,
    };
  } catch (err: any) {
    console.log('[StrategyInsights] Error preparing insights:', err.message);
    return {
      recentOutputs: { skills: {}, agents: {}, skillCount: 0, agentCount: 0 },
      crossWorkspace: { workspaces: [], icpProfiles: [], leadScoreDistribution: [] },
      trends: { skillRunFrequency: [], stageMovement: [] },
      dataAvailable: false,
    };
  }
}
