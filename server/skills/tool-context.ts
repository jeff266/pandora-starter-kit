import { getSkillRegistry } from './registry.js';

/**
 * Builds a context block listing all available analysis skills/tools.
 * Used in Assistant (Command Center) system prompts to provide tool awareness.
 */
export function getToolDefinitionsContext(): string {
  const registry = getSkillRegistry();
  const skills = registry.getAll();

  const toolDescriptions = skills
    .filter((s: any) => s.description)
    .map((s: any) => `- ${s.id}: ${s.description}`)
    .join('\n');

  return `
<available_tools>
The following analysis tools are available in the system:
${toolDescriptions}

When referencing analysis capabilities, use these skill IDs.
</available_tools>`;
}

/**
 * Builds a context block listing all available data query tools for Ask Pandora.
 * Provides brief descriptions of what each tool does.
 */
export function getPandoraToolsContext(): string {
  const tools = [
    'query_deals - Query deal/opportunity records with flexible filters',
    'query_accounts - Query account/company records',
    'query_contacts - Query contact records',
    'query_conversations - Query call/meeting/email records',
    'compute_metric - Calculate business metrics with full breakdown',
    'query_activity_timeline - Get chronological activity for deals/accounts',
    'query_stage_history - Get stage transition history',
    'compute_stage_benchmarks - Calculate time-in-stage benchmarks by stage',
    'compute_conversion_funnel - Calculate conversion rates between stages',
    'compute_cohort_analysis - Analyze deal cohorts over time',
    'query_custom_fields - Query custom field values and distributions',
    'query_schema - Discover available custom fields and metadata',
    'execute_sql - Run read-only SQL queries against the workspace database',
    'render_table - Format query results as a markdown table',
    'render_chart - Generate chart specifications from data',
  ];

  return `
<available_data_tools>
You have access to these data query tools:
${tools.map((t) => `- ${t}`).join('\n')}
</available_data_tools>`;
}
