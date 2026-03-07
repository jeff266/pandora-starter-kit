import { assembleBrief } from './brief-assembler.js';

export interface MaterialChange {
  type:
    | 'deal_closed_won'
    | 'deal_closed_lost'
    | 'amount_changed'
    | 'pipeline_reclassified'
    | 'stage_regression'
    | 'close_date_slipped';
  dealId: string;
  dealName: string;
  before: Record<string, any>;
  after: Record<string, any>;
}

export function triggerBriefReassembly(
  workspaceId: string,
  reason: string,
  materialChanges: MaterialChange[]
): void {
  setImmediate(async () => {
    try {
      console.log(
        `[BriefReassembly] ${materialChanges.length} material change(s) detected (${reason}), reassembling brief for workspace ${workspaceId}`
      );
      const hasClosedWon = materialChanges.some(c => c.type === 'deal_closed_won');
      if (hasClosedWon) {
        console.log(`[BriefReassembly] HIGH PRIORITY — Closed Won deal detected, forcing immediate reassembly`);
      }
      await assembleBrief(workspaceId, { force: true });
      console.log(`[BriefReassembly] Brief reassembled successfully for workspace ${workspaceId}`);
    } catch (err) {
      console.error(
        `[BriefReassembly] Reassembly failed for workspace ${workspaceId}:`,
        err instanceof Error ? err.message : err
      );
    }
  });
}
