import { query } from '../db.js';

export interface FeedbackSignalInput {
  targetType: string;
  targetId: string;
  signalType: string;
  metadata?: Record<string, unknown>;
  source: string;
  createdBy?: string;
}

export interface FeedbackSignal {
  id: string;
  workspace_id: string;
  target_type: string;
  target_id: string;
  signal_type: string;
  signal_metadata: Record<string, unknown>;
  source: string;
  created_by: string | null;
  created_at: string;
}

export async function recordFeedbackSignal(
  workspaceId: string,
  data: FeedbackSignalInput
): Promise<FeedbackSignal> {
  if (data.createdBy) {
    await query(
      `DELETE FROM feedback_signals
       WHERE workspace_id = $1 AND target_type = $2 AND target_id = $3 AND created_by = $4`,
      [workspaceId, data.targetType, data.targetId, data.createdBy]
    );
  }

  const result = await query<FeedbackSignal>(
    `INSERT INTO feedback_signals
       (workspace_id, target_type, target_id, signal_type, signal_metadata, source, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      workspaceId,
      data.targetType,
      data.targetId,
      data.signalType,
      JSON.stringify(data.metadata || {}),
      data.source,
      data.createdBy || null,
    ]
  );

  return result.rows[0];
}

export interface FeedbackSummary {
  totals: Record<string, number>;
  byWeek: Array<{ week: string; signal_type: string; count: number }>;
}

export async function getFeedbackSummary(
  workspaceId: string,
  since: Date
): Promise<FeedbackSummary> {
  const totalsResult = await query<{ signal_type: string; cnt: string }>(
    `SELECT signal_type, COUNT(*) as cnt
     FROM feedback_signals
     WHERE workspace_id = $1 AND created_at >= $2
     GROUP BY signal_type`,
    [workspaceId, since.toISOString()]
  );

  const totals: Record<string, number> = {};
  for (const row of totalsResult.rows) {
    totals[row.signal_type] = parseInt(row.cnt, 10);
  }

  const byWeekResult = await query<{ week: string; signal_type: string; cnt: string }>(
    `SELECT date_trunc('week', created_at)::text as week, signal_type, COUNT(*) as cnt
     FROM feedback_signals
     WHERE workspace_id = $1 AND created_at >= $2
     GROUP BY week, signal_type
     ORDER BY week DESC`,
    [workspaceId, since.toISOString()]
  );

  const byWeek = byWeekResult.rows.map(r => ({
    week: r.week,
    signal_type: r.signal_type,
    count: parseInt(r.cnt, 10),
  }));

  return { totals, byWeek };
}

export async function getSignalsForTarget(
  targetType: string,
  targetId: string
): Promise<FeedbackSignal[]> {
  const result = await query<FeedbackSignal>(
    `SELECT * FROM feedback_signals
     WHERE target_type = $1 AND target_id = $2
     ORDER BY created_at DESC`,
    [targetType, targetId]
  );
  return result.rows;
}
