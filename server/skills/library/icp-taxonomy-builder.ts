/**
 * ICP Taxonomy Builder Skill
 *
 * Three-phase pattern (COMPUTE → CLASSIFY → SYNTHESIZE)
 *
 * Enriches ICP Discovery with web signal intelligence to build actionable taxonomies:
 * - Vertical detection (healthcare, industrial, software, generic)
 * - Top 50 won accounts enriched with Serper news/signals
 * - DeepSeek classification of account patterns
 * - Claude synthesis into targeting playbooks
 *
 * Token Budget: < 12K tokens total
 * - Phase 1 (COMPUTE): 0 tokens - SQL aggregation only
 * - Phase 2 (COMPUTE): 0 tokens - Serper enrichment + compression
 * - Phase 3 (CLASSIFY): ~3.6K tokens - DeepSeek classifies compressed accounts
 * - Phase 4 (SYNTHESIZE): ~4.5K tokens - Claude builds taxonomy report
 *
 * Scheduling:
 * - Monthly on 1st of month at 3am
 * - Minimum 10 won deals required
 * - Scope-aware: runs per confirmed scope
 *
 * Cost control:
 * - Top 50 accounts only (Serper API cost limit)
 * - Serper: ~$0.05 per 50 searches
 * - DeepSeek: ~$0.07 per run
 * - Claude: ~$0.15 per run
 * - Total: ~$0.27 per scope per month
 */

import type { SkillDefinition } from '../types.js';

// Handlebars templates - defined as const to avoid TypeScript template literal parsing
const DEEPSEEK_PROMPT = 'You are a B2B sales intelligence analyst classifying company patterns from closed deals and web signals.\n\nFor each account, classify:\n\n1. **vertical_pattern**: One of:\n   - "healthcare_provider" (hospitals, clinics, health systems)\n   - "healthcare_tech" (healthtech SaaS, medical devices)\n   - "industrial_manufacturing" (factories, production facilities)\n   - "industrial_services" (logistics, supply chain, field services)\n   - "software_b2b" (SaaS, enterprise software, dev tools)\n   - "software_consumer" (consumer apps, gaming, media)\n   - "professional_services" (consulting, agencies, financial services)\n   - "generic_b2b" (no clear vertical pattern)\n\n2. **buying_signals**: Array of detected signals (max 5):\n   - "expansion" (hiring, funding, new offices)\n   - "digital_transformation" (tech modernization initiatives)\n   - "regulatory_pressure" (compliance, new regulations)\n   - "leadership_change" (new exec team, M&A)\n   - "market_disruption" (competitive pressure, market shift)\n   - "cost_optimization" (efficiency, cost reduction)\n   - "revenue_growth" (growth initiatives, new markets)\n\n3. **company_maturity**: "early_stage" | "growth_stage" | "established" | "enterprise"\n\n4. **use_case_archetype**: Brief description of why they bought (1-2 sentences)\n\n5. **lookalike_indicators**: 3-5 characteristics that define similar prospects\n\n6. **confidence**: 0.0-1.0 (based on signal quality and industry clarity)\n\nACCOUNTS TO CLASSIFY:\n\n{{#each compressed_accounts.accounts}}\n## Account {{@index}}: {{this.name}}\n- Industry: {{this.industry}}\n- Size: {{this.employee_count}} employees\n- Deal Amount: ${{formatNumber this.amount}}\n- Web Signal: {{this.research_summary}}\n{{/each}}\n\nRespond with ONLY a JSON array:\n[\n  {\n    "account_id": "uuid",\n    "account_name": "string",\n    "vertical_pattern": "...",\n    "buying_signals": ["...", "..."],\n    "company_maturity": "...",\n    "use_case_archetype": "...",\n    "lookalike_indicators": ["...", "...", "..."],\n    "confidence": 0.85\n  }\n]';

const CLAUDE_PROMPT = 'You are a revenue intelligence strategist building an ICP Taxonomy from closed deal analysis and web signal intelligence.\n\n## FOUNDATION DATA (from ICP Discovery)\n\n**Won Deals Analyzed:** {{taxonomy_foundation.won_count}}\n**Scope:** {{taxonomy_foundation.scope_name}}\n**Minimum Threshold:** {{taxonomy_foundation.min_threshold}} won deals required ({{#if taxonomy_foundation.meets_threshold}}✓ MET{{else}}✗ NOT MET{{/if}})\n\n**Top Industries:**\n{{#each taxonomy_foundation.top_industries}}\n- {{this.industry}}: {{this.count}} deals, {{multiply this.win_rate 100}}% win rate, avg ${{formatNumber this.avg_amount}}\n{{/each}}\n\n**Top Company Sizes:**\n{{#each taxonomy_foundation.top_sizes}}\n- {{this.size_bucket}}: {{this.count}} deals, {{multiply this.win_rate 100}}% win rate\n{{/each}}\n\n## WEB-ENRICHED ACCOUNTS (Top 50 by Amount)\n\nTotal accounts enriched: {{enriched_accounts.accounts_enriched}}\nSerper searches performed: {{enriched_accounts.serper_searches}}\nAccounts with signals: {{enriched_accounts.accounts_with_signals}}\n\n{{#each enriched_accounts.top_accounts}}\n### {{@index}}. {{this.name}} (${{formatNumber this.amount}})\n- Industry: {{this.industry}}\n- Size: {{this.employee_count}} employees\n- Signals: {{this.signals.length}} found\n{{/each}}\n\n## DEEPSEEK CLASSIFICATIONS\n\nVertical distribution:\n{{#each account_classifications}}\n- {{this.vertical_pattern}}: {{this.account_name}} (confidence: {{this.confidence}})\n{{/each}}\n\nCommon buying signals:\n{{#each (groupBy account_classifications "buying_signals")}}\n- {{@key}}: {{this.length}} accounts\n{{/each}}\n\nMaturity distribution:\n{{#each (groupBy account_classifications "company_maturity")}}\n- {{@key}}: {{this.length}} accounts\n{{/each}}\n\n## YOUR TASK\n\nBuild a comprehensive ICP Taxonomy Report with these sections:\n\n### 1. Vertical Classification (100-150 words)\nClassify this company\'s ICP into ONE primary vertical:\n- **Healthcare** (healthcare_provider OR healthcare_tech dominates)\n- **Industrial** (industrial_manufacturing OR industrial_services dominates)\n- **Software** (software_b2b OR software_consumer dominates)\n- **Generic B2B** (no clear vertical pattern OR professional_services)\n\nState the vertical clearly in the first sentence. Explain the reasoning based on:\n- Industry distribution from foundation data\n- Vertical patterns from classifications\n- Signal clustering\n\n### 2. Ideal Customer Archetypes (200-250 words)\nFor each distinct archetype (3-5 archetypes):\n- Archetype name (e.g., "Regional Health System Modernizer")\n- Company profile (size, maturity, industry characteristics)\n- Typical buying signals (what triggers the purchase?)\n- Use case pattern (why they buy, what problem they solve)\n- Example companies (2-3 from the classified accounts)\n\n### 3. Lookalike Targeting Criteria (150-200 words)\nSynthesize lookalike indicators into actionable targeting rules:\n- Firmographic filters (industry, size, revenue, growth rate)\n- Technographic signals (if mentioned in indicators)\n- Behavioral triggers (web signals that indicate readiness)\n- Negative filters (patterns that correlate with lost deals)\n\n### 4. Go-to-Market Implications (100-150 words)\nStrategic recommendations:\n- Should marketing focus on a specific vertical or stay horizontal?\n- What content/messaging themes resonate? (based on use cases + signals)\n- Which buying signals should SDRs prioritize for outreach timing?\n- Any coverage gaps or expansion opportunities?\n\n## RULES\n\n- Be specific with numbers: cite deal counts, percentages, dollar amounts\n- Use real company names from the data when illustrating archetypes\n- If taxonomy_foundation.meets_threshold is false, note data limitations but still provide best-effort insights\n- If no clear vertical pattern emerges, say "Generic B2B" and explain horizontal targeting strategy\n- Total response: 600-800 words (fit in Slack message)\n\n{{voiceBlock}}';

export const icpTaxonomyBuilderSkill: SkillDefinition = {
  id: 'icp-taxonomy-builder',
  name: 'ICP Taxonomy Builder',
  description: 'Monthly enrichment of ICP insights with web signals to detect vertical patterns and build targeting taxonomies',
  version: '1.0.0',
  category: 'intelligence',
  tier: 'mixed',
  slackTemplate: 'icp-taxonomy',

  requiredTools: ['buildICPTaxonomy', 'enrichTopAccounts', 'compressForClassification', 'classifyAccountPatterns', 'persistTaxonomy'],
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
      name: 'Classify Account Patterns (CLASSIFY)',
      tier: 'deepseek',
      dependsOn: ['compress-for-classification'],
      deepseekPrompt: DEEPSEEK_PROMPT,
      deepseekSchema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            account_id: { type: 'string' },
            account_name: { type: 'string' },
            vertical_pattern: {
              type: 'string',
              enum: [
                'healthcare_provider',
                'healthcare_tech',
                'industrial_manufacturing',
                'industrial_services',
                'software_b2b',
                'software_consumer',
                'professional_services',
                'generic_b2b',
              ],
            },
            buying_signals: {
              type: 'array',
              items: {
                type: 'string',
                enum: [
                  'expansion',
                  'digital_transformation',
                  'regulatory_pressure',
                  'leadership_change',
                  'market_disruption',
                  'cost_optimization',
                  'revenue_growth',
                ],
              },
              maxItems: 5,
            },
            company_maturity: {
              type: 'string',
              enum: ['early_stage', 'growth_stage', 'established', 'enterprise'],
            },
            use_case_archetype: { type: 'string' },
            lookalike_indicators: {
              type: 'array',
              items: { type: 'string' },
              minItems: 3,
              maxItems: 5,
            },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
          },
          required: [
            'account_id',
            'account_name',
            'vertical_pattern',
            'buying_signals',
            'company_maturity',
            'use_case_archetype',
            'lookalike_indicators',
            'confidence',
          ],
        },
      },
      outputKey: 'account_classifications',
      parseAs: 'json',
    },

    {
      id: 'synthesize-taxonomy',
      name: 'Synthesize ICP Taxonomy (SYNTHESIZE)',
      tier: 'claude',
      dependsOn: ['enrich-top-accounts', 'classify-account-patterns'],
      claudePrompt: CLAUDE_PROMPT,
      outputKey: 'taxonomy_report',
      parseAs: 'markdown',
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
