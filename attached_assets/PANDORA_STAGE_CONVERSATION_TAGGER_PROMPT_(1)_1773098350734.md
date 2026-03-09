# Claude Code Prompt: Stage Conversation Tagging
## Weekly reconciliation job — pre-labels conversations as
## progressor/staller so quarterly Stage Progression reads clean pools

---

## Context

The quarterly Stage Progression skill currently assembles its transcript
pool at run time — joining conversations to deal_stage_history across
three tables with date-range math per stage. This works but is slow and
recomputed from scratch every quarter.

This prompt builds a weekly reconciliation job that does that relational
work incrementally, once per week, and stores the result in a
`stage_tagged_conversations` table. The quarterly run then reads
pre-labeled rows directly instead of computing them.

Pattern: identical to the conversation enrichment job that landed in
T001–T008. Read `server/jobs/conversation-enrichment.ts` before starting
— this job follows the same structure: migration → job class → cron
registration → skill consumer update.

---

## Before starting

Read these files:

1. `server/jobs/conversation-enrichment.ts` — the weekly enrichment job
   that just landed. Copy its class structure, cron registration pattern,
   duplicate-run guard, and per-workspace iteration loop exactly.

2. `server/analysis/stage-history-queries.ts` — `getAverageTimeInStage`,
   `getStageConversionRates`, `getWonCyclePercentiles`. You will call
   `getAverageTimeInStage` to compute stall thresholds per stage.

3. `server/skills/compute/behavioral-milestones.ts` — find how
   `getClosedDeals` and the stage progression pool builder currently
   query conversations. You will update those queries in Step 5.

4. The `deal_stage_history` table schema — `deal_id`, `workspace_id`,
   `to_stage`, `to_stage_normalized`, `changed_at`,
   `duration_in_previous_stage_ms`.

5. The `conversations` table schema — `id`, `deal_id`, `workspace_id`,
   `started_at`, `transcript_text`, `is_internal`.

6. Current migration numbering — check `migrations/` for the highest
   number. This migration is the next one.

---

## Step 1: Migration — stage_tagged_conversations table

Create the next migration file:

```sql
CREATE TABLE IF NOT EXISTS stage_tagged_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,

  -- Stage context at time of call
  stage_name TEXT NOT NULL,
  stage_normalized TEXT NOT NULL,
  entered_stage_at TIMESTAMPTZ NOT NULL,
  exited_stage_at TIMESTAMPTZ,          -- NULL if deal still in stage
  days_in_stage_at_call INT,            -- how far into stage when call occurred

  -- Classification
  transition_type TEXT CHECK (
    transition_type IN ('progressor', 'staller', 'pending')
  ),
  stall_threshold_days INT NOT NULL,    -- 2 × won median for this stage

  -- Resolution tracking
  resolved_at TIMESTAMPTZ,             -- when pending resolved to final type
  resolution_reason TEXT,              -- 'advanced' | 'stalled' | 'closed_lost'
                                       -- | 'threshold_exceeded' | 'still_pending'

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- One tag per conversation per stage
  -- A call can only belong to one stage window
  UNIQUE(conversation_id, stage_name)
);

-- Primary read pattern for quarterly Stage Progression run
CREATE INDEX idx_stc_quarterly_read
  ON stage_tagged_conversations(workspace_id, stage_name, transition_type)
  WHERE transition_type IN ('progressor', 'staller');

-- Resolution loop — find pending rows to re-evaluate
CREATE INDEX idx_stc_pending
  ON stage_tagged_conversations(workspace_id, transition_type)
  WHERE transition_type = 'pending';

-- Per-workspace, per-deal lookup for dedup
CREATE INDEX idx_stc_deal
  ON stage_tagged_conversations(deal_id, stage_name);
```

Run the migration. Confirm it applies cleanly before proceeding.

---

## Step 2: Stall threshold computation

Add `getStallThresholdsByStage()` to
`server/analysis/stage-history-queries.ts` if it doesn't already exist:

```typescript
export async function getStallThresholdsByStage(
  workspaceId: string,
  pipelineId: string | null,
  db: DatabaseClient
): Promise<Map<string, { wonMedianDays: number; stallThresholdDays: number }>> {
  // For each stage in the workspace, compute:
  //   wonMedianDays = median days in stage for closed won deals
  //   stallThresholdDays = MAX(2 × wonMedianDays, 7)
  //   (minimum 7 days prevents zero-threshold edge cases on fast stages)
  //
  // Use getAverageTimeInStage() if it returns median, or query directly:

  const result = await db.query(`
    SELECT
      dsh.to_stage AS stage_name,
      PERCENTILE_CONT(0.5) WITHIN GROUP (
        ORDER BY dsh.duration_in_previous_stage_ms
      ) / 86400000.0 AS won_median_days
    FROM deal_stage_history dsh
    JOIN deals d ON d.id = dsh.deal_id
    WHERE dsh.workspace_id = $1
      AND d.is_won = true
      AND d.is_closed = true
      AND dsh.duration_in_previous_stage_ms IS NOT NULL
      AND dsh.duration_in_previous_stage_ms > 0
      ${pipelineId ? 'AND d.pipeline_id = $2' : ''}
    GROUP BY dsh.to_stage
  `, pipelineId ? [workspaceId, pipelineId] : [workspaceId]);

  const thresholds = new Map<string, {
    wonMedianDays: number;
    stallThresholdDays: number;
  }>();

  for (const row of result.rows) {
    const wonMedian = Math.round(parseFloat(row.won_median_days));
    thresholds.set(row.stage_name, {
      wonMedianDays: wonMedian,
      stallThresholdDays: Math.max(wonMedian * 2, 7),
    });
  }

  // Default for stages with no won deal history
  // Use 30 days as a safe default stall threshold
  return thresholds;
}
```

---

## Step 3: Weekly reconciliation job

Create `server/jobs/stage-conversation-tagger.ts`.

Follow the exact class structure of `conversation-enrichment.ts`:
- Same per-workspace iteration pattern
- Same duplicate-run guard (check for a completed run in last 6 days)
- Same error isolation (one workspace failure doesn't stop others)
- Same structured logging

```typescript
export class StageConversationTagger {

  async run(): Promise<void> {
    console.log('[StageConversationTagger] Starting weekly reconciliation');

    const workspaces = await this.getActiveWorkspaces();
    console.log(`[StageConversationTagger] Processing ${workspaces.length} workspaces`);

    for (const workspace of workspaces) {
      try {
        await this.processWorkspace(workspace.id);
      } catch (err) {
        console.error(`[StageConversationTagger] Workspace ${workspace.id} failed:`, err);
        // Continue to next workspace
      }
    }

    console.log('[StageConversationTagger] Weekly reconciliation complete');
  }

  private async processWorkspace(workspaceId: string): Promise<void> {
    // Duplicate-run guard: skip if ran successfully in last 6 days
    const recentRun = await db.query(`
      SELECT id FROM job_runs
      WHERE job_name = 'stage-conversation-tagger'
        AND workspace_id = $1
        AND status = 'completed'
        AND completed_at > now() - interval '6 days'
      LIMIT 1
    `, [workspaceId]);

    if (recentRun.rows.length > 0) {
      console.log(`[StageConversationTagger] Workspace ${workspaceId}: skipped (ran recently)`);
      return;
    }

    const thresholds = await getStallThresholdsByStage(workspaceId, null, db);

    let tagged = 0;
    let resolved = 0;
    let backfilled = 0;

    // --- PHASE 1: Tag new conversations ---
    tagged = await this.tagNewConversations(workspaceId, thresholds);

    // --- PHASE 2: Resolve pending tags ---
    resolved = await this.resolvePendingTags(workspaceId, thresholds);

    // --- PHASE 3: Backfill late-arriving conversations ---
    backfilled = await this.backfillLateConversations(workspaceId, thresholds);

    console.log(
      `[StageConversationTagger] Workspace ${workspaceId}: ` +
      `tagged=${tagged} resolved=${resolved} backfilled=${backfilled}`
    );

    // Record job completion
    await this.recordJobRun(workspaceId, 'completed', { tagged, resolved, backfilled });
  }

  // --- PHASE 1: Tag new conversations ---
  // Conversations synced since last run that have a deal_id and
  // aren't already in stage_tagged_conversations

  private async tagNewConversations(
    workspaceId: string,
    thresholds: Map<string, { wonMedianDays: number; stallThresholdDays: number }>
  ): Promise<number> {

    // Find untagged conversations linked to deals
    const untagged = await db.query(`
      SELECT
        c.id AS conversation_id,
        c.deal_id,
        c.started_at
      FROM conversations c
      WHERE c.workspace_id = $1
        AND c.deal_id IS NOT NULL
        AND c.is_internal = false
        AND NOT EXISTS (
          SELECT 1 FROM stage_tagged_conversations stc
          WHERE stc.conversation_id = c.id
        )
      ORDER BY c.started_at DESC
      LIMIT 500  -- process max 500 per run to bound execution time
    `, [workspaceId]);

    let count = 0;

    for (const conv of untagged.rows) {
      // Find which stage window this conversation falls in
      const stageWindow = await db.query(`
        SELECT
          to_stage AS stage_name,
          to_stage_normalized AS stage_normalized,
          changed_at AS entered_at,
          LEAD(changed_at) OVER (
            PARTITION BY deal_id ORDER BY changed_at
          ) AS exited_at
        FROM deal_stage_history
        WHERE deal_id = $1
        ORDER BY changed_at
      `, [conv.deal_id]);

      // Find the stage window that contains this conversation's started_at
      for (const window of stageWindow.rows) {
        const enteredAt = new Date(window.entered_at);
        const exitedAt  = window.exited_at ? new Date(window.exited_at) : null;
        const callAt    = new Date(conv.started_at);

        const inWindow = callAt >= enteredAt &&
          (exitedAt === null || callAt < exitedAt);

        if (!inWindow) continue;

        // Skip closed stages
        const stageLower = window.stage_name.toLowerCase();
        if (stageLower.includes('closed') ||
            stageLower.includes('won') ||
            stageLower.includes('lost')) continue;

        const threshold = thresholds.get(window.stage_name);
        const stallDays = threshold?.stallThresholdDays ?? 30;
        const daysInStageAtCall = Math.floor(
          (callAt.getTime() - enteredAt.getTime()) / 86400000
        );

        // Determine transition_type immediately if deal already exited
        let transitionType: 'progressor' | 'staller' | 'pending';
        let resolutionReason: string | null = null;

        if (exitedAt !== null) {
          const daysInStage = Math.floor(
            (exitedAt.getTime() - enteredAt.getTime()) / 86400000
          );
          // Check if it moved forward (next stage exists and isn't closed)
          const movedForward = stageWindow.rows.some(w =>
            new Date(w.entered_at).getTime() === exitedAt.getTime() &&
            !w.stage_name.toLowerCase().includes('lost')
          );

          if (movedForward && daysInStage <= stallDays) {
            transitionType  = 'progressor';
            resolutionReason = 'advanced';
          } else {
            transitionType  = 'staller';
            resolutionReason = 'closed_lost';
          }
        } else {
          // Deal still in this stage — classify as pending
          transitionType = 'pending';
        }

        await db.query(`
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
          workspaceId, conv.conversation_id, conv.deal_id,
          window.stage_name, window.stage_normalized,
          window.entered_at, window.exited_at,
          daysInStageAtCall,
          transitionType, stallDays,
          transitionType !== 'pending' ? new Date() : null,
          resolutionReason,
        ]);

        count++;
        break; // A conversation belongs to exactly one stage window
      }
    }

    return count;
  }

  // --- PHASE 2: Resolve pending tags ---
  // Re-evaluate any row where transition_type = 'pending'
  // Deal may have since moved, stalled past threshold, or closed

  private async resolvePendingTags(
    workspaceId: string,
    thresholds: Map<string, { wonMedianDays: number; stallThresholdDays: number }>
  ): Promise<number> {

    const pending = await db.query(`
      SELECT
        stc.id,
        stc.deal_id,
        stc.stage_name,
        stc.entered_stage_at,
        stc.stall_threshold_days
      FROM stage_tagged_conversations stc
      WHERE stc.workspace_id = $1
        AND stc.transition_type = 'pending'
    `, [workspaceId]);

    let resolved = 0;

    for (const row of pending.rows) {
      // Check if deal has since exited this stage
      const exit = await db.query(`
        SELECT changed_at, to_stage
        FROM deal_stage_history
        WHERE deal_id = $1
          AND changed_at > $2
        ORDER BY changed_at ASC
        LIMIT 1
      `, [row.deal_id, row.entered_stage_at]);

      const enteredAt = new Date(row.entered_stage_at);
      const now       = new Date();
      const daysInStage = Math.floor(
        (now.getTime() - enteredAt.getTime()) / 86400000
      );

      let transitionType: 'progressor' | 'staller';
      let resolutionReason: string;
      let exitedAt: Date | null = null;

      if (exit.rows.length > 0) {
        exitedAt        = new Date(exit.rows[0].changed_at);
        const nextStage = exit.rows[0].to_stage.toLowerCase();
        const movedForward = !nextStage.includes('lost') &&
                             !nextStage.includes('closed');
        transitionType  = movedForward ? 'progressor' : 'staller';
        resolutionReason = movedForward ? 'advanced' : 'closed_lost';
      } else if (daysInStage > row.stall_threshold_days) {
        // Still in stage but exceeded threshold
        transitionType  = 'staller';
        resolutionReason = 'threshold_exceeded';
      } else {
        // Still pending — not enough time has passed
        continue;
      }

      await db.query(`
        UPDATE stage_tagged_conversations
        SET transition_type = $1,
            resolution_reason = $2,
            exited_stage_at = $3,
            resolved_at = now(),
            updated_at = now()
        WHERE id = $4
      `, [transitionType, resolutionReason, exitedAt, row.id]);

      resolved++;
    }

    return resolved;
  }

  // --- PHASE 3: Backfill late-arriving conversations ---
  // Gong/Fireflies sometimes deliver transcripts days after the call.
  // Find conversations older than 7 days that still aren't tagged.

  private async backfillLateConversations(
    workspaceId: string,
    thresholds: Map<string, { wonMedianDays: number; stallThresholdDays: number }>
  ): Promise<number> {

    // Same logic as Phase 1 but targets older untagged conversations
    // (started_at < 7 days ago) — these are late-arriving transcripts
    // that were missing when Phase 1 ran previously

    const late = await db.query(`
      SELECT c.id AS conversation_id, c.deal_id, c.started_at
      FROM conversations c
      WHERE c.workspace_id = $1
        AND c.deal_id IS NOT NULL
        AND c.is_internal = false
        AND c.started_at < now() - interval '7 days'
        AND NOT EXISTS (
          SELECT 1 FROM stage_tagged_conversations stc
          WHERE stc.conversation_id = c.id
        )
      ORDER BY c.started_at DESC
      LIMIT 200
    `, [workspaceId]);

    // Run through same tagging logic as Phase 1
    // Extract to shared private method to avoid duplication
    return this.tagConversationBatch(workspaceId, late.rows, thresholds);
  }
}
```

Extract the inner tagging logic from Phase 1 into a shared private
method `tagConversationBatch()` used by both Phase 1 and Phase 3 —
don't duplicate the code.

---

## Step 4: Register the weekly cron

In whichever file registers the conversation enrichment job cron
(likely `server/index.ts` or `server/jobs/index.ts`), add:

```typescript
import { StageConversationTagger } from './jobs/stage-conversation-tagger';

const stageTagger = new StageConversationTagger();

// Sunday 9 PM UTC — runs one hour BEFORE conversation enrichment
// so enriched transcripts are ready when Stage Progression quarterly
// run fires
cron.schedule('0 21 * * 0', async () => {
  await stageTagger.run();
});

console.log('[StageConversationTagger] Registered weekly tagging on cron 0 21 * * 0 (Sunday 9pm UTC)');
```

Schedule it one hour before the enrichment job (`0 22 * * 0`) so
tagging runs first. The quarterly Stage Progression run on `0 5 1 1,4,7,10`
runs well after both weekly jobs — the cache will always be current.

---

## Step 5: Update quarterly Stage Progression query

In `server/skills/compute/behavioral-milestones.ts`, update
`buildStagePool()` to read from `stage_tagged_conversations` instead
of joining conversations to deal_stage_history at query time:

```typescript
// BEFORE — slow three-table join computed at run time
const pool = await db.query(`
  SELECT c.*, dsh.*
  FROM conversations c
  JOIN deal_stage_history dsh
    ON dsh.deal_id = c.deal_id
    AND c.started_at >= dsh.changed_at
    AND (... exited_at date math ...)
  JOIN deals d ON d.id = c.deal_id
  WHERE ...
`);

// AFTER — direct read from pre-labeled cache
const pool = await db.query(`
  SELECT
    stc.transition_type,
    stc.stage_name,
    stc.days_in_stage_at_call,
    stc.stall_threshold_days,
    stc.entered_stage_at,
    c.id AS conversation_id,
    c.transcript_text,
    c.participants,
    c.summary,
    d.id AS deal_id,
    d.name AS deal_name,
    d.pipeline_id
  FROM stage_tagged_conversations stc
  JOIN conversations c ON c.id = stc.conversation_id
  JOIN deals d ON d.id = stc.deal_id
  WHERE stc.workspace_id = $1
    AND stc.stage_name = $2
    AND stc.transition_type IN ('progressor', 'staller')
    AND c.transcript_text IS NOT NULL
    AND LENGTH(c.transcript_text) > 100
    ${pipelineId ? 'AND d.pipeline_id = $3' : ''}
  ORDER BY stc.resolved_at DESC
`, pipelineId ? [workspaceId, stageName, pipelineId] : [workspaceId, stageName]);
```

Add a fallback: if `stage_tagged_conversations` returns 0 rows for a
stage (job hasn't run yet for a new workspace), fall back to the old
three-table join with a log warning:

```
[StageProgression] stage_tagged_conversations empty for workspace X,
stage Y — falling back to live query. Run StageConversationTagger
to populate cache.
```

---

## Step 6: Logging and observability

The weekly run should produce a summary log per workspace:

```
[StageConversationTagger] Workspace {id} ({name}):
  tagged=47 resolved=12 backfilled=3
  pending_remaining=8
  coverage: qualification=34% evaluation=61% decision=28% negotiation=19%
```

Log the per-stage coverage so it's visible in server logs without
querying the database. This is the number that tells you whether
quarterly Stage Progression will have enough signal per stage.

Also log if any stage has no thresholds (no won deal history) — these
will use the 30-day default:

```
[StageConversationTagger] Workspace {id}: no won deal history for
  stage "Pilot" — using default 30d stall threshold
```

---

## Acceptance criteria

- [ ] Migration applies cleanly — `stage_tagged_conversations` table
      exists with all indexes
- [ ] `getStallThresholdsByStage()` returns correct thresholds for
      Frontera — verify Decision stage is ~7d won median, ~14d stall
      threshold (matches Pipeline Mechanics 7d won median)
- [ ] Phase 1 tags new conversations correctly — a conversation linked
      to a deal that moved forward within threshold is tagged
      `progressor`; one that didn't is tagged `staller`
- [ ] Phase 2 resolves pending rows — a deal that exceeded its stall
      threshold since last run is correctly resolved to `staller`
- [ ] Phase 3 catches late-arriving conversations — any untagged
      conversation older than 7 days is evaluated
- [ ] `UNIQUE(conversation_id, stage_name)` prevents duplicate tags —
      re-running the job is idempotent
- [ ] Cron registers at `0 21 * * 0` — confirmed in server startup log
- [ ] `buildStagePool()` reads from `stage_tagged_conversations` when
      rows exist; falls back to live query when table is empty
- [ ] Stage Progression quarterly run log shows pool sizes from cache:
      "X progressor + Y staller deals from stage_tagged_conversations"
      rather than the old "3-table join" log message
- [ ] `created_at` used throughout — not `created_date`
- [ ] No TypeScript errors
