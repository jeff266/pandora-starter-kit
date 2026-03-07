import { query } from '../db.js';

export interface FireworksFineTuneRecord {
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
}

export interface DatasetAssemblyOptions {
  pairType: 'document_synthesis' | 'classification';
  qualityFilter: Array<'good' | 'needs_improvement' | 'poor'>;
  minEditDistance?: number;
  maxEditDistance?: number;
  workspaceIds?: string[];
  trainSplitPct: number;
  deduplicateThreshold: number;
}

export interface DatasetStats {
  totalCount: number;
  trainCount: number;
  valCount: number;
  byQuality: Record<string, number>;
  byTemplate?: Record<string, number>;
  bySection?: Record<string, number>;
  deduplicatedCount: number;
}

/**
 * Assembles a dataset for Fireworks fine-tuning from document_training_pairs.
 */
export async function assembleDataset(options: DatasetAssemblyOptions): Promise<{
  train: FireworksFineTuneRecord[];
  val: FireworksFineTuneRecord[];
  stats: DatasetStats;
}> {
  const {
    pairType,
    qualityFilter,
    minEditDistance = 0,
    maxEditDistance = 1.0,
    workspaceIds,
    trainSplitPct = 0.9,
    deduplicateThreshold = 0.95,
  } = options;

  // Build query
  let sql = `
    SELECT * FROM document_training_pairs 
    WHERE pair_type = $1 
    AND quality_label != 'poor'
    AND quality_label = ANY($2)
    AND edit_distance >= $3
    AND edit_distance <= $4
  `;
  const params: any[] = [pairType, qualityFilter, minEditDistance, maxEditDistance];

  if (workspaceIds && workspaceIds.length > 0) {
    sql += ` AND workspace_id = ANY($${params.length + 1})`;
    params.push(workspaceIds);
  }

  const result = await query(sql, params);
  const rawPairs = result.rows;

  // Deduplicate
  const deduplicatedPairs = deduplicatePairs(rawPairs, deduplicateThreshold);

  // Convert to Fireworks format
  const records = deduplicatedPairs.map(pair => convertToFineTuneFormat(pair, pairType));

  // Shuffle
  const shuffled = records.sort(() => Math.random() - 0.5);

  // Split
  const splitIdx = Math.floor(shuffled.length * trainSplitPct);
  const train = shuffled.slice(0, splitIdx);
  const val = shuffled.slice(splitIdx);

  // Stats
  const stats: DatasetStats = {
    totalCount: rawPairs.length,
    deduplicatedCount: deduplicatedPairs.length,
    trainCount: train.length,
    valCount: val.length,
    byQuality: countByQuality(deduplicatedPairs),
  };

  if (pairType === 'document_synthesis') {
    stats.byTemplate = countByTemplate(deduplicatedPairs);
    stats.bySection = countBySection(deduplicatedPairs);
  }

  return { train, val, stats };
}

/**
 * Converts a training pair record to Fireworks messages format.
 */
function convertToFineTuneFormat(pair: any, pairType: string): FireworksFineTuneRecord {
  if (pairType === 'document_synthesis') {
    return {
      messages: [
        { role: 'system', content: pair.system_prompt_at_time || '' },
        { role: 'user', content: pair.raw_output || '' },
        { role: 'assistant', content: pair.corrected_output || '' }
      ]
    };
  } else {
    // For classification, the system prompt usually contains the user message or context
    // We try to extract a clean user message or just use the system prompt as context
    const userMessage = extractUserMessageFromPrompt(pair.system_prompt_at_time);
    return {
      messages: [
        { role: 'system', content: 'You are an intent classifier for a sales assistant.' },
        { role: 'user', content: userMessage || pair.system_prompt_at_time || '' },
        { role: 'assistant', content: pair.corrected_output || '' }
      ]
    };
  }
}

/**
 * Deduplicates pairs based on first 200 characters of raw input.
 * Keeps the one with the higher quality score if duplicates found.
 */
function deduplicatePairs(pairs: any[], threshold: number): any[] {
  const seen = new Map<string, any>();

  for (const pair of pairs) {
    const key = (pair.raw_output || pair.system_prompt_at_time || '').substring(0, 200);
    if (!seen.has(key)) {
      seen.set(key, pair);
    } else {
      const existing = seen.get(key);
      if (qualityScore(pair) > qualityScore(existing)) {
        seen.set(key, pair);
      }
    }
  }

  return Array.from(seen.values());
}

/**
 * Assigns a numeric score to quality labels for comparison.
 */
function qualityScore(pair: any): number {
  switch (pair.quality_label) {
    case 'good': return 3;
    case 'needs_improvement': return 2;
    case 'poor': return 1;
    default: return 0;
  }
}

/**
 * Helper to extract user message from a complex system prompt string if possible.
 */
function extractUserMessageFromPrompt(systemPrompt: string): string {
  if (!systemPrompt) return '';
  // Common pattern in orchestrator: "User said: '...'"
  const match = systemPrompt.match(/User said: ['"](.*)['"]/i);
  if (match) return match[1];
  return systemPrompt;
}

function countByQuality(pairs: any[]): Record<string, number> {
  return pairs.reduce((acc, p) => {
    acc[p.quality_label] = (acc[p.quality_label] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
}

function countByTemplate(pairs: any[]): Record<string, number> {
  return pairs.reduce((acc, p) => {
    if (p.template_type) {
      acc[p.template_type] = (acc[p.template_type] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);
}

function countBySection(pairs: any[]): Record<string, number> {
  return pairs.reduce((acc, p) => {
    if (p.section_id) {
      acc[p.section_id] = (acc[p.section_id] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);
}
