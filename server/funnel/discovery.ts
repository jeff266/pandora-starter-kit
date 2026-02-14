/**
 * AI-Assisted Funnel Discovery
 *
 * Analyzes CRM schema and data distributions to recommend the best funnel template
 * and generate CRM field mappings. Uses DeepSeek to classify sales motion and
 * suggest stage mappings.
 */

import { query } from '../db.js';
import { callLLM } from '../utils/llm-router.js';
import { getTemplate, getAllTemplates } from './templates.js';

// Wrapper for LLM completion
async function llmComplete(options: any) {
  const response = await callLLM({
    messages: [
      { role: 'system', content: options.systemPrompt || '' },
      { role: 'user', content: options.userPrompt }
    ],
    model: 'fireworks/deepseek-v3p1',
    maxTokens: options.maxTokens || 2000,
  }, options._tracking || {});

  return { content: response.content };
}
import type {
  FunnelDefinition,
  FunnelDiscoveryResult,
  FunnelStage,
  StageDataSource,
  StageMappingRecommendation,
  FunnelSide,
} from '../types/funnel.js';
import { randomUUID } from 'crypto';

interface CRMTypeDetection {
  connector_type: string;
  config: Record<string, any>;
}

/**
 * Main discovery function - analyzes workspace CRM data and recommends a funnel
 */
export async function discoverFunnel(workspaceId: string): Promise<FunnelDiscoveryResult> {
  console.log(`[Funnel Discovery] Starting for workspace ${workspaceId}`);

  // 1. Determine CRM type
  const connectorResult = await query<CRMTypeDetection>(
    `SELECT connector_name as connector_type, credentials as config
     FROM connections
     WHERE workspace_id = $1 AND status IN ('healthy', 'degraded')
     ORDER BY last_sync_at DESC
     LIMIT 1`,
    [workspaceId]
  );

  const crmType = connectorResult.rows[0]?.connector_type || 'unknown';
  console.log(`[Funnel Discovery] CRM type: ${crmType}`);

  // 2. Gather stage distributions from all relevant sources
  const stageData: StageDataSource[] = [];

  // -- Deal stages (all CRM types)
  const dealStages = await query<{
    stage: string;
    stage_normalized: string | null;
    count: string;
    total_value: string;
    won_count: string;
    lost_count: string;
    open_count: string;
  }>(
    `SELECT
      stage,
      stage_normalized,
      COUNT(*)::text as count,
      COALESCE(SUM(amount), 0)::text as total_value,
      COUNT(*) FILTER (WHERE stage_normalized = 'closed_won')::text as won_count,
      COUNT(*) FILTER (WHERE stage_normalized = 'closed_lost')::text as lost_count,
      COUNT(*) FILTER (
        WHERE stage_normalized NOT IN ('closed_won', 'closed_lost')
      )::text as open_count
     FROM deals
     WHERE workspace_id = $1 AND stage IS NOT NULL
     GROUP BY stage, stage_normalized
     ORDER BY COUNT(*) DESC`,
    [workspaceId]
  );

  stageData.push({
    source: 'deal_stages',
    object: 'deals',
    field: 'stage',
    normalized_field: 'stage_normalized',
    values: dealStages.rows,
  });

  // -- Contact lifecycle stages (HubSpot)
  if (crmType === 'hubspot') {
    const lifecycleStages = await query<{ stage: string | null; count: string }>(
      `SELECT
        custom_fields->>'lifecyclestage' as stage,
        COUNT(*)::text as count
       FROM contacts
       WHERE workspace_id = $1
         AND custom_fields->>'lifecyclestage' IS NOT NULL
       GROUP BY 1
       ORDER BY 2 DESC`,
      [workspaceId]
    );

    stageData.push({
      source: 'hubspot_lifecycle',
      object: 'contacts',
      field: 'lifecyclestage',
      field_path: "custom_fields->>'lifecyclestage'",
      values: lifecycleStages.rows.filter(r => r.stage !== null),
    });
  }

  // -- Lead statuses (Salesforce)
  if (crmType === 'salesforce') {
    const leadStatuses = await query<{ status: string | null; count: string }>(
      `SELECT
        status,
        COUNT(*)::text as count
       FROM leads
       WHERE workspace_id = $1
         AND status IS NOT NULL
       GROUP BY 1
       ORDER BY 2 DESC`,
      [workspaceId]
    );

    stageData.push({
      source: 'salesforce_leads',
      object: 'leads',
      field: 'status',
      values: leadStatuses.rows.filter(r => r.status !== null),
    });
  }

  // -- Check for post-sale indicators
  const postSalePatterns = await query<{ stage: string; stage_normalized: string | null; count: string }>(
    `SELECT stage, stage_normalized, COUNT(*)::text as count
     FROM deals
     WHERE workspace_id = $1
       AND (
         stage ILIKE '%expansion%' OR stage ILIKE '%upsell%' OR
         stage ILIKE '%cross-sell%' OR stage ILIKE '%renewal%' OR
         stage ILIKE '%renew%' OR stage ILIKE '%onboard%' OR
         stage ILIKE '%implement%' OR stage ILIKE '%kickoff%' OR
         stage ILIKE '%deploy%' OR stage ILIKE '%adoption%' OR
         stage ILIKE '%churn%' OR stage ILIKE '%cancel%'
       )
     GROUP BY 1, 2
     ORDER BY 3 DESC`,
    [workspaceId]
  );

  // -- Check for PLG indicators
  const plgIndicators = await query<{ plg_contacts: string; total_contacts: string }>(
    `SELECT
      COUNT(*) FILTER (
        WHERE custom_fields->>'signup_date' IS NOT NULL
        OR custom_fields->>'trial_start' IS NOT NULL
        OR custom_fields->>'activation_date' IS NOT NULL
      )::text as plg_contacts,
      COUNT(*)::text as total_contacts
     FROM contacts
     WHERE workspace_id = $1`,
    [workspaceId]
  );

  const plgContactsCount = parseInt(plgIndicators.rows[0]?.plg_contacts || '0', 10);
  const totalContactsCount = parseInt(plgIndicators.rows[0]?.total_contacts || '0', 10);
  const hasPlgSignals = plgContactsCount > (totalContactsCount * 0.1);

  // 3. Build discovery prompt for DeepSeek
  const templates = getAllTemplates();
  const templateDescriptions = Object.entries(templates)
    .map(([key, t], index) => {
      const stages = t.stages.map(s => s.label).join(' → ');
      return `${index + 1}. ${key}: ${stages}`;
    })
    .join('\n');

  const lifecycleData = stageData.find(s => s.source === 'hubspot_lifecycle');
  const leadData = stageData.find(s => s.source === 'salesforce_leads');

  const discoveryPrompt = `You are analyzing a CRM's stage data to recommend the best funnel model and map CRM values to funnel stages.

CRM TYPE: ${crmType}

DEAL STAGES FOUND:
${dealStages.rows.map(r =>
  `"${r.stage}" (normalized: ${r.stage_normalized || 'null'}) — ${r.count} deals, ` +
  `${r.open_count} open, ${r.won_count} won, ${r.lost_count} lost, ` +
  `$${parseFloat(r.total_value).toLocaleString()} total value`
).join('\n')}

${crmType === 'hubspot' && lifecycleData ? `
HUBSPOT LIFECYCLE STAGES:
${lifecycleData.values.map((r: any) =>
  `"${r.stage}" — ${r.count} contacts`
).join('\n')}
` : ''}

${crmType === 'salesforce' && leadData ? `
SALESFORCE LEAD STATUSES:
${leadData.values.map((r: any) =>
  `"${r.status}" — ${r.count} leads`
).join('\n')}
` : ''}

POST-SALE STAGE INDICATORS:
${postSalePatterns.rows.length > 0
  ? postSalePatterns.rows.map(r => `"${r.stage}" — ${r.count} deals`).join('\n')
  : 'None detected'}

PLG SIGNALS: ${hasPlgSignals ? 'YES — signup/trial/activation fields found on contacts' : 'NO'}

AVAILABLE TEMPLATES:
${templateDescriptions}

RESPOND WITH ONLY VALID JSON:
{
  "recommended_template": "classic_b2b" | "plg" | "enterprise" | "velocity" | "channel",
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation of why this template fits",

  "stage_mappings": [
    {
      "template_stage_id": "lead",
      "crm_object": "contacts",
      "crm_field": "custom_fields->>'lifecyclestage'",
      "crm_values": ["lead", "subscriber"],
      "confidence": 0.9,
      "note": "Standard HubSpot lifecycle mapping"
    }
  ],

  "stages_to_remove": [
    {
      "stage_id": "mql",
      "reason": "No MQL lifecycle stage found — company may skip this step"
    }
  ],

  "stages_to_add": [
    {
      "id": "pilot",
      "label": "Pilot",
      "side": "pre_sale",
      "after_stage": "eval",
      "reason": "Found 'Pilot' deal stage with 15 deals — appears to be a distinct phase"
    }
  ],

  "post_sale_available": true | false,
  "post_sale_mappings": [
    {
      "template_stage_id": "onboarding",
      "crm_object": "deals",
      "crm_field": "stage",
      "crm_values": ["07 -Kickoff"],
      "confidence": 0.8
    }
  ]
}`;

  console.log('[Funnel Discovery] Calling DeepSeek for template recommendation...');

  const classification = await llmComplete({
    provider: 'deepseek',
    systemPrompt: 'You are a RevOps analyst. Respond with only valid JSON.',
    userPrompt: discoveryPrompt,
    maxTokens: 2000,
    _tracking: {
      workspaceId,
      skillId: 'funnel-discovery',
      phase: 'classify',
      stepName: 'template-recommendation',
    },
  });

  let recommendation: any;
  try {
    recommendation = JSON.parse(classification.text);
  } catch (error) {
    console.error('[Funnel Discovery] Failed to parse DeepSeek response:', classification.text);
    throw new Error('Failed to parse AI recommendation');
  }

  // 4. Build the funnel definition from template + mappings
  const template = getTemplate(recommendation.recommended_template);
  if (!template) {
    throw new Error(`Unknown template: ${recommendation.recommended_template}`);
  }

  console.log(`[Funnel Discovery] Recommended template: ${recommendation.recommended_template} (confidence: ${recommendation.confidence})`);

  // Start with template stages
  let stages: FunnelStage[] = JSON.parse(JSON.stringify(template.stages)); // deep copy

  // Apply CRM mappings
  for (const mapping of recommendation.stage_mappings || []) {
    const stage = stages.find(s => s.id === mapping.template_stage_id);
    if (stage) {
      stage.source = {
        object: mapping.crm_object,
        field: mapping.crm_field,
        values: mapping.crm_values,
        field_path: mapping.crm_field.includes('->') ? mapping.crm_field : undefined,
      };
    }
  }

  // Remove stages that don't apply
  if (recommendation.stages_to_remove && recommendation.stages_to_remove.length > 0) {
    const removeIds = new Set(recommendation.stages_to_remove.map((s: any) => s.stage_id));
    stages = stages.filter(s => !removeIds.has(s.id));
  }

  // Add custom stages
  if (recommendation.stages_to_add && recommendation.stages_to_add.length > 0) {
    for (const newStage of recommendation.stages_to_add) {
      const afterIndex = stages.findIndex(s => s.id === newStage.after_stage);
      const insertAt = afterIndex >= 0 ? afterIndex + 1 : stages.length;
      stages.splice(insertAt, 0, {
        id: newStage.id,
        label: newStage.label,
        side: newStage.side as FunnelSide,
        order: 0, // will be renumbered
        source: { object: 'deals', field: '', values: [] },
        description: newStage.reason,
      });
    }
  }

  // Apply post-sale mappings
  if (recommendation.post_sale_mappings && recommendation.post_sale_mappings.length > 0) {
    for (const mapping of recommendation.post_sale_mappings) {
      const stage = stages.find(s => s.id === mapping.template_stage_id);
      if (stage) {
        stage.source = {
          object: mapping.crm_object,
          field: mapping.crm_field,
          values: mapping.crm_values,
        };
      }
    }
  }

  // Remove post-sale stages with no mappings (empty source values)
  stages = stages.filter(s =>
    s.side !== 'post_sale' ||
    (s.source.values && s.source.values.length > 0)
  );

  // Renumber order sequentially
  stages.forEach((s, i) => s.order = i + 1);

  // 5. Create the funnel definition
  const funnelDef: FunnelDefinition = {
    id: randomUUID(),
    workspace_id: workspaceId,
    model_type: recommendation.recommended_template,
    model_label: template.model_label,
    stages,
    status: 'discovered',
    discovered_at: new Date(),
    created_at: new Date(),
    updated_at: new Date(),
  };

  // 6. Store in context_layer definitions JSONB
  await query(
    `UPDATE context_layer
     SET definitions = jsonb_set(COALESCE(definitions, '{}'), '{funnel}', $2::jsonb),
         updated_at = NOW()
     WHERE workspace_id = $1`,
    [workspaceId, JSON.stringify(funnelDef)]
  );

  console.log(`[Funnel Discovery] Complete. Stored funnel with ${stages.length} stages`);

  return {
    funnel: funnelDef,
    recommendation: {
      template: recommendation.recommended_template,
      confidence: recommendation.confidence,
      reasoning: recommendation.reasoning,
      stages_removed: recommendation.stages_to_remove || [],
      stages_added: recommendation.stages_to_add || [],
      post_sale_available: recommendation.post_sale_available || false,
    },
  };
}

/**
 * Get the workspace's current funnel definition
 */
export async function getFunnelDefinition(workspaceId: string): Promise<FunnelDefinition | null> {
  const result = await query<{ funnel: FunnelDefinition }>(
    `SELECT definitions->'funnel' as funnel
     FROM context_layer
     WHERE workspace_id = $1`,
    [workspaceId]
  );

  return result.rows[0]?.funnel || null;
}

/**
 * Save or update a funnel definition
 */
export async function saveFunnelDefinition(
  workspaceId: string,
  funnel: Partial<FunnelDefinition>,
  status: 'template' | 'confirmed' = 'confirmed',
  confirmedBy?: string
): Promise<FunnelDefinition> {
  const existing = await getFunnelDefinition(workspaceId);

  const funnelDef: FunnelDefinition = {
    id: existing?.id || randomUUID(),
    workspace_id: workspaceId,
    model_type: funnel.model_type || 'custom',
    model_label: funnel.model_label || 'Custom Funnel',
    stages: funnel.stages || [],
    status,
    discovered_at: existing?.discovered_at,
    confirmed_at: status === 'confirmed' ? new Date() : existing?.confirmed_at,
    confirmed_by: status === 'confirmed' ? (confirmedBy || 'user') : existing?.confirmed_by,
    created_at: existing?.created_at || new Date(),
    updated_at: new Date(),
  };

  await query(
    `UPDATE context_layer
     SET definitions = jsonb_set(COALESCE(definitions, '{}'), '{funnel}', $2::jsonb),
         updated_at = NOW()
     WHERE workspace_id = $1`,
    [workspaceId, JSON.stringify(funnelDef)]
  );

  return funnelDef;
}

/**
 * Delete the funnel definition
 */
export async function deleteFunnelDefinition(workspaceId: string): Promise<void> {
  await query(
    `UPDATE context_layer
     SET definitions = definitions - 'funnel',
         updated_at = NOW()
     WHERE workspace_id = $1`,
    [workspaceId]
  );
}
