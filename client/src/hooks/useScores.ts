import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import type { RFMSegmentData } from '../components/account/AccountRFMSegment';

export interface AccountScores {
  account_id: string;
  icp_score: number;
  icp_tier: 'A' | 'B' | 'C' | 'D';
  lead_score: number;
  lead_tier: 'HOT' | 'WARM' | 'COLD';
  intent_score: number;
  engagement_score: number;
  fit_score: number;
  recency_score: number;
  last_scored_at: string;
  scoring_factors?: {
    positive: Array<{ factor: string; impact: number; reason: string }>;
    negative: Array<{ factor: string; impact: number; reason: string }>;
  };
  rfmSegment?: RFMSegmentData | null;
}

interface UseScoresOptions {
  accountId?: string;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

export function useScores(options: UseScoresOptions = {}) {
  const {
    accountId,
    autoRefresh = false,
    refreshInterval = 600000,
  } = options;

  const [scores, setScores] = useState<AccountScores | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchScores = useCallback(async () => {
    if (!accountId) return;

    try {
      setLoading(true);
      setError(null);

      const data = await api.get(`/accounts/${accountId}/scores`);
      setScores(data);
    } catch (err: any) {
      console.error('Failed to fetch scores:', err);
      setError(err.message || 'Failed to fetch scores');
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    if (accountId) {
      fetchScores();
    }
  }, [accountId, fetchScores]);

  useEffect(() => {
    if (!autoRefresh || !accountId) return;

    const interval = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      fetchScores();
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, accountId, fetchScores]);

  const recalculateScores = useCallback(async () => {
    if (!accountId) return;

    try {
      setLoading(true);
      setError(null);

      await api.post(`/accounts/${accountId}/scores/recalculate`);
      await fetchScores();
    } catch (err: any) {
      console.error('Failed to recalculate scores:', err);
      setError(err.message || 'Failed to recalculate scores');
      throw err;
    }
  }, [accountId, fetchScores]);

  return {
    scores,
    loading,
    error,
    refetch: fetchScores,
    recalculateScores,
  };
}
