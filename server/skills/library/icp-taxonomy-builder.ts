/**
 * ICP Taxonomy Builder Skill
 *
 * Three-phase pattern (COMPUTE → CLASSIFY → SYNTHESIZE)
 *
 * Enriches ICP Discovery with web signal intelligence to build actionable taxonomies:
 * - Vertical detection (healthcare, industrial, software, generic)
 * - Top 50 won accounts enriched with Serper news/signals
 * - DeepSeek classification of account patterns (batched)
 * - Claude synthesis into structured JSON taxonomy (grounded in classification data)
 *
 * Token Budget: < 12K tokens total
 * - Phase 1 (COMPUTE): 0 tokens - SQL aggregation only
 * - Phase 2 (COMPUTE): 0 tokens - Serper enrichment + compression
 * - Phase 3 (COMPUTE+DeepSeek): ~3.6K tokens - Batched classification
 * - Phase 4 (COMPUTE+Claude): ~4.5K tokens - Grounded synthesis
 *
 * Scheduling:
 * - Monthly on 1st of month at 3am
 * - Minimum 10 won deals required
 * - Scope-aware: runs per confirmed scope
 *
 * Cost control:
 * - Top 50 accounts only (Serper API cost limit)
 * - Serper: ~$0.05 per 50 searches
 * - DeepSeek: ~$0.07 per run (4 batches)
 * - Claude: ~$0.15 per run
 * - Total: ~$0.27 per scope per month
 */

import type { SkillDefinition } from '../types.js';

export const icpTaxonomyBuilderSkill: SkillDefinition = {
  id: 'icp-taxonomy-builder',
  name: 'ICP Taxonomy Builder',
  description: 'Monthly enrichment of ICP insights with web signals to detect vertical patterns and build targeting taxonomies',
  version: '1.1.0',
  category: 'intelligence',
  tier: 'mixed',
  slackTemplate: 'icp-taxonomy',

  requiredTools: ['buildICPTaxonomy', 'enrichTopAccounts', 'compressForClassification', 'classifyAccountPatterns', 'synthesizeTaxonomy', 'persistTaxonomy'],
  requiredContext: [],

  steps: [
    {
      id: 'build-taxonomy-foundation',
      name: 'Build Taxonomy Foundation (COMPUTE Phase 1)',
      tier: 'compute',
      computeFn: 'buildICPTaxonomy',
      computeArgs: {},
      outputKey: 'taxonomy_foundation',
    },

    {
      id: 'enrich-top-accounts',
      name: 'Enrich Top Accounts with Web Signals (COMPUTE Phase 2)',
      tier: 'compute',
      dependsOn: ['build-taxonomy-foundation'],
      computeFn: 'enrichTopAccounts',
      computeArgs: {},
      outputKey: 'enriched_accounts',
    },

    {
      id: 'compress-for-classification',
      name: 'Compress Enriched Data for DeepSeek (COMPUTE Phase 2B)',
      tier: 'compute',
      dependsOn: ['enrich-top-accounts'],
      computeFn: 'compressForClassification',
      computeArgs: {},
      outputKey: 'compressed_accounts',
    },

    {
      id: 'classify-account-patterns',
      name: 'Classify Account Patterns in Batches (COMPUTE + DeepSeek)',
      tier: 'compute',
      dependsOn: ['compress-for-classification'],
      computeFn: 'classifyAccountPatterns',
      computeArgs: {},
      outputKey: 'account_classifications',
    },

    {
      id: 'synthesize-taxonomy',
      name: 'Synthesize ICP Taxonomy (COMPUTE + Claude)',
      tier: 'compute',
      dependsOn: ['build-taxonomy-foundation', 'enrich-top-accounts', 'classify-account-patterns'],
      computeFn: 'synthesizeTaxonomy',
      computeArgs: {},
      outputKey: 'taxonomy_report',
    },

    {
      id: 'persist-taxonomy',
      name: 'Persist Taxonomy to Database',
      tier: 'compute',
      dependsOn: ['synthesize-taxonomy'],
      computeFn: 'persistTaxonomy',
      computeArgs: {},
      outputKey: 'persist_result',
    },
  ],

  schedule: {
    cron: '0 3 1 * *', // Monthly on 1st at 3am
    trigger: ['on_demand', 'post_icp_discovery'],
  },

  outputFormat: 'slack',
  estimatedDuration: '120s',

  evidenceSchema: {
    entity_type: 'account',
    columns: [
      { key: 'account_name', display: 'Account Name', format: 'text' },
      { key: 'industry', display: 'Industry', format: 'text' },
      { key: 'employee_count', display: 'Size', format: 'number' },
      { key: 'amount', display: 'Deal Amount', format: 'currency' },
      { key: 'vertical_pattern', display: 'Vertical Pattern', format: 'text' },
      { key: 'buying_signals', display: 'Buying Signals', format: 'text' },
      { key: 'company_maturity', display: 'Maturity', format: 'text' },
      { key: 'use_case_archetype', display: 'Use Case', format: 'text' },
      { key: 'confidence', display: 'Classification Confidence', format: 'percentage' },
    ],
  },
};
