/**
 * Unit tests for conversation-features.ts
 *
 * Tests conversation linking, metadata aggregation, excerpt extraction,
 * and coverage tier calculation with edge cases.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  linkConversationsToDeals,
  extractTranscriptExcerpts,
  computeConversationCoverage,
  buildConversationFeatures,
  generateMockConversationMetadata,
  generateMockTranscriptExcerpts,
  type ConversationMetadata,
  type TranscriptExcerpt,
  type ConversationCoverage,
} from '../conversation-features.js';

// Mock the database query function
vi.mock('../../db.js', () => ({
  query: vi.fn(),
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

import { query } from '../../db.js';

describe('conversation-features', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('linkConversationsToDeals', () => {
    it('should return empty array when no deal IDs provided', async () => {
      const result = await linkConversationsToDeals('workspace-1', []);
      expect(result).toEqual([]);
      expect(query).not.toHaveBeenCalled();
    });

    it('should link conversations via direct match', async () => {
      vi.mocked(query).mockResolvedValueOnce({
        rows: [
          { deal_id: 'deal-1', conversation_ids: ['conv-1', 'conv-2'] },
          { deal_id: 'deal-2', conversation_ids: ['conv-3'] },
        ],
      } as any);

      // Fuzzy account query (none found)
      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any);

      // Fuzzy contact query (none found)
      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any);

      const result = await linkConversationsToDeals('workspace-1', ['deal-1', 'deal-2', 'deal-3']);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        deal_id: 'deal-1',
        conversation_ids: ['conv-1', 'conv-2'],
        link_method: 'direct',
      });
      expect(result[1]).toEqual({
        deal_id: 'deal-2',
        conversation_ids: ['conv-3'],
        link_method: 'direct',
      });
    });

    it('should fall back to fuzzy account matching for deals without direct links', async () => {
      // Direct links (only deal-1 has direct link)
      vi.mocked(query).mockResolvedValueOnce({
        rows: [{ deal_id: 'deal-1', conversation_ids: ['conv-1'] }],
      } as any);

      // Fuzzy account links (deal-2 matched via account)
      vi.mocked(query).mockResolvedValueOnce({
        rows: [{ deal_id: 'deal-2', conversation_ids: ['conv-2', 'conv-3'] }],
      } as any);

      // Fuzzy contact links (none)
      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any);

      const result = await linkConversationsToDeals('workspace-1', ['deal-1', 'deal-2', 'deal-3']);

      expect(result).toHaveLength(2);
      expect(result[0].link_method).toBe('direct');
      expect(result[1].link_method).toBe('fuzzy_account');
    });

    it('should fall back to fuzzy contact matching when account matching fails', async () => {
      // No direct links
      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any);

      // No fuzzy account links
      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any);

      // Fuzzy contact links
      vi.mocked(query).mockResolvedValueOnce({
        rows: [{ deal_id: 'deal-1', conversation_ids: ['conv-1'] }],
      } as any);

      const result = await linkConversationsToDeals('workspace-1', ['deal-1']);

      expect(result).toHaveLength(1);
      expect(result[0].link_method).toBe('fuzzy_contact');
    });

    it('should handle deals with no conversations at all', async () => {
      // No links at any level
      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any);
      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any);
      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any);

      const result = await linkConversationsToDeals('workspace-1', ['deal-1', 'deal-2']);

      expect(result).toEqual([]);
    });

    it('should not duplicate deals in result', async () => {
      // Same deal appears in multiple link types (shouldn't happen but defensive)
      vi.mocked(query).mockResolvedValueOnce({
        rows: [{ deal_id: 'deal-1', conversation_ids: ['conv-1'] }],
      } as any);

      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any);
      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any);

      const result = await linkConversationsToDeals('workspace-1', ['deal-1']);

      expect(result).toHaveLength(1);
      expect(result[0].deal_id).toBe('deal-1');
    });
  });

  describe('extractTranscriptExcerpts', () => {
    it('should return empty array when no conversation IDs provided', async () => {
      const result = await extractTranscriptExcerpts('workspace-1', [], 1500);
      expect(result).toEqual([]);
      expect(query).not.toHaveBeenCalled();
    });

    it('should extract excerpts from conversations with transcripts', async () => {
      vi.mocked(query).mockResolvedValueOnce({
        rows: [
          {
            id: 'conv-1',
            transcript_text: 'This is a long transcript that should be truncated...',
            summary: 'Summary text',
            source: 'gong',
            call_date: '2024-01-15T10:00:00Z',
          },
          {
            id: 'conv-2',
            transcript_text: 'Another transcript',
            summary: null,
            source: 'fireflies',
            call_date: '2024-01-16T10:00:00Z',
          },
        ],
      } as any);

      const result = await extractTranscriptExcerpts('workspace-1', ['conv-1', 'conv-2'], 1500);

      expect(result).toHaveLength(2);
      expect(result[0].conversation_id).toBe('conv-1');
      expect(result[0].excerpt).toContain('transcript');
      expect(result[0].source).toBe('gong');
      expect(result[1].conversation_id).toBe('conv-2');
    });

    it('should fallback to summary when transcript_text is null', async () => {
      vi.mocked(query).mockResolvedValueOnce({
        rows: [
          {
            id: 'conv-1',
            transcript_text: null,
            summary: 'This is the summary text',
            source: 'gong',
            call_date: '2024-01-15T10:00:00Z',
          },
        ],
      } as any);

      const result = await extractTranscriptExcerpts('workspace-1', ['conv-1'], 1500);

      expect(result).toHaveLength(1);
      expect(result[0].excerpt).toBe('This is the summary text');
    });

    it('should skip conversations with no text at all', async () => {
      vi.mocked(query).mockResolvedValueOnce({
        rows: [
          {
            id: 'conv-1',
            transcript_text: null,
            summary: null,
            source: 'gong',
            call_date: '2024-01-15T10:00:00Z',
          },
          {
            id: 'conv-2',
            transcript_text: 'Has text',
            summary: null,
            source: 'fireflies',
            call_date: '2024-01-16T10:00:00Z',
          },
        ],
      } as any);

      const result = await extractTranscriptExcerpts('workspace-1', ['conv-1', 'conv-2'], 1500);

      expect(result).toHaveLength(1);
      expect(result[0].conversation_id).toBe('conv-2');
    });

    it('should truncate excerpts to fit token budget', async () => {
      const longText = 'a'.repeat(10000); // 10,000 chars

      vi.mocked(query).mockResolvedValueOnce({
        rows: [
          {
            id: 'conv-1',
            transcript_text: longText,
            summary: null,
            source: 'gong',
            call_date: '2024-01-15T10:00:00Z',
          },
        ],
      } as any);

      const result = await extractTranscriptExcerpts('workspace-1', ['conv-1'], 500); // 500 tokens = ~2000 chars

      expect(result).toHaveLength(1);
      expect(result[0].excerpt.length).toBeLessThanOrEqual(2003); // 2000 + '...'
      expect(result[0].excerpt).toContain('...');
    });

    it('should distribute token budget across multiple conversations', async () => {
      const text1 = 'a'.repeat(5000);
      const text2 = 'b'.repeat(5000);
      const text3 = 'c'.repeat(5000);

      vi.mocked(query).mockResolvedValueOnce({
        rows: [
          { id: 'conv-1', transcript_text: text1, summary: null, source: 'gong', call_date: '2024-01-15T10:00:00Z' },
          { id: 'conv-2', transcript_text: text2, summary: null, source: 'gong', call_date: '2024-01-16T10:00:00Z' },
          { id: 'conv-3', transcript_text: text3, summary: null, source: 'gong', call_date: '2024-01-17T10:00:00Z' },
        ],
      } as any);

      const result = await extractTranscriptExcerpts('workspace-1', ['conv-1', 'conv-2', 'conv-3'], 1500);

      expect(result).toHaveLength(3);

      // Each should get ~500 tokens = ~2000 chars
      for (const excerpt of result) {
        expect(excerpt.token_count).toBeLessThanOrEqual(600); // ~500 + margin
      }
    });

    it('should handle empty conversation result from query', async () => {
      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any);

      const result = await extractTranscriptExcerpts('workspace-1', ['conv-1'], 1500);

      expect(result).toEqual([]);
    });

    it('should estimate token count correctly', async () => {
      const text = 'a'.repeat(400); // 400 chars ~= 100 tokens

      vi.mocked(query).mockResolvedValueOnce({
        rows: [
          { id: 'conv-1', transcript_text: text, summary: null, source: 'gong', call_date: '2024-01-15T10:00:00Z' },
        ],
      } as any);

      const result = await extractTranscriptExcerpts('workspace-1', ['conv-1'], 1500);

      expect(result[0].token_count).toBeGreaterThanOrEqual(90);
      expect(result[0].token_count).toBeLessThanOrEqual(110);
    });
  });

  describe('computeConversationCoverage', () => {
    it('should return tier 0 when no closed-won deals exist', async () => {
      vi.mocked(query).mockResolvedValueOnce({
        rows: [{ total: 0 }],
      } as any);

      const result = await computeConversationCoverage('workspace-1');

      expect(result.tier).toBe(0);
      expect(result.tier_label).toBe('none');
      expect(result.total_closed_won_deals).toBe(0);
      expect(result.deals_with_conversations).toBe(0);
      expect(result.coverage_percent).toBe(0);
    });

    it('should return tier 0 when coverage is 0%', async () => {
      vi.mocked(query).mockResolvedValueOnce({
        rows: [{ total: 10 }],
      } as any);

      vi.mocked(query).mockResolvedValueOnce({
        rows: [{ covered: 0 }],
      } as any);

      const result = await computeConversationCoverage('workspace-1');

      expect(result.tier).toBe(0);
      expect(result.tier_label).toBe('none');
      expect(result.coverage_percent).toBe(0);
    });

    it('should return tier 1 when coverage is <30%', async () => {
      vi.mocked(query).mockResolvedValueOnce({
        rows: [{ total: 100 }],
      } as any);

      vi.mocked(query).mockResolvedValueOnce({
        rows: [{ covered: 25 }],
      } as any);

      const result = await computeConversationCoverage('workspace-1');

      expect(result.tier).toBe(1);
      expect(result.tier_label).toBe('sparse');
      expect(result.coverage_percent).toBe(25);
    });

    it('should return tier 2 when coverage is 30-70%', async () => {
      vi.mocked(query).mockResolvedValueOnce({
        rows: [{ total: 100 }],
      } as any);

      vi.mocked(query).mockResolvedValueOnce({
        rows: [{ covered: 50 }],
      } as any);

      const result = await computeConversationCoverage('workspace-1');

      expect(result.tier).toBe(2);
      expect(result.tier_label).toBe('moderate');
      expect(result.coverage_percent).toBe(50);
    });

    it('should return tier 3 when coverage is >70%', async () => {
      vi.mocked(query).mockResolvedValueOnce({
        rows: [{ total: 100 }],
      } as any);

      vi.mocked(query).mockResolvedValueOnce({
        rows: [{ covered: 85 }],
      } as any);

      const result = await computeConversationCoverage('workspace-1');

      expect(result.tier).toBe(3);
      expect(result.tier_label).toBe('strong');
      expect(result.coverage_percent).toBe(85);
    });

    it('should correctly classify boundary cases (exactly 30% and 70%)', async () => {
      // Exactly 30% should be tier 2
      vi.mocked(query).mockResolvedValueOnce({
        rows: [{ total: 100 }],
      } as any);
      vi.mocked(query).mockResolvedValueOnce({
        rows: [{ covered: 30 }],
      } as any);

      let result = await computeConversationCoverage('workspace-1');
      expect(result.tier).toBe(2);

      // Exactly 70% should be tier 3
      vi.mocked(query).mockResolvedValueOnce({
        rows: [{ total: 100 }],
      } as any);
      vi.mocked(query).mockResolvedValueOnce({
        rows: [{ covered: 70 }],
      } as any);

      result = await computeConversationCoverage('workspace-1');
      expect(result.tier).toBe(3);
    });

    it('should handle 100% coverage', async () => {
      vi.mocked(query).mockResolvedValueOnce({
        rows: [{ total: 50 }],
      } as any);

      vi.mocked(query).mockResolvedValueOnce({
        rows: [{ covered: 50 }],
      } as any);

      const result = await computeConversationCoverage('workspace-1');

      expect(result.tier).toBe(3);
      expect(result.tier_label).toBe('strong');
      expect(result.coverage_percent).toBe(100);
    });

    it('should handle empty query results gracefully', async () => {
      vi.mocked(query).mockResolvedValueOnce({
        rows: [],
      } as any);

      const result = await computeConversationCoverage('workspace-1');

      expect(result.tier).toBe(0);
      expect(result.coverage_percent).toBe(0);
    });
  });

  describe('buildConversationFeatures', () => {
    it('should return empty array when no deal IDs provided', async () => {
      const result = await buildConversationFeatures('workspace-1', []);
      expect(result).toEqual([]);
    });

    it('should return features with has_conversations=false for deals without conversations', async () => {
      // No direct links
      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any);
      // No fuzzy account links
      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any);
      // No fuzzy contact links
      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any);

      const result = await buildConversationFeatures('workspace-1', ['deal-1']);

      expect(result).toHaveLength(1);
      expect(result[0].deal_id).toBe('deal-1');
      expect(result[0].has_conversations).toBe(false);
      expect(result[0].metadata).toBeNull();
      expect(result[0].transcript_excerpts).toEqual([]);
    });
  });

  describe('Mock data generators', () => {
    it('should generate valid mock conversation metadata', () => {
      const metadata = generateMockConversationMetadata();

      expect(metadata.call_count).toBeGreaterThan(0);
      expect(metadata.total_duration_minutes).toBeGreaterThan(0);
      expect(metadata.avg_duration_minutes).toBeGreaterThan(0);
      expect(metadata.avg_sentiment_score).toBeGreaterThanOrEqual(-1);
      expect(metadata.avg_sentiment_score).toBeLessThanOrEqual(1);
      expect(metadata.unique_participants).toBeGreaterThan(0);
    });

    it('should generate valid mock transcript excerpts', () => {
      const excerpts = generateMockTranscriptExcerpts(3);

      expect(excerpts).toHaveLength(3);

      for (const excerpt of excerpts) {
        expect(excerpt.conversation_id).toMatch(/^mock-conversation-\d+$/);
        expect(excerpt.excerpt).toBeTruthy();
        expect(excerpt.token_count).toBeGreaterThan(0);
        expect(excerpt.source).toBe('mock');
        expect(excerpt.call_date).toBeTruthy();
      }
    });

    it('should generate different mock data on each call', () => {
      const metadata1 = generateMockConversationMetadata();
      const metadata2 = generateMockConversationMetadata();

      // Very unlikely to be exactly the same
      expect(metadata1).not.toEqual(metadata2);
    });
  });
});
