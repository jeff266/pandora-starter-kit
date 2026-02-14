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

  const threadingData = stepResults.threading_analysis || stepResults.deal_classifications || [];
  const allDeals = stepResults.all_deals || stepResults.pipeline_deals || [];

  const threadMap = new Map<string, any>();
  if (Array.isArray(threadingData)) {
    for (const t of threadingData) {
      threadMap.set((t.dealName || t.name || '').toLowerCase(), t);
    }
  }

  const singleThreaded: any[] = [];

  const dealList = Array.isArray(allDeals) ? allDeals : (allDeals?.topDeals || []);
  for (const deal of dealList) {
    const name = (deal.name || deal.dealName || '').toLowerCase();
    const thread = threadMap.get(name);
    const contactCount = deal.contactCount || deal.contact_count || thread?.contact_count || 0;
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
      account_contact_count: deal.account_contact_count || thread?.account_contacts || 0,
    }, {
      risk_level: severity,
      likely_cause: thread?.likely_cause || (isSingleThreaded ? 'single_contact' : 'multi_threaded'),
      has_expansion_contacts: String(thread?.has_expansion || false),
      recommended_action: thread?.suggested_action || (isSingleThreaded ? 'Identify additional stakeholders' : 'No action needed'),
    }, severity));
  }

  if (singleThreaded.length > 0) {
    const totalValue = singleThreaded.reduce((s, d) => s + (d.amount || 0), 0);
    eb.addClaim({
      claim_id: 'single_threaded_deals',
      claim_text: `${singleThreaded.length} deals worth $${Math.round(totalValue / 1000)}K are single-threaded (≤1 contact)`,
      entity_type: 'deal',
      entity_ids: singleThreaded.map((d: any) => d.id || d.dealId || ''),
      metric_name: 'contact_count',
      metric_values: singleThreaded.map((d: any) => d.contactCount || d.contact_count || 0),
      threshold_applied: '≤1 contact',
      severity: singleThreaded.some((d: any) => (d.amount || 0) > 50000) ? 'critical' : 'warning',
    });
  }

  return eb.build();
}
