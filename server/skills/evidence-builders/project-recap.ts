import type { SkillEvidence } from '../types.js';
import { EvidenceBuilder, buildDataSources } from '../evidence-builder.js';

export async function buildProjectRecapEvidence(
  stepResults: Record<string, any>,
  workspaceId: string,
  _businessContext: Record<string, any>
): Promise<SkillEvidence> {
  const eb = new EvidenceBuilder();

  const dataSources = await buildDataSources(workspaceId, ['hubspot', 'salesforce']);
  for (const ds of dataSources) eb.addDataSource(ds);

  const projectData = stepResults.project_data || {};
  const workspaces = projectData.workspaces || projectData.crossWorkspace || [];

  for (const ws of workspaces) {
    eb.addRecord({
      entity_id: ws.id || ws.workspace_id || '',
      entity_type: 'deal' as any,
      entity_name: ws.name || ws.workspace_name || '',
      owner_email: null,
      owner_name: null,
      fields: {
        workspace_name: ws.name || ws.workspace_name || '',
        open_deals: ws.open_deals || ws.openDeals || 0,
        open_pipeline: ws.open_pipeline || ws.openPipeline || 0,
        won_this_month: ws.won_this_month || ws.wonThisMonth || 0,
        project_status: ws.status || ws.project_status || '',
      },
      flags: {},
      severity: 'healthy',
    });
  }

  return eb.build();
}
