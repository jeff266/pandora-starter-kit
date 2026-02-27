import { getSkillRegistry } from '../skills/registry.js';
import { getSkillRuntime } from '../skills/runtime.js';
import { linkConversations } from '../linker/entity-linker.js';
import { classifyAndUpdateInternalStatus } from '../analysis/conversation-internal-filter.js';
import { extractInsightsFromConversations } from '../analysis/deal-insights-extractor.js';
import { enrichClosedDeal } from '../enrichment/closed-deal-enrichment.js';
import { getEnrichmentConfig } from '../enrichment/config.js';
import { resolveConversationParticipants } from '../conversations/resolve-participants.js';
import { snapshotDealStateAtCall, checkPostCallFollowThrough } from '../conversations/post-call-tracker.js';
import { extractConversationSignals } from '../conversations/signal-extractor.js';
import { extractConversationSignals as extractStructuredSignals } from '../signals/extract-conversation-signals.js';
import { query } from '../db.js';
import { captureCurrentSchema, detectNewFields, insertNewFieldsFinding } from './field-detector.js';
import { discoverWinPatterns } from '../coaching/win-pattern-discovery.js';

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

      // Step 1: Resolve speaker identity on conversations
      resolveConversationParticipants(workspaceId)
        .then(result => {
          console.log(`[ParticipantResolver] Post-sync: ${result.processed} conversations, ${result.resolved_internal} internal, ${result.resolved_external} external (${result.duration_ms}ms)`);
        })
        .catch(err => {
          console.error(`[ParticipantResolver] Post-sync failed:`, err instanceof Error ? err.message : err);
        });

      // Step 2: Snapshot deal state for newly linked conversations
      snapshotDealStateAtCall(workspaceId)
        .then(count => {
          console.log(`[PostCallTracker] Post-sync: ${count} conversation snapshots created`);
        })
        .catch(err => {
          console.error(`[PostCallTracker] Post-sync snapshot failed:`, err instanceof Error ? err.message : err);
        });

      // Step 3: Check follow-through on older conversations (24h+)
      checkPostCallFollowThrough(workspaceId)
        .then(count => {
          console.log(`[PostCallTracker] Post-sync: ${count} conversations checked for follow-through`);
        })
        .catch(err => {
          console.error(`[PostCallTracker] Post-sync follow-through failed:`, err instanceof Error ? err.message : err);
        });
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
      // JSONB signal extraction (existing)
      extractConversationSignals(workspaceId)
        .then(result => {
          console.log(`[SignalExtractor] Post-sync ${workspaceId}: ${result.extracted} extracted, ${result.skipped} skipped (${result.duration_ms}ms)`);
        })
        .catch(err => {
          console.error(`[SignalExtractor] Post-sync ${workspaceId} failed:`, err instanceof Error ? err.message : err);
        });

      // Structured signal extraction (new - conversation_signals table)
      extractStructuredSignals(workspaceId)
        .then(result => {
          console.log(`[ConversationSignals] Post-sync ${workspaceId}: ${result.extracted} signals extracted from ${result.processed - result.skipped} conversations, ${result.skipped} skipped (${result.duration_ms}ms)`);
        })
        .catch(err => {
          console.error(`[ConversationSignals] Post-sync ${workspaceId} failed:`, err instanceof Error ? err.message : err);
        });
    }, 5000);
  }

  const crmSynced = connectorTypes.some(c => ['hubspot', 'salesforce'].includes(c));
  if (crmSynced) {
    setTimeout(() => {
      import('../computed-fields/engine.js').then(({ computeFields }) => {
        computeFields(workspaceId).then(result => {
          console.log(`[ComputedFields] Post-sync: ${result.deals.updated} deals, ${result.contacts.updated} contacts, ${result.accounts.updated} accounts updated`);
        }).catch(err => {
          console.error(`[ComputedFields] Post-sync failed:`, err instanceof Error ? err.message : err);
        });
      }).catch(() => {});
    }, 5000);

    // Recompute scoring state — closed_won count may have changed
    import('../scoring/workspace-scoring-state.js').then(({ recomputeScoringState }) => {
      recomputeScoringState(workspaceId).catch(err => {
        console.error(`[ScoringState] Post-sync recompute failed:`, err instanceof Error ? err.message : err);
      });
    }).catch(() => {});

    triggerEnrichmentForNewlyClosedDeals(workspaceId).catch(err => {
      console.error(`[Enrichment] Post-sync trigger failed:`, err instanceof Error ? err.message : err);
    });

    // Win pattern discovery - check if we should run
    maybeRunPatternDiscovery(workspaceId).catch(err => {
      console.error(`[Coaching] Pattern discovery check failed:`, err instanceof Error ? err.message : err);
    });

    // Field detection — cheap SQL diff, runs after every CRM sync
    for (const connectorType of connectorTypes.filter(c => ['hubspot', 'salesforce'].includes(c))) {
      (async () => {
        try {
          const currentSchema = await captureCurrentSchema(workspaceId, connectorType);
          const result = await detectNewFields(workspaceId, connectorType, currentSchema);
          if (result.hasNewFields) {
            await insertNewFieldsFinding(workspaceId, connectorType, result.newFields);
          }
        } catch (err) {
          console.error(`[FieldDetector] Error during field detection for ${workspaceId}/${connectorType}:`, err instanceof Error ? err.message : err);
        }
      })();
    }
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

/**
 * Check if win pattern discovery should run
 * Runs when: 7+ days since last run, OR 5+ new closed deals, OR never run before
 */
async function maybeRunPatternDiscovery(workspaceId: string): Promise<void> {
  // Check when discovery last ran
  const lastRunResult = await query<{ last_discovery: string | null }>(
    `SELECT MAX(discovered_at) as last_discovery
     FROM win_patterns
     WHERE workspace_id = $1`,
    [workspaceId]
  );

  const lastDiscovery = lastRunResult.rows[0]?.last_discovery;
  const daysSinceLastRun = lastDiscovery
    ? daysBetween(new Date(lastDiscovery), new Date())
    : Infinity;

  // Check new closed deals since last run
  const newClosedResult = await query<{ n: number }>(
    `SELECT COUNT(*)::integer as n
     FROM deals
     WHERE workspace_id = $1
       AND stage_normalized IN ('closed_won', 'closed_lost')
       AND updated_at > COALESCE(
         (SELECT MAX(discovered_at) FROM win_patterns WHERE workspace_id = $1),
         '1970-01-01'::timestamptz
       )`,
    [workspaceId]
  );

  const newClosedCount = newClosedResult.rows[0]?.n || 0;

  const shouldRun =
    daysSinceLastRun >= 7 || // Weekly minimum
    (daysSinceLastRun >= 1 && newClosedCount >= 5) || // 5+ new closes
    daysSinceLastRun === Infinity; // Never run before

  if (!shouldRun) {
    console.log(
      `[Coaching] Pattern discovery not needed (${daysSinceLastRun} days since last run, ${newClosedCount} new closed deals)`
    );
    return;
  }

  console.log(`[Coaching] Running win pattern discovery for workspace ${workspaceId}`);
  const result = await discoverWinPatterns(workspaceId);
  console.log(
    `[Coaching] Discovery complete: ${result.patterns_found.length} patterns found across ${result.segments_analyzed} segments (${result.won_deals} won, ${result.lost_deals} lost)`
  );
}

function daysBetween(date1: Date, date2: Date): number {
  const diffMs = Math.abs(date2.getTime() - date1.getTime());
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}
