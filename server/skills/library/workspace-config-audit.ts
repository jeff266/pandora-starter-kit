import type { SkillDefinition } from '../types.js';

export const workspaceConfigAuditSkill: SkillDefinition = {
  id: 'workspace-config-audit',
  name: 'Workspace Config Audit',
  description: 'Periodic audit of workspace configuration against live CRM data. Detects roster drift, unmapped stages, velocity shifts, win rate changes, segmentation patterns, coverage target misalignment, stale threshold calibration issues, and field fill rate gaps. Generates actionable suggestions when findings exist.',
  version: '1.0.0',
  category: 'config',
  tier: 'mixed',

  requiredTools: ['runConfigAudit'],
  requiredContext: [],

  schedule: {
    cron: '0 7 1,15 * *',
    description: 'Biweekly on 1st and 15th at 7 AM',
  },

  steps: [
    {
      id: 'audit-results',
      name: 'Run Config Drift Checks',
      tier: 'compute',
      computeFn: 'runConfigAudit',
      computeArgs: {},
      outputKey: 'audit_data',
    },

    {
      id: 'classify-findings',
      name: 'Classify & Prioritize Findings',
      tier: 'deepseek',
      dependsOn: ['audit-results'],
      deepseekPrompt: `You are a RevOps platform analyst reviewing workspace configuration drift findings.

CONFIG STATUS: {{#if audit_data.config_confirmed}}User-confirmed{{else}}Auto-inferred (not yet confirmed){{/if}}

AUDIT SUMMARY:
- Checks run: {{audit_data.checks_run}}
- Passed: {{audit_data.checks_passed}}
- Findings: {{audit_data.findings.length}} ({{audit_data.summary.critical}} critical, {{audit_data.summary.warning}} warning, {{audit_data.summary.info}} info)

FINDINGS:
{{#each audit_data.findings}}
### {{this.check}} [{{this.severity}}]
{{this.message}}
Evidence: {{{json this.evidence}}}

{{/each}}

For each finding, provide:
1. priority: 1 (act now) | 2 (this week) | 3 (next review)
2. impact: Which skills/reports are affected
3. action: Specific one-sentence recommendation

{{#unless audit_data.findings.length}}
No findings detected. Return an empty classifications array.
{{/unless}}

Respond with ONLY a JSON object:
{
  "classifications": [
    {
      "check": "string",
      "priority": 1,
      "impact": "string",
      "action": "string"
    }
  ],
  "overall_config_health": "healthy | needs_attention | critical",
  "top_action": "string or null"
}`,
      outputKey: 'finding_classifications',
      parseAs: 'json',
    },

    {
      id: 'synthesize-report',
      name: 'Generate Audit Report',
      tier: 'claude',
      dependsOn: ['audit-results', 'classify-findings'],
      claudePrompt: `You are a RevOps platform delivering a workspace configuration health report. Be concise and actionable — skip findings with no data.

{{#unless audit_data.findings.length}}
All 8 configuration checks passed with no findings. Respond with a brief "Config Health: All Clear" summary (2-3 sentences max).
{{/unless}}

# Config Audit Results

Config Status: {{#if audit_data.config_confirmed}}Confirmed by user{{else}}Auto-inferred — recommend user review{{/if}}
Checks: {{audit_data.checks_passed}}/{{audit_data.checks_run}} passed

{{#if audit_data.findings.length}}
## Findings ({{audit_data.summary.critical}} critical, {{audit_data.summary.warning}} warning, {{audit_data.summary.info}} info)

{{#each audit_data.findings}}
### {{this.check}} — {{this.severity}}
{{this.message}}
{{/each}}

## Classifications
{{#each finding_classifications.classifications}}
- **{{this.check}}** (P{{this.priority}}): {{this.action}} — Impacts: {{this.impact}}
{{/each}}

Overall Health: {{finding_classifications.overall_config_health}}
{{#if finding_classifications.top_action}}Top Action: {{finding_classifications.top_action}}{{/if}}
{{/if}}

Write a structured report:
1. **Health Score** — healthy/needs_attention/critical with one-line rationale
2. **Priority Actions** — numbered list of what to fix, in priority order (max 5)
3. **Impact Assessment** — which skills/reports are affected by current config gaps
4. **Recommendation** — one paragraph on whether config needs immediate attention

Keep the report under 400 words. Use specific numbers from the data. No generic advice.`,
      outputKey: 'report',
    },
  ],

  evidenceSchema: {
    entity_type: 'workspace',
    columns: [
      { key: 'check_name', display: 'Check', format: 'text' },
      { key: 'severity', display: 'Severity', format: 'severity' },
      { key: 'message', display: 'Finding', format: 'text' },
      { key: 'priority', display: 'Priority', format: 'number' },
      { key: 'impact', display: 'Impacted Skills', format: 'text' },
      { key: 'action', display: 'Recommended Action', format: 'text' },
    ],
  },
};
