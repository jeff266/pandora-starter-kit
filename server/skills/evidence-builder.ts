/**
 * Evidence Builder Utility
 *
 * Shared utility that assembles structured evidence from skill compute/classify outputs.
 * Used by the skill runtime to populate SkillResult.evidence after step execution.
 *
 * Design: Evidence is assembled from step results using per-skill builder functions
 * registered in the evidence registry. Each skill defines how to map its compute
 * outputs into claims, evaluated_records, data_sources, and parameters.
 */

import type {
  SkillEvidence,
  EvidenceClaim,
  EvaluatedRecord,
  DataSourceContribution,
  SkillParameter,
} from './types.js';
import { query } from '../db.js';

// ============================================================================
// Evidence Builder (Fluent API)
// ============================================================================

export class EvidenceBuilder {
  private claims: EvidenceClaim[] = [];
  private records: EvaluatedRecord[] = [];
  private dataSources: DataSourceContribution[] = [];
  private parameters: SkillParameter[] = [];

  addClaim(claim: EvidenceClaim): this {
    this.claims.push(claim);
    return this;
  }

  addRecords(records: EvaluatedRecord[]): this {
    this.records.push(...records);
    return this;
  }

  addRecord(record: EvaluatedRecord): this {
    this.records.push(record);
    return this;
  }

  addDataSource(source: DataSourceContribution): this {
    this.dataSources.push(source);
    return this;
  }

  addParameter(param: SkillParameter): this {
    this.parameters.push(param);
    return this;
  }

  build(): SkillEvidence {
    return {
      claims: this.claims,
      evaluated_records: this.records,
      data_sources: this.dataSources,
      parameters: this.parameters,
    };
  }
}

// ============================================================================
// Data Source Helper
// ============================================================================

/**
 * Build data source contributions from workspace connector state.
 * Queries which connectors are active and includes disconnected sources
 * so users see exactly what Pandora couldn't see.
 */
export async function buildDataSources(
  workspaceId: string,
  relevantSources: string[]
): Promise<DataSourceContribution[]> {
  const sources: DataSourceContribution[] = [];

  try {
    const connResult = await query<{
      connector_name: string;
      last_sync_at: string | null;
      status: string;
    }>(
      `SELECT connector_name, last_sync_at, status
       FROM connections
       WHERE workspace_id = $1`,
      [workspaceId]
    );

    const connMap = new Map<string, { last_sync_at: string | null; status: string }>();
    for (const row of connResult.rows) {
      connMap.set(row.connector_name, {
        last_sync_at: row.last_sync_at,
        status: row.status,
      });
    }

    // Also check for file imports
    const importResult = await query<{ created_at: string }>(
      `SELECT created_at FROM import_batches
       WHERE workspace_id = $1 AND status = 'applied'
       ORDER BY created_at DESC LIMIT 1`,
      [workspaceId]
    );

    for (const sourceName of relevantSources) {
      const conn = connMap.get(sourceName);

      if (conn && (conn.status === 'active' || conn.status === 'healthy')) {
        // Get record counts for connected sources
        let recordCount = 0;
        try {
          if (sourceName === 'hubspot' || sourceName === 'salesforce') {
            const countResult = await query<{ count: string }>(
              `SELECT COUNT(*) as count FROM deals WHERE workspace_id = $1`,
              [workspaceId]
            );
            recordCount = parseInt(countResult.rows[0]?.count || '0', 10);
          } else if (sourceName === 'gong' || sourceName === 'fireflies') {
            const countResult = await query<{ count: string }>(
              `SELECT COUNT(*) as count FROM conversations WHERE workspace_id = $1 AND source = $2`,
              [workspaceId, sourceName]
            );
            recordCount = parseInt(countResult.rows[0]?.count || '0', 10);
          }
        } catch {
          // Table may not exist for some sources
        }

        sources.push({
          source: sourceName,
          connected: true,
          last_sync: conn.last_sync_at,
          records_available: recordCount,
          records_used: recordCount,
        });
      } else {
        // Not connected — include so users see what's missing
        const noteMap: Record<string, string> = {
          hubspot: 'Not connected — CRM deal data incomplete',
          salesforce: 'Not connected — CRM deal data incomplete',
          gong: 'Not connected — call transcript data unavailable',
          fireflies: 'Not connected — call transcript data unavailable',
        };

        sources.push({
          source: sourceName,
          connected: false,
          last_sync: null,
          records_available: 0,
          records_used: 0,
          note: noteMap[sourceName] || `Not connected`,
        });
      }
    }

    // If no CRM connectors but file import exists, add file import source
    const hasCRM = relevantSources.some(s =>
      (s === 'hubspot' || s === 'salesforce') && connMap.has(s)
    );
    if (!hasCRM && importResult.rows.length > 0) {
      const dealCount = await query<{ count: string }>(
        `SELECT COUNT(*) as count FROM deals WHERE workspace_id = $1`,
        [workspaceId]
      );
      sources.push({
        source: 'file_import',
        connected: true,
        last_sync: importResult.rows[0].created_at,
        records_available: parseInt(dealCount.rows[0]?.count || '0', 10),
        records_used: parseInt(dealCount.rows[0]?.count || '0', 10),
        note: 'Data from CSV/Excel import',
      });
    }
  } catch {
    // If connections table doesn't exist yet, return empty
  }

  return sources;
}

// ============================================================================
// Evidence Builder Registry
//
// Each skill registers a function that builds evidence from its step results.
// The skill runtime calls the registered builder after all steps complete.
// ============================================================================

export type EvidenceBuilderFn = (
  stepResults: Record<string, any>,
  workspaceId: string,
  businessContext: Record<string, any>
) => Promise<SkillEvidence>;

const evidenceBuilderRegistry = new Map<string, EvidenceBuilderFn>();

export function registerEvidenceBuilder(skillId: string, builder: EvidenceBuilderFn): void {
  evidenceBuilderRegistry.set(skillId, builder);
}

export function getEvidenceBuilder(skillId: string): EvidenceBuilderFn | undefined {
  return evidenceBuilderRegistry.get(skillId);
}

// ============================================================================
// Helper: Convert deal-like objects to EvaluatedRecord
// ============================================================================

export function dealToRecord(
  deal: any,
  fields: Record<string, string | number | boolean | null>,
  flags: Record<string, string>,
  severity: 'critical' | 'warning' | 'healthy'
): EvaluatedRecord {
  return {
    entity_id: deal.id || deal.deal_id || deal.dealId || '',
    entity_type: 'deal',
    entity_name: deal.name || deal.deal_name || deal.dealName || 'Unnamed',
    owner_email: deal.owner_email || deal.ownerEmail || deal.owner || null,
    owner_name: deal.owner_name || deal.ownerName || deal.owner || null,
    fields,
    flags,
    severity,
  };
}

export function repToRecord(
  rep: any,
  fields: Record<string, string | number | boolean | null>,
  flags: Record<string, string>,
  severity: 'critical' | 'warning' | 'healthy'
): EvaluatedRecord {
  return {
    entity_id: rep.email || rep.rep_email || rep.owner || '',
    entity_type: 'deal' as any, // EvaluatedRecord type allows deal/contact/account/conversation - rep maps to deal owner
    entity_name: rep.name || rep.rep_name || rep.owner || 'Unknown',
    owner_email: rep.email || rep.rep_email || rep.owner || null,
    owner_name: rep.name || rep.rep_name || rep.owner || null,
    fields,
    flags,
    severity,
  };
}
