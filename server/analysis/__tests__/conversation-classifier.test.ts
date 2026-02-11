/**
 * Unit tests for conversation-classifier.ts
 *
 * Tests DeepSeek classification, parsing, aggregation with edge cases.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  aggregateClassifications,
  generateMockClassification,
  type ConversationClassification,
  type CompetitorMention,
  type ChampionSignal,
} from '../conversation-classifier.js';

// Mock the LLM router
vi.mock('../../utils/llm-router.js', () => ({
  callLLM: vi.fn(),
}));

// Mock the logger
vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

import { callLLM } from '../../utils/llm-router.js';

describe('conversation-classifier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('aggregateClassifications', () => {
    it('should return empty aggregation when no classifications provided', () => {
      const result = aggregateClassifications([]);

      expect(result).toEqual({
        all_competitors: [],
        all_champion_signals: [],
        avg_sentiment_score: 0,
        overall_engagement: 'medium',
        avg_technical_depth: 'moderate',
        all_objections: [],
        all_buying_signals: [],
      });
    });

    it('should deduplicate competitors by name', () => {
      const classifications: ConversationClassification[] = [
        {
          conversation_id: 'conv-1',
          competitors: [
            { competitor_name: 'Salesforce', context: 'Mentioned in call 1', sentiment: 'negative' },
            { competitor_name: 'HubSpot', context: 'Mentioned in call 1', sentiment: 'neutral' },
          ],
          champion_signals: [],
          sentiment: {
            overall_sentiment: 'positive',
            sentiment_score: 0.5,
            buyer_engagement: 'high',
            concern_level: 'low',
          },
          technical_depth: {
            depth_level: 'moderate',
            technical_questions_asked: 3,
            architecture_discussed: true,
            integration_concerns: false,
            security_discussed: false,
            scalability_discussed: false,
          },
          key_objections: [],
          buying_signals: [],
        },
        {
          conversation_id: 'conv-2',
          competitors: [
            { competitor_name: 'Salesforce', context: 'Mentioned again in call 2', sentiment: 'negative' },
            { competitor_name: 'Monday.com', context: 'New competitor', sentiment: 'neutral' },
          ],
          champion_signals: [],
          sentiment: {
            overall_sentiment: 'positive',
            sentiment_score: 0.6,
            buyer_engagement: 'high',
            concern_level: 'low',
          },
          technical_depth: {
            depth_level: 'moderate',
            technical_questions_asked: 2,
            architecture_discussed: false,
            integration_concerns: true,
            security_discussed: false,
            scalability_discussed: false,
          },
          key_objections: [],
          buying_signals: [],
        },
      ];

      const result = aggregateClassifications(classifications);

      // Should have 3 unique competitors (Salesforce, HubSpot, Monday.com)
      expect(result.all_competitors).toHaveLength(3);
      const competitorNames = result.all_competitors.map(c => c.competitor_name);
      expect(competitorNames).toContain('Salesforce');
      expect(competitorNames).toContain('HubSpot');
      expect(competitorNames).toContain('Monday.com');
    });

    it('should aggregate all champion signals', () => {
      const signal1: ChampionSignal = {
        indicator_type: 'advocate_language',
        excerpt: 'I love this product',
        confidence: 'high',
      };

      const signal2: ChampionSignal = {
        indicator_type: 'urgency',
        excerpt: 'We need this now',
        confidence: 'medium',
      };

      const classifications: ConversationClassification[] = [
        {
          conversation_id: 'conv-1',
          competitors: [],
          champion_signals: [signal1],
          sentiment: {
            overall_sentiment: 'positive',
            sentiment_score: 0.7,
            buyer_engagement: 'high',
            concern_level: 'low',
          },
          technical_depth: {
            depth_level: 'moderate',
            technical_questions_asked: 0,
            architecture_discussed: false,
            integration_concerns: false,
            security_discussed: false,
            scalability_discussed: false,
          },
          key_objections: [],
          buying_signals: [],
        },
        {
          conversation_id: 'conv-2',
          competitors: [],
          champion_signals: [signal2],
          sentiment: {
            overall_sentiment: 'positive',
            sentiment_score: 0.6,
            buyer_engagement: 'high',
            concern_level: 'low',
          },
          technical_depth: {
            depth_level: 'moderate',
            technical_questions_asked: 0,
            architecture_discussed: false,
            integration_concerns: false,
            security_discussed: false,
            scalability_discussed: false,
          },
          key_objections: [],
          buying_signals: [],
        },
      ];

      const result = aggregateClassifications(classifications);

      expect(result.all_champion_signals).toHaveLength(2);
      expect(result.all_champion_signals).toContainEqual(signal1);
      expect(result.all_champion_signals).toContainEqual(signal2);
    });

    it('should calculate average sentiment score', () => {
      const classifications: ConversationClassification[] = [
        {
          conversation_id: 'conv-1',
          competitors: [],
          champion_signals: [],
          sentiment: {
            overall_sentiment: 'positive',
            sentiment_score: 0.8,
            buyer_engagement: 'high',
            concern_level: 'low',
          },
          technical_depth: {
            depth_level: 'moderate',
            technical_questions_asked: 0,
            architecture_discussed: false,
            integration_concerns: false,
            security_discussed: false,
            scalability_discussed: false,
          },
          key_objections: [],
          buying_signals: [],
        },
        {
          conversation_id: 'conv-2',
          competitors: [],
          champion_signals: [],
          sentiment: {
            overall_sentiment: 'neutral',
            sentiment_score: 0.2,
            buyer_engagement: 'medium',
            concern_level: 'medium',
          },
          technical_depth: {
            depth_level: 'moderate',
            technical_questions_asked: 0,
            architecture_discussed: false,
            integration_concerns: false,
            security_discussed: false,
            scalability_discussed: false,
          },
          key_objections: [],
          buying_signals: [],
        },
      ];

      const result = aggregateClassifications(classifications);

      // (0.8 + 0.2) / 2 = 0.5
      expect(result.avg_sentiment_score).toBe(0.5);
    });

    it('should determine overall engagement by majority vote', () => {
      const classifications: ConversationClassification[] = [
        {
          conversation_id: 'conv-1',
          competitors: [],
          champion_signals: [],
          sentiment: {
            overall_sentiment: 'positive',
            sentiment_score: 0.5,
            buyer_engagement: 'high',
            concern_level: 'low',
          },
          technical_depth: {
            depth_level: 'moderate',
            technical_questions_asked: 0,
            architecture_discussed: false,
            integration_concerns: false,
            security_discussed: false,
            scalability_discussed: false,
          },
          key_objections: [],
          buying_signals: [],
        },
        {
          conversation_id: 'conv-2',
          competitors: [],
          champion_signals: [],
          sentiment: {
            overall_sentiment: 'positive',
            sentiment_score: 0.6,
            buyer_engagement: 'high',
            concern_level: 'low',
          },
          technical_depth: {
            depth_level: 'moderate',
            technical_questions_asked: 0,
            architecture_discussed: false,
            integration_concerns: false,
            security_discussed: false,
            scalability_discussed: false,
          },
          key_objections: [],
          buying_signals: [],
        },
        {
          conversation_id: 'conv-3',
          competitors: [],
          champion_signals: [],
          sentiment: {
            overall_sentiment: 'neutral',
            sentiment_score: 0.3,
            buyer_engagement: 'low',
            concern_level: 'medium',
          },
          technical_depth: {
            depth_level: 'moderate',
            technical_questions_asked: 0,
            architecture_discussed: false,
            integration_concerns: false,
            security_discussed: false,
            scalability_discussed: false,
          },
          key_objections: [],
          buying_signals: [],
        },
      ];

      const result = aggregateClassifications(classifications);

      // 2 high, 1 low → should be 'high'
      expect(result.overall_engagement).toBe('high');
    });

    it('should determine technical depth by majority vote', () => {
      const classifications: ConversationClassification[] = [
        {
          conversation_id: 'conv-1',
          competitors: [],
          champion_signals: [],
          sentiment: {
            overall_sentiment: 'positive',
            sentiment_score: 0.5,
            buyer_engagement: 'high',
            concern_level: 'low',
          },
          technical_depth: {
            depth_level: 'deep',
            technical_questions_asked: 10,
            architecture_discussed: true,
            integration_concerns: true,
            security_discussed: true,
            scalability_discussed: true,
          },
          key_objections: [],
          buying_signals: [],
        },
        {
          conversation_id: 'conv-2',
          competitors: [],
          champion_signals: [],
          sentiment: {
            overall_sentiment: 'positive',
            sentiment_score: 0.6,
            buyer_engagement: 'high',
            concern_level: 'low',
          },
          technical_depth: {
            depth_level: 'deep',
            technical_questions_asked: 8,
            architecture_discussed: true,
            integration_concerns: false,
            security_discussed: true,
            scalability_discussed: false,
          },
          key_objections: [],
          buying_signals: [],
        },
        {
          conversation_id: 'conv-3',
          competitors: [],
          champion_signals: [],
          sentiment: {
            overall_sentiment: 'neutral',
            sentiment_score: 0.3,
            buyer_engagement: 'medium',
            concern_level: 'medium',
          },
          technical_depth: {
            depth_level: 'shallow',
            technical_questions_asked: 1,
            architecture_discussed: false,
            integration_concerns: false,
            security_discussed: false,
            scalability_discussed: false,
          },
          key_objections: [],
          buying_signals: [],
        },
      ];

      const result = aggregateClassifications(classifications);

      // 2 deep, 1 shallow → should be 'deep'
      expect(result.avg_technical_depth).toBe('deep');
    });

    it('should deduplicate objections and buying signals', () => {
      const classifications: ConversationClassification[] = [
        {
          conversation_id: 'conv-1',
          competitors: [],
          champion_signals: [],
          sentiment: {
            overall_sentiment: 'positive',
            sentiment_score: 0.5,
            buyer_engagement: 'high',
            concern_level: 'low',
          },
          technical_depth: {
            depth_level: 'moderate',
            technical_questions_asked: 0,
            architecture_discussed: false,
            integration_concerns: false,
            security_discussed: false,
            scalability_discussed: false,
          },
          key_objections: ['Price too high', 'Integration complexity'],
          buying_signals: ['Budget approved', 'Urgency'],
        },
        {
          conversation_id: 'conv-2',
          competitors: [],
          champion_signals: [],
          sentiment: {
            overall_sentiment: 'positive',
            sentiment_score: 0.6,
            buyer_engagement: 'high',
            concern_level: 'low',
          },
          technical_depth: {
            depth_level: 'moderate',
            technical_questions_asked: 0,
            architecture_discussed: false,
            integration_concerns: false,
            security_discussed: false,
            scalability_discussed: false,
          },
          key_objections: ['Price too high', 'Timeline concerns'],
          buying_signals: ['Budget approved', 'Executive alignment'],
        },
      ];

      const result = aggregateClassifications(classifications);

      // Should deduplicate
      expect(result.all_objections).toHaveLength(3);
      expect(result.all_objections).toContain('Price too high');
      expect(result.all_objections).toContain('Integration complexity');
      expect(result.all_objections).toContain('Timeline concerns');

      expect(result.all_buying_signals).toHaveLength(3);
      expect(result.all_buying_signals).toContain('Budget approved');
      expect(result.all_buying_signals).toContain('Urgency');
      expect(result.all_buying_signals).toContain('Executive alignment');
    });

    it('should handle classifications with all null/empty values', () => {
      const classifications: ConversationClassification[] = [
        {
          conversation_id: 'conv-1',
          competitors: [],
          champion_signals: [],
          sentiment: {
            overall_sentiment: 'neutral',
            sentiment_score: 0,
            buyer_engagement: 'medium',
            concern_level: 'medium',
          },
          technical_depth: {
            depth_level: 'moderate',
            technical_questions_asked: 0,
            architecture_discussed: false,
            integration_concerns: false,
            security_discussed: false,
            scalability_discussed: false,
          },
          key_objections: [],
          buying_signals: [],
        },
      ];

      const result = aggregateClassifications(classifications);

      expect(result.all_competitors).toEqual([]);
      expect(result.all_champion_signals).toEqual([]);
      expect(result.avg_sentiment_score).toBe(0);
      expect(result.all_objections).toEqual([]);
      expect(result.all_buying_signals).toEqual([]);
    });

    it('should handle engagement tie-breaker (equal high/medium/low)', () => {
      const classifications: ConversationClassification[] = [
        {
          conversation_id: 'conv-1',
          competitors: [],
          champion_signals: [],
          sentiment: {
            overall_sentiment: 'positive',
            sentiment_score: 0.5,
            buyer_engagement: 'high',
            concern_level: 'low',
          },
          technical_depth: {
            depth_level: 'moderate',
            technical_questions_asked: 0,
            architecture_discussed: false,
            integration_concerns: false,
            security_discussed: false,
            scalability_discussed: false,
          },
          key_objections: [],
          buying_signals: [],
        },
        {
          conversation_id: 'conv-2',
          competitors: [],
          champion_signals: [],
          sentiment: {
            overall_sentiment: 'neutral',
            sentiment_score: 0.3,
            buyer_engagement: 'medium',
            concern_level: 'medium',
          },
          technical_depth: {
            depth_level: 'moderate',
            technical_questions_asked: 0,
            architecture_discussed: false,
            integration_concerns: false,
            security_discussed: false,
            scalability_discussed: false,
          },
          key_objections: [],
          buying_signals: [],
        },
        {
          conversation_id: 'conv-3',
          competitors: [],
          champion_signals: [],
          sentiment: {
            overall_sentiment: 'negative',
            sentiment_score: -0.2,
            buyer_engagement: 'low',
            concern_level: 'high',
          },
          technical_depth: {
            depth_level: 'moderate',
            technical_questions_asked: 0,
            architecture_discussed: false,
            integration_concerns: false,
            security_discussed: false,
            scalability_discussed: false,
          },
          key_objections: [],
          buying_signals: [],
        },
      ];

      const result = aggregateClassifications(classifications);

      // 1 high, 1 medium, 1 low → tie-breaker favors high
      expect(result.overall_engagement).toBe('high');
    });
  });

  describe('Mock classification generator', () => {
    it('should generate valid mock classification', () => {
      const classification = generateMockClassification('conv-123');

      expect(classification.conversation_id).toBe('conv-123');
      expect(Array.isArray(classification.competitors)).toBe(true);
      expect(Array.isArray(classification.champion_signals)).toBe(true);
      expect(classification.sentiment).toBeDefined();
      expect(classification.sentiment.sentiment_score).toBeGreaterThanOrEqual(-1);
      expect(classification.sentiment.sentiment_score).toBeLessThanOrEqual(1);
      expect(classification.technical_depth).toBeDefined();
      expect(Array.isArray(classification.key_objections)).toBe(true);
      expect(Array.isArray(classification.buying_signals)).toBe(true);
    });

    it('should generate different conversation IDs when called with different IDs', () => {
      const classification1 = generateMockClassification('conv-1');
      const classification2 = generateMockClassification('conv-2');

      expect(classification1.conversation_id).toBe('conv-1');
      expect(classification2.conversation_id).toBe('conv-2');
    });

    it('should generate valid enum values', () => {
      const classification = generateMockClassification('conv-1');

      // Check sentiment values
      expect(['very_positive', 'positive', 'neutral', 'negative', 'very_negative']).toContain(
        classification.sentiment.overall_sentiment
      );
      expect(['high', 'medium', 'low']).toContain(classification.sentiment.buyer_engagement);
      expect(['high', 'medium', 'low']).toContain(classification.sentiment.concern_level);

      // Check technical depth
      expect(['deep', 'moderate', 'shallow']).toContain(classification.technical_depth.depth_level);

      // Check champion signal types and confidence
      for (const signal of classification.champion_signals) {
        expect(['advocate_language', 'internal_selling', 'urgency', 'executive_alignment']).toContain(
          signal.indicator_type
        );
        expect(['high', 'medium', 'low']).toContain(signal.confidence);
      }

      // Check competitor sentiment
      for (const competitor of classification.competitors) {
        expect(['positive', 'neutral', 'negative']).toContain(competitor.sentiment);
      }
    });
  });
});
