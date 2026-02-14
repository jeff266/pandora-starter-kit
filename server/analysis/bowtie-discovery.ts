/**
 * Bowtie Stage Discovery
 *
 * Detects whether a workspace's CRM data contains post-sale / bowtie stages
 * (onboarding, adoption, expansion, renewal, churned) alongside the standard
 * pre-sale funnel. Stores findings in context_layer.definitions.
 *
 * The "bowtie" model treats the customer lifecycle as two funnels joined
 * at closed_won: pre-sale (awareness → closed_won) and post-sale
 * (onboarding → renewal/churn).
 */

import { query } from '../db.js';
import { getDefinitions, updateContext } from '../context/index.js';

export interface BowtieStageMapping {
  rawStage: string;
  bowtieCategory: BowtieCategory;
  confidence: 'high' | 'medium' | 'low';
  dealCount: number;
  totalValue: number;
}

export type BowtieCategory =
  | 'onboarding'
  | 'adoption'
  | 'expansion'
  | 'renewal'
  | 'churned'
  | 'pre_sale';

export interface BowtieDiscoveryResult {
  hasBowtieStages: boolean;
  bowtieStages: BowtieStageMapping[];
  preSaleStageCount: number;
  postSaleStageCount: number;
  postSaleDealCount: number;
  postSaleTotalValue: number;
  discoveredAt: string;
}

const BOWTIE_PATTERNS: Record<BowtieCategory, RegExp[]> = {
  onboarding: [
    /onboard/i, /implement/i, /kickoff/i, /kick-off/i, /setup/i,
    /go[\s-]?live/i, /deployment/i, /provisioning/i, /activation/i,
    /customer[\s-]?success[\s-]?handoff/i,
  ],
  adoption: [
    /adopt/i, /active[\s-]?customer/i, /live[\s-]?customer/i,
    /usage[\s-]?ramp/i, /engagement/i, /health/i,
    /steady[\s-]?state/i, /ongoing/i,
  ],
  expansion: [
    /expand/i, /upsell/i, /cross[\s-]?sell/i, /growth/i,
    /upgrade/i, /additional[\s-]?license/i, /add[\s-]?on/i,
    /expansion/i, /land[\s-]?and[\s-]?expand/i,
  ],
  renewal: [
    /renew/i, /retention/i, /contract[\s-]?extension/i,
    /re[\s-]?sign/i, /subscription[\s-]?renewal/i,
  ],
  churned: [
    /churn/i, /cancel/i, /downgrad/i, /non[\s-]?renew/i,
    /lost[\s-]?customer/i, /departed/i, /offboard/i,
  ],
  pre_sale: [],
};

function classifyStage(rawStage: string): { category: BowtieCategory; confidence: 'high' | 'medium' | 'low' } {
  const stage = rawStage.replace(/[^\x00-\x7F]/g, '').trim();

  for (const [category, patterns] of Object.entries(BOWTIE_PATTERNS)) {
    if (category === 'pre_sale') continue;
    for (const pattern of patterns) {
      if (pattern.test(stage)) {
        const isExact = stage.replace(/[^a-zA-Z]/g, '').length < 20;
        return {
          category: category as BowtieCategory,
          confidence: isExact ? 'high' : 'medium',
        };
      }
    }
  }

  return { category: 'pre_sale', confidence: 'low' };
}

export async function discoverBowtieStages(workspaceId: string): Promise<BowtieDiscoveryResult> {
  const stageResult = await query<{
    stage: string;
    stage_normalized: string | null;
    deal_count: number;
    total_value: number;
  }>(
    `SELECT
       stage,
       stage_normalized,
       COUNT(*)::int as deal_count,
       COALESCE(SUM(amount), 0)::numeric as total_value
     FROM deals
     WHERE workspace_id = $1
       AND stage IS NOT NULL
       AND stage != ''
     GROUP BY stage, stage_normalized
     ORDER BY deal_count DESC`,
    [workspaceId]
  );

  const bowtieStages: BowtieStageMapping[] = [];
  let postSaleDealCount = 0;
  let postSaleTotalValue = 0;
  let preSaleCount = 0;

  for (const row of stageResult.rows) {
    const { category, confidence } = classifyStage(row.stage);

    const mapping: BowtieStageMapping = {
      rawStage: row.stage,
      bowtieCategory: category,
      confidence,
      dealCount: row.deal_count,
      totalValue: Number(row.total_value),
    };

    if (category !== 'pre_sale') {
      bowtieStages.push(mapping);
      postSaleDealCount += row.deal_count;
      postSaleTotalValue += Number(row.total_value);
    } else {
      preSaleCount++;
    }
  }

  const result: BowtieDiscoveryResult = {
    hasBowtieStages: bowtieStages.length > 0,
    bowtieStages,
    preSaleStageCount: preSaleCount,
    postSaleStageCount: bowtieStages.length,
    postSaleDealCount,
    postSaleTotalValue,
    discoveredAt: new Date().toISOString(),
  };

  const definitions = await getDefinitions(workspaceId) as Record<string, unknown>;
  await updateContext(workspaceId, 'definitions', {
    ...definitions,
    bowtie_discovery: result,
  }, 'system:bowtie-discovery');

  return result;
}

export async function getBowtieDiscovery(workspaceId: string): Promise<BowtieDiscoveryResult | null> {
  const definitions = await getDefinitions(workspaceId) as Record<string, unknown>;
  return (definitions?.bowtie_discovery as BowtieDiscoveryResult) ?? null;
}
