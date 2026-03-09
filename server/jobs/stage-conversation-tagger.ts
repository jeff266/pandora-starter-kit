import { query } from '../db.js';
import { getStallThresholdsByStage } from '../analysis/stage-history-queries.js';

export interface TaggerJobResult {
  tagged: number;
  resolved: number;
  backfilled: number;
  pendingRemaining: number;
  durationMs: number;
}

interface UntaggedConv {
  conversation_id: string;
  deal_id: string;
  call_date: string;
}

interface StageWindow {
  stage_name: string;
  stage_normalized: string;
  entered_at: string;
  exited_at: string | null;
}

type TransitionType = 'progressor' | 'staller' | 'pending';

const CLOSED_STAGE_PATTERN = /closed|won|lost/i;

function isClosedStage(stageName: string): boolean {
  return CLOSED_STAGE_PATTERN.test(stageName);
}

async function getStageWindows(dealId: string): Promise<StageWindow[]> {
  const result = await query<{
    stage_name: string;
    stage_normalized: string;
    entered_at: string;
    exited_at: string | null;
  }>(`
    SELECT
      to_stage        AS stage_name,
      COALESCE(to_stage_normalized, to_stage) AS stage_normalized,
      changed_at      AS entered_at,
      LEAD(changed_at) OVER (PARTITION BY deal_id ORDER BY changed_at) AS exited_at
    FROM deal_stage_history
    WHERE deal_id = $1
    ORDER BY changed_at
  `, [dealId]);

  return result.rows;
}

async function tagConversationBatch(
  workspaceId: string,
  convs: UntaggedConv[],
  thresholds: Map<string, { wonMedianDays: number; stallThresholdDays: number }>,
): Promise<number> {
  let count = 0;

  for (const conv of convs) {
    const windows = await getStageWindows(conv.deal_id);
    const callAt = new Date(conv.call_date);

    for (const win of windows) {
      if (isClosedStage(win.stage_name)) continue;

      const enteredAt = new Date(win.entered_at);
      const exitedAt  = win.exited_at ? new Date(win.exited_at) : null;
      const inWindow  = callAt >= enteredAt && (exitedAt === null || callAt < exitedAt);
      if (!inWindow) continue;

      const threshold = thresholds.get(win.stage_name);
      const stallDays = threshold?.stallThresholdDays ?? 30;

      if (!threshold) {
        console.log(
          `[StageConversationTagger] Workspace ${workspaceId}: no won deal history for stage "${win.stage_name}" — using default 30d stall threshold`,
        );
      }

      const daysInStageAtCall = Math.floor((callAt.getTime() - enteredAt.getTime()) / 86400000);

      let transitionType: TransitionType = 'pending';
      let resolutionReason: string | null = null;

      if (exitedAt !== null) {
        const daysInStage = Math.floor((exitedAt.getTime() - enteredAt.getTime()) / 86400000);
        const movedForward = windows.some(w => {
          if (!w.entered_at) return false;
          const wEntered = new Date(w.entered_at);
          return (
            Math.abs(wEntered.getTime() - exitedAt.getTime()) < 1000 &&
            !isClosedStage(w.stage_name)
          );
        });

        if (movedForward && daysInStage <= stallDays) {
          transitionType   = 'progressor';
          resolutionReason = 'advanced';
        } else {
          transitionType   = 'staller';
          resolutionReason = isClosedStage(win.stage_name) ? 'closed_lost' : 'threshold_exceeded';
        }
      }

      await query(`
        INSERT INTO stage_tagged_conversations (
          workspace_id, conversation_id, deal_id,
          stage_name, stage_normalized,
          entered_stage_at, exited_stage_at,
          days_in_stage_at_call,
          transition_type, stall_threshold_days,
          resolved_at, resolution_reason
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (conversation_id, stage_name) DO NOTHING
      `, [
        workspaceId,
        conv.conversation_id,
        conv.deal_id,
        win.stage_name,
        win.stage_normalized,
        win.entered_at,
        win.exited_at,
        daysInStageAtCall,
        transitionType,
        stallDays,
        transitionType !== 'pending' ? new Date() : null,
        resolutionReason,
      ]);

      count++;
      break; // a conversation belongs to exactly one stage window
    }
  }

  return count;
}

async function tagNewConversations(
  workspaceId: string,
  thresholds: Map<string, { wonMedianDays: number; stallThresholdDays: number }>,
): Promise<number> {
  const result = await query<UntaggedConv>(`
    SELECT c.id AS conversation_id, c.deal_id, c.call_date
    FROM conversations c
    WHERE c.workspace_id = $1
      AND c.deal_id IS NOT NULL
      AND (c.is_internal = false OR c.is_internal IS NULL)
      AND c.transcript_text IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM stage_tagged_conversations stc
        WHERE stc.conversation_id = c.id
      )
    ORDER BY c.call_date DESC
    LIMIT 500
  `, [workspaceId]);

  return tagConversationBatch(workspaceId, result.rows, thresholds);
}

async function resolvePendingTags(
  workspaceId: string,
  thresholds: Map<string, { wonMedianDays: number; stallThresholdDays: number }>,
): Promise<number> {
  const pending = await query<{
    id: string;
    deal_id: string;
    stage_name: string;
    entered_stage_at: string;
    stall_threshold_days: number;
  }>(`
    SELECT id, deal_id, stage_name, entered_stage_at, stall_threshold_days
    FROM stage_tagged_conversations
    WHERE workspace_id = $1
      AND transition_type = 'pending'
  `, [workspaceId]);

  let resolved = 0;

  for (const row of pending.rows) {
    const exit = await query<{ changed_at: string; to_stage: string }>(`
      SELECT changed_at, to_stage
      FROM deal_stage_history
      WHERE deal_id = $1
        AND changed_at > $2
      ORDER BY changed_at ASC
      LIMIT 1
    `, [row.deal_id, row.entered_stage_at]);

    const enteredAt   = new Date(row.entered_stage_at);
    const daysInStage = Math.floor((Date.now() - enteredAt.getTime()) / 86400000);
    const threshold   = thresholds.get(row.stage_name)?.stallThresholdDays ?? row.stall_threshold_days;

    let transitionType: 'progressor' | 'staller';
    let resolutionReason: string;
    let exitedAt: Date | null = null;

    if (exit.rows.length > 0) {
      exitedAt             = new Date(exit.rows[0].changed_at);
      const nextStage      = exit.rows[0].to_stage.toLowerCase();
      const movedForward   = !nextStage.includes('lost') && !nextStage.includes('closed');
      transitionType       = movedForward ? 'progressor' : 'staller';
      resolutionReason     = movedForward ? 'advanced' : 'closed_lost';
    } else if (daysInStage > threshold) {
      transitionType   = 'staller';
      resolutionReason = 'threshold_exceeded';
    } else {
      continue;
    }

    await query(`
      UPDATE stage_tagged_conversations
      SET transition_type    = $1,
          resolution_reason  = $2,
          exited_stage_at    = $3,
          resolved_at        = now(),
          updated_at         = now()
      WHERE id = $4
    `, [transitionType, resolutionReason, exitedAt, row.id]);

    resolved++;
  }

  return resolved;
}

async function backfillLateConversations(
  workspaceId: string,
  thresholds: Map<string, { wonMedianDays: number; stallThresholdDays: number }>,
): Promise<number> {
  const late = await query<UntaggedConv>(`
    SELECT c.id AS conversation_id, c.deal_id, c.call_date
    FROM conversations c
    WHERE c.workspace_id = $1
      AND c.deal_id IS NOT NULL
      AND (c.is_internal = false OR c.is_internal IS NULL)
      AND c.transcript_text IS NOT NULL
      AND c.call_date < now() - interval '7 days'
      AND NOT EXISTS (
        SELECT 1 FROM stage_tagged_conversations stc
        WHERE stc.conversation_id = c.id
      )
    ORDER BY c.call_date DESC
    LIMIT 200
  `, [workspaceId]);

  return tagConversationBatch(workspaceId, late.rows, thresholds);
}

async function getStageCoverage(workspaceId: string): Promise<Record<string, number>> {
  const result = await query<{ stage_name: string; total: string; tagged: string }>(`
    SELECT
      stc.stage_name,
      COUNT(*) AS tagged,
      COUNT(*) FILTER (WHERE stc.transition_type IN ('progressor', 'staller')) AS resolved
    FROM stage_tagged_conversations stc
    WHERE stc.workspace_id = $1
    GROUP BY stc.stage_name
  `, [workspaceId]);

  const coverage: Record<string, number> = {};
  for (const row of result.rows) {
    coverage[row.stage_name] = parseInt(row.tagged, 10);
  }
  return coverage;
}

export async function runStageConversationTagger(workspaceId: string): Promise<TaggerJobResult> {
  const startTime = Date.now();

  const recentRun = await query<{ id: string }>(`
    SELECT id FROM stage_tagged_conversations
    WHERE workspace_id = $1
      AND created_at > now() - interval '6 days'
    LIMIT 1
  `, [workspaceId]).catch(() => ({ rows: [] as { id: string }[] }));

  if (recentRun.rows.length > 0) {
    console.log(`[StageConversationTagger] Workspace ${workspaceId}: skipped (ran recently)`);
    return { tagged: 0, resolved: 0, backfilled: 0, pendingRemaining: 0, durationMs: Date.now() - startTime };
  }

  const thresholds = await getStallThresholdsByStage(workspaceId, null);

  const tagged     = await tagNewConversations(workspaceId, thresholds);
  const resolved   = await resolvePendingTags(workspaceId, thresholds);
  const backfilled = await backfillLateConversations(workspaceId, thresholds);

  const pendingRes = await query<{ count: string }>(`
    SELECT COUNT(*) AS count
    FROM stage_tagged_conversations
    WHERE workspace_id = $1 AND transition_type = 'pending'
  `, [workspaceId]).catch(() => ({ rows: [{ count: '0' }] }));

  const pendingRemaining = parseInt(pendingRes.rows[0]?.count ?? '0', 10);

  const coverage = await getStageCoverage(workspaceId);
  const coverageStr = Object.entries(coverage)
    .map(([stage, n]) => `${stage}=${n}`)
    .join(' ');

  console.log(
    `[StageConversationTagger] Workspace ${workspaceId}: ` +
    `tagged=${tagged} resolved=${resolved} backfilled=${backfilled} ` +
    `pending_remaining=${pendingRemaining}\n` +
    `  coverage: ${coverageStr || 'none'}`,
  );

  return { tagged, resolved, backfilled, pendingRemaining, durationMs: Date.now() - startTime };
}
