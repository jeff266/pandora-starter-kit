import type { McpTool } from '../index.js';
import { runSkillWithAutoSave } from './helpers.js';

export const getDealRiskReview: McpTool = {
  name: 'get_deal_risk_review',
  description: [
    'Returns deals assessed as at-risk of slipping or being lost.',
    'Includes risk score, days since activity, risk factors, and recommended action per deal.',
    'Auto-saves results. Pass save: false to skip.',
    'Filter by risk_level to focus on critical risks.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      risk_level: {
        type: 'string',
        enum: ['high', 'medium', 'low'],
        description: 'Filter to a specific risk level',
      },
      limit: {
        type: 'number',
        description: 'Max deals to return (default: 20)',
      },
      save: {
        type: 'boolean',
        description: 'Auto-save results to Pandora (default: true)',
      },
    },
  },
  handler: async (args: any, workspaceId: string) => {
    const save = args.save !== false;
    const limit = Math.min(args.limit ?? 20, 50);

    const result = await runSkillWithAutoSave(
      workspaceId,
      'deal-risk-review',
      {},
      save,
      'get_deal_risk_review'
    );

    const output = result.output ?? {};
    const evidence = output.evidence ?? {};
    const records: any[] = evidence.evaluated_records ?? [];
    const narrative = result.narrative ?? '';

    // Try to parse JSON array embedded in narrative (```json [...] ```)
    let dealsFromNarrative: any[] = [];
    try {
      const jsonMatch = narrative.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        dealsFromNarrative = JSON.parse(jsonMatch[0]);
      }
    } catch { /* fall back to records */ }

    let deals: any[] = dealsFromNarrative.length > 0
      ? dealsFromNarrative.map((d: any) => ({
          deal_name: d.dealName ?? d.deal_name,
          amount: d.amount,
          stage: d.currentStage ?? d.stage,
          close_date: d.closeDate ?? d.close_date,
          risk_level: d.risk ?? d.risk_level,
          risk_score: d.riskScore ?? d.risk_score,
          owner: d.owner ?? d.ownerName,
          days_since_activity: d.daysSinceActivity ?? d.days_since_activity,
          risk_factors: d.factors ?? d.risk_factors ?? [],
          recommended_action: d.recommendedAction ?? d.recommended_action,
        }))
      : records.map((r: any) => ({
          deal_name: r.entity_name,
          amount: r.fields?.amount,
          stage: r.fields?.stage,
          close_date: r.fields?.close_date,
          risk_level: r.flags?.risk_level ?? r.severity,
          risk_score: r.fields?.risk_score,
          owner: r.owner_name,
          days_since_activity: r.fields?.days_since_activity,
          risk_factors: r.flags?.risk_factors ?? [],
          recommended_action: r.flags?.recommended_action,
        }));

    if (args.risk_level) {
      deals = deals.filter((d: any) =>
        (d.risk_level ?? '').toLowerCase() === args.risk_level.toLowerCase()
      );
    }

    deals = deals.slice(0, limit);

    const highCount = deals.filter((d: any) =>
      (d.risk_level ?? '').toLowerCase() === 'high'
    ).length;
    const medCount = deals.filter((d: any) =>
      (d.risk_level ?? '').toLowerCase() === 'medium'
    ).length;

    return {
      skill_id: 'deal-risk-review',
      run_id: result.run_id,
      high_risk_count: highCount,
      medium_risk_count: medCount,
      total_shown: deals.length,
      at_risk_deals: deals,
      narrative: narrative.slice(0, 1000),
      saved: result.saved,
      generated_at: new Date().toISOString(),
    };
  },
};
