import type { SkillExecutionContext } from '../skills/types.js';
import type { ForecastAnnotation, RawAnnotation } from './annotation-types.js';
import { query } from '../db.js';

function parseIfString(value: any): any[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;

  let cleaned = value.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') return [parsed];
    return null;
  } catch {
    return null;
  }
}

export async function mergeAnnotationsWithUserState(
  context: SkillExecutionContext
): Promise<ForecastAnnotation[]> {
  const raw: RawAnnotation[] = Array.isArray(context.stepResults.raw_annotations)
    ? context.stepResults.raw_annotations
    : [];

  if (raw.length === 0) {
    console.log('[AnnotationMerge] No raw annotations to merge');
    return [];
  }

  const classified = parseIfString(context.stepResults.classified_annotations) || [];
  const synthesized = parseIfString(context.stepResults.synthesized_annotations) || [];

  console.log(`[AnnotationMerge] Merging: ${raw.length} raw, ${classified.length} classified, ${synthesized.length} synthesized`);

  const classifiedById = new Map<string, any>();
  for (const c of classified) {
    if (c.id) classifiedById.set(c.id, c);
  }

  const synthesizedById = new Map<string, any>();
  for (const s of synthesized) {
    if (s.id) synthesizedById.set(s.id, s);
  }

  const snapshotDate = (context.metadata as any)?.snapshotDate || new Date().toISOString().split('T')[0];

  const annotations: ForecastAnnotation[] = raw.map((r: RawAnnotation, i: number) => {
    const rawData = r.raw_data || {};
    const evidence = rawData.evidence || { deal_ids: [], deal_names: [], metric_values: {}, comparison_basis: null };
    const rawId = rawData.id || `${r.type}-${evidence.deal_ids?.[0] || 'global'}-${snapshotDate}`;

    const cls = classifiedById.get(rawId) || classified[i] || {};
    const syn = synthesizedById.get(rawId) || synthesized[i] || {};

    const defaultSeverity = r.type === 'stalled_commit' || r.type === 'concentration_risk' ? 'critical' : 'warning';
    const defaultTitle = rawData.deal_name
      ? `${rawData.deal_name}: ${rawData.days_in_stage || 0}d in ${rawData.stage || 'stage'} (${rawData.comparison_basis || ''})`
      : rawData.title || `${r.type.replace(/_/g, ' ')} detected`;

    return {
      id: rawId,
      type: r.type,
      severity: cls.severity || defaultSeverity,
      actionability: cls.actionability || 'immediate',
      title: syn.title || cls.title || defaultTitle,
      body: syn.body || defaultTitle,
      impact: syn.impact || (rawData.impact_amount ? `$${Number(rawData.impact_amount).toLocaleString()} at risk` : null),
      recommendation: syn.recommendation || null,
      anchor: cls.anchor || (rawData.deal_id
        ? { type: 'deal' as const, deal_id: rawData.deal_id, deal_name: rawData.deal_name || '' }
        : { type: 'global' as const }),
      evidence,
      snapshot_date: snapshotDate,
      created_at: new Date().toISOString(),
      dismissed_at: null,
      snoozed_until: null,
    } as ForecastAnnotation;
  });

  console.log(`[AnnotationMerge] Created ${annotations.length} annotations before filtering`);

  let stateMap = new Map<string, any>();
  let prevMap = new Map<string, ForecastAnnotation>();

  try {
    const states = await query(
      `SELECT annotation_id, state, snoozed_until
       FROM forecast_annotation_state
       WHERE workspace_id = $1`,
      [context.workspaceId]
    );
    stateMap = new Map(states.rows.map((s: any) => [s.annotation_id, s]));

    const prevRun = await query(
      `SELECT output FROM skill_runs
       WHERE workspace_id = $1 AND skill_id = 'forecast-rollup' AND status = 'completed'
       ORDER BY completed_at DESC LIMIT 1 OFFSET 1`,
      [context.workspaceId]
    );

    const prevAnnotations = prevRun.rows[0]?.output?.annotations || [];
    prevMap = new Map(
      prevAnnotations.map((a: ForecastAnnotation) => {
        const baseId = a.id.split('-').slice(0, -1).join('-');
        return [baseId, a];
      })
    );
  } catch (err: any) {
    console.warn(`[AnnotationMerge] DB query failed, returning all annotations unfiltered:`, err.message);
  }

  console.log(`[AnnotationMerge] Found ${stateMap.size} user state records and ${prevMap.size} previous annotations`);

  const active = annotations.filter((a) => {
    const state = stateMap.get(a.id);

    if (!state) return true;

    if (state.state === 'dismissed') {
      const baseId = a.id.split('-').slice(0, -1).join('-');
      const prevAnnotation = prevMap.get(baseId);

      if (prevAnnotation?.evidence?.metric_values) {
        const prevMetricKeys = Object.keys(prevAnnotation.evidence.metric_values);
        const currentMetricKeys = Object.keys(a.evidence.metric_values);

        if (prevMetricKeys.length > 0 && currentMetricKeys.length > 0) {
          const prevMetric = prevAnnotation.evidence.metric_values[prevMetricKeys[0]];
          const currentMetric = a.evidence.metric_values[currentMetricKeys[0]];

          if (prevMetric && currentMetric && prevMetric !== 0) {
            const percentChange = Math.abs(currentMetric - prevMetric) / Math.abs(prevMetric);
            if (percentChange > 0.05) {
              console.log(`[AnnotationMerge] Regenerating dismissed annotation ${a.id}: ${(percentChange * 100).toFixed(1)}% change`);
              return true;
            }
          }
        }
      }
      return false;
    }

    if (state.state === 'snoozed' && state.snoozed_until && new Date(state.snoozed_until) > new Date()) {
      return false;
    }

    return true;
  });

  console.log(`[AnnotationMerge] Filtered to ${active.length} active annotations`);

  if (!context.metadata) {
    (context as any).metadata = {};
  }
  (context.metadata as any).totalAnnotationsBeforeFilter = annotations.length;
  (context.metadata as any).totalAnnotationsActive = active.length;

  return active;
}
