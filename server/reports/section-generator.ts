// Section Content Generator
// Converts ReportSection → SectionContent by pulling from skill evidence

import { query } from '../db.js';
import { ReportSection, SectionContent, VoiceConfig, MetricCard, DealCard, ActionItem, TableRow } from './types.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('SectionGenerator');

interface SkillRunResult {
  skill_id: string;
  completed_at: string;
  output: any;
  output_text: string;
}

interface FindingClaim {
  severity: string;
  category: string;
  message: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_name: string | null;
  metric_value: any;
}

interface ActionRecord {
  id: string;
  title: string;
  summary: string;
  severity: string;
  urgency_label: string;
  target_entity_type: string;
  target_entity_name: string;
  owner_email: string;
  recommended_steps: string[];
}

export async function generateSectionContent(
  workspaceId: string,
  section: ReportSection,
  voiceConfig: VoiceConfig
): Promise<SectionContent> {
  logger.info('Generating section content', { section_id: section.id, skills: section.skills });

  // Pull skill evidence from most recent runs
  const skillData = await loadSkillEvidence(workspaceId, section.skills);

  // Pull actions for this section's skills
  const actions = await loadActions(workspaceId, section.skills);

  const content: SectionContent = {
    section_id: section.id,
    title: section.label,
    narrative: await generateNarrative(section, skillData, voiceConfig),
    source_skills: section.skills,
    data_freshness: new Date().toISOString(),
    confidence: calculateConfidence(skillData),
  };

  // Populate structured elements based on section type
  switch (section.id) {
    case 'the-number':
      content.metrics = extractForecastMetrics(skillData);
      break;

    case 'what-moved':
      content.deal_cards = extractMovementCards(skillData, section.config.max_items || 10);
      break;

    case 'deals-needing-attention':
      content.deal_cards = extractRiskDeals(skillData, section.config.max_items || 15);
      content.action_items = extractActionItems(actions, section.config.max_items || 10);
      break;

    case 'rep-performance':
      content.table = extractRepPerformanceTable(skillData);
      break;

    case 'pipeline-hygiene':
      content.deal_cards = extractHygieneIssues(skillData, section.config.max_items || 20);
      content.action_items = extractActionItems(actions, section.config.max_items || 10);
      break;

    case 'call-intelligence':
      content.metrics = extractCallMetrics(skillData);
      break;

    case 'pipeline-coverage':
      content.metrics = extractCoverageMetrics(skillData);
      if (section.config.include_chart) {
        content.chart_data = extractCoverageChart(skillData);
      }
      break;

    case 'icp-fit-analysis':
      content.metrics = extractICPMetrics(skillData);
      content.table = extractICPTable(skillData, section.config.max_items || 15);
      break;

    case 'forecast-waterfall':
      content.metrics = extractWaterfallMetrics(skillData);
      if (section.config.include_chart) {
        content.chart_data = extractWaterfallChart(skillData);
      }
      break;

    case 'actions-summary':
      // Aggregate all actions from all skills in the workspace
      content.action_items = extractActionItems(actions, section.config.max_items || 5);
      break;
  }

  return content;
}

// Load skill evidence from most recent successful runs
async function loadSkillEvidence(workspaceId: string, skillIds: string[]): Promise<Map<string, SkillRunResult>> {
  if (skillIds.length === 0) return new Map();

  const result = await query<SkillRunResult>(
    `SELECT DISTINCT ON (skill_id)
       skill_id, completed_at, output, output_text
     FROM skill_runs
     WHERE workspace_id = $1
       AND skill_id = ANY($2)
       AND status = 'completed'
       AND completed_at >= NOW() - INTERVAL '7 days'
     ORDER BY skill_id, completed_at DESC`,
    [workspaceId, skillIds]
  );

  const evidenceMap = new Map<string, SkillRunResult>();
  for (const row of result.rows) {
    evidenceMap.set(row.skill_id, row);
  }

  return evidenceMap;
}

// Load actions from these skills
async function loadActions(workspaceId: string, skillIds: string[]): Promise<ActionRecord[]> {
  if (skillIds.length === 0) {
    // For actions-summary, load from ALL skills
    const result = await query<ActionRecord>(
      `SELECT id, title, summary, severity, urgency_label,
              target_entity_type, target_entity_name, owner_email, recommended_steps
       FROM actions
       WHERE workspace_id = $1
         AND execution_status = 'open'
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY
         CASE severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,
         created_at DESC
       LIMIT 100`,
      [workspaceId]
    );
    return result.rows;
  }

  const result = await query<ActionRecord>(
    `SELECT id, title, summary, severity, urgency_label,
            target_entity_type, target_entity_name, owner_email, recommended_steps
     FROM actions
     WHERE workspace_id = $1
       AND source_skill = ANY($2)
       AND execution_status = 'open'
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY
       CASE severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END,
       created_at DESC
     LIMIT 50`,
    [workspaceId, skillIds]
  );

  return result.rows;
}

// Generate narrative from skill data
async function generateNarrative(
  section: ReportSection,
  skillData: Map<string, SkillRunResult>,
  voiceConfig: VoiceConfig
): Promise<string> {
  // Extract summary text from skill outputs
  const summaries: string[] = [];
  for (const [skillId, data] of skillData.entries()) {
    if (data.output_text) {
      summaries.push(data.output_text);
    } else if (data.output?.narrative) {
      summaries.push(data.output.narrative);
    } else if (data.output?.summary) {
      summaries.push(data.output.summary);
    }
  }

  if (summaries.length === 0) {
    return `No recent data available for "${section.label}". Run the required skills: ${section.skills.join(', ')}.`;
  }

  // Combine summaries with basic deduplication
  return summaries.join(' ').slice(0, 2000);
}

// Calculate confidence based on data freshness
function calculateConfidence(skillData: Map<string, SkillRunResult>): number {
  if (skillData.size === 0) return 0;

  const now = Date.now();
  let totalFreshness = 0;

  for (const data of skillData.values()) {
    const age = now - new Date(data.completed_at).getTime();
    const hoursOld = age / (1000 * 60 * 60);
    // Confidence decays from 1.0 (fresh) to 0.5 (7 days old)
    const freshness = Math.max(0.5, 1.0 - (hoursOld / 168) * 0.5);
    totalFreshness += freshness;
  }

  return totalFreshness / skillData.size;
}

// Extract forecast metrics from forecast-rollup and monte-carlo skills
function extractForecastMetrics(skillData: Map<string, SkillRunResult>): MetricCard[] {
  const metrics: MetricCard[] = [];

  const forecastRun = skillData.get('forecast-rollup');
  const monteCarloRun = skillData.get('monte-carlo');

  if (forecastRun?.output?.metrics) {
    const m = forecastRun.output.metrics;
    if (m.forecast_amount) {
      metrics.push({
        label: 'Forecast',
        value: formatCurrency(m.forecast_amount),
        severity: m.pacing_pct >= 0.9 ? 'good' : m.pacing_pct >= 0.7 ? 'warning' : 'critical',
      });
    }
    if (m.pacing_pct !== undefined) {
      metrics.push({
        label: 'Pacing',
        value: `${Math.round(m.pacing_pct * 100)}%`,
        delta: m.pacing_delta ? `${m.pacing_delta > 0 ? '+' : ''}${Math.round(m.pacing_delta * 100)}%` : undefined,
        delta_direction: m.pacing_delta > 0 ? 'up' : m.pacing_delta < 0 ? 'down' : 'flat',
        severity: m.pacing_pct >= 0.9 ? 'good' : m.pacing_pct >= 0.7 ? 'warning' : 'critical',
      });
    }
  }

  if (monteCarloRun?.output?.p50) {
    metrics.push({
      label: 'Monte Carlo P50',
      value: formatCurrency(monteCarloRun.output.p50),
      severity: 'warning',
    });
  }

  return metrics;
}

// Extract pipeline coverage metrics
function extractCoverageMetrics(skillData: Map<string, SkillRunResult>): MetricCard[] {
  const metrics: MetricCard[] = [];
  const coverageRun = skillData.get('pipeline-coverage');

  if (coverageRun?.output?.metrics) {
    const m = coverageRun.output.metrics;
    if (m.coverage_ratio) {
      metrics.push({
        label: 'Coverage Ratio',
        value: `${m.coverage_ratio.toFixed(1)}x`,
        severity: m.coverage_ratio >= 3.0 ? 'good' : m.coverage_ratio >= 2.0 ? 'warning' : 'critical',
      });
    }
    if (m.gap_to_target) {
      metrics.push({
        label: 'Gap to Target',
        value: formatCurrency(m.gap_to_target),
        severity: m.gap_to_target < 100000 ? 'good' : m.gap_to_target < 500000 ? 'warning' : 'critical',
      });
    }
  }

  return metrics;
}

// Extract call intelligence metrics
function extractCallMetrics(skillData: Map<string, SkillRunResult>): MetricCard[] {
  const metrics: MetricCard[] = [];
  const callRun = skillData.get('conversation-intelligence');

  if (callRun?.output?.metrics) {
    const m = callRun.output.metrics;
    if (m.total_calls !== undefined) {
      metrics.push({ label: 'Total Calls', value: String(m.total_calls) });
    }
    if (m.competitor_mentions !== undefined) {
      metrics.push({ label: 'Competitor Mentions', value: String(m.competitor_mentions) });
    }
    if (m.champion_signals !== undefined) {
      metrics.push({ label: 'Champion Signals', value: String(m.champion_signals) });
    }
  }

  return metrics;
}

// Extract ICP metrics
function extractICPMetrics(skillData: Map<string, SkillRunResult>): MetricCard[] {
  const metrics: MetricCard[] = [];
  const icpRun = skillData.get('icp-discovery');

  if (icpRun?.output?.metrics) {
    const m = icpRun.output.metrics;
    if (m.icp_match_rate !== undefined) {
      metrics.push({
        label: 'ICP Match Rate',
        value: `${Math.round(m.icp_match_rate * 100)}%`,
        severity: m.icp_match_rate >= 0.6 ? 'good' : m.icp_match_rate >= 0.4 ? 'warning' : 'critical',
      });
    }
    if (m.avg_fit_score !== undefined) {
      metrics.push({ label: 'Avg Fit Score', value: String(Math.round(m.avg_fit_score)) });
    }
  }

  return metrics;
}

// Extract waterfall metrics
function extractWaterfallMetrics(skillData: Map<string, SkillRunResult>): MetricCard[] {
  const metrics: MetricCard[] = [];
  const waterfallRun = skillData.get('pipeline-waterfall');

  if (waterfallRun?.output?.metrics) {
    const m = waterfallRun.output.metrics;
    if (m.net_change !== undefined) {
      metrics.push({
        label: 'Net Change',
        value: formatCurrency(m.net_change),
        delta_direction: m.net_change > 0 ? 'up' : m.net_change < 0 ? 'down' : 'flat',
        severity: m.net_change > 0 ? 'good' : 'warning',
      });
    }
    if (m.closed_won !== undefined) {
      metrics.push({ label: 'Closed Won', value: formatCurrency(m.closed_won), severity: 'good' });
    }
    if (m.closed_lost !== undefined) {
      metrics.push({ label: 'Closed Lost', value: formatCurrency(m.closed_lost), severity: 'critical' });
    }
  }

  return metrics;
}

// Extract risk deals from findings
function extractRiskDeals(skillData: Map<string, SkillRunResult>, maxItems: number): DealCard[] {
  const cards: DealCard[] = [];

  // Get evaluated_records from deal-risk-review, single-thread-alert, etc.
  for (const [skillId, data] of skillData.entries()) {
    const records = data.output?.evidence?.evaluated_records || data.output?.evaluated_records || [];

    for (const record of records.slice(0, maxItems)) {
      if (record.risk_score && record.risk_score >= 70) {
        cards.push({
          name: record.deal_name || record.name || 'Unknown Deal',
          amount: formatCurrency(record.amount || 0),
          owner: record.owner_name || record.owner || 'Unknown',
          stage: record.stage || 'Unknown',
          signal: record.risk_reason || record.signal || 'High risk score',
          signal_severity: record.risk_score >= 85 ? 'critical' : record.risk_score >= 70 ? 'warning' : 'info',
          detail: record.detail || record.risk_detail || '',
          action: record.recommended_action || 'Review and take action',
        });
      }
    }
  }

  return cards.slice(0, maxItems);
}

// Extract hygiene issues
function extractHygieneIssues(skillData: Map<string, SkillRunResult>, maxItems: number): DealCard[] {
  const cards: DealCard[] = [];
  const hygieneRun = skillData.get('pipeline-hygiene');

  if (hygieneRun?.output?.evaluated_records) {
    for (const record of hygieneRun.output.evaluated_records.slice(0, maxItems)) {
      cards.push({
        name: record.deal_name || record.name || 'Unknown Deal',
        amount: formatCurrency(record.amount || 0),
        owner: record.owner_name || record.owner || 'Unknown',
        stage: record.stage || 'Unknown',
        signal: record.issue_type || 'Data quality issue',
        signal_severity: record.severity === 'critical' ? 'critical' : 'warning',
        detail: record.issue_detail || record.detail || '',
        action: record.recommended_fix || 'Update missing data',
      });
    }
  }

  return cards;
}

// Extract movement cards (what moved this week)
function extractMovementCards(skillData: Map<string, SkillRunResult>, maxItems: number): DealCard[] {
  const cards: DealCard[] = [];
  const waterfallRun = skillData.get('pipeline-waterfall');

  if (waterfallRun?.output?.movements) {
    for (const movement of waterfallRun.output.movements.slice(0, maxItems)) {
      cards.push({
        name: movement.deal_name || 'Unknown Deal',
        amount: formatCurrency(movement.amount || 0),
        owner: movement.owner_name || 'Unknown',
        stage: movement.to_stage || movement.stage || 'Unknown',
        signal: movement.movement_type || 'Stage change',
        signal_severity: movement.movement_type === 'closed_won' ? 'info' : movement.movement_type === 'closed_lost' ? 'critical' : 'warning',
        detail: movement.detail || `Moved from ${movement.from_stage} to ${movement.to_stage}`,
        action: movement.action || 'Monitor progress',
      });
    }
  }

  return cards;
}

// Extract rep performance table
function extractRepPerformanceTable(skillData: Map<string, SkillRunResult>): { headers: string[]; rows: TableRow[] } | undefined {
  const repRun = skillData.get('rep-scorecard');
  if (!repRun?.output?.reps) return undefined;

  const headers = ['Rep', 'Pipeline', 'Coverage', 'Win Rate', 'Deals'];
  const rows: TableRow[] = [];

  for (const rep of repRun.output.reps) {
    rows.push({
      Rep: rep.name || rep.email || 'Unknown',
      Pipeline: formatCurrency(rep.pipeline || 0),
      Coverage: rep.coverage_ratio ? `${rep.coverage_ratio.toFixed(1)}x` : 'N/A',
      'Win Rate': rep.win_rate ? `${Math.round(rep.win_rate * 100)}%` : 'N/A',
      Deals: rep.deal_count || 0,
    });
  }

  return { headers, rows };
}

// Extract ICP fit table
function extractICPTable(skillData: Map<string, SkillRunResult>, maxItems: number): { headers: string[]; rows: TableRow[] } | undefined {
  const icpRun = skillData.get('icp-discovery');
  if (!icpRun?.output?.accounts) return undefined;

  const headers = ['Account', 'Fit Score', 'Tier', 'Industry', 'Employees'];
  const rows: TableRow[] = [];

  for (const account of icpRun.output.accounts.slice(0, maxItems)) {
    rows.push({
      Account: account.name || 'Unknown',
      'Fit Score': account.fit_score || 0,
      Tier: account.tier || 'N/A',
      Industry: account.industry || 'Unknown',
      Employees: account.employee_count || 0,
    });
  }

  return { headers, rows };
}

// Extract coverage chart
function extractCoverageChart(skillData: Map<string, SkillRunResult>) {
  const coverageRun = skillData.get('pipeline-coverage');
  if (!coverageRun?.output?.by_territory) return undefined;

  return {
    type: 'bar' as const,
    labels: coverageRun.output.by_territory.map((t: any) => t.territory_name),
    datasets: [{
      label: 'Coverage Ratio',
      data: coverageRun.output.by_territory.map((t: any) => t.coverage_ratio || 0),
      color: '#3b82f6',
    }],
  };
}

// Extract waterfall chart
function extractWaterfallChart(skillData: Map<string, SkillRunResult>) {
  const waterfallRun = skillData.get('pipeline-waterfall');
  if (!waterfallRun?.output?.waterfall_data) return undefined;

  const data = waterfallRun.output.waterfall_data;
  return {
    type: 'waterfall' as const,
    labels: ['Start', 'New', 'Won', 'Lost', 'Moved', 'End'],
    datasets: [{
      label: 'Pipeline Movement',
      data: [
        data.start_amount || 0,
        data.new_created || 0,
        -(data.closed_won || 0),
        -(data.closed_lost || 0),
        data.stage_changes || 0,
        data.end_amount || 0,
      ],
      color: '#3b82f6',
    }],
  };
}

// Extract action items
function extractActionItems(actions: ActionRecord[], maxItems: number): ActionItem[] {
  return actions.slice(0, maxItems).map(action => ({
    owner: action.owner_email || action.target_entity_name || 'Team',
    action: action.title,
    urgency: mapUrgency(action.severity, action.urgency_label),
    related_deal: action.target_entity_type === 'deal' ? action.target_entity_name : undefined,
  }));
}

// Map action severity to urgency
function mapUrgency(severity: string, urgencyLabel: string): 'today' | 'this_week' | 'this_month' {
  if (severity === 'critical' || urgencyLabel?.includes('days') && parseInt(urgencyLabel) < 3) {
    return 'today';
  }
  if (severity === 'warning' || urgencyLabel?.includes('week')) {
    return 'this_week';
  }
  return 'this_month';
}

// Format currency
function formatCurrency(amount: number): string {
  if (amount >= 1000000) {
    return `$${(amount / 1000000).toFixed(1)}M`;
  }
  if (amount >= 1000) {
    return `$${Math.round(amount / 1000)}K`;
  }
  return `$${Math.round(amount)}`;
}
