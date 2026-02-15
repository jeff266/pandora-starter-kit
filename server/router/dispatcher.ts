/**
 * Router Dispatcher
 *
 * Takes a RouterDecision and executes the appropriate action:
 * - evidence_inquiry: Pull evidence from skill runs
 * - scoped_analysis: Synthesize answer from multiple skills
 * - deliverable_request: Trigger template generation (stub for now)
 * - skill_execution: Run the requested skill (stub for now)
 */

import { RouterDecision } from './request-router.js';
import { invalidateStateCache } from './state-index.js';
import { query } from '../db.js';
import { ClaudeClient } from '../utils/llm-client.js';
import { generateDeliverable } from '../templates/deliverable-pipeline.js';

export interface ExecutionResult {
  type: string;
  success: boolean;
  data?: any;
  error?: string;
  tokens_used?: number;
  duration_ms?: number;
}

export async function dispatch(decision: RouterDecision, workspaceId: string): Promise<ExecutionResult> {
  const start = Date.now();

  try {
    // Step 1: Rerun stale skills if needed (stub for now)
    if (decision.stale_skills_to_rerun && decision.stale_skills_to_rerun.length > 0) {
      for (const skillId of decision.stale_skills_to_rerun) {
        console.log(`[Dispatcher] Would rerun stale skill: ${skillId}`);
        // TODO: Wire to actual skill runner
        // await runSkill(workspaceId, skillId);
      }
      invalidateStateCache(workspaceId);
    }

    switch (decision.type) {
      case 'evidence_inquiry':
        return await handleEvidenceInquiry(decision, workspaceId);

      case 'scoped_analysis':
        return await handleScopedAnalysis(decision, workspaceId);

      case 'deliverable_request':
        return await handleDeliverableRequest(decision, workspaceId);

      case 'skill_execution':
        return await handleSkillExecution(decision, workspaceId);

      default:
        return { type: 'unknown', success: false, error: `Unknown request type: ${decision.type}` };
    }
  } catch (err) {
    return {
      type: decision.type,
      success: false,
      error: (err as Error).message,
      duration_ms: Date.now() - start,
    };
  }
}

async function handleEvidenceInquiry(
  decision: RouterDecision,
  workspaceId: string
): Promise<ExecutionResult> {
  // Special case: workspace status overview
  if (decision.target_metric === 'workspace_status') {
    return {
      type: 'evidence_inquiry',
      success: true,
      data: {
        response_type: 'workspace_status',
        state: decision.workspace_state,
      },
    };
  }

  // Pull evidence from the target skill's most recent run
  const skillId = decision.target_skill;
  if (!skillId) {
    return { type: 'evidence_inquiry', success: false, error: 'No target skill identified' };
  }

  const run = await query(`
    SELECT output, completed_at
    FROM skill_runs
    WHERE workspace_id = $1 AND skill_id = $2 AND status = 'completed'
    ORDER BY completed_at DESC LIMIT 1
  `, [workspaceId, skillId]);

  if (run.rows.length === 0) {
    return { type: 'evidence_inquiry', success: false, error: `No evidence found for ${skillId}` };
  }

  const evidence = run.rows[0].output;

  // If a specific metric is requested, extract just that
  if (decision.target_metric) {
    const metric = extractMetric(evidence, decision.target_metric);
    return {
      type: 'evidence_inquiry',
      success: true,
      data: {
        response_type: 'metric_drill_through',
        skill_id: skillId,
        metric: decision.target_metric,
        value: metric,
        evidence_snapshot: evidence,
        as_of: run.rows[0].completed_at,
      },
    };
  }

  // If a specific entity is mentioned, filter evidence to that entity
  if (decision.target_entity_id) {
    const filtered = filterEvidenceByEntity(evidence, decision.target_entity_id);
    return {
      type: 'evidence_inquiry',
      success: true,
      data: {
        response_type: 'entity_evidence',
        skill_id: skillId,
        entity: decision.target_entity_id,
        claims: filtered.claims,
        records: filtered.records,
        as_of: run.rows[0].completed_at,
      },
    };
  }

  // Return full evidence
  return {
    type: 'evidence_inquiry',
    success: true,
    data: {
      response_type: 'full_evidence',
      skill_id: skillId,
      evidence,
      as_of: run.rows[0].completed_at,
    },
  };
}

async function handleScopedAnalysis(
  decision: RouterDecision,
  workspaceId: string
): Promise<ExecutionResult> {
  // Pull evidence from multiple skills
  const skillIds = decision.skills_to_consult || [];
  const evidenceBundle: Record<string, any> = {};

  for (const skillId of skillIds) {
    const run = await query(`
      SELECT output FROM skill_runs
      WHERE workspace_id = $1 AND skill_id = $2 AND status = 'completed'
      ORDER BY completed_at DESC LIMIT 1
    `, [workspaceId, skillId]);

    if (run.rows.length > 0) {
      evidenceBundle[skillId] = run.rows[0].output;
    }
  }

  // Scope the evidence to the entity if specified
  if (decision.scope_entity) {
    for (const [skillId, evidence] of Object.entries(evidenceBundle)) {
      evidenceBundle[skillId] = filterEvidenceByEntity(evidence, decision.scope_entity!);
    }
  }

  // Synthesize an answer using Claude
  const synthesisPrompt = buildScopedAnalysisPrompt(
    decision.scope_question || '',
    decision.scope_type || 'pipeline',
    decision.scope_entity,
    evidenceBundle
  );

  const client = new ClaudeClient({ model: 'claude-sonnet-4-5' });
  const synthesis = await client.call(
    'You are a GTM intelligence analyst. Answer the question using only the evidence provided. Be specific, reference actual data points, and be concise. If the evidence is insufficient, say so.',
    synthesisPrompt,
    { maxTokens: 1000, temperature: 0.1 }
  );

  return {
    type: 'scoped_analysis',
    success: true,
    data: {
      response_type: 'scoped_analysis',
      question: decision.scope_question,
      scope: { type: decision.scope_type, entity: decision.scope_entity },
      answer: synthesis,
      evidence_consulted: Object.keys(evidenceBundle),
    },
  };
}

async function handleDeliverableRequest(
  decision: RouterDecision,
  workspaceId: string
): Promise<ExecutionResult> {
  const templateId = decision.deliverable_type || decision.template_id;
  const readiness = decision.workspace_state.template_readiness[templateId || ''];

  if (!readiness) {
    return {
      type: 'deliverable_request',
      success: false,
      error: `Unknown deliverable type: ${templateId}`,
    };
  }

  if (!readiness.ready) {
    return {
      type: 'deliverable_request',
      success: false,
      error: readiness.reason || 'Template not ready',
      data: {
        response_type: 'template_not_ready',
        template_id: templateId,
        missing_skills: readiness.missing_skills,
        suggestion: `Run these skills first: ${readiness.missing_skills.join(', ')}`,
      },
    };
  }

  // --- REAL EXECUTION (replaces stub) ---
  try {
    const result = await generateDeliverable({
      workspaceId,
      templateType: templateId,
    });

    return {
      type: 'deliverable_request',
      success: true,
      data: {
        response_type: 'deliverable_generated',
        template_id: templateId,
        template_name: readiness.template_name,
        stages: result.matrix.stages.length,
        dimensions: result.matrix.rows.length,
        cells: result.matrix.cell_count,
        degraded_dimensions: readiness.degraded_dimensions,
        timing: {
          discovery_ms: result.discovery_ms,
          assembly_ms: result.assembly_ms,
          population_ms: result.population_ms,
          total_ms: result.total_ms,
        },
        tokens_used: result.populationStats?.total_tokens_used || 0,
        // The matrix itself — the renderer will consume this
        matrix: result.matrix,
      },
      tokens_used: result.populationStats?.total_tokens_used || 0,
      duration_ms: result.total_ms,
    };
  } catch (err) {
    return {
      type: 'deliverable_request',
      success: false,
      error: `Generation failed: ${(err as Error).message}`,
    };
  }
}

async function handleSkillExecution(
  decision: RouterDecision,
  workspaceId: string
): Promise<ExecutionResult> {
  const skillId = decision.skill_id;
  if (!skillId) {
    return { type: 'skill_execution', success: false, error: 'No skill specified' };
  }

  // TODO: Wire to the actual skill runner
  // const result = await runSkill(workspaceId, skillId, decision.skill_params);

  return {
    type: 'skill_execution',
    success: true,
    data: {
      response_type: 'skill_started',
      skill_id: skillId,
      message: `Running ${formatSkillName(skillId)}...`,
    },
  };
}

// Helper Functions

function extractMetric(evidence: any, metricName: string): any {
  // Look through claims and parameters for the metric
  if (evidence?.parameters?.[metricName] !== undefined) {
    return evidence.parameters[metricName];
  }

  // Check claims for metric references
  const relatedClaims = (evidence?.claims || []).filter(
    (c: any) => c.category?.includes(metricName) || c.message?.toLowerCase().includes(metricName.replace('_', ' '))
  );

  return {
    claims: relatedClaims,
    parameters: evidence?.parameters || {},
  };
}

function filterEvidenceByEntity(evidence: any, entityRef: string): any {
  const entityLower = entityRef.toLowerCase();

  const filteredClaims = (evidence?.claims || []).filter(
    (c: any) => c.entity_id?.toLowerCase().includes(entityLower) ||
                c.message?.toLowerCase().includes(entityLower)
  );

  const filteredRecords = (evidence?.evaluated_records || []).filter(
    (r: any) => r.entity_name?.toLowerCase().includes(entityLower) ||
                r.entity_id?.toLowerCase().includes(entityLower) ||
                r.deal_name?.toLowerCase().includes(entityLower) ||
                r.account_name?.toLowerCase().includes(entityLower)
  );

  return {
    claims: filteredClaims,
    records: filteredRecords,
    data_sources: evidence?.data_sources,
    parameters: evidence?.parameters,
  };
}

function buildScopedAnalysisPrompt(
  question: string,
  scopeType: string,
  scopeEntity: string | undefined,
  evidenceBundle: Record<string, any>
): string {
  let prompt = `Question: ${question}\n`;
  prompt += `Scope: ${scopeType}${scopeEntity ? ` — ${scopeEntity}` : ''}\n\n`;
  prompt += `Evidence from Pandora skills:\n\n`;

  for (const [skillId, evidence] of Object.entries(evidenceBundle)) {
    prompt += `--- ${formatSkillName(skillId)} ---\n`;

    if (evidence?.evidence?.claims?.length > 0) {
      prompt += `Findings (${evidence.evidence.claims.length}):\n`;
      for (const claim of evidence.evidence.claims.slice(0, 10)) {
        prompt += `- [${claim.severity}] ${claim.claim_text || claim.message}\n`;
      }
    }

    if (evidence?.evidence?.evaluated_records?.length > 0) {
      prompt += `Records matching scope (${evidence.evidence.evaluated_records.length}):\n`;
      for (const record of evidence.evidence.evaluated_records.slice(0, 5)) {
        const summary = Object.entries(record.fields || {})
          .slice(0, 5)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ');
        prompt += `- ${record.entity_name || 'Unknown'}: ${summary}\n`;
      }
    }

    prompt += '\n';
  }

  return prompt;
}

function formatSkillName(skillId: string): string {
  return skillId.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
