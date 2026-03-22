import { query } from '../../../db.js';
import { getSkillRegistry } from '../../../skills/registry.js';
import { SkillRuntime } from '../../../skills/runtime.js';
import { maybeAutoSave, mapSkillToInsightType, getTopSeverity } from '../types.js';

export async function ensureSkillRegistered(skillId: string): Promise<void> {
  const registry = getSkillRegistry();
  if (registry.get(skillId)) return;

  try {
    const module = await import(`../../../skills/library/${skillId}.js`);
    const skill = module.default ?? Object.values(module)[0];
    if (skill && typeof skill === 'object' && 'id' in skill) {
      registry.register(skill as any);
    }
  } catch {
    // Skill file not found — caller will throw "not found"
  }
}

export interface SkillRunResult {
  run_id: string;
  skill_id: string;
  status: string;
  duration_ms?: number;
  finding_count: number;
  top_findings: any[];
  narrative: string;
  output: any;
  saved: boolean;
  save_location: string;
  insight_id: string | null;
}

export async function runSkillWithAutoSave(
  workspaceId: string,
  skillId: string,
  params: Record<string, any> = {},
  save: boolean = true,
  triggerQuery?: string
): Promise<SkillRunResult> {
  await ensureSkillRegistered(skillId);

  const registry = getSkillRegistry();
  const skill = registry.get(skillId);
  if (!skill) {
    throw new Error(`Skill not found: "${skillId}". Pass a valid skill ID from the run_skill description.`);
  }

  // 4-hour cache check — reuse recent successful run
  const recent = await query(
    `SELECT run_id, output, output_text FROM skill_runs
     WHERE workspace_id = $1
       AND skill_id = $2
       AND status = 'completed'
       AND created_at > NOW() - INTERVAL '4 hours'
     ORDER BY created_at DESC LIMIT 1`,
    [workspaceId, skillId]
  );

  let runId: string;
  let fullOutput: any;
  let outputText: string | null = null;
  let durationMs: number | undefined;

  if (recent.rows.length > 0) {
    runId = recent.rows[0].run_id;
    fullOutput = recent.rows[0].output;
    outputText = recent.rows[0].output_text ?? null;
  } else {
    const runtime = new SkillRuntime();
    const result = await runtime.executeSkill(skill, workspaceId, params);
    runId = result.runId;
    durationMs = result.totalDuration_ms;

    const run = await query(
      `SELECT output, output_text FROM skill_runs WHERE run_id = $1`,
      [runId]
    );
    fullOutput = run.rows[0]?.output ?? result.output;
    outputText = run.rows[0]?.output_text ?? null;
  }

  const claims: any[] = fullOutput?.evidence?.claims ?? [];
  const narrative: string = outputText ?? fullOutput?.narrative ?? fullOutput?.summary ?? '';

  let insightId: string | null = null;
  if (save && narrative) {
    insightId = await maybeAutoSave(
      workspaceId,
      skillId,
      narrative.slice(0, 2000),
      mapSkillToInsightType(skillId),
      getTopSeverity(claims),
      triggerQuery ?? `run_skill: ${skillId}`
    );
  }

  return {
    run_id: runId,
    skill_id: skillId,
    status: 'completed',
    duration_ms: durationMs,
    finding_count: claims.length,
    top_findings: claims.slice(0, 10).map((c: any) => ({
      finding: c.claim_text ?? c.message ?? c.finding,
      severity: c.severity,
      metric: c.metric_name ?? null,
      value: c.metric_values?.[0] ?? null,
    })),
    narrative: narrative.slice(0, 2000),
    output: fullOutput,
    saved: save && !!narrative,
    save_location: 'skill_runs',
    insight_id: insightId,
  };
}
