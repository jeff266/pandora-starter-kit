import type { SkillExecutionContext } from '../skills/types.js';
import type { ForecastAnnotation, RawAnnotation } from './annotation-types.js';
import { query } from '../db.js';

/**
 * Merges synthesized annotation data with user lifecycle state (dismiss/snooze).
 *
 * This is the SINGLE SOURCE OF TRUTH for annotation filtering.
 * - Checks forecast_annotation_state table for dismissed/snoozed annotations
 * - Applies 5% material change detection for dismissed annotations
 * - Returns only active annotations that should be displayed
 *
 * The API endpoint should trust this output directly without additional filtering.
 */
export async function mergeAnnotationsWithUserState(
  context: SkillExecutionContext
): Promise<ForecastAnnotation[]> {
  const synthesized = context.stepResults.synthesized_annotations;
  const classified = context.stepResults.classified_annotations;
  const raw = context.stepResults.raw_annotations;

  if (!Array.isArray(synthesized) || !Array.isArray(classified) || !Array.isArray(raw)) {
    console.error('[AnnotationMerge] Missing or invalid step results', {
      synthesized: Array.isArray(synthesized),
      classified: Array.isArray(classified),
      raw: Array.isArray(raw),
    });
    return [];
  }

  // Merge all three data sources into complete annotations
  const annotations: ForecastAnnotation[] = synthesized.map((synth: any, i: number) => ({
    ...classified[i],
    ...synth,
    evidence: raw[i].raw_data.evidence, // Already normalized by compute orchestrator
    snapshot_date: context.metadata.snapshotDate || new Date().toISOString().split('T')[0],
    created_at: new Date().toISOString(),
    dismissed_at: null,
    snoozed_until: null,
  }));

  console.log(`[AnnotationMerge] Created ${annotations.length} annotations before filtering`);

  // Check forecast_annotation_state for dismissed/snoozed
  const states = await query(
    `SELECT annotation_id, state, snoozed_until
     FROM forecast_annotation_state
     WHERE workspace_id = $1`,
    [context.workspaceId]
  );

  const stateMap = new Map(states.rows.map((s: any) => [s.annotation_id, s]));

  // Get previous run to check for material changes
  const prevRun = await query(
    `SELECT output FROM skill_runs
     WHERE workspace_id = $1 AND skill_id = 'forecast-rollup' AND status = 'completed'
     ORDER BY completed_at DESC LIMIT 1 OFFSET 1`,
    [context.workspaceId]
  );

  const prevAnnotations = prevRun.rows[0]?.output?.annotations || [];
  const prevMap = new Map(
    prevAnnotations.map((a: ForecastAnnotation) => {
      // Remove date suffix from ID to create base ID for comparison
      const baseId = a.id.split('-').slice(0, -1).join('-');
      return [baseId, a];
    })
  );

  console.log(`[AnnotationMerge] Found ${stateMap.size} user state records and ${prevAnnotations.length} previous annotations`);

  // Filter based on user state + material change logic
  const active = annotations.filter((a) => {
    const state = stateMap.get(a.id);

    if (!state) {
      // New annotation, show it
      return true;
    }

    if (state.state === 'dismissed') {
      // Check if underlying metric changed >5% since dismissal
      const baseId = a.id.split('-').slice(0, -1).join('-'); // Remove date suffix
      const prevAnnotation = prevMap.get(baseId);

      if (prevAnnotation) {
        const prevMetricKeys = Object.keys(prevAnnotation.evidence.metric_values);
        const currentMetricKeys = Object.keys(a.evidence.metric_values);

        if (prevMetricKeys.length > 0 && currentMetricKeys.length > 0) {
          // Use the first metric as the primary comparison metric
          const prevMetricKey = prevMetricKeys[0];
          const currentMetricKey = currentMetricKeys[0];

          const prevMetric = prevAnnotation.evidence.metric_values[prevMetricKey];
          const currentMetric = a.evidence.metric_values[currentMetricKey];

          if (prevMetric && currentMetric && prevMetric !== 0) {
            const percentChange = Math.abs(currentMetric - prevMetric) / Math.abs(prevMetric);

            if (percentChange > 0.05) {
              console.log(`[AnnotationMerge] Regenerating dismissed annotation ${a.id}: ${(percentChange * 100).toFixed(1)}% change`);
              return true; // Material change - regenerate annotation
            }
          }
        }
      }

      // Still dismissed, no material change
      return false;
    }

    if (state.state === 'snoozed' && state.snoozed_until && new Date(state.snoozed_until) > new Date()) {
      // Still snoozed
      return false;
    }

    // Active or snooze expired
    return true;
  });

  console.log(`[AnnotationMerge] Filtered to ${active.length} active annotations`);

  // Store pre-filter count for frontend badge display
  if (!context.metadata) {
    context.metadata = {};
  }
  context.metadata.totalAnnotationsBeforeFilter = annotations.length;
  context.metadata.totalAnnotationsActive = active.length;

  return active;
}
