import type { SkillEvidence } from '../types.js';
import { EvidenceBuilder, buildDataSources } from '../evidence-builder.js';

export async function buildWorkspaceConfigAuditEvidence(
  stepResults: Record<string, any>,
  workspaceId: string,
  _businessContext: Record<string, any>
): Promise<SkillEvidence> {
  const eb = new EvidenceBuilder();

  const dataSources = await buildDataSources(workspaceId, ['hubspot', 'salesforce']);
  for (const ds of dataSources) eb.addDataSource(ds);

  const auditData = stepResults.audit_data || {};
  const findings = auditData.findings || [];
  const classifications = stepResults.finding_classifications?.classifications || [];

  const classMap = new Map<string, any>();
  for (const c of classifications) {
    classMap.set(c.check, c);
  }

  for (const finding of findings) {
    const classification = classMap.get(finding.check);
    const severity: 'critical' | 'warning' | 'healthy' =
      finding.severity === 'critical' ? 'critical' :
      finding.severity === 'warning' ? 'warning' : 'healthy';

    eb.addRecord({
      entity_id: finding.check || finding.id || '',
      entity_type: 'deal' as any,
      entity_name: finding.check || '',
      owner_email: null,
      owner_name: null,
      fields: {
        check_name: finding.check || '',
        severity: finding.severity || '',
        message: finding.message || '',
        priority: classification?.priority || 3,
        impact: classification?.impact || '',
      },
      flags: {
        action: classification?.action || '',
      },
      severity,
    });
  }

  if (findings.length > 0) {
    const critical = findings.filter((f: any) => f.severity === 'critical');
    if (critical.length > 0) {
      eb.addClaim({
        claim_id: 'critical_config_issues',
        claim_text: `${critical.length} critical configuration issues detected`,
        entity_type: 'deal',
        entity_ids: critical.map((f: any) => f.check || ''),
        metric_name: 'config_severity',
        metric_values: critical.map(() => 'critical'),
        threshold_applied: 'severity = critical',
        severity: 'critical',
      });
    }
  }

  return eb.build();
}
