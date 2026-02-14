import type { SkillEvidence } from '../types.js';
import { EvidenceBuilder, buildDataSources } from '../evidence-builder.js';

export async function buildContactRoleResolutionEvidence(
  stepResults: Record<string, any>,
  workspaceId: string,
  _businessContext: Record<string, any>
): Promise<SkillEvidence> {
  const eb = new EvidenceBuilder();

  const dataSources = await buildDataSources(workspaceId, ['hubspot', 'salesforce', 'gong', 'fireflies']);
  for (const ds of dataSources) eb.addDataSource(ds);

  const result = stepResults.resolution_result || {};

  eb.addParameter({
    name: 'total_deals_processed',
    display_name: 'Deals Processed',
    value: result.dealsProcessed || 0,
    description: 'Number of deals evaluated for contact roles',
    configurable: false,
  });

  // Resolution summary as claims
  const contactsResolved = result.contactsResolved?.total || 0;
  if (contactsResolved > 0) {
    eb.addClaim({
      claim_id: 'contacts_resolved',
      claim_text: `${contactsResolved} contact roles resolved across ${result.dealsProcessed || 0} deals`,
      entity_type: 'contact',
      entity_ids: [],
      metric_name: 'contacts_resolved',
      metric_values: [contactsResolved],
      threshold_applied: 'all available sources',
      severity: 'info',
    });
  }

  if (result.dealsWithNoContacts > 0) {
    eb.addClaim({
      claim_id: 'deals_without_contacts',
      claim_text: `${result.dealsWithNoContacts} deals have no contacts linked`,
      entity_type: 'deal',
      entity_ids: [],
      metric_name: 'contact_count',
      metric_values: [0],
      threshold_applied: '0 contacts',
      severity: 'warning',
    });
  }

  return eb.build();
}
