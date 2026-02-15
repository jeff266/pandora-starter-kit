import type { SkillEvidence } from '../types.js';
import { EvidenceBuilder, buildDataSources, dealToRecord } from '../evidence-builder.js';

export async function buildSingleThreadAlertEvidence(
  stepResults: Record<string, any>,
  workspaceId: string,
  businessContext: Record<string, any>
): Promise<SkillEvidence> {
  const eb = new EvidenceBuilder();

  eb.addParameter({
    name: 'single_thread_threshold',
    display_name: 'Single-Thread Threshold',
    value: 1,
    description: 'Deals with this many or fewer contacts are flagged as single-threaded',
    configurable: true,
  });

  const dataSources = await buildDataSources(workspaceId, ['hubspot', 'salesforce', 'gong', 'fireflies']);
  for (const ds of dataSources) eb.addDataSource(ds);

  const threadingData = stepResults.threading_data || {};
  const enrichedDeals = stepResults.enriched_deals || [];
  const riskClassifications = stepResults.risk_classifications || [];

  const classMap = new Map<string, any>();
  if (Array.isArray(riskClassifications)) {
    for (const c of riskClassifications) {
      const key = (c.dealName || c.name || '').toLowerCase();
      classMap.set(key, c);
    }
  }

  const criticalDeals = threadingData.criticalDeals || [];
  const warningDeals = threadingData.warningDeals || [];
  const allFlaggedDeals = [...criticalDeals, ...warningDeals];

  const enrichedMap = new Map<string, any>();
  if (Array.isArray(enrichedDeals)) {
    for (const d of enrichedDeals) {
      enrichedMap.set(d.dealId || d.id || '', d);
    }
  }

  const singleThreaded: any[] = [];

  for (const deal of allFlaggedDeals) {
    const dealId = deal.dealId || deal.id || '';
    const name = (deal.name || deal.dealName || '').toLowerCase();
    const enriched = enrichedMap.get(dealId) || {};
    const classification = classMap.get(name);
    const contactCount = deal.contactCount || deal.contact_count || enriched.contactCount || 0;
    const isSingleThreaded = contactCount <= 1;
    const severity: 'critical' | 'warning' | 'healthy' = isSingleThreaded && (deal.amount || 0) > 50000
      ? 'critical' : isSingleThreaded ? 'warning' : 'healthy';

    if (isSingleThreaded) singleThreaded.push(deal);

    eb.addRecord(dealToRecord(deal, {
      deal_name: deal.name || deal.dealName || '',
      amount: deal.amount || 0,
      stage: deal.stage || deal.stage_normalized || '',
      owner: deal.owner || '',
      contact_count: contactCount,
      account_contact_count: enriched.totalContactsAtAccount || deal.account_contact_count || 0,
    }, {
      risk_level: classification?.risk_level || severity,
      likely_cause: classification?.likely_cause || (isSingleThreaded ? 'single_contact' : 'multi_threaded'),
      has_expansion_contacts: String(classification?.has_expansion_contacts || enriched.hasExpansionContacts || false),
      recommended_action: classification?.recommended_action || (isSingleThreaded ? 'Identify additional stakeholders' : 'No action needed'),
    }, severity));
  }

  if (singleThreaded.length > 0) {
    const totalValue = singleThreaded.reduce((s, d) => s + (d.amount || 0), 0);
    eb.addClaim({
      claim_id: 'single_threaded_deals',
      claim_text: `${singleThreaded.length} deals worth $${Math.round(totalValue / 1000)}K are single-threaded (≤1 contact)`,
      entity_type: 'deal',
      entity_ids: singleThreaded.map((d: any) => d.dealId || d.id || ''),
      metric_name: 'contact_count',
      metric_values: singleThreaded.map((d: any) => d.contactCount || d.contact_count || 0),
      threshold_applied: '≤1 contact',
      severity: singleThreaded.some((d: any) => (d.amount || 0) > 50000) ? 'critical' : 'warning',
    });
  }

  return eb.build();
}
