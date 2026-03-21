import { query } from '../db.js';
import { ReportSection } from '../reports/types.js';

const WBR_SECTIONS: ReportSection[] = [
  {
    id: 'wbr-pipeline-health',
    label: 'Pipeline Health Snapshot',
    description: 'Stage distribution, coverage ratio, net new pipeline, at-risk deals',
    skills: ['pipeline-hygiene', 'pipeline-coverage'],
    config: { detail_level: 'executive', include_chart: true },
    order: 0,
    enabled: true,
  },
  {
    id: 'wbr-forecast',
    label: 'Forecast Review',
    description: 'Commit vs. Best Case vs. Pipeline, forecast movement, gap to quota, slippage',
    skills: ['forecast-rollup'],
    config: { detail_level: 'executive', include_chart: true },
    order: 1,
    enabled: true,
  },
  {
    id: 'wbr-deal-velocity',
    label: 'Deal Velocity Metrics',
    description: 'Sales cycle trends, deal size, recent closed-won/lost, deal desk flags',
    skills: ['deal-risk-review', 'pipeline-waterfall'],
    config: { detail_level: 'manager', include_deal_list: true, max_items: 10 },
    order: 2,
    enabled: true,
  },
  {
    id: 'wbr-rep-performance',
    label: 'Rep-Level Performance',
    description: 'QTD attainment, activity metrics, pipeline generation per rep, leaderboard',
    skills: ['rep-scorecard', 'pipeline-coverage'],
    config: { detail_level: 'manager', include_chart: true },
    order: 3,
    enabled: true,
  },
  {
    id: 'wbr-demand',
    label: 'Lead & Demand Signal',
    description: 'MQL→SQL conversion, inbound vs outbound split, lead response time, routing',
    skills: ['pipeline-coverage'],
    config: { detail_level: 'executive' },
    order: 4,
    enabled: true,
  },
  {
    id: 'wbr-hygiene',
    label: 'Process & Hygiene Flags',
    description: 'CRM hygiene score, overdue tasks, stale opportunities, forecast category accuracy',
    skills: ['pipeline-hygiene'],
    config: { detail_level: 'manager', include_deal_list: true, max_items: 15 },
    order: 5,
    enabled: true,
  },
  {
    id: 'wbr-actions',
    label: 'Key Actions & Owners',
    description: "Last week's actions — done or not. This week's actions with owner and due date.",
    skills: [],
    config: { detail_level: 'executive', max_items: 10 },
    order: 6,
    enabled: true,
  },
  {
    id: 'wbr-watchlist',
    label: 'What to Watch',
    description: 'Deals expected to close this week, at-risk accounts, external factors',
    skills: ['deal-risk-review'],
    config: { detail_level: 'executive', include_deal_list: true, max_items: 5 },
    order: 7,
    enabled: true,
  },
];

const QBR_SECTIONS: ReportSection[] = [
  {
    id: 'qbr-the-number',
    label: 'Quarter in Review: The Number',
    description: 'Final attainment, bookings vs target, ARR impact, vs prior quarter and prior year, segment breakdown',
    skills: ['forecast-rollup', 'rep-scorecard'],
    config: { detail_level: 'executive', include_chart: true },
    order: 0,
    enabled: true,
  },
  {
    id: 'qbr-pipeline-funnel',
    label: 'Pipeline & Funnel Analysis',
    description: 'Pipeline entering vs exiting quarter, coverage at quarter start, stage conversion rates, sales cycle, deal size trends, waterfall',
    skills: ['pipeline-waterfall', 'pipeline-coverage', 'pipeline-hygiene'],
    config: { detail_level: 'executive', include_chart: true },
    order: 1,
    enabled: true,
  },
  {
    id: 'qbr-forecast-accuracy',
    label: 'Forecast Accuracy Review',
    description: 'Commit accuracy by rep and manager, best case accuracy, slippage rate, who forecasts well',
    skills: ['forecast-rollup'],
    config: { detail_level: 'manager', metrics: ['commit_accuracy', 'best_case_accuracy', 'slippage_rate'] },
    order: 2,
    enabled: true,
  },
  {
    id: 'qbr-win-loss',
    label: 'Win/Loss Analysis',
    description: 'Win rate overall and by competitor, top reasons for loss, top reasons for win, deal size won vs lost, no-decision analysis',
    skills: ['deal-risk-review'],
    config: { detail_level: 'executive', include_deal_list: true, max_items: 20 },
    order: 3,
    enabled: true,
  },
  {
    id: 'qbr-rep-performance',
    label: 'Rep & Team Performance',
    description: 'Attainment distribution, ramp performance, top and bottom performer analysis, tenure vs performance',
    skills: ['rep-scorecard'],
    config: { detail_level: 'manager', include_chart: true },
    order: 4,
    enabled: true,
  },
  {
    id: 'qbr-capacity',
    label: 'Sales Capacity & Coverage',
    description: 'Headcount plan vs actual, capacity model, territory and account coverage, rep pipeline load',
    skills: ['pipeline-coverage'],
    config: { detail_level: 'manager', include_chart: true },
    order: 5,
    enabled: true,
  },
  {
    id: 'qbr-process-health',
    label: 'Process & Systems Health',
    description: 'CRM data quality scorecard, tool adoption, process compliance, automation performance, top friction points',
    skills: ['pipeline-hygiene'],
    config: { detail_level: 'manager', include_deal_list: true, max_items: 20 },
    order: 6,
    enabled: true,
  },
  {
    id: 'qbr-marketing',
    label: 'Marketing & Pipeline Sourcing',
    description: 'Pipeline by source, MQL→SQL→Opp conversion, marketing-sourced contribution, SDR/BDR performance, lead response time',
    skills: ['pipeline-coverage'],
    config: { detail_level: 'executive', include_chart: true },
    order: 7,
    enabled: true,
  },
  {
    id: 'qbr-next-quarter',
    label: 'Next Quarter Plan',
    description: 'Pipeline entering Q+1, coverage ratio, quota plan, key initiatives, hiring plan, top risks and opportunities',
    skills: ['forecast-rollup', 'pipeline-coverage'],
    config: { detail_level: 'executive', include_chart: true },
    order: 8,
    enabled: true,
  },
  {
    id: 'qbr-asks',
    label: 'Asks & Commitments',
    description: 'What RevOps needs from sales leadership, what RevOps is committing to, cross-functional asks',
    skills: [],
    config: { detail_level: 'executive', max_items: 10 },
    order: 9,
    enabled: true,
  },
];

export async function seedWbrQbrTemplates(workspaceId: string): Promise<void> {
  const existing = await query<{ id: string; created_from_template: string }>(
    `SELECT id, created_from_template FROM report_templates
     WHERE workspace_id = $1
       AND created_from_template IN ('wbr_standard', 'qbr_standard')`,
    [workspaceId]
  );

  const seededKeys = new Set(existing.rows.map(r => r.created_from_template));
  if (seededKeys.has('wbr_standard') && seededKeys.has('qbr_standard')) return;

  if (!seededKeys.has('wbr_standard')) {
    await query(
      `INSERT INTO report_templates
         (workspace_id, name, description, sections, cadence,
          formats, created_from_template, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT DO NOTHING`,
      [
        workspaceId,
        'Weekly Business Review',
        'Operational pipeline review for RevOps and sales leadership. 15-20 minutes. Lead with the number, close with actions.',
        JSON.stringify(WBR_SECTIONS),
        'weekly',
        JSON.stringify(['pdf']),
        'wbr_standard',
        true,
      ]
    );
  }

  if (!seededKeys.has('qbr_standard')) {
    await query(
      `INSERT INTO report_templates
         (workspace_id, name, description, sections, cadence,
          formats, created_from_template, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT DO NOTHING`,
      [
        workspaceId,
        'Quarterly Business Review',
        'Strategic quarter review for RevOps presenting to sales leadership and executives. 45-60 minutes. What happened, why, and what changes.',
        JSON.stringify(QBR_SECTIONS),
        'quarterly',
        JSON.stringify(['pdf']),
        'qbr_standard',
        true,
      ]
    );
  }
}
