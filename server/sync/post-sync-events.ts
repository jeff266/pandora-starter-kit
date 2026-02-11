import { getSkillRegistry } from '../skills/registry.js';
import { getSkillRuntime } from '../skills/runtime.js';
import { linkConversations } from '../linker/entity-linker.js';

interface SyncResult {
  connector: string;
  category: string;
  status: string;
  message?: string;
  counts?: Record<string, { transformed: number; failed: number; dbInserted: number; dbFailed: number }>;
}

export async function emitSyncCompleted(
  workspaceId: string,
  results: SyncResult[]
): Promise<void> {
  console.log(`[PostSync] Sync completed for workspace ${workspaceId}, checking for triggered skills`);

  const connectorTypes = results.filter(r => r.status === 'success').map(r => r.connector);
  const linkerRelevant = connectorTypes.some(c => ['gong', 'fireflies', 'hubspot', 'salesforce'].includes(c));
  if (linkerRelevant) {
    linkConversations(workspaceId)
      .then(lr => {
        const total = lr.linked.tier1_email + lr.linked.tier2_native + lr.linked.tier3_inferred;
        console.log(`[Linker] Post-sync: ${total} linked, ${lr.stillUnlinked} unlinked (${lr.durationMs}ms)`);
      })
      .catch(err => console.error(`[Linker] Post-sync failed:`, err instanceof Error ? err.message : err));
  }

  const registry = getSkillRegistry();
  const allSkills = registry.listAll();

  const matchingSkills = allSkills.filter(skill =>
    skill.schedule?.trigger === 'post_sync'
  );

  if (matchingSkills.length === 0) {
    console.log('[PostSync] No skills with post_sync trigger');
    return;
  }

  console.log(`[PostSync] Triggering ${matchingSkills.length} skills: ${matchingSkills.map(s => s.id).join(', ')}`);

  const runtime = getSkillRuntime();

  for (const skillSummary of matchingSkills) {
    const skill = registry.get(skillSummary.id);
    if (!skill) continue;

    try {
      runtime.executeSkill(skill, workspaceId, { syncResults: results }).catch(err => {
        console.error(`[PostSync] Skill ${skill.id} failed:`, err instanceof Error ? err.message : err);
      });
      console.log(`[PostSync] Queued skill ${skill.id} for workspace ${workspaceId}`);
    } catch (err) {
      console.error(`[PostSync] Failed to queue skill ${skill.id}:`, err);
    }
  }
}
