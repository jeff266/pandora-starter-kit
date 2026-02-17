import { getSkillRegistry } from '../skills/registry.js';
import { getSkillRuntime } from '../skills/runtime.js';
import { linkConversations } from '../linker/entity-linker.js';
import { classifyAndUpdateInternalStatus } from '../analysis/conversation-internal-filter.js';
import { extractInsightsFromConversations } from '../analysis/deal-insights-extractor.js';
import { enrichClosedDeal } from '../enrichment/closed-deal-enrichment.js';
import { getEnrichmentConfig } from '../enrichment/config.js';
import { extractConversationSignals } from '../conversations/signal-extractor.js';
import { query } from '../db.js';

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
  const conversationSynced = connectorTypes.some(c => ['gong', 'fireflies'].includes(c));
  const linkerRelevant = connectorTypes.some(c => ['gong', 'fireflies', 'hubspot', 'salesforce'].includes(c));

  if (linkerRelevant) {
    try {
      const lr = await linkConversations(workspaceId);
      const total = lr.linked.tier1_email + lr.linked.tier2_native + lr.linked.tier3_inferred;
      console.log(`[Linker] Post-sync: ${total} linked, ${lr.stillUnlinked} unlinked (${lr.durationMs}ms)`);
    } catch (err) {
      console.error(`[Linker] Post-sync failed:`, err instanceof Error ? err.message : err);
    }
  }

  if (conversationSynced || linkerRelevant) {
    classifyAndUpdateInternalStatus(workspaceId)
      .then(stats => {
        console.log(`[InternalFilter] Post-sync: ${stats.classified} classified, ${stats.markedInternal} internal (${stats.durationMs}ms)`);
      })
      .catch(err => console.error(`[InternalFilter] Post-sync failed:`, err instanceof Error ? err.message : err));
  }

  if (conversationSynced) {
    extractInsightsFromConversations(workspaceId)
      .then(result => {
        console.log(`[Insights] Post-sync ${workspaceId}: ${result.extracted} created, ${result.skipped} skipped (${result.processed} conversations)`);
      })
      .catch(err => {
        console.error(`[Insights] Post-sync ${workspaceId} failed:`, err instanceof Error ? err.message : err);
      });

    // Signal extraction runs 5s after sync to let the linker finish first
    // (signals benefit from deal/account links being present)
    setTimeout(() => {
      extractConversationSignals(workspaceId)
        .then(result => {
          console.log(`[SignalExtractor] Post-sync ${workspaceId}: ${result.extracted} extracted, ${result.skipped} skipped (${result.duration_ms}ms)`);
        })
        .catch(err => {
          console.error(`[SignalExtractor] Post-sync ${workspaceId} failed:`, err instanceof Error ? err.message : err);
        });
    }, 5000);
  }

  const crmSynced = connectorTypes.some(c => ['hubspot', 'salesforce'].includes(c));
  if (crmSynced) {
    triggerEnrichmentForNewlyClosedDeals(workspaceId).catch(err => {
      console.error(`[Enrichment] Post-sync trigger failed:`, err instanceof Error ? err.message : err);
    });
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

async function triggerEnrichmentForNewlyClosedDeals(workspaceId: string): Promise<void> {
  const config = await getEnrichmentConfig(workspaceId);
  if (!config.autoEnrichOnClose) {
    console.log('[Enrichment] Auto-enrich disabled for workspace', workspaceId);
    return;
  }

  if (!config.apolloApiKey && !config.serperApiKey) {
    console.log('[Enrichment] No enrichment API keys configured, skipping');
    return;
  }

  const recentlyClosedResult = await query(`
    SELECT d.id, d.name FROM deals d
    WHERE d.workspace_id = $1
      AND d.stage_normalized IN ('closed_won', 'closed_lost')
      AND d.updated_at > NOW() - INTERVAL '1 day'
      AND NOT EXISTS (
        SELECT 1 FROM deal_contacts dc
        WHERE dc.deal_id = d.id AND dc.workspace_id = d.workspace_id
          AND dc.enrichment_status = 'enriched'
          AND dc.buying_role IS NOT NULL
          AND dc.apollo_data IS NOT NULL
      )
    ORDER BY d.updated_at DESC
    LIMIT 10
  `, [workspaceId]);

  if (recentlyClosedResult.rows.length === 0) {
    console.log('[Enrichment] No newly closed deals to enrich');
    return;
  }

  console.log(`[Enrichment] Found ${recentlyClosedResult.rows.length} newly closed deals to enrich`);

  for (const deal of recentlyClosedResult.rows) {
    try {
      const result = await enrichClosedDeal(workspaceId, deal.id);
      console.log(`[Enrichment] Enriched "${deal.name}": ${result.contactResolution.rolesResolved} roles, ${result.apolloEnrichment.enrichedCount} contacts, ${result.accountSignals.signalCount} signals (${result.durationMs}ms)`);
    } catch (err) {
      console.error(`[Enrichment] Failed to enrich deal "${deal.name}":`, err instanceof Error ? err.message : err);
    }
  }
}
