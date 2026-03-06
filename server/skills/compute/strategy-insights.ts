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

const DEPENDENT_SKILLS = [
  'pipeline-hygiene',
  'pipeline-coverage',
  'pipeline-waterfall',
  'data-quality-audit',
  'deal-risk-review',
  'forecast-rollup',
  'rep-scorecard',
  'conversation-intelligence',
];

async function checkInputFreshness(workspaceId: string): Promise<{
  sufficientData: boolean;
  limitedData: boolean;
  skillsWithRecentRuns: string[];
  skillsMissingRuns: string[];
  warningMessage?: string;
}> {
  try {
    const result = await query(`
      SELECT DISTINCT ON (skill_id) skill_id, completed_at
      FROM skill_runs
      WHERE workspace_id = $1
        AND skill_id = ANY($2)
        AND status = 'completed'
        AND started_at >= NOW() - INTERVAL '14 days'
      ORDER BY skill_id, started_at DESC
    `, [workspaceId, DEPENDENT_SKILLS]);

    const ran = new Set(result.rows.map((r: any) => r.skill_id));
    const skillsWithRecentRuns = DEPENDENT_SKILLS.filter(s => ran.has(s));
    const skillsMissingRuns = DEPENDENT_SKILLS.filter(s => !ran.has(s));
    const count = skillsWithRecentRuns.length;

    if (count < 3) {
      return {
        sufficientData: false,
        limitedData: false,
        skillsWithRecentRuns,
        skillsMissingRuns,
        warningMessage: `Strategy & Insights needs at least 3 upstream skills to have run in the last 14 days. Only ${count} found: ${skillsWithRecentRuns.join(', ') || 'none'}. Run the following skills first: ${skillsMissingRuns.slice(0, 5).join(', ')}.`,
      };
    }

    if (count < 5) {
      return {
        sufficientData: true,
        limitedData: true,
        skillsWithRecentRuns,
        skillsMissingRuns,
        warningMessage: `Running on partial data — ${count} of ${DEPENDENT_SKILLS.length} upstream skills have recent outputs. Missing: ${skillsMissingRuns.join(', ')}.`,
      };
    }

    return { sufficientData: true, limitedData: false, skillsWithRecentRuns, skillsMissingRuns };
  } catch (err: any) {
    console.log('[StrategyInsights] Error checking input freshness:', err.message);
    return { sufficientData: true, limitedData: false, skillsWithRecentRuns: [], skillsMissingRuns: [] };
  }
}

export async function prepareStrategyInsights(workspaceId: string) {
  try {
    console.log('[StrategyInsights] Preparing strategy insights for workspace', workspaceId);

    const freshness = await checkInputFreshness(workspaceId);

    if (!freshness.sufficientData) {
      const freshRunCount = freshness.skillsWithRecentRuns.length;
      try {
        const existing = await query(
          `SELECT id FROM actions
           WHERE workspace_id = $1
             AND action_type = 'ops_process_fix'
             AND source_skill = 'strategy-insights'
             AND created_at > NOW() - INTERVAL '7 days'
             AND status = 'open'
           LIMIT 1`,
          [workspaceId]
        );
        if (existing.rows.length === 0) {
          await query(
            `INSERT INTO actions (
               workspace_id, source_skill, action_type, severity, title, summary,
               recommended_steps, status
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'open')`,
            [
              workspaceId,
              'strategy-insights',
              'ops_process_fix',
              'low',
              'Strategy & Insights needs fresh data to run',
              `Strategy & Insights requires recent outputs from at least 3 skills to synthesize cross-functional insights. Found only ${freshRunCount} fresh skill run(s). Trigger Pipeline Hygiene, Forecast Rollup, and Pipeline Coverage first, then re-run Strategy & Insights.`,
              JSON.stringify(['Run Pipeline Hygiene', 'Run Forecast Rollup', 'Run Pipeline Coverage', 'Re-run Strategy & Insights']),
            ]
          );
          console.log('[StrategyInsights] Emitted ops_process_fix action for workspace', workspaceId);
        }
      } catch (actionErr: any) {
        console.log('[StrategyInsights] Could not emit action:', actionErr.message);
      }

      return {
        recentOutputs: { skills: {}, agents: {}, skillCount: 0, agentCount: 0 },
        crossWorkspace: { workspaces: [], icpProfiles: [], leadScoreDistribution: [] },
        trends: { skillRunFrequency: [], stageMovement: [] },
        dataAvailable: false,
        limitedData: false,
        warningMessage: freshness.warningMessage,
        skillsWithRecentRuns: freshness.skillsWithRecentRuns,
        skillsMissingRuns: freshness.skillsMissingRuns,
      };
    }

    const recentOutputs = await gatherRecentSkillOutputs(workspaceId);
    const crossWorkspace = await gatherCrossWorkspaceContext();
    const trends = await gatherTrendAnalysis(workspaceId);

    return {
      recentOutputs,
      crossWorkspace,
      trends,
      dataAvailable: recentOutputs.skillCount > 0,
      limitedData: freshness.limitedData,
      warningMessage: freshness.warningMessage,
      skillsWithRecentRuns: freshness.skillsWithRecentRuns,
      skillsMissingRuns: freshness.skillsMissingRuns,
    };
  } catch (err: any) {
    console.log('[StrategyInsights] Error preparing insights:', err.message);
    return {
      recentOutputs: { skills: {}, agents: {}, skillCount: 0, agentCount: 0 },
      crossWorkspace: { workspaces: [], icpProfiles: [], leadScoreDistribution: [] },
      trends: { skillRunFrequency: [], stageMovement: [] },
      dataAvailable: false,
      limitedData: false,
      warningMessage: 'Failed to load strategy insights data.',
      skillsWithRecentRuns: [],
      skillsMissingRuns: DEPENDENT_SKILLS,
    };
  }
}
