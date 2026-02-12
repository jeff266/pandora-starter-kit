export const DEAL_TEMPORAL_FIELDS = `
  EXTRACT(EPOCH FROM (NOW() - last_activity_date)) / 86400 AS computed_days_since_activity,
  CASE
    WHEN stage_changed_at IS NOT NULL
    THEN FLOOR(EXTRACT(EPOCH FROM (NOW() - stage_changed_at)) / 86400)::integer
    ELSE days_in_stage
  END AS computed_days_in_stage
`;

export const DEAL_WITH_TEMPORAL_SQL = `
  SELECT d.*,
    CASE
      WHEN d.last_activity_date IS NOT NULL
      THEN FLOOR(EXTRACT(EPOCH FROM (NOW() - d.last_activity_date)) / 86400)::integer
      ELSE NULL
    END AS computed_days_since_activity
  FROM deals d
`;

export function dealsWithTemporalQuery(workspaceId: string, additionalWhere?: string): { text: string; params: unknown[] } {
  const where = additionalWhere ? `AND ${additionalWhere}` : '';
  return {
    text: `
      SELECT d.*,
        CASE
          WHEN d.last_activity_date IS NOT NULL
          THEN FLOOR(EXTRACT(EPOCH FROM (NOW() - d.last_activity_date)) / 86400)::integer
          ELSE NULL
        END AS computed_days_since_activity
      FROM deals d
      WHERE d.workspace_id = $1 ${where}
    `,
    params: [workspaceId],
  };
}
