/**
 * Conversation Intelligence Demo
 *
 * Demonstrates conversation intelligence features with mock data.
 * Run this to see the full pipeline in action without requiring:
 * - Real conversation data in DB
 * - ICP Discovery skill
 * - LLM API calls
 *
 * Usage:
 *   npx tsx server/analysis/conversation-intelligence-demo.ts
 */

import {
  generateMockConversationMetadata,
  generateMockTranscriptExcerpts,
  type ConversationFeatures,
  type ConversationCoverage,
} from './conversation-features.js';

import {
  generateMockClassification,
  aggregateClassifications,
  type ConversationClassification,
} from './conversation-classifier.js';

import {
  buildConversationFeatureColumns,
  buildConversationFeatureMatrix,
  analyzeConversationFeatureImportance,
  shouldIncludeConversationFeatures,
  regularizeFeatureImportance,
  type ConversationFeatureColumns,
} from './conversation-feature-matrix.js';

// ============================================================================
// Demo: Single Deal Conversation Intelligence
// ============================================================================

function demoSingleDeal() {
  console.log('\n========================================');
  console.log('DEMO 1: Single Deal Conversation Intelligence');
  console.log('========================================\n');

  // Mock a deal with 3 conversations
  const dealId = 'deal-abc-123';
  const conversationIds = ['conv-1', 'conv-2', 'conv-3'];

  // Step 1: Generate mock metadata
  console.log('Step 1: Generating mock conversation metadata...');
  const metadata = generateMockConversationMetadata();
  console.log(`  Call count: ${metadata.call_count}`);
  console.log(`  Avg duration: ${metadata.avg_duration_minutes} minutes`);
  console.log(`  Avg sentiment: ${metadata.avg_sentiment_score?.toFixed(2)}`);
  console.log(`  Champion signals: ${metadata.unique_participants} participants`);

  // Step 2: Generate mock excerpts
  console.log('\nStep 2: Generating mock transcript excerpts...');
  const excerpts = generateMockTranscriptExcerpts(3);
  console.log(`  Excerpts generated: ${excerpts.length}`);
  console.log(`  Total estimated tokens: ${excerpts.reduce((sum, e) => sum + e.token_count, 0)}`);
  console.log(`\n  Sample excerpt (first 100 chars):`);
  console.log(`  "${excerpts[0].excerpt.substring(0, 100)}..."`);

  // Step 3: Generate mock classifications
  console.log('\nStep 3: Generating mock classifications...');
  const classifications: ConversationClassification[] = conversationIds.map(id =>
    generateMockClassification(id)
  );
  console.log(`  Classifications generated: ${classifications.length}`);
  console.log(`  Competitors found: ${classifications[0].competitors.length}`);
  console.log(`  Champion signals: ${classifications[0].champion_signals.length}`);
  console.log(`  Technical depth: ${classifications[0].technical_depth.depth_level}`);

  // Step 4: Aggregate classifications
  console.log('\nStep 4: Aggregating classifications...');
  const aggregated = aggregateClassifications(classifications);
  console.log(`  All competitors: ${aggregated.all_competitors.map(c => c.competitor_name).join(', ')}`);
  console.log(`  Champion signals: ${aggregated.all_champion_signals.length}`);
  console.log(`  Avg sentiment: ${aggregated.avg_sentiment_score}`);
  console.log(`  Overall engagement: ${aggregated.overall_engagement}`);
  console.log(`  Technical depth: ${aggregated.avg_technical_depth}`);

  // Step 5: Build conversation feature columns
  console.log('\nStep 5: Building conversation feature columns...');
  const conversationFeatures: ConversationFeatures = {
    deal_id: dealId,
    has_conversations: true,
    metadata,
    transcript_excerpts: excerpts,
  };

  const closeDate = new Date('2024-03-15');
  const featureColumns = buildConversationFeatureColumns(
    conversationFeatures,
    classifications,
    closeDate
  );

  console.log('  Feature columns built:');
  console.log(`    - has_conversation_data: ${featureColumns.has_conversation_data}`);
  console.log(`    - call_count: ${featureColumns.call_count}`);
  console.log(`    - avg_sentiment_score: ${featureColumns.avg_sentiment_score}`);
  console.log(`    - has_champion_signals: ${featureColumns.has_champion_signals}`);
  console.log(`    - champion_signal_count: ${featureColumns.champion_signal_count}`);
  console.log(`    - technical_depth_level: ${featureColumns.technical_depth_level}`);
  console.log(`    - buying_signal_count: ${featureColumns.buying_signal_count}`);
  console.log(`    - competitors_discussed: ${featureColumns.competitors_discussed.join(', ')}`);

  console.log('\n✅ Single deal conversation intelligence complete!');
}

// ============================================================================
// Demo: Batch Feature Matrix Building
// ============================================================================

function demoBatchFeatureMatrix() {
  console.log('\n========================================');
  console.log('DEMO 2: Batch Feature Matrix Building');
  console.log('========================================\n');

  // Mock 5 closed deals
  const dealIds = ['deal-1', 'deal-2', 'deal-3', 'deal-4', 'deal-5'];

  console.log(`Processing ${dealIds.length} closed deals...\n`);

  // Generate features for each deal
  const dealsFeatures: ConversationFeatures[] = dealIds.map(dealId => ({
    deal_id: dealId,
    has_conversations: Math.random() > 0.2, // 80% have conversations
    metadata: generateMockConversationMetadata(),
    transcript_excerpts: generateMockTranscriptExcerpts(Math.floor(Math.random() * 3) + 1),
  }));

  // Generate classifications for each deal
  const dealsClassifications = new Map<string, ConversationClassification[]>();
  for (const dealFeature of dealsFeatures) {
    if (dealFeature.has_conversations) {
      const classifications = dealFeature.transcript_excerpts.map(excerpt =>
        generateMockClassification(excerpt.conversation_id)
      );
      dealsClassifications.set(dealFeature.deal_id, classifications);
    }
  }

  // Mock close dates
  const dealCloseDates = new Map<string, Date>(
    dealIds.map((id, idx) => [id, new Date(2024, 2, 10 + idx)])
  );

  // Build feature matrix
  console.log('Building conversation feature matrix...');
  const featureMatrix = buildConversationFeatureMatrix(
    dealsFeatures,
    dealsClassifications,
    dealCloseDates
  );

  // Display results
  console.log(`\nFeature matrix built for ${featureMatrix.size} deals:\n`);

  let dealsWithData = 0;
  for (const [dealId, features] of featureMatrix) {
    if (features.has_conversation_data) {
      dealsWithData++;
      console.log(`  ${dealId}:`);
      console.log(`    Calls: ${features.call_count}`);
      console.log(`    Sentiment: ${features.avg_sentiment_score?.toFixed(2) || 'N/A'}`);
      console.log(`    Champions: ${features.champion_signal_count}`);
      console.log(`    Buying signals: ${features.buying_signal_count}`);
    } else {
      console.log(`  ${dealId}: No conversation data (Tier 0)`);
    }
  }

  const coveragePercent = Math.round((dealsWithData / dealIds.length) * 100);
  console.log(`\nCoverage: ${dealsWithData}/${dealIds.length} deals (${coveragePercent}%)`);
  console.log('✅ Batch feature matrix complete!');
}

// ============================================================================
// Demo: Feature Importance Analysis
// ============================================================================

function demoFeatureImportance() {
  console.log('\n========================================');
  console.log('DEMO 3: Feature Importance Analysis');
  console.log('========================================\n');

  // Generate mock won/lost deals
  const wonCount = 20;
  const lostCount = 15;

  console.log(`Analyzing ${wonCount} won deals vs ${lostCount} lost deals...\n`);

  // Mock won deals (higher engagement, more champions, better sentiment)
  const wonDeals: ConversationFeatureColumns[] = Array.from({ length: wonCount }, () => {
    const baseFeatures = buildConversationFeatureColumns(
      {
        deal_id: 'mock-won',
        has_conversations: true,
        metadata: generateMockConversationMetadata(),
        transcript_excerpts: generateMockTranscriptExcerpts(3),
      },
      [generateMockClassification('mock-1'), generateMockClassification('mock-2')],
      new Date()
    );

    // Boost won deal features
    return {
      ...baseFeatures,
      call_count: baseFeatures.call_count + Math.floor(Math.random() * 3),
      champion_signal_count: baseFeatures.champion_signal_count + Math.floor(Math.random() * 2),
      avg_sentiment_score: Math.min(1, (baseFeatures.avg_sentiment_score || 0) + 0.2),
      buying_signal_count: baseFeatures.buying_signal_count + Math.floor(Math.random() * 3),
    };
  });

  // Mock lost deals (lower engagement, fewer champions)
  const lostDeals: ConversationFeatureColumns[] = Array.from({ length: lostCount }, () => {
    const baseFeatures = buildConversationFeatureColumns(
      {
        deal_id: 'mock-lost',
        has_conversations: true,
        metadata: generateMockConversationMetadata(),
        transcript_excerpts: generateMockTranscriptExcerpts(2),
      },
      [generateMockClassification('mock-1')],
      new Date()
    );

    // Reduce lost deal features
    return {
      ...baseFeatures,
      call_count: Math.max(1, baseFeatures.call_count - 1),
      champion_signal_count: Math.max(0, baseFeatures.champion_signal_count - 1),
      avg_sentiment_score: Math.max(-1, (baseFeatures.avg_sentiment_score || 0) - 0.3),
      buying_signal_count: Math.max(0, baseFeatures.buying_signal_count - 2),
    };
  });

  // Analyze importance
  console.log('Analyzing feature importance...\n');
  const importance = analyzeConversationFeatureImportance(wonDeals, lostDeals);

  // Show top features
  console.log('Top 10 most important conversation features:\n');
  const topFeatures = importance
    .filter(f => f.statistical_significance !== 'low')
    .slice(0, 10);

  for (let i = 0; i < topFeatures.length; i++) {
    const f = topFeatures[i];
    const direction = f.delta > 0 ? '↑' : '↓';
    console.log(`${i + 1}. ${f.feature_name}`);
    console.log(`   Won avg: ${f.won_avg.toFixed(2)} | Lost avg: ${f.lost_avg.toFixed(2)} | Δ${f.delta.toFixed(2)} ${direction}`);
    console.log(`   Importance: ${f.importance_score.toFixed(2)} | Significance: ${f.statistical_significance}`);
    console.log('');
  }

  console.log('✅ Feature importance analysis complete!');
}

// ============================================================================
// Demo: Graceful Degradation (Tier-Based)
// ============================================================================

function demoGracefulDegradation() {
  console.log('\n========================================');
  console.log('DEMO 4: Graceful Degradation Tiers');
  console.log('========================================\n');

  // Mock different coverage scenarios
  const scenarios: Array<{ tier: 0 | 1 | 2 | 3; coveragePercent: number; label: string }> = [
    { tier: 0, coveragePercent: 0, label: 'none' },
    { tier: 1, coveragePercent: 15, label: 'sparse' },
    { tier: 2, coveragePercent: 50, label: 'moderate' },
    { tier: 3, coveragePercent: 85, label: 'strong' },
  ];

  console.log('Coverage tier scenarios:\n');

  for (const scenario of scenarios) {
    const { include, weight, reason } = shouldIncludeConversationFeatures(scenario.tier);

    console.log(`Tier ${scenario.tier} - ${scenario.label.toUpperCase()} (${scenario.coveragePercent}% coverage):`);
    console.log(`  Include in ICP: ${include ? 'Yes' : 'No'}`);
    console.log(`  Feature weight: ${weight}`);
    console.log(`  Reason: ${reason}`);
    console.log('');
  }

  // Show regularization example
  console.log('\nRegularization example:');
  console.log('(How feature importance is weighted by coverage tier)\n');

  const mockImportance = [
    {
      feature_name: 'champion_signal_count' as keyof ConversationFeatureColumns,
      importance_score: 0.75,
      won_avg: 3.5,
      lost_avg: 1.2,
      delta: 2.3,
      statistical_significance: 'high' as const,
    },
    {
      feature_name: 'buying_signal_count' as keyof ConversationFeatureColumns,
      importance_score: 0.65,
      won_avg: 5.8,
      lost_avg: 2.1,
      delta: 3.7,
      statistical_significance: 'high' as const,
    },
  ];

  for (const scenario of scenarios.slice(1)) {
    // Skip tier 0
    const regularized = regularizeFeatureImportance(mockImportance, scenario.tier);
    console.log(`Tier ${scenario.tier} (${scenario.label}) - weight ${shouldIncludeConversationFeatures(scenario.tier).weight}:`);

    for (const f of regularized) {
      console.log(`  ${f.feature_name}: ${f.importance_score.toFixed(3)} (was ${mockImportance.find(m => m.feature_name === f.feature_name)!.importance_score})`);
    }
    console.log('');
  }

  console.log('✅ Graceful degradation demo complete!');
}

// ============================================================================
// Main Demo Runner
// ============================================================================

function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('   CONVERSATION INTELLIGENCE FOR ICP DISCOVERY - DEMO');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('This demo shows conversation intelligence features using mock data.');
  console.log('No database or LLM API calls required.');
  console.log('');

  try {
    demoSingleDeal();
    demoBatchFeatureMatrix();
    demoFeatureImportance();
    demoGracefulDegradation();

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('   ALL DEMOS COMPLETE ✅');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Review conversation-features.ts for data extraction');
    console.log('  2. Review conversation-classifier.ts for DeepSeek classification');
    console.log('  3. Review conversation-feature-matrix.ts for ICP integration');
    console.log('  4. See CONVERSATION_INTELLIGENCE_README.md for full integration guide');
    console.log('');
  } catch (error) {
    console.error('\n❌ Demo failed:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main as runDemo };
