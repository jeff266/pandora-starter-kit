/**
 * Cell Populator (Layer 5)
 *
 * Takes an assembled TemplateMatrix and populates every cell.
 * Four source handlers run in sequence by type:
 * - static (already done during assembly)
 * - config (batch DB read)
 * - computed (batch SQL)
 * - synthesize (parallel Claude calls)
 */

import { TemplateMatrix, TemplateCell, TemplateRow } from './template-assembler.js';
import { ClaudeClient } from '../utils/llm-client.js';
import { query } from '../db.js';

// Concurrency control — don't overwhelm the LLM API
const SYNTHESIS_CONCURRENCY = 5;  // 5 parallel Claude calls at a time
const SYNTHESIS_MAX_TOKENS = 400; // Per-cell synthesis should be concise

export interface PopulationContext {
  workspaceId: string;
  workspaceConfig: any;               // Full workspace config from context_layer
  skillEvidence: Record<string, any>; // Latest evidence per skill, keyed by skill_id
  voiceConfig?: {
    detail_level: 'executive' | 'manager' | 'analyst';
    framing: 'direct' | 'diplomatic' | 'consultative';
    alert_threshold: 'conservative' | 'balanced' | 'aggressive';
  };
}

export interface PopulationResult {
  matrix: TemplateMatrix;
  stats: {
    cells_populated: number;
    cells_degraded: number;
    cells_failed: number;
    total_tokens_used: number;
    total_duration_ms: number;
    synthesis_calls: number;
    synthesis_parallelism: number;
  };
}

/**
 * Main population orchestrator
 */
export async function populateTemplate(
  matrix: TemplateMatrix,
  context: PopulationContext
): Promise<PopulationResult> {
  const start = Date.now();
  matrix.population_status = 'in_progress';

  let cellsPopulated = 0;
  let cellsDegraded = 0;
  let cellsFailed = 0;
  let totalTokens = 0;
  let synthesisCalls = 0;

  // Phase 1: Populate config cells (batch — one DB read, many cells)
  const configResult = await populateConfigCells(matrix, context);
  cellsPopulated += configResult.populated;
  cellsDegraded += configResult.degraded;

  // Phase 2: Populate computed cells (batch — SQL queries)
  const computeResult = await populateComputedCells(matrix, context);
  cellsPopulated += computeResult.populated;
  cellsDegraded += computeResult.degraded;

  // Phase 3: Gather evidence for synthesis cells (batch — one query per skill)
  await gatherSynthesisEvidence(matrix, context);

  // Phase 4: Populate synthesis cells (parallel Claude calls)
  const synthResult = await populateSynthesisCells(matrix, context);
  cellsPopulated += synthResult.populated;
  cellsDegraded += synthResult.degraded;
  cellsFailed += synthResult.failed;
  totalTokens += synthResult.tokens_used;
  synthesisCalls = synthResult.calls_made;

  // Finalize
  matrix.population_status = cellsFailed === 0 ? 'complete' : 'partial';
  matrix.populated_at = new Date().toISOString();

  return {
    matrix,
    stats: {
      cells_populated: cellsPopulated,
      cells_degraded: cellsDegraded,
      cells_failed: cellsFailed,
      total_tokens_used: totalTokens,
      total_duration_ms: Date.now() - start,
      synthesis_calls: synthesisCalls,
      synthesis_parallelism: SYNTHESIS_CONCURRENCY,
    },
  };
}

// ============================================================================
// Phase 1: Config Cell Population
// ============================================================================

async function populateConfigCells(
  matrix: TemplateMatrix,
  context: PopulationContext
): Promise<{ populated: number; degraded: number }> {
  let populated = 0;
  let degraded = 0;

  for (const row of matrix.rows) {
    if (row.source_type !== 'config') continue;

    for (const [stageNorm, cell] of Object.entries(row.cells)) {
      if (cell.status === 'not_applicable') continue;

      const value = resolveConfigValue(cell.config_path, stageNorm, context.workspaceConfig);

      if (value !== null && value !== undefined) {
        cell.content = formatConfigValue(cell.dimension_key, value);
        cell.status = 'populated';
        cell.confidence = 1.0;
        populated++;
      } else {
        cell.content = 'Not configured in CRM';
        cell.status = 'degraded';
        cell.degradation_reason = `Config path ${cell.config_path} not found for stage ${stageNorm}`;
        cell.confidence = 0;
        degraded++;
      }
    }
  }

  return { populated, degraded };
}

function resolveConfigValue(
  configPath: string | undefined,
  stageNormalized: string,
  workspaceConfig: any
): any {
  if (!configPath) return null;

  // Config paths reference stage-specific values
  // Expected patterns:
  // 'pipelines.stages.probability' → look up probability for this stage
  // 'pipelines.stages.forecast_category' → look up forecast category for this stage
  // 'pipelines.stages.required_properties' → look up required fields for this stage

  try {
    // Try to find stage in pipeline config
    const pipelines = workspaceConfig?.pipelines || [];
    for (const pipeline of pipelines) {
      const stages = pipeline?.stages || pipeline?.stage_mappings || [];
      const stage = stages.find((s: any) =>
        s.stage_normalized === stageNormalized ||
        s.normalized === stageNormalized ||
        s.name?.toLowerCase().replace(/\s+/g, '_') === stageNormalized
      );

      if (stage) {
        // Extract the specific field from the config path
        const field = configPath.split('.').pop();
        if (field && stage[field] !== undefined) {
          return stage[field];
        }
      }
    }

    // Also try stage_mappings table if pipeline config doesn't have it
    // Fall through to null
    return null;
  } catch (err) {
    console.warn(`[CellPopulator] Config resolution failed for ${configPath} at ${stageNormalized}:`, err);
    return null;
  }
}

function formatConfigValue(dimensionKey: string, value: any): string {
  // Format the raw config value for display
  switch (dimensionKey) {
    case 'forecast_probability':
      return typeof value === 'number' ? `${Math.round(value * 100)}%` : String(value);

    case 'forecast_category':
      return String(value);

    case 'required_fields':
      if (Array.isArray(value)) {
        return value.join(', ');
      }
      return String(value);

    default:
      if (Array.isArray(value)) return value.join(', ');
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
  }
}

// ============================================================================
// Phase 2: Computed Cell Population
// ============================================================================

// Registry of compute functions
const COMPUTE_FUNCTIONS: Record<string, ComputeFunction> = {};

type ComputeFunction = (
  workspaceId: string,
  stageNormalized: string,
  skillEvidence: Record<string, any>
) => Promise<ComputeResult>;

interface ComputeResult {
  value: string | null;
  confidence: number;
  degraded: boolean;
  degradation_reason?: string;
}

// Register compute functions
function registerComputeFunction(name: string, fn: ComputeFunction): void {
  COMPUTE_FUNCTIONS[name] = fn;
}

// --- Compute Function: Stage Duration ---
registerComputeFunction('computeStageDuration', async (workspaceId, stageNormalized, evidence) => {
  try {
    const result = await query(`
      WITH stage_durations AS (
        SELECT
          EXTRACT(EPOCH FROM (exited_at - entered_at)) / 86400.0 as days_in_stage,
          d.stage_normalized as final_stage
        FROM deal_stage_history dsh
        JOIN deals d ON d.id = dsh.deal_id AND d.workspace_id = dsh.workspace_id
        WHERE dsh.workspace_id = $1
          AND dsh.stage_normalized = $2
          AND dsh.exited_at IS NOT NULL
      )
      SELECT
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY days_in_stage) as median_days,
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY days_in_stage) as p25_days,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY days_in_stage) as p75_days,
        COUNT(*) as sample_size,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY days_in_stage)
          FILTER (WHERE final_stage = 'closed_won') as median_won,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY days_in_stage)
          FILTER (WHERE final_stage = 'closed_lost') as median_lost
      FROM stage_durations
    `, [workspaceId, stageNormalized]);

    const row = result.rows[0];
    if (!row || !row.median_days || parseInt(row.sample_size) === 0) {
      return {
        value: null,
        confidence: 0,
        degraded: true,
        degradation_reason: 'No stage transition history available',
      };
    }

    const median = Math.round(parseFloat(row.median_days));
    const p25 = Math.round(parseFloat(row.p25_days));
    const p75 = Math.round(parseFloat(row.p75_days));
    const sampleSize = parseInt(row.sample_size);

    let display = `${median} days (median)`;
    if (p25 !== p75) {
      display += `, ${p25}-${p75} days (IQR)`;
    }
    display += ` (n=${sampleSize})`;

    // Add won vs lost comparison if available
    if (row.median_won && row.median_lost) {
      const wonDays = Math.round(parseFloat(row.median_won));
      const lostDays = Math.round(parseFloat(row.median_lost));
      if (wonDays !== lostDays) {
        display += `. Won: ${wonDays}d, Lost: ${lostDays}d`;
      }
    }

    return {
      value: display,
      confidence: sampleSize >= 10 ? 0.9 : sampleSize >= 5 ? 0.7 : 0.5,
      degraded: sampleSize < 5,
      degradation_reason: sampleSize < 5 ? `Low sample size (${sampleSize} deals)` : undefined,
    };
  } catch (err) {
    console.error(`[Compute] computeStageDuration failed:`, err);
    return { value: null, confidence: 0, degraded: true, degradation_reason: 'Computation failed' };
  }
});

// --- Compute Function: Stage Regression ---
registerComputeFunction('computeStageRegression', async (workspaceId, stageNormalized, evidence) => {
  try {
    // Count how many deals regressed FROM the next stage back to this one
    // vs. total deals that passed through this stage
    const result = await query(`
      WITH stage_entries AS (
        SELECT deal_id, entered_at, exited_at,
          LAG(stage_normalized) OVER (PARTITION BY deal_id ORDER BY entered_at) as prev_stage
        FROM deal_stage_history
        WHERE workspace_id = $1
      ),
      regressions AS (
        SELECT COUNT(*) as regression_count
        FROM stage_entries
        WHERE stage_normalized = $2
          AND prev_stage IS NOT NULL
          -- A regression is when a deal enters this stage from a LATER stage
          -- This requires knowing stage order — use display_order from stage_mappings
      ),
      total_entries AS (
        SELECT COUNT(DISTINCT deal_id) as total
        FROM deal_stage_history
        WHERE workspace_id = $1 AND stage_normalized = $2
      )
      SELECT
        (SELECT regression_count FROM regressions) as regressions,
        (SELECT total FROM total_entries) as total_deals
    `, [workspaceId, stageNormalized]);

    const row = result.rows[0];
    const regressions = parseInt(row?.regressions || '0');
    const total = parseInt(row?.total_deals || '0');

    if (total === 0) {
      return {
        value: 'No data',
        confidence: 0,
        degraded: true,
        degradation_reason: 'No deals found at this stage',
      };
    }

    const rate = total > 0 ? (regressions / total * 100).toFixed(1) : '0';

    if (regressions === 0) {
      return { value: 'No regressions observed', confidence: 0.8, degraded: false };
    }

    return {
      value: `Yes — ${regressions} deals (${rate}%) regressed to this stage`,
      confidence: total >= 10 ? 0.9 : 0.6,
      degraded: total < 5,
      degradation_reason: total < 5 ? `Low sample size (${total} deals)` : undefined,
    };
  } catch (err) {
    console.error(`[Compute] computeStageRegression failed:`, err);
    return { value: null, confidence: 0, degraded: true, degradation_reason: 'Computation failed' };
  }
});

// --- Main computed cell population ---
async function populateComputedCells(
  matrix: TemplateMatrix,
  context: PopulationContext
): Promise<{ populated: number; degraded: number }> {
  let populated = 0;
  let degraded = 0;

  // Collect all compute tasks
  const tasks: { row: TemplateRow; stageNorm: string; cell: TemplateCell }[] = [];

  for (const row of matrix.rows) {
    if (row.source_type !== 'computed') continue;
    for (const [stageNorm, cell] of Object.entries(row.cells)) {
      if (cell.status === 'not_applicable') continue;
      tasks.push({ row, stageNorm, cell });
    }
  }

  // Run all compute tasks (these are DB queries, so some parallelism is fine)
  const results = await Promise.all(
    tasks.map(async ({ cell }) => {
      const fn = COMPUTE_FUNCTIONS[cell.compute_function || ''];
      if (!fn) {
        return {
          cell,
          result: {
            value: null,
            confidence: 0,
            degraded: true,
            degradation_reason: `Unknown compute function: ${cell.compute_function}`,
          } as ComputeResult,
        };
      }

      const result = await fn(context.workspaceId, cell.stage_normalized, context.skillEvidence);
      return { cell, result };
    })
  );

  // Apply results to cells
  for (const { cell, result } of results) {
    if (result.value !== null && !result.degraded) {
      cell.content = result.value;
      cell.status = 'populated';
      cell.confidence = result.confidence;
      populated++;
    } else {
      cell.content = result.value || result.degradation_reason || 'Insufficient data';
      cell.status = 'degraded';
      cell.degradation_reason = result.degradation_reason;
      cell.confidence = result.confidence;
      degraded++;
    }
  }

  return { populated, degraded };
}

// ============================================================================
// Phase 3: Evidence Gathering for Synthesis
// ============================================================================

async function gatherSynthesisEvidence(
  matrix: TemplateMatrix,
  context: PopulationContext
): Promise<void> {
  // Determine which skills are needed across all synthesis cells
  const neededSkills = new Set<string>();

  for (const row of matrix.rows) {
    if (row.source_type !== 'synthesize') continue;
    for (const skillId of (row.cells[Object.keys(row.cells)[0]]?.data_sources || [])) {
      neededSkills.add(skillId);
    }
  }

  // Ensure all needed skill evidence is loaded
  // context.skillEvidence should already be populated by the caller,
  // but verify and load any missing
  for (const skillId of neededSkills) {
    if (!context.skillEvidence[skillId]) {
      const run = await query(`
        SELECT output FROM skill_runs
        WHERE workspace_id = $1 AND skill_id = $2 AND status = 'completed'
        ORDER BY completed_at DESC LIMIT 1
      `, [context.workspaceId, skillId]);

      if (run.rows.length > 0 && run.rows[0].output) {
        context.skillEvidence[skillId] = run.rows[0].output;
      }
    }
  }

  // Now attach per-cell evidence scoped to each stage
  for (const row of matrix.rows) {
    if (row.source_type !== 'synthesize') continue;

    for (const [stageNorm, cell] of Object.entries(row.cells)) {
      if (cell.status === 'not_applicable') continue;

      // Build evidence bundle for this specific cell (dimension × stage)
      cell.skill_evidence = {};

      for (const skillId of (cell.data_sources || [])) {
        const evidence = context.skillEvidence[skillId];
        if (!evidence) continue;

        // Scope evidence to this stage where possible
        cell.skill_evidence[skillId] = scopeEvidenceToStage(evidence, stageNorm, cell.dimension_key);
      }
    }
  }
}

function scopeEvidenceToStage(
  evidence: any,
  stageNormalized: string,
  dimensionKey: string
): any {
  // Extract the subset of evidence relevant to this specific stage
  const scoped: any = {};

  // Filter claims to those mentioning this stage
  if (evidence.claims) {
    scoped.claims = evidence.claims.filter((c: any) =>
      c.stage === stageNormalized ||
      c.message?.toLowerCase().includes(stageNormalized.replace(/_/g, ' '))
    );
  }

  // Filter evaluated_records to this stage
  if (evidence.evaluated_records) {
    scoped.records = evidence.evaluated_records.filter((r: any) =>
      r.stage === stageNormalized ||
      r.stage_normalized === stageNormalized ||
      r.current_stage === stageNormalized
    );
  }

  // Always include parameters (they're typically stage-agnostic but useful for context)
  scoped.parameters = evidence.parameters || {};

  // Include summary if available
  scoped.summary = evidence.summary || evidence.synthesis || null;

  return scoped;
}

// ============================================================================
// Phase 4: Synthesis Cell Population (Parallel Claude Calls)
// ============================================================================

interface SynthesisResult {
  populated: number;
  degraded: number;
  failed: number;
  tokens_used: number;
  calls_made: number;
}

async function populateSynthesisCells(
  matrix: TemplateMatrix,
  context: PopulationContext
): Promise<SynthesisResult> {
  // Collect all synthesis tasks
  const tasks: { cell: TemplateCell; prompt: string }[] = [];

  for (const row of matrix.rows) {
    if (row.source_type !== 'synthesize') continue;

    for (const [stageNorm, cell] of Object.entries(row.cells)) {
      if (cell.status === 'not_applicable') continue;

      // Resolve the prompt template with actual evidence
      const resolvedPrompt = resolvePromptTemplate(cell, matrix, context);

      if (resolvedPrompt) {
        tasks.push({ cell, prompt: resolvedPrompt });
      } else {
        // Can't build a prompt — degrade the cell
        cell.content = 'Insufficient evidence to generate content for this cell';
        cell.status = 'degraded';
        cell.degradation_reason = 'No synthesis prompt could be constructed';
      }
    }
  }

  // Execute in parallel with concurrency control
  let populated = 0;
  let degraded = 0;
  let failed = 0;
  let tokensUsed = 0;

  // Process in batches of SYNTHESIS_CONCURRENCY
  for (let i = 0; i < tasks.length; i += SYNTHESIS_CONCURRENCY) {
    const batch = tasks.slice(i, i + SYNTHESIS_CONCURRENCY);

    const results = await Promise.allSettled(
      batch.map(async ({ cell, prompt }) => {
        return synthesizeCell(cell, prompt, context);
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { success, tokens } = result.value;
        tokensUsed += tokens;
        if (success) {
          populated++;
        } else {
          degraded++;
        }
      } else {
        failed++;
      }
    }
  }

  return {
    populated,
    degraded,
    failed,
    tokens_used: tokensUsed,
    calls_made: tasks.length,
  };
}

async function synthesizeCell(
  cell: TemplateCell,
  prompt: string,
  context: PopulationContext
): Promise<{ success: boolean; tokens: number }> {
  try {
    // Build system prompt with voice configuration
    const systemPrompt = buildSynthesisSystemPrompt(context.voiceConfig);

    // Call Claude for this cell
    const client = new ClaudeClient({ model: 'claude-sonnet-4-5' });
    const response = await client.call(systemPrompt, prompt, {
      maxTokens: SYNTHESIS_MAX_TOKENS,
      temperature: 0.2,  // Low temperature for consistency across cells
    });

    // Track token usage (estimate based on response length)
    const tokensUsed = Math.ceil(response.length / 4) + Math.ceil(prompt.length / 4);

    if (response && response.trim().length > 0) {
      cell.content = response.trim();
      cell.status = cell.status === 'degraded' ? 'degraded' : 'populated';
      cell.confidence = cell.status === 'degraded' ? 0.5 : 0.8;
      cell.tokens_used = tokensUsed;
      return { success: true, tokens: tokensUsed };
    } else {
      cell.content = 'Unable to generate content — check evidence availability';
      cell.status = 'degraded';
      cell.tokens_used = tokensUsed;
      return { success: false, tokens: tokensUsed };
    }
  } catch (err) {
    console.error(`[Synthesis] Failed for ${cell.dimension_key}/${cell.stage_normalized}:`, err);
    cell.content = 'Synthesis failed — will retry on next generation';
    cell.status = 'degraded';
    cell.degradation_reason = (err as Error).message;
    return { success: false, tokens: 0 };
  }
}

function buildSynthesisSystemPrompt(voiceConfig?: PopulationContext['voiceConfig']): string {
  let prompt = `You are a GTM intelligence analyst populating a cell in a sales process deliverable.

Rules:
- Write content specific to this company's actual data and patterns. Never write generic sales advice.
- Be concise. This is a matrix cell, not a paragraph. 2-4 sentences or 3-6 bullet points maximum.
- Reference specific data points from the evidence when available (deal counts, percentages, patterns).
- If the evidence is thin, say what you can and note what additional data would improve the analysis.
- Do not invent data. If no evidence supports a claim, don't make it.`;

  // Apply voice configuration
  if (voiceConfig) {
    switch (voiceConfig.detail_level) {
      case 'executive':
        prompt += '\n- Executive audience: be extremely concise. 1-2 sentences max. Lead with the implication.';
        break;
      case 'manager':
        prompt += '\n- Manager audience: balance conciseness with enough detail to act on. 2-3 sentences.';
        break;
      case 'analyst':
        prompt += '\n- Analyst audience: include supporting data points and methodology notes. 3-5 sentences.';
        break;
    }

    switch (voiceConfig.framing) {
      case 'direct':
        prompt += '\n- Direct framing: state findings plainly. No hedging language.';
        break;
      case 'diplomatic':
        prompt += '\n- Diplomatic framing: frame observations as opportunities. Acknowledge what works.';
        break;
      case 'consultative':
        prompt += '\n- Consultative framing: present as expert recommendations with reasoning.';
        break;
    }
  }

  return prompt;
}

// ============================================================================
// Prompt Template Resolution
// ============================================================================

function resolvePromptTemplate(
  cell: TemplateCell,
  matrix: TemplateMatrix,
  context: PopulationContext
): string | null {
  const template = cell.synthesis_prompt;
  if (!template) return null;

  // Find the stage metadata
  const stage = matrix.stages.find(s => s.stage_normalized === cell.stage_normalized);
  if (!stage) return null;

  let prompt = template;

  // Replace stage variables
  prompt = prompt.replace(/\{\{stage_name\}\}/g, stage.stage_name);
  prompt = prompt.replace(/\{\{stage_normalized\}\}/g, stage.stage_normalized);
  prompt = prompt.replace(/\{\{display_order\}\}/g, String(stage.display_order));
  prompt = prompt.replace(/\{\{total_stages\}\}/g, String(matrix.stages.length));

  // Replace workspace description
  const workspaceDesc = context.workspaceConfig?.description ||
                        context.workspaceConfig?.business_model?.description ||
                        'B2B SaaS company';
  prompt = prompt.replace(/\{\{workspace_description\}\}/g, workspaceDesc);

  // Replace evidence blocks
  const evidence = cell.skill_evidence || {};
  prompt = replaceEvidencePlaceholders(prompt, evidence, cell.dimension_key, cell.stage_normalized);

  // Replace any remaining unresolved placeholders with "No data available"
  prompt = prompt.replace(/\{\{[^}]+\}\}/g, 'No data available for this field');

  return prompt;
}

function replaceEvidencePlaceholders(
  prompt: string,
  evidence: Record<string, any>,
  dimensionKey: string,
  stageNormalized: string
): string {
  // Build evidence summaries for each skill

  // Config evidence (from workspace-config-audit)
  if (evidence['workspace-config-audit']) {
    const configEv = evidence['workspace-config-audit'];
    const configSummary = summarizeEvidence(configEv, 'config');
    prompt = prompt.replace(/\{\{config_evidence\}\}/g, configSummary);
  }

  // Pipeline hygiene evidence
  if (evidence['pipeline-hygiene']) {
    const hygieneEv = evidence['pipeline-hygiene'];
    prompt = prompt.replace(/\{\{hygiene_evidence\}\}/g, summarizeEvidence(hygieneEv, 'findings'));
    prompt = prompt.replace(/\{\{hygiene_findings\}\}/g, summarizeFindings(hygieneEv));
  }

  // Pipeline waterfall evidence
  if (evidence['pipeline-waterfall']) {
    const waterfallEv = evidence['pipeline-waterfall'];
    prompt = prompt.replace(/\{\{waterfall_evidence\}\}/g, summarizeEvidence(waterfallEv, 'findings'));
  }

  // ICP Discovery evidence
  if (evidence['icp-discovery']) {
    const icpEv = evidence['icp-discovery'];
    prompt = prompt.replace(/\{\{icp_evidence\}\}/g, summarizeEvidence(icpEv, 'findings'));
  }

  return prompt;
}

function summarizeEvidence(evidence: any, type: string): string {
  if (!evidence) return 'No evidence available';

  const parts: string[] = [];

  if (evidence.claims?.length > 0) {
    const topClaims = evidence.claims.slice(0, 5);
    for (const claim of topClaims) {
      parts.push(`- [${claim.severity || 'info'}] ${claim.message || claim.text || JSON.stringify(claim)}`);
    }
  }

  if (evidence.parameters && Object.keys(evidence.parameters).length > 0) {
    const params = evidence.parameters;
    for (const [key, value] of Object.entries(params).slice(0, 5)) {
      parts.push(`- ${key}: ${value}`);
    }
  }

  return parts.length > 0 ? parts.join('\n') : 'No relevant evidence found for this stage';
}

function summarizeFindings(evidence: any): string {
  if (!evidence?.claims) return 'No findings';
  return evidence.claims
    .slice(0, 5)
    .map((c: any) => `- ${c.message || c.text}`)
    .join('\n');
}
