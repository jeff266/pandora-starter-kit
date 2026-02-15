import { query } from '../db.js';
import { formatCurrency } from '../utils/format-currency.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(val: unknown): val is string {
  return typeof val === 'string' && UUID_RE.test(val);
}

export interface FindingRow {
  workspace_id: string;
  skill_run_id: string;
  skill_id: string;
  severity: string;
  category: string;
  message: string;
  deal_id?: string;
  account_id?: string;
  owner_email?: string;
  metadata: Record<string, any>;
}

type SkillExtractor = (
  runId: string,
  workspaceId: string,
  result: Record<string, any>,
) => FindingRow[];

const extractors: Record<string, SkillExtractor> = {
  'pipeline-hygiene': extractPipelineHygiene,
  'single-thread-alert': extractSingleThreadAlert,
  'data-quality-audit': extractDataQualityAudit,
  'forecast-rollup': extractForecastRollup,
  'pipeline-coverage': extractPipelineCoverage,
  'deal-risk-review': extractDealRiskReview,
  'rep-scorecard': extractRepScorecard,
};

export function extractFindings(
  skillId: string,
  runId: string,
  workspaceId: string,
  resultData: Record<string, any>,
): FindingRow[] {
  if (!resultData || typeof resultData !== 'object') return [];

  const extractor = extractors[skillId];
  try {
    const findings = extractor
      ? extractor(runId, workspaceId, resultData)
      : extractGenericFallback(skillId, runId, workspaceId, resultData);
    return findings.filter(f => f.message && f.severity && f.category);
  } catch (err) {
    console.error(`[FindingsExtractor] Error extracting findings for ${skillId}:`, err);
    return [];
  }
}

function makeFinding(
  workspaceId: string,
  runId: string,
  skillId: string,
  severity: string,
  category: string,
  message: string,
  opts: { deal_id?: string; account_id?: string; owner_email?: string; metadata?: Record<string, any> } = {},
): FindingRow {
  return {
    workspace_id: workspaceId,
    skill_run_id: runId,
    skill_id: skillId,
    severity,
    category,
    message,
    deal_id: isValidUUID(opts.deal_id) ? opts.deal_id : undefined,
    account_id: isValidUUID(opts.account_id) ? opts.account_id : undefined,
    owner_email: opts.owner_email || undefined,
    metadata: opts.metadata || {},
  };
}

function extractPipelineHygiene(runId: string, workspaceId: string, result: Record<string, any>): FindingRow[] {
  const findings: FindingRow[] = [];
  const skillId = 'pipeline-hygiene';

  const stale = result.stale_deals_agg;
  if (stale && typeof stale === 'object' && !stale.error) {
    const topDeals = Array.isArray(stale.topDeals) ? stale.topDeals : [];
    const bySeverity = stale.bySeverity || {};

    for (const deal of topDeals) {
      if (!deal) continue;
      const dealName = deal.name || deal.dealName || 'Unknown deal';
      const amount = deal.amount || deal.value || 0;
      const days = deal.daysSinceActivity || deal.daysStale || deal.days_inactive || 0;
      const rawSev = (deal.severity || deal.staleSeverity || '').toLowerCase();

      let severity = 'watch';
      if (rawSev === 'critical' || rawSev === 'serious') severity = 'act';
      else if (rawSev === 'warning') severity = 'watch';
      else if (rawSev === 'watch') severity = 'notable';

      if (!severity && bySeverity) {
        if (bySeverity.critical?.count > 0 && days > 60) severity = 'act';
        else if (bySeverity.warning?.count > 0 && days > 30) severity = 'watch';
        else severity = 'notable';
      }

      const amountStr = amount ? ` (${formatCurrency(amount)})` : '';
      findings.push(makeFinding(
        workspaceId, runId, skillId, severity, 'stale_deal',
        `${dealName}${amountStr} has had no activity for ${days} days`,
        {
          deal_id: deal.dealId || deal.id,
          owner_email: deal.owner || deal.ownerEmail,
          metadata: { days_inactive: days, amount, stage: deal.stage },
        },
      ));
    }
  }

  const classifications = result.deal_classifications;
  if (Array.isArray(classifications)) {
    for (const cls of classifications) {
      if (!cls || cls.error) continue;
      const dealName = cls.dealName || cls.name || 'Unknown deal';
      const classification = cls.classification || cls.action || cls.status || '';
      if (!classification) continue;

      const rawSev = (cls.severity || cls.urgency || '').toLowerCase();
      let severity = 'info';
      if (rawSev === 'critical' || rawSev === 'high') severity = 'act';
      else if (rawSev === 'medium' || rawSev === 'warning') severity = 'watch';
      else if (rawSev === 'low') severity = 'notable';

      findings.push(makeFinding(
        workspaceId, runId, skillId, severity, 'deal_classification',
        `${dealName}: ${classification}`,
        {
          deal_id: cls.dealId || cls.id,
          owner_email: cls.owner || cls.ownerEmail,
          metadata: { classification, reason: cls.reason || cls.rationale },
        },
      ));
    }
  }

  return findings;
}

function extractSingleThreadAlert(runId: string, workspaceId: string, result: Record<string, any>): FindingRow[] {
  const findings: FindingRow[] = [];
  const skillId = 'single-thread-alert';
  const threadingData = result.threading_data;
  if (!threadingData || typeof threadingData !== 'object') return findings;

  const riskClassifications = result.risk_classifications;
  const classMap = new Map<string, any>();
  if (Array.isArray(riskClassifications)) {
    for (const c of riskClassifications) {
      if (!c) continue;
      const key = (c.dealName || c.name || c.dealId || '').toLowerCase();
      if (key) classMap.set(key, c);
    }
  }

  const processDealList = (deals: any[], severity: string) => {
    if (!Array.isArray(deals)) return;
    for (const deal of deals) {
      if (!deal) continue;
      const dealName = deal.name || deal.dealName || 'Unknown deal';
      const amount = deal.amount || 0;
      const contactCount = deal.contactCount || deal.contact_count || 0;
      const stage = deal.stage || '';
      const owner = deal.owner || deal.ownerEmail || '';

      const classKey = dealName.toLowerCase();
      const enrichment = classMap.get(classKey) || classMap.get((deal.dealId || '').toLowerCase()) || {};

      const amountStr = amount ? ` (${formatCurrency(amount)})` : '';
      let msg = `${dealName}${amountStr} has only ${contactCount} contact${contactCount === 1 ? '' : 's'}`;
      if (enrichment.likely_cause) msg += ` — ${enrichment.likely_cause}`;

      findings.push(makeFinding(
        workspaceId, runId, skillId, severity, 'single_threaded',
        msg,
        {
          deal_id: deal.dealId || deal.id,
          owner_email: owner,
          metadata: {
            contact_count: contactCount,
            amount,
            stage,
            risk_level: enrichment.risk_level,
            recommended_action: enrichment.recommended_action,
            has_expansion_contacts: enrichment.has_expansion_contacts,
          },
        },
      ));
    }
  };

  processDealList(threadingData.criticalDeals, 'act');
  processDealList(threadingData.warningDeals, 'watch');

  return findings;
}

function extractDataQualityAudit(runId: string, workspaceId: string, result: Record<string, any>): FindingRow[] {
  const findings: FindingRow[] = [];
  const skillId = 'data-quality-audit';
  const metrics = result.quality_metrics;
  if (!metrics || typeof metrics !== 'object') return findings;

  const byEntity = metrics.byEntity;
  if (!byEntity || typeof byEntity !== 'object') return findings;

  for (const [entityType, entityData] of Object.entries(byEntity)) {
    if (!entityData || typeof entityData !== 'object') continue;
    const data = entityData as Record<string, any>;
    const total = data.total || 0;
    const issues = data.issues;
    if (!issues || typeof issues !== 'object') continue;

    for (const [issueName, issueCount] of Object.entries(issues)) {
      const count = typeof issueCount === 'number' ? issueCount : 0;
      if (count <= 0) continue;

      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
      let severity = 'info';
      if (pct > 30 || count > 50) severity = 'act';
      else if (pct > 15 || count > 20) severity = 'watch';
      else if (pct > 5 || count > 5) severity = 'notable';

      const issueLabel = issueName.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim().toLowerCase();
      findings.push(makeFinding(
        workspaceId, runId, skillId, severity, 'data_quality',
        `${count} ${entityType} (${pct}%) have ${issueLabel}`,
        { metadata: { entity_type: entityType, issue: issueName, count, total, percentage: pct } },
      ));
    }
  }

  const offenders = result.enriched_offenders;
  if (Array.isArray(offenders)) {
    for (const offender of offenders.slice(0, 10)) {
      if (!offender) continue;
      const name = offender.name || offender.entity_name || 'Unknown record';
      const issueCount = offender.issue_count || offender.issueCount || 0;
      if (issueCount <= 0) continue;

      findings.push(makeFinding(
        workspaceId, runId, skillId, issueCount > 5 ? 'act' : 'watch', 'data_quality',
        `${name} has ${issueCount} data quality issues`,
        {
          deal_id: offender.dealId || offender.deal_id || offender.id,
          account_id: offender.accountId || offender.account_id,
          owner_email: offender.owner || offender.ownerEmail,
          metadata: { issues: offender.issues || offender.issue_list, entity_type: offender.entity_type },
        },
      ));
    }
  }

  return findings;
}

function extractForecastRollup(runId: string, workspaceId: string, result: Record<string, any>): FindingRow[] {
  const findings: FindingRow[] = [];
  const skillId = 'forecast-rollup';

  let classifications = result.risk_classifications;
  if (typeof classifications === 'string') {
    try {
      const jsonMatch = classifications.match(/\[[\s\S]*\]/);
      classifications = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch {
      classifications = null;
    }
  }

  if (Array.isArray(classifications)) {
    for (const risk of classifications) {
      if (!risk || typeof risk !== 'object') continue;
      const repName = risk.rep_name || risk.repName || 'Unknown rep';
      const riskType = risk.risk_type || risk.riskType || 'forecast risk';
      const evidence = risk.evidence || '';
      const action = risk.suggested_action || risk.suggestedAction || '';

      const rawSev = (risk.severity || '').toLowerCase();
      let severity = 'info';
      if (rawSev === 'high' || rawSev === 'critical') severity = 'act';
      else if (rawSev === 'medium') severity = 'watch';
      else if (rawSev === 'low') severity = 'notable';

      let msg = `${repName}: ${riskType}`;
      if (evidence) msg += ` — ${typeof evidence === 'string' ? evidence.slice(0, 120) : JSON.stringify(evidence).slice(0, 120)}`;

      findings.push(makeFinding(
        workspaceId, runId, skillId, severity, 'forecast_risk',
        msg,
        {
          owner_email: risk.email || risk.owner_email,
          metadata: { risk_type: riskType, evidence, suggested_action: action, rep_name: repName },
        },
      ));
    }
  }

  const concentration = result.concentration_risk;
  if (Array.isArray(concentration)) {
    for (const deal of concentration) {
      if (!deal) continue;
      const dealName = deal.name || deal.dealName || 'Unknown deal';
      const amount = deal.amount || 0;
      const pctOfPipeline = deal.pct_of_pipeline || deal.percentOfPipeline || 0;

      const amountStr = amount ? ` (${formatCurrency(amount)})` : '';
      findings.push(makeFinding(
        workspaceId, runId, skillId, pctOfPipeline > 30 ? 'act' : 'watch', 'forecast_risk',
        `${dealName}${amountStr} represents ${pctOfPipeline}% of pipeline — concentration risk`,
        {
          deal_id: deal.dealId || deal.id,
          owner_email: deal.owner || deal.ownerEmail,
          metadata: { amount, pct_of_pipeline: pctOfPipeline, stage: deal.stage },
        },
      ));
    }
  }

  return findings;
}

function extractPipelineCoverage(runId: string, workspaceId: string, result: Record<string, any>): FindingRow[] {
  const findings: FindingRow[] = [];
  const skillId = 'pipeline-coverage';

  const atRiskReps = result.at_risk_reps;
  if (Array.isArray(atRiskReps) && atRiskReps.length > 0) {
    for (const rep of atRiskReps) {
      if (!rep) continue;
      const name = rep.name || rep.repName || 'Unknown rep';
      const email = rep.email || rep.ownerEmail || '';
      const coverage = rep.coverage || rep.coverageRatio || 0;
      const pipeline = rep.pipeline || rep.pipelineValue || 0;
      const quota = rep.quota || rep.quotaValue || 0;

      let severity = 'watch';
      if (coverage < 1) severity = 'act';
      else if (coverage < 2) severity = 'watch';
      else severity = 'notable';

      const coverageStr = typeof coverage === 'number' ? `${coverage.toFixed(1)}x` : String(coverage);
      const pipelineStr = pipeline ? ` (${formatCurrency(pipeline)} pipeline)` : '';
      findings.push(makeFinding(
        workspaceId, runId, skillId, severity, 'coverage_gap',
        `${name} has ${coverageStr} coverage${pipelineStr}`,
        {
          owner_email: email,
          metadata: { coverage, pipeline, quota, rep_name: name },
        },
      ));
    }
    return findings;
  }

  const coverageData = result.coverage_data;
  if (coverageData && typeof coverageData === 'object') {
    const reps = Array.isArray(coverageData.reps) ? coverageData.reps : [];
    for (const rep of reps) {
      if (!rep) continue;
      const pipeline = rep.pipeline || 0;
      const quota = rep.quota || rep.quotaValue || 0;
      const coverage = quota > 0 ? pipeline / quota : 0;

      if (coverage >= 3) continue;

      const name = rep.name || rep.repName || 'Unknown rep';
      const email = rep.email || rep.ownerEmail || '';

      let severity = 'notable';
      if (coverage < 1) severity = 'act';
      else if (coverage < 2) severity = 'watch';

      findings.push(makeFinding(
        workspaceId, runId, skillId, severity, 'coverage_gap',
        `${name} has ${coverage.toFixed(1)}x coverage (${formatCurrency(pipeline)} pipeline)`,
        {
          owner_email: email,
          metadata: { coverage, pipeline, quota, deal_count: rep.dealCount, rep_name: name },
        },
      ));
    }
  }

  const repClassifications = result.rep_risk_classifications;
  if (Array.isArray(repClassifications)) {
    for (const cls of repClassifications) {
      if (!cls || cls.error) continue;
      const name = cls.rep_name || cls.repName || cls.name || 'Unknown rep';
      const riskLevel = (cls.risk_level || cls.severity || '').toLowerCase();

      let severity = 'info';
      if (riskLevel === 'high' || riskLevel === 'critical') severity = 'act';
      else if (riskLevel === 'medium') severity = 'watch';
      else if (riskLevel === 'low') severity = 'notable';

      if (severity === 'info') continue;

      findings.push(makeFinding(
        workspaceId, runId, skillId, severity, 'coverage_gap',
        `${name}: ${cls.assessment || cls.reason || 'coverage risk identified'}`,
        {
          owner_email: cls.email || cls.ownerEmail,
          metadata: { risk_level: riskLevel, assessment: cls.assessment, rep_name: name },
        },
      ));
    }
  }

  return findings;
}

function extractDealRiskReview(runId: string, workspaceId: string, result: Record<string, any>): FindingRow[] {
  const findings: FindingRow[] = [];
  const skillId = 'deal-risk-review';

  let riskScores: Record<string, any> = {};
  const assessment = result.risk_assessment;
  if (typeof assessment === 'string') {
    try {
      const jsonMatch = assessment.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed && typeof parsed === 'object') {
          riskScores = parsed;
        }
      }
    } catch { /* embedded JSON parse failed, proceed without */ }
  }

  const openDeals = result.open_deals;
  if (!Array.isArray(openDeals)) return findings;

  for (const deal of openDeals) {
    if (!deal) continue;
    const dealId = deal.id || deal.dealId || '';
    const dealName = deal.name || deal.dealName || 'Unknown deal';
    const amount = deal.amount || 0;
    const stage = deal.stage || '';
    const owner = deal.owner || deal.ownerEmail || '';

    const riskData = riskScores[dealId] || riskScores[dealName] || {};
    const riskScore = deal.deal_risk || deal.riskScore || riskData.score || riskData.risk_score || 0;
    const riskFactors = deal.risk_factors || riskData.risk_factors || riskData.factors || [];

    if (riskScore < 50 && (!Array.isArray(riskFactors) || riskFactors.length === 0)) continue;

    let severity = 'info';
    if (riskScore >= 80) severity = 'act';
    else if (riskScore >= 60) severity = 'watch';
    else if (riskScore >= 40 || (Array.isArray(riskFactors) && riskFactors.length > 0)) severity = 'notable';
    else continue;

    const amountStr = amount ? ` (${formatCurrency(amount)})` : '';
    let msg = `${dealName}${amountStr} — risk score ${riskScore}`;
    if (Array.isArray(riskFactors) && riskFactors.length > 0) {
      const factorStrs = riskFactors.slice(0, 3).map((f: any) => typeof f === 'string' ? f : f.factor || f.name || '');
      msg += `: ${factorStrs.filter(Boolean).join(', ')}`;
    }

    findings.push(makeFinding(
      workspaceId, runId, skillId, severity, 'deal_risk',
      msg,
      {
        deal_id: dealId,
        owner_email: owner,
        metadata: { risk_score: riskScore, risk_factors: riskFactors, amount, stage },
      },
    ));
  }

  return findings;
}

function extractRepScorecard(runId: string, workspaceId: string, result: Record<string, any>): FindingRow[] {
  const findings: FindingRow[] = [];
  const skillId = 'rep-scorecard';

  for (const [key, value] of Object.entries(result)) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      if (!item.flagged && !item.alert && !item.risk && !item.issue) continue;

      const name = item.rep_name || item.repName || item.name || 'Unknown rep';
      const rawSev = (item.severity || item.risk_level || item.priority || '').toLowerCase();
      let severity = 'info';
      if (rawSev === 'high' || rawSev === 'critical') severity = 'act';
      else if (rawSev === 'medium' || rawSev === 'warning') severity = 'watch';
      else if (rawSev === 'low') severity = 'notable';

      const message = item.message || item.alert || item.issue || item.flag || `${name}: flagged in ${key}`;

      findings.push(makeFinding(
        workspaceId, runId, skillId, severity, 'rep_scorecard',
        typeof message === 'string' ? message.slice(0, 250) : String(message).slice(0, 250),
        {
          owner_email: item.email || item.ownerEmail,
          metadata: { source_key: key, rep_name: name, ...item },
        },
      ));
    }
  }

  return findings;
}

function extractGenericFallback(
  skillId: string,
  runId: string,
  workspaceId: string,
  result: Record<string, any>,
): FindingRow[] {
  const findings: FindingRow[] = [];

  for (const [key, value] of Object.entries(result)) {
    if (!Array.isArray(value)) continue;

    for (const item of value) {
      if (!item || typeof item !== 'object') continue;

      const hasSeverity = item.severity || item.risk_level || item.priority;
      const hasMessage = item.message || item.alert || item.issue || item.finding;
      if (!hasSeverity && !hasMessage) continue;

      const rawSev = (item.severity || item.risk_level || item.priority || 'info').toLowerCase();
      let severity = 'info';
      if (rawSev === 'high' || rawSev === 'critical' || rawSev === 'act') severity = 'act';
      else if (rawSev === 'medium' || rawSev === 'warning' || rawSev === 'watch') severity = 'watch';
      else if (rawSev === 'low' || rawSev === 'notable') severity = 'notable';

      const message = (item.message || item.alert || item.issue || item.finding || `Finding from ${key}`);

      findings.push(makeFinding(
        workspaceId, runId, skillId, severity, key,
        typeof message === 'string' ? message.slice(0, 250) : String(message).slice(0, 250),
        {
          deal_id: item.dealId || item.deal_id || item.id,
          account_id: item.accountId || item.account_id,
          owner_email: item.owner || item.ownerEmail || item.email,
          metadata: item,
        },
      ));
    }
  }

  return findings;
}

export async function insertFindings(findings: FindingRow[]): Promise<number> {
  if (!findings || findings.length === 0) return 0;

  const workspaceId = findings[0].workspace_id;
  const skillId = findings[0].skill_id;

  await query(
    `UPDATE findings SET resolved_at = now() WHERE workspace_id = $1 AND skill_id = $2 AND resolved_at IS NULL`,
    [workspaceId, skillId],
  );

  const BATCH_SIZE = 100;
  let inserted = 0;

  for (let i = 0; i < findings.length; i += BATCH_SIZE) {
    const batch = findings.slice(i, i + BATCH_SIZE);
    const values: any[] = [];
    const placeholders: string[] = [];

    for (let j = 0; j < batch.length; j++) {
      const f = batch[j];
      const offset = j * 9;
      placeholders.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9})`,
      );
      values.push(
        f.workspace_id,
        f.skill_run_id,
        f.skill_id,
        f.severity,
        f.category,
        f.message,
        f.deal_id || null,
        f.owner_email || null,
        JSON.stringify(f.metadata),
      );
    }

    await query(
      `INSERT INTO findings (workspace_id, skill_run_id, skill_id, severity, category, message, deal_id, owner_email, metadata)
       VALUES ${placeholders.join(', ')}`,
      values,
    );

    inserted += batch.length;
  }

  console.log(`[FindingsExtractor] Inserted ${inserted} findings for ${skillId} in workspace ${workspaceId}`);
  return inserted;
}
