# Conversation Intelligence for ICP Discovery

## Overview

This module adds behavioral signals from Gong/Fireflies sales conversations to ICP Discovery, transforming it from a firmographic pattern engine to a behavioral pattern engine.

**Status:** ✅ Core infrastructure complete (Sub-steps A-D of Step 2.5)
**Spec:** `PANDORA_ICP_CONVERSATION_INTELLIGENCE_ADDENDUM.md`
**Integration:** Ready to wire into ICP Discovery skill when built

## What's Been Built

### 1. Conversation Feature Extraction (`conversation-features.ts`)

**Functions:**
- `buildConversationFeatures(workspaceId, dealIds)` - Main orchestrator for Sub-steps A + B
- `linkConversationsToDeals(workspaceId, dealIds)` - 3-tier linking (direct, fuzzy account, fuzzy contact)
- `aggregateConversationMetadata(workspaceId, conversationIds)` - Metadata aggregation
- `extractTranscriptExcerpts(workspaceId, conversationIds, tokensPerExcerpt)` - Excerpt extraction
- `computeConversationCoverage(workspaceId)` - Graceful degradation tier (0-3)

**Mock utilities:**
- `generateMockConversationMetadata()` - Mock metadata for testing
- `generateMockTranscriptExcerpts(count)` - Mock excerpts for testing

**Data extracted:**
- Call count, duration, frequency
- Participant counts (internal/external)
- Sentiment scores
- Talk/listen ratios
- Competitor mentions, objections, action items
- Conversation timing and span

### 2. Conversation Classification (`conversation-classifier.ts`)

**Functions:**
- `classifySingleExcerpt(workspaceId, excerpt)` - Classify one transcript
- `classifyBatch(workspaceId, excerpts)` - Batch classification with rate limiting
- `aggregateClassifications(classifications)` - Aggregate across conversations

**Uses DeepSeek via LLM Router** (capability: `classify`)

**Extracts:**
- Competitor mentions with context and sentiment
- Champion signals (advocate language, urgency, exec alignment)
- Sentiment analysis (overall, engagement, concern level)
- Technical depth (questions asked, architecture discussed, etc.)
- Key objections and buying signals

**Mock utilities:**
- `generateMockClassification(conversationId)` - Mock classification for testing

### 3. Feature Matrix Expansion (`conversation-feature-matrix.ts`)

**Functions:**
- `buildConversationFeatureColumns(features, classifications, closeDate)` - Build feature columns for one deal
- `buildConversationFeatureMatrix(dealsFeatures, dealsClassifications, dealCloseDates)` - Batch build
- `analyzeConversationFeatureImportance(wonDeals, lostDeals)` - Feature importance for pattern discovery
- `shouldIncludeConversationFeatures(tier)` - Graceful degradation logic
- `regularizeFeatureImportance(importance, tier)` - Tier-based regularization

**Feature columns added:**
- 35+ conversation-derived features covering:
  - Call metadata (count, duration, frequency, participants)
  - Engagement quality (sentiment, talk ratio, buyer engagement)
  - Behavioral signals (competitors, champions, objections)
  - Technical depth (architecture, integration, security discussions)
  - Buying signals and action items
  - Conversation timing (first call to close, span)

**Types defined:**
- `ConversationFeatureColumns` - All conversation features
- `DealWithConversationFeatures` - Complete deal + conversation features
- `ConversationFeatureImportance` - Feature importance analysis

## Graceful Degradation

The system supports **4 tiers** based on conversation coverage:

| Tier | Coverage | Label | Behavior |
|------|----------|-------|----------|
| **0** | 0% | None | No conversation data - skill works as before |
| **1** | <30% | Sparse | Emerging signals only, weight = 0.1 |
| **2** | 30-70% | Moderate | Full integration with regularization, weight = 0.3 |
| **3** | >70% | Strong | High confidence playbook, weight = 0.5 |

Coverage is calculated as: `(closed-won deals with conversations) / (total closed-won deals)`

## Usage Examples

### Example 1: Extract Conversation Features for a Deal

```typescript
import { buildConversationFeatures, computeConversationCoverage } from './analysis/conversation-features';
import { classifyBatch } from './analysis/conversation-classifier';
import { buildConversationFeatureMatrix } from './analysis/conversation-feature-matrix';

// Check coverage tier first
const coverage = await computeConversationCoverage(workspaceId);
console.log(`Coverage: ${coverage.coverage_percent}% (Tier ${coverage.tier} - ${coverage.tier_label})`);

// Extract features for closed-won deals
const dealIds = ['deal-1', 'deal-2', 'deal-3'];
const features = await buildConversationFeatures(workspaceId, dealIds);

console.log(`Deals with conversations: ${features.filter(f => f.has_conversations).length}`);
```

### Example 2: Classify Transcripts and Build Feature Matrix

```typescript
// Step 1: Extract conversation features
const conversationFeatures = await buildConversationFeatures(workspaceId, dealIds);

// Step 2: Collect all excerpts
const allExcerpts = conversationFeatures.flatMap(f => f.transcript_excerpts);
console.log(`Total excerpts to classify: ${allExcerpts.length}`);

// Step 3: Classify in batch (uses DeepSeek)
const classificationResult = await classifyBatch(workspaceId, allExcerpts);
console.log(`Classified: ${classificationResult.successful} / ${classificationResult.total_excerpts}`);
console.log(`Tokens used: ${classificationResult.total_tokens_used}`);

// Step 4: Group classifications by deal
const classificationsByDeal = new Map();
for (const c of classificationResult.classifications) {
  const dealId = conversationFeatures.find(f =>
    f.transcript_excerpts.some(e => e.conversation_id === c.conversation_id)
  )?.deal_id;

  if (dealId) {
    if (!classificationsByDeal.has(dealId)) {
      classificationsByDeal.set(dealId, []);
    }
    classificationsByDeal.get(dealId).push(c);
  }
}

// Step 5: Build feature matrix
const dealCloseDates = new Map([
  ['deal-1', new Date('2024-01-15')],
  ['deal-2', new Date('2024-02-20')],
  ['deal-3', new Date('2024-03-10')],
]);

const featureMatrix = buildConversationFeatureMatrix(
  conversationFeatures,
  classificationsByDeal,
  dealCloseDates
);

// Access features for a specific deal
const deal1Features = featureMatrix.get('deal-1');
console.log('Deal 1 conversation features:', {
  call_count: deal1Features.call_count,
  avg_sentiment_score: deal1Features.avg_sentiment_score,
  has_champion_signals: deal1Features.has_champion_signals,
  technical_depth_level: deal1Features.technical_depth_level,
  buying_signal_count: deal1Features.buying_signal_count,
});
```

### Example 3: Analyze Feature Importance (for ICP patterns)

```typescript
import { analyzeConversationFeatureImportance, regularizeFeatureImportance } from './analysis/conversation-feature-matrix';

// Assume we have won and lost deals with conversation features
const wonDeals: ConversationFeatureColumns[] = [...]; // From won deals
const lostDeals: ConversationFeatureColumns[] = [...]; // From lost deals

// Analyze which features discriminate between won/lost
const importance = analyzeConversationFeatureImportance(wonDeals, lostDeals);

// Apply regularization based on coverage tier
const coverage = await computeConversationCoverage(workspaceId);
const regularized = regularizeFeatureImportance(importance, coverage.tier);

// Show top features
const topFeatures = regularized
  .filter(f => f.statistical_significance === 'high')
  .slice(0, 5);

console.log('Top conversation signals for ICP:');
for (const f of topFeatures) {
  console.log(`${f.feature_name}: won_avg=${f.won_avg}, lost_avg=${f.lost_avg}, importance=${f.importance_score}`);
}
```

### Example 4: Using Mock Data (for development)

```typescript
import { generateMockConversationMetadata, generateMockTranscriptExcerpts } from './analysis/conversation-features';
import { generateMockClassification } from './analysis/conversation-classifier';

// Generate mock data without DB or LLM calls
const mockMetadata = generateMockConversationMetadata();
const mockExcerpts = generateMockTranscriptExcerpts(3);
const mockClassification = generateMockClassification('conv-123');

console.log('Mock metadata:', mockMetadata);
console.log('Mock excerpts:', mockExcerpts.length);
console.log('Mock classification:', {
  competitors: mockClassification.competitors.length,
  champion_signals: mockClassification.champion_signals.length,
  technical_depth: mockClassification.technical_depth.depth_level,
});
```

## Integration into ICP Discovery

### Step-by-Step Integration Guide

**1. In ICP Discovery Step 2 (Build Feature Matrix):**

After building firmographic features, add conversation features:

```typescript
// Get conversation coverage tier
const coverage = await computeConversationCoverage(workspaceId);
const { include, weight } = shouldIncludeConversationFeatures(coverage.tier);

if (!include) {
  // Tier 0: No conversation data, skip
  return baseFeatureMatrix;
}

// Extract conversation features for all deals
const conversationFeatures = await buildConversationFeatures(workspaceId, dealIds);

// Classify transcripts (DeepSeek batch)
const allExcerpts = conversationFeatures.flatMap(f => f.transcript_excerpts);
const classificationResult = await classifyBatch(workspaceId, allExcerpts);

// Group classifications by deal
const classificationsByDeal = new Map();
for (const c of classificationResult.classifications) {
  const dealId = conversationFeatures.find(f =>
    f.transcript_excerpts.some(e => e.conversation_id === c.conversation_id)
  )?.deal_id;

  if (dealId) {
    if (!classificationsByDeal.has(dealId)) {
      classificationsByDeal.set(dealId, []);
    }
    classificationsByDeal.get(dealId).push(c);
  }
}

// Build conversation feature matrix
const conversationFeatureMatrix = buildConversationFeatureMatrix(
  conversationFeatures,
  classificationsByDeal,
  dealCloseDates
);

// Merge into main feature matrix
for (const [dealId, convFeatures] of conversationFeatureMatrix) {
  featureMatrix.set(dealId, {
    ...featureMatrix.get(dealId),
    conversation_features: convFeatures
  });
}
```

**2. In ICP Discovery Step 4 (Discover Persona Patterns):**

Analyze conversation feature importance:

```typescript
// Extract conversation features for won/lost deals
const wonConvFeatures = wonDeals.map(d => d.conversation_features);
const lostConvFeatures = lostDeals.map(d => d.conversation_features);

// Analyze importance
let importance = analyzeConversationFeatureImportance(wonConvFeatures, lostConvFeatures);

// Apply regularization based on coverage
importance = regularizeFeatureImportance(importance, coverage.tier);

// Get top features
const topConversationSignals = importance
  .filter(f => f.statistical_significance === 'high')
  .slice(0, 5);

// Include in persona patterns
personaPatterns.conversationSignals = topConversationSignals;
```

**3. In ICP Discovery Step 5 (Company Pattern Enhancement):**

Add conversation benchmarks to company patterns:

```typescript
// Calculate conversation benchmarks per company
const companyConversationStats = {
  avg_call_count: ...,
  avg_champion_signals: ...,
  avg_technical_depth: ...,
  // etc.
};
```

**4. In ICP Discovery Step 7 (Synthesis):**

Expand synthesis prompt with conversation playbook:

```markdown
## Conversation Playbook (Coverage: {tier} - {tier_label}, {coverage_percent}%)

**Top Conversation Signals:**
{for each top signal}
- **{signal_name}**: Won deals average {won_avg}, Lost deals average {lost_avg} (Δ{delta})
{end for}

**Champion Detection:**
- {champion_signal_count} champion signals detected in {percent}% of won deals
- Confidence: {champion_confidence}

**Technical Engagement:**
- {technical_depth_level} technical depth correlates with {win_rate}% win rate
- Architecture discussions in {percent}% of won deals

**Competitive Dynamics:**
- {competitor_count} competitors mentioned across conversations
- Top competitors: {competitor_names}
```

## Testing

### Unit Tests (TODO)

```typescript
// test/analysis/conversation-features.test.ts
describe('Conversation Features', () => {
  it('should link conversations to deals via direct match', async () => {
    // Test direct linking
  });

  it('should fall back to fuzzy account matching', async () => {
    // Test fuzzy account linking
  });

  it('should compute conversation coverage tiers', async () => {
    // Test tier calculation
  });
});

// test/analysis/conversation-classifier.test.ts
describe('Conversation Classifier', () => {
  it('should classify transcript excerpt', async () => {
    // Test single classification
  });

  it('should batch classify with rate limiting', async () => {
    // Test batch processing
  });
});

// test/analysis/conversation-feature-matrix.test.ts
describe('Feature Matrix', () => {
  it('should build conversation feature columns', () => {
    // Test column building
  });

  it('should handle null features gracefully', () => {
    // Test graceful degradation
  });

  it('should calculate feature importance', () => {
    // Test importance analysis
  });
});
```

### Integration Tests (TODO)

```typescript
// test/integration/conversation-intelligence.test.ts
describe('Conversation Intelligence E2E', () => {
  it('should extract features and classify for real deals', async () => {
    // Full pipeline test with real workspace
  });
});
```

## Token Budget

Per the spec (lines 445-489):

**ICP Discovery with Conversation Intelligence:**
- Base ICP Discovery: ~10,000 tokens (existing)
- Conversation features: +5,000 tokens
  - Transcript extraction: 1,500 tokens per deal × 10 deals = 15,000 input tokens
  - DeepSeek classification: 2,000 tokens per call × avg 3 calls/deal = 6,000 output tokens
- **Total:** ~15,000 tokens per run (+$0.06 per run)

**Lead Scoring with Conversation Weights:**
- Base Lead Scoring: ~5,000 tokens (existing)
- Conversation weights: +2,000 tokens
- **Total:** ~7,000 tokens per run (+$0.01 per run)

## Dependencies

### Database Tables
- `conversations` (from migrations/001_initial.sql)
  - Populated by Gong/Fireflies sync
  - Columns: id, workspace_id, source, call_date, duration_seconds, participants, deal_id, account_id, transcript_text, summary, etc.

- `llm_configs` (from migrations/008_llm_config.sql)
  - Workspace LLM routing configuration
  - Default classify capability: `fireworks/deepseek-v3-0324`

### External Services
- **DeepSeek via Fireworks API** - For transcript classification
  - Configured in LLM Router with capability `classify`
  - Requires `FIREWORKS_API_KEY` env var

- **Gong/Fireflies** - Conversation data sources
  - Synced to `conversations` table via connectors
  - Not called directly by this module

## Next Steps (After ICP Discovery Skill is Built)

1. **Wire conversation features into ICP Discovery Step 2** (Feature Matrix)
2. **Add conversation signals to Step 4** (Persona Patterns)
3. **Add conversation benchmarks to Step 5** (Company Patterns)
4. **Expand synthesis prompt in Step 7** (Synthesis)
5. **Add conversation weights to Lead Scoring skill**
6. **Add conversation participant resolution to Closed Deal Enrichment**
7. **Create skill runs for conversation intelligence** (track token usage)
8. **Build monitoring dashboard** for conversation coverage trends

## Files Created

```
server/analysis/
├── conversation-features.ts          # Sub-steps A + B (link + aggregate)
├── conversation-classifier.ts        # Sub-step C (DeepSeek classification)
├── conversation-feature-matrix.ts    # Sub-step D (feature merge)
└── CONVERSATION_INTELLIGENCE_README.md  # This file
```

## Questions?

See the parent spec: `/Users/jeffignacio/Downloads/PANDORA_ICP_CONVERSATION_INTELLIGENCE_ADDENDUM.md`

For implementation details, see inline comments and JSDoc in each module.
