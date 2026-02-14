import type { SkillEvidence } from '../types.js';
import { EvidenceBuilder, buildDataSources } from '../evidence-builder.js';

export async function buildStrategyInsightsEvidence(
  stepResults: Record<string, any>,
  workspaceId: string,
  _businessContext: Record<string, any>
): Promise<SkillEvidence> {
  const eb = new EvidenceBuilder();

  const dataSources = await buildDataSources(workspaceId, ['hubspot', 'salesforce']);
  for (const ds of dataSources) eb.addDataSource(ds);

  const insightsData = stepResults.insights_data || {};
  const crossWorkspace = insightsData.crossWorkspace?.workspaces || [];

  for (const ws of crossWorkspace) {
    eb.addRecord({
      entity_id: ws.id || ws.workspace_id || '',
      entity_type: 'deal' as any,
      entity_name: ws.name || '',
      owner_email: null,
      owner_name: null,
      fields: {
        workspace_name: ws.name || '',
        insight_type: 'cross_workspace_metric',
        finding: `${ws.open_deals || 0} open deals, $${ws.open_pipeline || 0} pipeline`,
        source_skills: 'strategy-insights',
      },
      flags: {
        severity: 'info',
        recommendation: '',
      },
      severity: 'healthy',
    });
  }

  return eb.build();
}
