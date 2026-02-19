/**
 * Scope Inference
 *
 * Inspects the normalized deals table for a workspace and proposes
 * analysis_scopes rows based on three detection paths (in priority order):
 *
 *   Path 1: HubSpot pipelines     (confidence 1.0)
 *   Path 2: Salesforce record types (confidence 0.95)
 *   Path 3: Custom segmentation fields (confidence 0.80)
 *
 * Runs after initial sync completes. Does NOT make any CRM API calls.
 * All inference runs on the already-normalized deals table only.
 *
 * Usage:
 *   const scopes = await inferAnalysisScopes(workspaceId);
 *   await applyInferredScopes(workspaceId, scopes);
 */

import { query } from '../db.js';

// ============================================================================
// Types
// ============================================================================

export interface InferredScope {
  scope_id: string;         // slugified name: "new-business", "renewals"
  name: string;             // human label: "New Business", "Renewals"
  filter_field: string;     // normalized field name or JSONB path
  filter_operator: 'in';   // always 'in' for now
  filter_values: string[]; // the values that match this scope
  confidence: number;       // 0.0–1.0
  source: string;           // 'hubspot_pipeline' | 'salesforce_record_type' | 'custom_field:<name>'
  deal_count: number;       // how many deals matched during inference
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Convert a display name to a URL-safe scope_id slug.
 * "New Business" → "new-business"
 * "SMB/Mid-Market" → "smb-mid-market"
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Try to look up pipeline names from context_layer workspace config.
 * Returns a map of pipeline_id → display name.
 * Falls back to empty map if config is absent — callers use pipeline_id as name.
 */
async function getPipelineNames(workspaceId: string): Promise<Map<string, string>> {
  const result = await query<{ workspace_config: any }>(
    `SELECT definitions->'workspace_config' as workspace_config
     FROM context_layer
     WHERE workspace_id = $1
     LIMIT 1`,
    [workspaceId]
  );

  const pipelineMap = new Map<string, string>();
  const config = result.rows[0]?.workspace_config;
  if (!config?.pipelines) return pipelineMap;

  for (const p of config.pipelines) {
    if (p.id && p.name) {
      pipelineMap.set(String(p.id), String(p.name));
    }
  }
  return pipelineMap;
}

// ============================================================================
// Detection Path 1: HubSpot Pipelines (confidence 1.0)
// ============================================================================

async function detectHubSpotPipelines(workspaceId: string): Promise<InferredScope[]> {
  // The deals table stores the pipeline label (or raw HubSpot pipeline ID as fallback)
  // in the `pipeline` column. We group by that value — each distinct pipeline is a scope.
  const rows = await query<{ pipeline_val: string; deal_count: string }>(
    `SELECT
       pipeline AS pipeline_val,
       COUNT(*) as deal_count
     FROM deals
     WHERE workspace_id = $1
       AND pipeline IS NOT NULL
       AND pipeline != ''
     GROUP BY pipeline
     HAVING COUNT(*) >= 5
     ORDER BY deal_count DESC`,
    [workspaceId]
  );

  if (rows.rows.length <= 1) {
    // Single pipeline = no segmentation needed
    return [];
  }

  return rows.rows.map(row => {
    const name = String(row.pipeline_val);
    return {
      scope_id: slugify(name),
      name,
      filter_field: 'pipeline',
      filter_operator: 'in' as const,
      filter_values: [name],
      confidence: 1.0,
      source: 'hubspot_pipeline',
      deal_count: parseInt(row.deal_count, 10),
    };
  });
}

// ============================================================================
// Detection Path 2: Salesforce Record Types (confidence 0.95)
// ============================================================================

async function detectSalesforceRecordTypes(workspaceId: string): Promise<InferredScope[]> {
  const rows = await query<{ record_type_name: string; deal_count: string }>(
    `SELECT
       custom_fields->>'record_type_name' as record_type_name,
       COUNT(*) as deal_count
     FROM deals
     WHERE workspace_id = $1
       AND custom_fields->>'record_type_name' IS NOT NULL
       AND custom_fields->>'record_type_name' != ''
     GROUP BY 1
     HAVING COUNT(*) >= 5
     ORDER BY deal_count DESC`,
    [workspaceId]
  );

  if (rows.rows.length <= 1) {
    return [];
  }

  return rows.rows.map(row => ({
    scope_id: slugify(row.record_type_name),
    name: row.record_type_name,
    filter_field: "custom_fields->>'record_type_name'",
    filter_operator: 'in' as const,
    filter_values: [row.record_type_name],
    confidence: 0.95,
    source: 'salesforce_record_type',
    deal_count: parseInt(row.deal_count, 10),
  }));
}

// ============================================================================
// Detection Path 3: Custom Segmentation Fields (confidence 0.80)
// ============================================================================

// Field names to check in priority order
const SEGMENTATION_FIELDS = [
  'deal_type',
  'opportunity_type',
  'type',
  'segment',
  'business_type',
  'motion',
  'category',
];

// Values that indicate a recognized deal segment
const SEGMENTATION_VALUE_PATTERNS = [
  'new business', 'new_business', 'newbusiness',
  'renewal', 'renew',
  'expand', 'expansion',
  'upsell',
  'cross-sell', 'cross sell', 'crosssell',
  'enterprise',
  'smb',
  'mid-market', 'mid market', 'midmarket',
  'self-serve', 'self serve',
  'nfr',
];

function matchesSegmentationPattern(val: string): boolean {
  const lower = val.toLowerCase();
  return SEGMENTATION_VALUE_PATTERNS.some(p => lower.includes(p));
}

async function detectCustomSegmentationField(workspaceId: string): Promise<InferredScope[]> {
  for (const fieldName of SEGMENTATION_FIELDS) {
    const rows = await query<{ val: string; deal_count: string }>(
      `SELECT
         custom_fields->>'${fieldName}' as val,
         COUNT(*) as deal_count
       FROM deals
       WHERE workspace_id = $1
         AND custom_fields->>'${fieldName}' IS NOT NULL
         AND custom_fields->>'${fieldName}' != ''
       GROUP BY 1
       HAVING COUNT(*) >= 5
       ORDER BY deal_count DESC`,
      [workspaceId]
    );

    const matching = rows.rows.filter(r => matchesSegmentationPattern(r.val));
    if (matching.length >= 2) {
      return matching.map(row => ({
        scope_id: slugify(row.val),
        name: row.val,
        filter_field: `custom_fields->>'${fieldName}'`,
        filter_operator: 'in' as const,
        filter_values: [row.val],
        confidence: 0.80,
        source: `custom_field:${fieldName}`,
        deal_count: parseInt(row.deal_count, 10),
      }));
    }
  }

  return [];
}

// ============================================================================
// Main: inferAnalysisScopes
// ============================================================================

/**
 * Inspect the normalized deals table and propose analysis scopes.
 * Returns an empty array if no segmentation is detectable.
 * Never returns the 'default' scope — that is handled by migration 058.
 */
export async function inferAnalysisScopes(workspaceId: string): Promise<InferredScope[]> {
  // Path 1: HubSpot pipelines
  const hubspotScopes = await detectHubSpotPipelines(workspaceId);
  if (hubspotScopes.length > 0) {
    console.log(`[Scope Inference] workspace=${workspaceId} found=${hubspotScopes.length} scopes via hubspot_pipeline`);
    for (const s of hubspotScopes) {
      console.log(`[Scope Inference]   ${s.scope_id} (${s.deal_count} deals, confidence=${s.confidence})`);
    }
    return hubspotScopes;
  }

  // Path 2: Salesforce record types (only if Path 1 produced nothing)
  const sfScopes = await detectSalesforceRecordTypes(workspaceId);
  if (sfScopes.length > 0) {
    console.log(`[Scope Inference] workspace=${workspaceId} found=${sfScopes.length} scopes via salesforce_record_type`);
    for (const s of sfScopes) {
      console.log(`[Scope Inference]   ${s.scope_id} (${s.deal_count} deals, confidence=${s.confidence})`);
    }
    return sfScopes;
  }

  // Path 3: Custom segmentation fields (only if Paths 1+2 produced nothing)
  const customScopes = await detectCustomSegmentationField(workspaceId);
  if (customScopes.length > 0) {
    const source = customScopes[0].source;
    console.log(`[Scope Inference] workspace=${workspaceId} found=${customScopes.length} scopes via ${source}`);
    for (const s of customScopes) {
      console.log(`[Scope Inference]   ${s.scope_id} (${s.deal_count} deals, confidence=${s.confidence})`);
    }
    return customScopes;
  }

  console.log(`[Scope Inference] workspace=${workspaceId} no segmentation detected — workspace will run as single scope`);
  return [];
}

// ============================================================================
// Apply: applyInferredScopes
// ============================================================================

/**
 * Write inferred scopes to the analysis_scopes table.
 *
 * Rules:
 * - Never deletes the 'default' scope
 * - Never auto-confirms scopes — confirmed=true is a user action only
 * - On conflict: updates name/filter/confidence only if existing row is unconfirmed
 */
export async function applyInferredScopes(
  workspaceId: string,
  scopes: InferredScope[]
): Promise<void> {
  if (scopes.length === 0) return;

  for (const scope of scopes) {
    // Store the detection source in field_overrides._source so the admin UI can display it
    const fieldOverrides = JSON.stringify({ _source: scope.source });

    await query(
      `INSERT INTO analysis_scopes (
         workspace_id, scope_id, name,
         filter_field, filter_operator, filter_values,
         field_overrides,
         confirmed, confidence
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8)
       ON CONFLICT (workspace_id, scope_id) DO UPDATE SET
         name           = EXCLUDED.name,
         filter_field   = EXCLUDED.filter_field,
         filter_operator = EXCLUDED.filter_operator,
         filter_values  = EXCLUDED.filter_values,
         field_overrides = EXCLUDED.field_overrides,
         confidence     = EXCLUDED.confidence,
         updated_at     = now()
       WHERE analysis_scopes.confirmed = false`,
      [
        workspaceId,
        scope.scope_id,
        scope.name,
        scope.filter_field,
        scope.filter_operator,
        scope.filter_values,
        fieldOverrides,
        scope.confidence,
      ]
    );
  }

  console.log(`[Scope Inference] workspace=${workspaceId} applied ${scopes.length} inferred scope(s) to analysis_scopes`);
}

// ============================================================================
// CLI test harness (run without writing to DB)
// ============================================================================

if (process.argv[1] && process.argv[1].includes('scope-inference')) {
  const workspaceId = process.argv[2];
  if (!workspaceId) {
    console.error('Usage: npx ts-node server/config/scope-inference.ts <workspaceId>');
    process.exit(1);
  }

  inferAnalysisScopes(workspaceId)
    .then(scopes => {
      console.log('\nInferred scopes (dry run — not written to DB):');
      console.log(JSON.stringify(scopes, null, 2));
      process.exit(0);
    })
    .catch(err => {
      console.error('Inference failed:', err);
      process.exit(1);
    });
}
