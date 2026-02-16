import { query } from '../db.js';
import { addConfigSuggestion, getPendingSuggestions } from '../config/config-suggestions.js';

export async function checkDismissVelocity(
  workspaceId: string,
  userId: string
): Promise<void> {
  try {
    const result = await query<{ severity: string; cnt: string }>(
      `SELECT
         COALESCE(signal_metadata->>'severity', 'unknown') as severity,
         COUNT(*) as cnt
       FROM feedback_signals
       WHERE workspace_id = $1
         AND created_by = $2
         AND signal_type = 'dismiss'
         AND created_at >= NOW() - INTERVAL '7 days'
       GROUP BY severity`,
      [workspaceId, userId]
    );

    for (const row of result.rows) {
      const count = parseInt(row.cnt, 10);
      if (count > 10) {
        await addConfigSuggestion(workspaceId, {
          source_skill: 'feedback-velocity',
          section: 'thresholds',
          path: `dismiss_velocity.${row.severity}`,
          type: 'alert',
          message: `User dismissed ${count} ${row.severity}-severity findings in the last 7 days. Consider adjusting sensitivity for this severity level.`,
          evidence: `${count} dismissals of ${row.severity} findings by user ${userId} in 7 days`,
          confidence: Math.min(0.9, 0.5 + (count - 10) * 0.04),
        });
      }
    }
  } catch (err) {
    console.error('[dismiss-velocity] Error checking dismiss velocity:', err);
  }
}

export async function checkCategoryDismissals(
  workspaceId: string
): Promise<void> {
  try {
    const result = await query<{ category: string; cnt: string }>(
      `SELECT
         COALESCE(signal_metadata->>'category', 'unknown') as category,
         COUNT(*) as cnt
       FROM feedback_signals
       WHERE workspace_id = $1
         AND signal_type = 'dismiss'
         AND created_at >= NOW() - INTERVAL '30 days'
       GROUP BY category
       HAVING COUNT(*) > 15`,
      [workspaceId]
    );

    for (const row of result.rows) {
      const count = parseInt(row.cnt, 10);
      await addConfigSuggestion(workspaceId, {
        source_skill: 'feedback-category-analysis',
        section: 'findings',
        path: `category_suppression.${row.category}`,
        type: 'adjust',
        message: `Finding category "${row.category}" has been dismissed ${count} times in 30 days. Consider suppressing or reducing severity for this category.`,
        evidence: `${count} dismissals of "${row.category}" category findings in 30 days`,
        confidence: Math.min(0.95, 0.6 + (count - 15) * 0.02),
        suggested_value: { suppress: true, category: row.category },
      });
    }
  } catch (err) {
    console.error('[dismiss-velocity] Error checking category dismissals:', err);
  }
}

export async function boostConfigConfidence(
  workspaceId: string,
  confirmedEntities: Array<{ entityType: string; entityId: string }>
): Promise<void> {
  try {
    for (const entity of confirmedEntities) {
      const key = `confirmed_${entity.entityType}_${entity.entityId}`;

      await query(
        `UPDATE context_layer
         SET definitions = jsonb_set(
           COALESCE(definitions, '{}'::jsonb),
           ARRAY['confirmation_counts', $2],
           (COALESCE(definitions->'confirmation_counts'->>$2, '0')::int + 1)::text::jsonb
         ),
         updated_at = NOW()
         WHERE workspace_id = $1`,
        [workspaceId, key]
      );
    }
  } catch (err) {
    console.error('[dismiss-velocity] Error boosting config confidence:', err);
  }
}
