import { query } from '../db.js';

export interface NextActionGap {
  deal_id: string;
  deal_name: string;
  deal_amount: number | null;
  deal_stage: string;
  deal_owner: string;
  last_call_date: string;
  days_since_last_call: number;
  last_call_title: string | null;
  last_call_id: string;
  last_call_disposition: string | null;
  last_call_engagement: string | null;
  gap_severity: 'critical' | 'warning' | 'moderate';
}

export interface NextActionGapSummary {
  total_gaps: number;
  critical_count: number;
  warning_count: number;
  moderate_count: number;
  total_deal_value: number;
}

export async function detectNextActionGaps(
  workspaceId: string,
  minDaysSinceCall: number = 3
): Promise<{ gaps: NextActionGap[]; summary: NextActionGapSummary }> {
  // Find deals with linked conversations where the most recent call is older than minDaysSinceCall
  const result = await query(
    `WITH latest_calls AS (
      SELECT
        c.deal_id,
        MAX(c.call_date) as last_call_date,
        ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(c.call_date))) / 86400)::int as days_since
      FROM conversations c
      WHERE c.workspace_id = $1
        AND c.deal_id IS NOT NULL
        AND c.is_internal = FALSE
        AND c.call_date IS NOT NULL
      GROUP BY c.deal_id
      HAVING ROUND(EXTRACT(EPOCH FROM (NOW() - MAX(c.call_date))) / 86400)::int >= $2
    ),
    last_call_details AS (
      SELECT DISTINCT ON (c.deal_id)
        c.deal_id,
        c.id as last_call_id,
        c.title as last_call_title,
        c.call_disposition,
        c.engagement_quality as last_call_engagement
      FROM conversations c
      INNER JOIN latest_calls lc ON lc.deal_id = c.deal_id AND lc.last_call_date = c.call_date
      WHERE c.workspace_id = $1
      ORDER BY c.deal_id, c.call_date DESC
    )
    SELECT
      d.id as deal_id,
      d.name as deal_name,
      d.amount as deal_amount,
      d.stage as deal_stage,
      d.owner as deal_owner,
      lc.last_call_date,
      lc.days_since as days_since_last_call,
      lcd.last_call_id,
      lcd.last_call_title,
      lcd.call_disposition as last_call_disposition,
      lcd.last_call_engagement
    FROM latest_calls lc
    INNER JOIN deals d ON d.id = lc.deal_id
    LEFT JOIN last_call_details lcd ON lcd.deal_id = lc.deal_id
    WHERE d.workspace_id = $1
      AND d.stage_normalized NOT IN ('closed_won', 'closed_lost')
    ORDER BY lc.days_since DESC, d.amount DESC NULLS LAST`,
    [workspaceId, minDaysSinceCall]
  );

  const gaps: NextActionGap[] = result.rows.map((row: any) => {
    const days = row.days_since_last_call;
    let severity: 'critical' | 'warning' | 'moderate';

    // Severity based on days since last call
    if (days >= 14) {
      severity = 'critical';
    } else if (days >= 7) {
      severity = 'warning';
    } else {
      severity = 'moderate';
    }

    return {
      deal_id: row.deal_id,
      deal_name: row.deal_name || '',
      deal_amount: row.deal_amount != null ? Number(row.deal_amount) : null,
      deal_stage: row.deal_stage || '',
      deal_owner: row.deal_owner || '',
      last_call_date: row.last_call_date ? new Date(row.last_call_date).toISOString() : '',
      days_since_last_call: Number(row.days_since_last_call),
      last_call_title: row.last_call_title || null,
      last_call_id: row.last_call_id,
      last_call_disposition: row.last_call_disposition || null,
      last_call_engagement: row.last_call_engagement || null,
      gap_severity: severity,
    };
  });

  const summary: NextActionGapSummary = {
    total_gaps: gaps.length,
    critical_count: gaps.filter(g => g.gap_severity === 'critical').length,
    warning_count: gaps.filter(g => g.gap_severity === 'warning').length,
    moderate_count: gaps.filter(g => g.gap_severity === 'moderate').length,
    total_deal_value: gaps.reduce((sum, g) => sum + (g.deal_amount || 0), 0),
  };

  return { gaps, summary };
}
