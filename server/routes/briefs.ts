import { Router, Request, Response } from 'express';
import { query } from '../db.js';
import { assembleBrief, getLatestBrief } from '../briefing/brief-assembler.js';
import { formatBriefForSlack } from '../briefing/brief-formatter.js';
import { getSlackAppClient } from '../connectors/slack/slack-app-client.js';
import type { BriefType } from '../briefing/brief-types.js';

const router = Router();

// GET /:workspaceId/brief — fetch latest ready brief
router.get('/:workspaceId/brief', async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.params.workspaceId as string;
  try {
    const brief = await getLatestBrief(workspaceId);
    if (!brief) {
      res.json({ available: false, brief: null, metadata: null });
      return;
    }

    // Build staleness metadata
    const connResult = await query<{ last_sync_at: string | null }>(
      `SELECT last_sync_at::text FROM connections WHERE workspace_id = $1 AND connector_name = 'hubspot' ORDER BY last_sync_at DESC NULLS LAST LIMIT 1`,
      [workspaceId]
    ).catch(() => ({ rows: [] as { last_sync_at: string | null }[] }));

    const assembledAt: string = (brief as any).generated_at || new Date().toISOString();
    const lastSyncAt: string | null = connResult.rows[0]?.last_sync_at || null;
    const isPotentiallyStale = !!(lastSyncAt && new Date(lastSyncAt) > new Date(assembledAt));

    const metadata = {
      assembled_at: assembledAt,
      last_sync_at: lastSyncAt,
      is_potentially_stale: isPotentiallyStale,
      stale_reason: isPotentiallyStale ? 'A HubSpot sync ran after this brief was assembled' : undefined,
    };

    res.json({ available: true, brief, metadata });
  } catch (err) {
    console.error('[briefs] GET /brief failed:', err);
    res.status(500).json({ error: 'Failed to fetch brief' });
  }
});

// POST /:workspaceId/brief/assemble — manual trigger
router.post('/:workspaceId/brief/assemble', async (req: Request, res: Response): Promise<void> => {
  const workspaceId = req.params.workspaceId as string;
  const { force = false, brief_type } = req.body as { force?: boolean; brief_type?: BriefType };
  try {
    const brief = await assembleBrief(workspaceId, { force, brief_type });
    res.json({ ok: true, brief });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[briefs] POST /brief/assemble failed:', msg);
    res.status(500).json({ error: msg });
  }
});

// PUT /:workspaceId/brief/:briefId/edit — patch edited_sections
router.put('/:workspaceId/brief/:briefId/edit', async (req: Request, res: Response): Promise<void> => {
  const { workspaceId, briefId } = req.params;
  const { sections, edited_by } = req.body as { sections: Record<string, any>; edited_by?: string };
  try {
    const result = await query(
      `UPDATE weekly_briefs SET
         edited_sections = edited_sections || $1::jsonb,
         status = 'edited',
         edited_by = $2,
         edited_at = NOW(),
         updated_at = NOW()
       WHERE id = $3 AND workspace_id = $4
       RETURNING *`,
      [JSON.stringify(sections), edited_by || null, briefId, workspaceId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Brief not found' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[briefs] PUT /brief/:briefId/edit failed:', err);
    res.status(500).json({ error: 'Failed to save edits' });
  }
});

// POST /:workspaceId/brief/:briefId/send — send to Slack
router.post('/:workspaceId/brief/:briefId/send', async (req: Request, res: Response): Promise<void> => {
  const { workspaceId, briefId } = req.params;
  const { channel, format = 'summary' } = req.body as { channel: string; format?: 'full' | 'summary' };

  if (!channel) {
    res.status(400).json({ error: 'channel required' });
    return;
  }

  try {
    const briefRes = await query<any>(`SELECT * FROM weekly_briefs WHERE id = $1 AND workspace_id = $2`, [briefId, workspaceId]);
    if (briefRes.rows.length === 0) {
      res.status(404).json({ error: 'Brief not found' });
      return;
    }

    const row = briefRes.rows[0];
    const p = (v: any) => typeof v === 'string' ? JSON.parse(v) : (v ?? {});
    const brief = { ...row, the_number: p(row.the_number), what_changed: p(row.what_changed), segments: p(row.segments), reps: p(row.reps), deals_to_watch: p(row.deals_to_watch), ai_blurbs: p(row.ai_blurbs), editorial_focus: p(row.editorial_focus), section_refreshed_at: p(row.section_refreshed_at), sent_to: p(row.sent_to) || [], edited_sections: p(row.edited_sections) || {} };

    const blocks = formatBriefForSlack(brief, format as 'full' | 'summary');
    const slackClient = getSlackAppClient();
    await slackClient.postMessage(workspaceId as string, channel, blocks);

    const sentEntry = { channel, format, sent_at: new Date().toISOString() };
    await query(
      `UPDATE weekly_briefs SET sent_to = sent_to || $1::jsonb, status = 'sent', updated_at = NOW() WHERE id = $2 AND workspace_id = $3`,
      [JSON.stringify([sentEntry]), briefId, workspaceId]
    );

    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[briefs] POST /brief/:briefId/send failed:', msg);
    res.status(500).json({ error: msg });
  }
});

// GET /:workspaceId/brief/history — last 12 briefs
router.get('/:workspaceId/brief/history', async (req: Request, res: Response): Promise<void> => {
  const { workspaceId } = req.params;
  try {
    const result = await query<any>(
      `SELECT id, brief_type, generated_date::text, status, assembly_duration_ms, ai_tokens_used, generated_at
       FROM weekly_briefs WHERE workspace_id = $1 ORDER BY generated_at DESC LIMIT 12`,
      [workspaceId]
    );
    res.json({ briefs: result.rows });
  } catch (err) {
    console.error('[briefs] GET /brief/history failed:', err);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

export default router;
