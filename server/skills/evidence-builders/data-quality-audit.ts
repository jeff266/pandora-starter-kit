import type { SkillEvidence } from '../types.js';
import { EvidenceBuilder, buildDataSources, dealToRecord } from '../evidence-builder.js';

export async function buildDataQualityAuditEvidence(
  stepResults: Record<string, any>,
  workspaceId: string,
  _businessContext: Record<string, any>
): Promise<SkillEvidence> {
  const eb = new EvidenceBuilder();

  eb.addParameter({
    name: 'completeness_threshold_pct',
    display_name: 'Completeness Threshold (%)',
    value: 70,
    description: 'Minimum field completeness percentage for a deal to be considered data-healthy',
    configurable: true,
  });

  const dataSources = await buildDataSources(workspaceId, ['hubspot', 'salesforce']);
  for (const ds of dataSources) eb.addDataSource(ds);

  const auditResults = stepResults.quality_metrics || stepResults.audit_data || {};
  const dealIssues = auditResults.dealIssues || auditResults.issues || [];
  const entityBreakdown = auditResults.entityBreakdown || {};

  const lowFillDeals: any[] = [];
  const orphanedDeals: any[] = [];

  const issueList = Array.isArray(dealIssues) ? dealIssues : [];
  for (const deal of issueList) {
    const completeness = deal.completeness_pct || deal.fillRate || 0;
    const isLow = completeness < 70;
    const isOrphaned = (deal.contact_count || deal.contactCount || 0) === 0;
    const severity: 'critical' | 'warning' | 'healthy' = isLow && isOrphaned ? 'critical' : isLow || isOrphaned ? 'warning' : 'healthy';

    if (isLow) lowFillDeals.push(deal);
    if (isOrphaned) orphanedDeals.push(deal);

    eb.addRecord(dealToRecord(deal, {
      entity_name: deal.name || deal.deal_name || '',
      entity_type: 'deal',
      owner: deal.owner || '',
      completeness_pct: completeness,
      missing_fields: (deal.missing_fields || deal.missingFields || []).join(', '),
      critical_fields_missing: deal.critical_fields_missing || 0,
    }, {
      pattern: deal.pattern || (isLow ? 'low_fill_rate' : 'healthy'),
      recommended_fix: deal.recommended_fix || (isLow ? 'Complete missing fields' : 'No action needed'),
      severity: severity,
    }, severity));
  }

  if (lowFillDeals.length > 0) {
    eb.addClaim({
      claim_id: 'low_fill_rate_deals',
      claim_text: `${lowFillDeals.length} deals below 70% field completeness`,
      entity_type: 'deal',
      entity_ids: lowFillDeals.map((d: any) => d.id || d.dealId || ''),
      metric_name: 'completeness_pct',
      metric_values: lowFillDeals.map((d: any) => d.completeness_pct || d.fillRate || 0),
      threshold_applied: '<70%',
      severity: 'warning',
    });
  }

  if (orphanedDeals.length > 0) {
    eb.addClaim({
      claim_id: 'orphaned_deals',
      claim_text: `${orphanedDeals.length} deals with no contacts linked`,
      entity_type: 'deal',
      entity_ids: orphanedDeals.map((d: any) => d.id || d.dealId || ''),
      metric_name: 'contact_count',
      metric_values: orphanedDeals.map(() => 0),
      threshold_applied: '0 contacts',
      severity: 'warning',
    });
  }

  // CWD (Conversations Without Deals) evidence
  const cwdOutput = stepResults.cwd_data;
  if (cwdOutput?.has_conversation_data && cwdOutput.summary) {
    // Add conversation data sources
    const convSources = await buildDataSources(workspaceId, ['gong', 'fireflies']);
    for (const ds of convSources) eb.addDataSource(ds);

    if (cwdOutput.summary.total_cwd > 0) {
      eb.addClaim({
        claim_id: 'conversations_without_deals',
        claim_text: `${cwdOutput.summary.total_cwd} conversations have no linked deal`,
        entity_type: 'conversation' as any,
        entity_ids: (cwdOutput.top_examples || []).map((c: any) => c.conversation_id),
        metric_name: 'days_since_call',
        metric_values: (cwdOutput.top_examples || []).map((c: any) => c.days_since_call),
        threshold_applied: 'deal_id IS NULL',
        severity: cwdOutput.summary.by_severity.high > 0 ? 'critical' : 'warning',
      });
    }

    // Add CWD top examples as evaluated records
    for (const example of (cwdOutput.top_examples || [])) {
      eb.addRecord({
        entity_id: example.conversation_id || '',
        entity_type: 'conversation' as any,
        entity_name: example.title || 'Untitled Call',
        owner_email: example.rep_email || null,
        owner_name: example.rep_name || null,
        fields: {
          account_name: example.account_name || '',
          duration_seconds: example.duration_seconds || 0,
          days_since_call: example.days_since_call || 0,
          participant_count: example.participant_count || 0,
          likely_cause: example.likely_cause || 'unknown',
        },
        flags: {
          severity: example.severity || 'low',
          likely_cause: example.likely_cause || 'unknown',
        },
        severity: example.severity === 'high' ? 'critical' : example.severity === 'medium' ? 'warning' : 'healthy',
      });
    }
  }

  return eb.build();
}
