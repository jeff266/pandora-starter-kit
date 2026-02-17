/**
 * Consultant Call Context Injection
 *
 * Provides consultant call context to skill synthesis prompts.
 * When a RevOps consultant has recorded calls with a client's stakeholders,
 * those summaries are injected into the workspace's skill analysis to
 * prioritize findings that align with expressed client concerns.
 *
 * Token impact: ~300 tokens per skill run if consultant calls exist.
 * 0 tokens if no consultant calls for this workspace.
 */

import { query } from '../db.js';

export async function getConsultantContext(workspaceId: string): Promise<string | null> {
  // Get recent consultant calls assigned to this workspace (last 30 days)
  const calls = await query<{
    title: string | null;
    call_date: string | null;
    summary: string | null;
    duration_seconds: number | null;
  }>(
    `SELECT c.title, c.call_date, c.summary, c.duration_seconds
     FROM conversations c
     WHERE c.workspace_id = $1
       AND c.source_type = 'consultant'
       AND c.call_date >= NOW() - INTERVAL '30 days'
     ORDER BY c.call_date DESC
     LIMIT 5`,
    [workspaceId]
  );

  if (calls.rows.length === 0) return null;

  const callSummaries = calls.rows.map(call => {
    const date = call.call_date
      ? new Date(call.call_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : 'Unknown date';
    const durationMin = call.duration_seconds
      ? Math.round(call.duration_seconds / 60)
      : '?';
    const summary = (call.summary || '').substring(0, 200).trim();
    return `- "${call.title || 'Untitled call'}" (${date}, ${durationMin}min): ${summary || 'No summary available'}`;
  }).join('\n');

  return `<consultant_context>
The RevOps consultant managing this workspace had the following recent calls
related to this client. These provide strategic context about client priorities
and concerns — not sales activity data.

${callSummaries}

Use this context to prioritize and frame your analysis. If the consultant's
client expressed specific concerns (e.g., churn, forecasting accuracy, data quality),
weight related findings more heavily in your synthesis.
</consultant_context>`;
}
