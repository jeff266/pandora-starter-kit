/**
 * Unit tests for conversation-feature-matrix.ts
 *
 * Tests feature column building, matrix building, importance analysis,
 * and graceful degradation with edge cases.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildConversationFeatureColumns,
  buildConversationFeatureMatrix,
  analyzeConversationFeatureImportance,
  shouldIncludeConversationFeatures,
  regularizeFeatureImportance,
  type ConversationFeatureColumns,
} from '../conversation-feature-matrix.js';

import type { ConversationFeatures } from '../conversation-features.js';
import type { ConversationClassification } from '../conversation-classifier.js';

// Mock the logger
vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

describe('conversation-feature-matrix', () => {
  describe('buildConversationFeatureColumns', () => {
    it('should return null features when has_conversations is false', () => {
      const features: ConversationFeatures = {
        deal_id: 'deal-1',
        has_conversations: false,
        metadata: null,
        transcript_excerpts: [],
      };

      const result = buildConversationFeatureColumns(features, []);

      expect(result.has_conversation_data).toBe(false);
      expect(result.call_count).toBe(0);
      expect(result.avg_sentiment_score).toBeNull();
      expect(result.champion_signal_count).toBe(0);
      expect(result.competitors_discussed).toEqual([]);
    });

    it('should return null features when metadata is null', () => {
      const features: ConversationFeatures = {
        deal_id: 'deal-1',
        has_conversations: true,
        metadata: null,
        transcript_excerpts: [],
      };

      const result = buildConversationFeatureColumns(features, []);

      expect(result.has_conversation_data).toBe(false);
    });

    it('should build features correctly with valid metadata and classifications', () => {
      const features: ConversationFeatures = {
        deal_id: 'deal-1',
        has_conversations: true,
        metadata: {
          call_count: 5,
          total_duration_minutes: 150,
          avg_duration_minutes: 30,
          avg_sentiment_score: 0.6,
          avg_talk_ratio: 0.45,
          competitor_mention_count: 3,
          objection_count: 2,
          action_item_count: 8,
          unique_participants: 6,
          internal_participants: 2,
          external_participants: 4,
          earliest_call_date: '2024-01-10T10:00:00Z',
          latest_call_date: '2024-02-15T15:00:00Z',
          days_span: 36,
        },
        transcript_excerpts: [],
      };

      const classifications: ConversationClassification[] = [
        {
          conversation_id: 'conv-1',
          competitors: [
            { competitor_name: 'Salesforce', context: 'test', sentiment: 'negative' },
          ],
          champion_signals: [
            { indicator_type: 'advocate_language', excerpt: 'test', confidence: 'high' },
          ],
          sentiment: {
            overall_sentiment: 'positive',
            sentiment_score: 0.7,
            buyer_engagement: 'high',
            concern_level: 'low',
          },
          technical_depth: {
            depth_level: 'deep',
            technical_questions_asked: 5,
            architecture_discussed: true,
            integration_concerns: true,
            security_discussed: true,
            scalability_discussed: false,
          },
          key_objections: ['Price', 'Timeline'],
          buying_signals: ['Budget approved', 'Urgency'],
        },
      ];

      const result = buildConversationFeatureColumns(features, classifications);

      expect(result.has_conversation_data).toBe(true);
      expect(result.call_count).toBe(5);
      expect(result.avg_call_duration_minutes).toBe(30);
      expect(result.avg_sentiment_score).toBe(0.6);
      expect(result.unique_participants).toBe(6);
      expect(result.champion_signal_count).toBe(1);
      expect(result.competitors_discussed).toContain('Salesforce');
      expect(result.technical_depth_level).toBe('deep');
      expect(result.architecture_discussed).toBe(true);
    });

    it('should calculate call_frequency_per_week correctly', () => {
      const features: ConversationFeatures = {
        deal_id: 'deal-1',
        has_conversations: true,
        metadata: {
          call_count: 4,
          total_duration_minutes: 120,
          avg_duration_minutes: 30,
          avg_sentiment_score: 0.5,
          avg_talk_ratio: 0.5,
          competitor_mention_count: 0,
          objection_count: 0,
          action_item_count: 0,
          unique_participants: 4,
          internal_participants: 2,
          external_participants: 2,
          earliest_call_date: '2024-01-01T10:00:00Z',
          latest_call_date: '2024-01-15T10:00:00Z',
          days_span: 14, // 2 weeks
        },
        transcript_excerpts: [],
      };

      const result = buildConversationFeatureColumns(features, []);

      // 4 calls in 14 days = 4/14 * 7 = 2 calls per week
      expect(result.call_frequency_per_week).toBeCloseTo(2, 1);
    });

    it('should handle null call_frequency_per_week when days_span is 0', () => {
      const features: ConversationFeatures = {
        deal_id: 'deal-1',
        has_conversations: true,
        metadata: {
          call_count: 2,
          total_duration_minutes: 60,
          avg_duration_minutes: 30,
          avg_sentiment_score: 0.5,
          avg_talk_ratio: 0.5,
          competitor_mention_count: 0,
          objection_count: 0,
          action_item_count: 0,
          unique_participants: 4,
          internal_participants: 2,
          external_participants: 2,
          earliest_call_date: '2024-01-01T10:00:00Z',
          latest_call_date: '2024-01-01T10:00:00Z',
          days_span: 0,
        },
        transcript_excerpts: [],
      };

      const result = buildConversationFeatureColumns(features, []);

      expect(result.call_frequency_per_week).toBeNull();
    });

    it('should calculate first_call_to_close_days correctly', () => {
      const features: ConversationFeatures = {
        deal_id: 'deal-1',
        has_conversations: true,
        metadata: {
          call_count: 3,
          total_duration_minutes: 90,
          avg_duration_minutes: 30,
          avg_sentiment_score: 0.5,
          avg_talk_ratio: 0.5,
          competitor_mention_count: 0,
          objection_count: 0,
          action_item_count: 0,
          unique_participants: 4,
          internal_participants: 2,
          external_participants: 2,
          earliest_call_date: '2024-01-01T10:00:00Z',
          latest_call_date: '2024-01-15T10:00:00Z',
          days_span: 14,
        },
        transcript_excerpts: [],
      };

      const closeDate = new Date('2024-02-01T10:00:00Z');

      const result = buildConversationFeatureColumns(features, [], closeDate);

      // Jan 1 to Feb 1 = 31 days
      expect(result.first_call_to_close_days).toBe(31);
    });

    it('should handle null first_call_to_close_days when closeDate is missing', () => {
      const features: ConversationFeatures = {
        deal_id: 'deal-1',
        has_conversations: true,
        metadata: {
          call_count: 3,
          total_duration_minutes: 90,
          avg_duration_minutes: 30,
          avg_sentiment_score: 0.5,
          avg_talk_ratio: 0.5,
          competitor_mention_count: 0,
          objection_count: 0,
          action_item_count: 0,
          unique_participants: 4,
          internal_participants: 2,
          external_participants: 2,
          earliest_call_date: '2024-01-01T10:00:00Z',
          latest_call_date: '2024-01-15T10:00:00Z',
          days_span: 14,
        },
        transcript_excerpts: [],
      };

      const result = buildConversationFeatureColumns(features, []);

      expect(result.first_call_to_close_days).toBeNull();
    });

    it('should determine champion_confidence correctly', () => {
      const features: ConversationFeatures = {
        deal_id: 'deal-1',
        has_conversations: true,
        metadata: {
          call_count: 1,
          total_duration_minutes: 30,
          avg_duration_minutes: 30,
          avg_sentiment_score: 0.5,
          avg_talk_ratio: 0.5,
          competitor_mention_count: 0,
          objection_count: 0,
          action_item_count: 0,
          unique_participants: 2,
          internal_participants: 1,
          external_participants: 1,
          earliest_call_date: '2024-01-01T10:00:00Z',
          latest_call_date: '2024-01-01T10:00:00Z',
          days_span: 0,
        },
        transcript_excerpts: [],
      };

      const classificationsWithHigh: ConversationClassification[] = [
        {
          conversation_id: 'conv-1',
          competitors: [],
          champion_signals: [
            { indicator_type: 'advocate_language', excerpt: 'test', confidence: 'high' },
          ],
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
      ];

      let result = buildConversationFeatureColumns(features, classificationsWithHigh);
      expect(result.champion_confidence).toBe('high');

      // Test with medium confidence
      const classificationsWithMedium: ConversationClassification[] = [
        {
          conversation_id: 'conv-1',
          competitors: [],
          champion_signals: [
            { indicator_type: 'urgency', excerpt: 'test', confidence: 'medium' },
          ],
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
      ];

      result = buildConversationFeatureColumns(features, classificationsWithMedium);
      expect(result.champion_confidence).toBe('medium');

      // Test with no champion signals
      result = buildConversationFeatureColumns(features, []);
      expect(result.champion_confidence).toBeNull();
    });
  });

  describe('buildConversationFeatureMatrix', () => {
    it('should build matrix for multiple deals', () => {
      const dealsFeatures: ConversationFeatures[] = [
        {
          deal_id: 'deal-1',
          has_conversations: true,
          metadata: {
            call_count: 3,
            total_duration_minutes: 90,
            avg_duration_minutes: 30,
            avg_sentiment_score: 0.6,
            avg_talk_ratio: 0.5,
            competitor_mention_count: 1,
            objection_count: 2,
            action_item_count: 5,
            unique_participants: 4,
            internal_participants: 2,
            external_participants: 2,
            earliest_call_date: '2024-01-01T10:00:00Z',
            latest_call_date: '2024-01-15T10:00:00Z',
            days_span: 14,
          },
          transcript_excerpts: [],
        },
        {
          deal_id: 'deal-2',
          has_conversations: false,
          metadata: null,
          transcript_excerpts: [],
        },
      ];

      const dealsClassifications = new Map<string, ConversationClassification[]>();
      dealsClassifications.set('deal-1', []);

      const dealCloseDates = new Map<string, Date>();
      dealCloseDates.set('deal-1', new Date('2024-02-01T10:00:00Z'));
      dealCloseDates.set('deal-2', new Date('2024-02-01T10:00:00Z'));

      const result = buildConversationFeatureMatrix(
        dealsFeatures,
        dealsClassifications,
        dealCloseDates
      );

      expect(result.size).toBe(2);
      expect(result.get('deal-1')?.has_conversation_data).toBe(true);
      expect(result.get('deal-2')?.has_conversation_data).toBe(false);
    });

    it('should handle empty deals array', () => {
      const result = buildConversationFeatureMatrix(
        [],
        new Map(),
        new Map()
      );

      expect(result.size).toBe(0);
    });

    it('should handle missing classifications for a deal', () => {
      const dealsFeatures: ConversationFeatures[] = [
        {
          deal_id: 'deal-1',
          has_conversations: true,
          metadata: {
            call_count: 1,
            total_duration_minutes: 30,
            avg_duration_minutes: 30,
            avg_sentiment_score: 0.5,
            avg_talk_ratio: 0.5,
            competitor_mention_count: 0,
            objection_count: 0,
            action_item_count: 0,
            unique_participants: 2,
            internal_participants: 1,
            external_participants: 1,
            earliest_call_date: '2024-01-01T10:00:00Z',
            latest_call_date: '2024-01-01T10:00:00Z',
            days_span: 0,
          },
          transcript_excerpts: [],
        },
      ];

      const dealsClassifications = new Map<string, ConversationClassification[]>();
      // No classifications for deal-1

      const dealCloseDates = new Map<string, Date>();
      dealCloseDates.set('deal-1', new Date('2024-02-01T10:00:00Z'));

      const result = buildConversationFeatureMatrix(
        dealsFeatures,
        dealsClassifications,
        dealCloseDates
      );

      expect(result.size).toBe(1);
      expect(result.get('deal-1')?.has_conversation_data).toBe(true);
      expect(result.get('deal-1')?.champion_signal_count).toBe(0);
    });

    it('should handle missing close date for a deal', () => {
      const dealsFeatures: ConversationFeatures[] = [
        {
          deal_id: 'deal-1',
          has_conversations: true,
          metadata: {
            call_count: 1,
            total_duration_minutes: 30,
            avg_duration_minutes: 30,
            avg_sentiment_score: 0.5,
            avg_talk_ratio: 0.5,
            competitor_mention_count: 0,
            objection_count: 0,
            action_item_count: 0,
            unique_participants: 2,
            internal_participants: 1,
            external_participants: 1,
            earliest_call_date: '2024-01-01T10:00:00Z',
            latest_call_date: '2024-01-01T10:00:00Z',
            days_span: 0,
          },
          transcript_excerpts: [],
        },
      ];

      const dealsClassifications = new Map<string, ConversationClassification[]>();
      const dealCloseDates = new Map<string, Date>();
      // No close date for deal-1

      const result = buildConversationFeatureMatrix(
        dealsFeatures,
        dealsClassifications,
        dealCloseDates
      );

      expect(result.size).toBe(1);
      expect(result.get('deal-1')?.first_call_to_close_days).toBeNull();
    });
  });

  describe('analyzeConversationFeatureImportance', () => {
    it('should return empty array when won or lost deals are empty', () => {
      const wonDeals: ConversationFeatureColumns[] = [];
      const lostDeals: ConversationFeatureColumns[] = [];

      const result = analyzeConversationFeatureImportance(wonDeals, lostDeals);

      expect(result).toEqual([]);
    });

    it('should calculate importance for numeric features', () => {
      const wonDeals: ConversationFeatureColumns[] = Array.from({ length: 20 }, () => ({
        has_conversation_data: true,
        call_count: 5,
        total_call_duration_minutes: 150,
        avg_call_duration_minutes: 30,
        call_frequency_per_week: 2.5,
        unique_participants: 6,
        internal_participants: 2,
        external_participants: 4,
        buyer_speaker_count: 4,
        avg_sentiment_score: 0.7,
        avg_talk_ratio: 0.45,
        buyer_engagement_level: 'high',
        competitor_mention_count: 1,
        competitors_discussed: ['Salesforce'],
        has_champion_signals: true,
        champion_signal_count: 2,
        champion_confidence: 'high',
        objection_count: 1,
        key_objections: [],
        concern_level: 'low',
        technical_depth_level: 'deep',
        technical_questions_asked: 5,
        architecture_discussed: true,
        integration_concerns: true,
        security_discussed: true,
        scalability_discussed: false,
        buying_signal_count: 3,
        buying_signals: [],
        action_item_count: 8,
        earliest_call_date: '2024-01-01T10:00:00Z',
        latest_call_date: '2024-01-15T10:00:00Z',
        conversation_days_span: 14,
        first_call_to_close_days: 30,
      }));

      const lostDeals: ConversationFeatureColumns[] = Array.from({ length: 15 }, () => ({
        has_conversation_data: true,
        call_count: 2,
        total_call_duration_minutes: 60,
        avg_call_duration_minutes: 30,
        call_frequency_per_week: 1.0,
        unique_participants: 3,
        internal_participants: 1,
        external_participants: 2,
        buyer_speaker_count: 2,
        avg_sentiment_score: 0.2,
        avg_talk_ratio: 0.6,
        buyer_engagement_level: 'low',
        competitor_mention_count: 3,
        competitors_discussed: [],
        has_champion_signals: false,
        champion_signal_count: 0,
        champion_confidence: null,
        objection_count: 5,
        key_objections: [],
        concern_level: 'high',
        technical_depth_level: 'shallow',
        technical_questions_asked: 1,
        architecture_discussed: false,
        integration_concerns: false,
        security_discussed: false,
        scalability_discussed: false,
        buying_signal_count: 1,
        buying_signals: [],
        action_item_count: 2,
        earliest_call_date: '2024-01-01T10:00:00Z',
        latest_call_date: '2024-01-10T10:00:00Z',
        conversation_days_span: 9,
        first_call_to_close_days: 45,
      }));

      const result = analyzeConversationFeatureImportance(wonDeals, lostDeals);

      expect(result.length).toBeGreaterThan(0);

      // Find call_count feature
      const callCountFeature = result.find(f => f.feature_name === 'call_count');
      expect(callCountFeature).toBeDefined();
      expect(callCountFeature!.won_avg).toBe(5);
      expect(callCountFeature!.lost_avg).toBe(2);
      expect(callCountFeature!.delta).toBe(3);
      expect(callCountFeature!.importance_score).toBeGreaterThan(0);
    });

    it('should sort features by importance score descending', () => {
      const wonDeals: ConversationFeatureColumns[] = Array.from({ length: 20 }, () => ({
        has_conversation_data: true,
        call_count: 10,
        total_call_duration_minutes: 300,
        avg_call_duration_minutes: 30,
        call_frequency_per_week: 3.0,
        unique_participants: 8,
        internal_participants: 3,
        external_participants: 5,
        buyer_speaker_count: 5,
        avg_sentiment_score: 0.8,
        avg_talk_ratio: 0.4,
        buyer_engagement_level: 'high',
        competitor_mention_count: 0,
        competitors_discussed: [],
        has_champion_signals: true,
        champion_signal_count: 5,
        champion_confidence: 'high',
        objection_count: 1,
        key_objections: [],
        concern_level: 'low',
        technical_depth_level: 'deep',
        technical_questions_asked: 10,
        architecture_discussed: true,
        integration_concerns: true,
        security_discussed: true,
        scalability_discussed: true,
        buying_signal_count: 6,
        buying_signals: [],
        action_item_count: 12,
        earliest_call_date: '2024-01-01T10:00:00Z',
        latest_call_date: '2024-01-30T10:00:00Z',
        conversation_days_span: 29,
        first_call_to_close_days: 35,
      }));

      const lostDeals: ConversationFeatureColumns[] = Array.from({ length: 15 }, () => ({
        has_conversation_data: true,
        call_count: 1,
        total_call_duration_minutes: 30,
        avg_call_duration_minutes: 30,
        call_frequency_per_week: 0.5,
        unique_participants: 2,
        internal_participants: 1,
        external_participants: 1,
        buyer_speaker_count: 1,
        avg_sentiment_score: -0.3,
        avg_talk_ratio: 0.7,
        buyer_engagement_level: 'low',
        competitor_mention_count: 5,
        competitors_discussed: [],
        has_champion_signals: false,
        champion_signal_count: 0,
        champion_confidence: null,
        objection_count: 8,
        key_objections: [],
        concern_level: 'high',
        technical_depth_level: 'shallow',
        technical_questions_asked: 0,
        architecture_discussed: false,
        integration_concerns: false,
        security_discussed: false,
        scalability_discussed: false,
        buying_signal_count: 0,
        buying_signals: [],
        action_item_count: 1,
        earliest_call_date: '2024-01-01T10:00:00Z',
        latest_call_date: '2024-01-01T10:00:00Z',
        conversation_days_span: 0,
        first_call_to_close_days: 60,
      }));

      const result = analyzeConversationFeatureImportance(wonDeals, lostDeals);

      // Should be sorted descending by importance_score
      for (let i = 1; i < result.length; i++) {
        expect(result[i - 1].importance_score).toBeGreaterThanOrEqual(result[i].importance_score);
      }
    });

    it('should assign statistical significance based on sample size and delta', () => {
      // Large sample, big delta → high significance
      const wonDealsLarge: ConversationFeatureColumns[] = Array.from({ length: 50 }, () => ({
        has_conversation_data: true,
        call_count: 10,
        total_call_duration_minutes: 300,
        avg_call_duration_minutes: 30,
        call_frequency_per_week: 2.0,
        unique_participants: 6,
        internal_participants: 2,
        external_participants: 4,
        buyer_speaker_count: 4,
        avg_sentiment_score: 0.8,
        avg_talk_ratio: 0.5,
        buyer_engagement_level: 'high',
        competitor_mention_count: 0,
        competitors_discussed: [],
        has_champion_signals: true,
        champion_signal_count: 3,
        champion_confidence: 'high',
        objection_count: 1,
        key_objections: [],
        concern_level: 'low',
        technical_depth_level: 'deep',
        technical_questions_asked: 5,
        architecture_discussed: true,
        integration_concerns: true,
        security_discussed: true,
        scalability_discussed: false,
        buying_signal_count: 4,
        buying_signals: [],
        action_item_count: 8,
        earliest_call_date: '2024-01-01T10:00:00Z',
        latest_call_date: '2024-01-15T10:00:00Z',
        conversation_days_span: 14,
        first_call_to_close_days: 30,
      }));

      const lostDealsLarge: ConversationFeatureColumns[] = Array.from({ length: 50 }, () => ({
        has_conversation_data: true,
        call_count: 2,
        total_call_duration_minutes: 60,
        avg_call_duration_minutes: 30,
        call_frequency_per_week: 0.5,
        unique_participants: 2,
        internal_participants: 1,
        external_participants: 1,
        buyer_speaker_count: 1,
        avg_sentiment_score: 0.1,
        avg_talk_ratio: 0.6,
        buyer_engagement_level: 'low',
        competitor_mention_count: 2,
        competitors_discussed: [],
        has_champion_signals: false,
        champion_signal_count: 0,
        champion_confidence: null,
        objection_count: 5,
        key_objections: [],
        concern_level: 'high',
        technical_depth_level: 'shallow',
        technical_questions_asked: 1,
        architecture_discussed: false,
        integration_concerns: false,
        security_discussed: false,
        scalability_discussed: false,
        buying_signal_count: 1,
        buying_signals: [],
        action_item_count: 2,
        earliest_call_date: '2024-01-01T10:00:00Z',
        latest_call_date: '2024-01-05T10:00:00Z',
        conversation_days_span: 4,
        first_call_to_close_days: 50,
      }));

      const result = analyzeConversationFeatureImportance(wonDealsLarge, lostDealsLarge);

      const highSignificanceFeatures = result.filter(f => f.statistical_significance === 'high');
      expect(highSignificanceFeatures.length).toBeGreaterThan(0);
    });

    it('should skip features with all null values', () => {
      const wonDeals: ConversationFeatureColumns[] = Array.from({ length: 10 }, () => ({
        has_conversation_data: true,
        call_count: 3,
        total_call_duration_minutes: 90,
        avg_call_duration_minutes: 30,
        call_frequency_per_week: null, // All null
        unique_participants: 4,
        internal_participants: 2,
        external_participants: 2,
        buyer_speaker_count: 2,
        avg_sentiment_score: null, // All null
        avg_talk_ratio: 0.5,
        buyer_engagement_level: 'high',
        competitor_mention_count: 1,
        competitors_discussed: [],
        has_champion_signals: true,
        champion_signal_count: 2,
        champion_confidence: 'high',
        objection_count: 1,
        key_objections: [],
        concern_level: 'low',
        technical_depth_level: 'deep',
        technical_questions_asked: 3,
        architecture_discussed: true,
        integration_concerns: false,
        security_discussed: false,
        scalability_discussed: false,
        buying_signal_count: 2,
        buying_signals: [],
        action_item_count: 5,
        earliest_call_date: '2024-01-01T10:00:00Z',
        latest_call_date: '2024-01-10T10:00:00Z',
        conversation_days_span: 9,
        first_call_to_close_days: 25,
      }));

      const lostDeals: ConversationFeatureColumns[] = Array.from({ length: 10 }, () => ({
        has_conversation_data: true,
        call_count: 1,
        total_call_duration_minutes: 30,
        avg_call_duration_minutes: 30,
        call_frequency_per_week: null, // All null
        unique_participants: 2,
        internal_participants: 1,
        external_participants: 1,
        buyer_speaker_count: 1,
        avg_sentiment_score: null, // All null
        avg_talk_ratio: 0.6,
        buyer_engagement_level: 'low',
        competitor_mention_count: 2,
        competitors_discussed: [],
        has_champion_signals: false,
        champion_signal_count: 0,
        champion_confidence: null,
        objection_count: 3,
        key_objections: [],
        concern_level: 'high',
        technical_depth_level: 'shallow',
        technical_questions_asked: 0,
        architecture_discussed: false,
        integration_concerns: false,
        security_discussed: false,
        scalability_discussed: false,
        buying_signal_count: 0,
        buying_signals: [],
        action_item_count: 1,
        earliest_call_date: '2024-01-01T10:00:00Z',
        latest_call_date: '2024-01-01T10:00:00Z',
        conversation_days_span: 0,
        first_call_to_close_days: 40,
      }));

      const result = analyzeConversationFeatureImportance(wonDeals, lostDeals);

      // Should not include call_frequency_per_week or avg_sentiment_score
      expect(result.find(f => f.feature_name === 'call_frequency_per_week')).toBeUndefined();
      expect(result.find(f => f.feature_name === 'avg_sentiment_score')).toBeUndefined();
    });
  });

  describe('shouldIncludeConversationFeatures', () => {
    it('should return correct settings for tier 0', () => {
      const result = shouldIncludeConversationFeatures(0);

      expect(result.include).toBe(false);
      expect(result.weight).toBe(0);
      expect(result.reason).toContain('No conversation data');
    });

    it('should return correct settings for tier 1', () => {
      const result = shouldIncludeConversationFeatures(1);

      expect(result.include).toBe(true);
      expect(result.weight).toBe(0.1);
      expect(result.reason).toContain('Sparse');
    });

    it('should return correct settings for tier 2', () => {
      const result = shouldIncludeConversationFeatures(2);

      expect(result.include).toBe(true);
      expect(result.weight).toBe(0.3);
      expect(result.reason).toContain('Moderate');
    });

    it('should return correct settings for tier 3', () => {
      const result = shouldIncludeConversationFeatures(3);

      expect(result.include).toBe(true);
      expect(result.weight).toBe(0.5);
      expect(result.reason).toContain('Strong');
    });
  });

  describe('regularizeFeatureImportance', () => {
    it('should apply weight to importance scores', () => {
      const importance = [
        {
          feature_name: 'call_count' as keyof ConversationFeatureColumns,
          importance_score: 0.8,
          won_avg: 5,
          lost_avg: 2,
          delta: 3,
          statistical_significance: 'high' as const,
        },
        {
          feature_name: 'champion_signal_count' as keyof ConversationFeatureColumns,
          importance_score: 0.6,
          won_avg: 3,
          lost_avg: 1,
          delta: 2,
          statistical_significance: 'high' as const,
        },
      ];

      // Tier 2 has weight 0.3
      const result = regularizeFeatureImportance(importance, 2);

      expect(result[0].importance_score).toBeCloseTo(0.8 * 0.3, 2);
      expect(result[1].importance_score).toBeCloseTo(0.6 * 0.3, 2);
    });

    it('should zero out all scores for tier 0', () => {
      const importance = [
        {
          feature_name: 'call_count' as keyof ConversationFeatureColumns,
          importance_score: 0.8,
          won_avg: 5,
          lost_avg: 2,
          delta: 3,
          statistical_significance: 'high' as const,
        },
      ];

      const result = regularizeFeatureImportance(importance, 0);

      expect(result[0].importance_score).toBe(0);
    });

    it('should handle empty importance array', () => {
      const result = regularizeFeatureImportance([], 2);

      expect(result).toEqual([]);
    });

    it('should preserve other fields when applying weight', () => {
      const importance = [
        {
          feature_name: 'call_count' as keyof ConversationFeatureColumns,
          importance_score: 0.8,
          won_avg: 5,
          lost_avg: 2,
          delta: 3,
          statistical_significance: 'high' as const,
        },
      ];

      const result = regularizeFeatureImportance(importance, 2);

      expect(result[0].feature_name).toBe('call_count');
      expect(result[0].won_avg).toBe(5);
      expect(result[0].lost_avg).toBe(2);
      expect(result[0].delta).toBe(3);
      expect(result[0].statistical_significance).toBe('high');
    });
  });
});
