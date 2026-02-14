/**
 * Bowtie → Funnel Migration
 *
 * Converts existing bowtie_discovery data in context_layer to the new FunnelDefinition format.
 * Run this on server startup to ensure all workspaces have funnel definitions.
 */

import { query } from '../db.js';
import type { FunnelDefinition, FunnelStage } from '../types/funnel.js';
import { randomUUID } from 'crypto';

interface BowtieDiscoveryLegacy {
  hasBowtieStages: boolean;
  bowtieStages: Array<{
    rawStage: string;
    bowtieCategory: string;
    confidence: string;
    dealCount: number;
    totalValue: number;
  }>;
  preSaleStageCount: number;
  postSaleStageCount: number;
  postSaleDealCount: number;
  postSaleTotalValue: number;
  discoveredAt: string;
  status?: string;
  confirmed_at?: string;
}

/**
 * Migrate a single workspace's bowtie_discovery to funnel definition
 */
export async function migrateBowtieToFunnel(workspaceId: string): Promise<boolean> {
  try {
    // Check for existing bowtie_discovery
    const existingBowtie = await query<{ value: BowtieDiscoveryLegacy }>(
      `SELECT value FROM context_layer
       WHERE workspace_id = $1 AND category = 'definitions' AND key = 'bowtie_discovery'`,
      [workspaceId]
    );

    if (existingBowtie.rows.length === 0) {
      console.log(`[Migration] No bowtie_discovery found for workspace ${workspaceId}`);
      return false;
    }

    // Check if funnel definition already exists
    const existingFunnel = await query(
      `SELECT 1 FROM context_layer
       WHERE workspace_id = $1 AND category = 'definitions' AND key = 'funnel'`,
      [workspaceId]
    );

    if (existingFunnel.rows.length > 0) {
      console.log(`[Migration] Funnel already exists for workspace ${workspaceId}, skipping migration`);
      return false;
    }

    const bowtie = existingBowtie.rows[0].value;

    // Build funnel stages from bowtie data
    const stages: FunnelStage[] = [];
    let order = 1;

    // Map bowtie categories to funnel stages
    const categoryMap: Record<string, { label: string; side: 'pre_sale' | 'center' | 'post_sale' }> = {
      pre_sale: { label: 'Pre-Sale', side: 'pre_sale' },
      onboarding: { label: 'Onboarding', side: 'post_sale' },
      adoption: { label: 'Adoption', side: 'post_sale' },
      expansion: { label: 'Expansion', side: 'post_sale' },
      renewal: { label: 'Renewal', side: 'post_sale' },
      churned: { label: 'Churned', side: 'post_sale' },
    };

    // Process bowtie stages
    for (const bowtieStage of bowtie.bowtieStages || []) {
      const category = bowtieStage.bowtieCategory;
      const config = categoryMap[category];

      if (!config) continue;

      // Create stage ID from raw stage name (slugify)
      const stageId = bowtieStage.rawStage
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

      stages.push({
        id: stageId,
        label: bowtieStage.rawStage,
        side: config.side,
        order: order++,
        source: {
          object: 'deals',
          field: 'stage',
          values: [bowtieStage.rawStage],
        },
        description: `Migrated from bowtie_discovery (${category})`,
      });
    }

    // Add a "won" center stage if it doesn't exist
    const hasCenter = stages.some(s => s.side === 'center');
    if (!hasCenter) {
      stages.push({
        id: 'won',
        label: 'Closed Won',
        side: 'center',
        order: order++,
        source: {
          object: 'deals',
          field: 'stage_normalized',
          values: ['closed_won'],
        },
      });
    }

    // Ensure at least 2 pre-sale stages exist
    const preSaleCount = stages.filter(s => s.side === 'pre_sale').length;
    if (preSaleCount < 2) {
      // Add generic pre-sale stages
      stages.unshift({
        id: 'open',
        label: 'Open Opportunity',
        side: 'pre_sale',
        order: 1,
        source: {
          object: 'deals',
          field: 'stage_normalized',
          values: ['qualification', 'discovery', 'proposal', 'negotiation'],
        },
      });
    }

    // Renumber orders
    stages.forEach((s, i) => s.order = i + 1);

    // Create funnel definition
    const funnel: FunnelDefinition = {
      id: randomUUID(),
      workspace_id: workspaceId,
      model_type: 'classic_b2b',
      model_label: 'Classic B2B (migrated from bowtie)',
      stages,
      status: bowtie.status === 'confirmed' ? 'confirmed' : 'discovered',
      discovered_at: bowtie.discoveredAt ? new Date(bowtie.discoveredAt) : new Date(),
      confirmed_at: bowtie.confirmed_at ? new Date(bowtie.confirmed_at) : undefined,
      created_at: new Date(),
      updated_at: new Date(),
    };

    // Store funnel definition
    await query(
      `INSERT INTO context_layer (workspace_id, category, key, value, updated_at)
       VALUES ($1, 'definitions', 'funnel', $2::jsonb, NOW())`,
      [workspaceId, JSON.stringify(funnel)]
    );

    console.log(
      `[Migration] Migrated bowtie_discovery to funnel for workspace ${workspaceId} ` +
      `(${stages.length} stages, status: ${funnel.status})`
    );

    return true;
  } catch (error) {
    console.error(`[Migration] Failed to migrate workspace ${workspaceId}:`, error);
    return false;
  }
}

/**
 * Migrate all workspaces with bowtie_discovery data
 */
export async function migrateAllBowtiesToFunnel(): Promise<{ migrated: number; skipped: number; errors: number }> {
  console.log('[Migration] Starting bowtie → funnel migration for all workspaces...');

  try {
    // Find all workspaces with bowtie_discovery
    const workspaces = await query<{ workspace_id: string }>(
      `SELECT DISTINCT workspace_id FROM context_layer
       WHERE category = 'definitions' AND key = 'bowtie_discovery'`
    );

    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    for (const row of workspaces.rows) {
      try {
        const result = await migrateBowtieToFunnel(row.workspace_id);
        if (result) {
          migrated++;
        } else {
          skipped++;
        }
      } catch (error) {
        console.error(`[Migration] Error migrating workspace ${row.workspace_id}:`, error);
        errors++;
      }
    }

    console.log(
      `[Migration] Complete: ${migrated} migrated, ${skipped} skipped, ${errors} errors`
    );

    return { migrated, skipped, errors };
  } catch (error) {
    console.error('[Migration] Fatal error during migration:', error);
    return { migrated: 0, skipped: 0, errors: 1 };
  }
}
