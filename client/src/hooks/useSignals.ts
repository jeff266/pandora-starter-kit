import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

export type SignalCategory =
  | 'funding'
  | 'acquisition'
  | 'expansion'
  | 'executive_change'
  | 'layoff'
  | 'product_launch'
  | 'partnership'
  | 'stakeholder_departure'
  | 'stakeholder_promotion'
  | 'stakeholder_role_change';

export type SignalType = 'market_news' | 'stakeholder_change' | 'activity';

export interface Signal {
  id: string;
  workspace_id: string;
  account_id: string;
  signal_type: SignalType;
  signal_category: SignalCategory;
  headline: string;
  description?: string;
  source?: string;
  source_url?: string;
  signal_date: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  relevance: 'high' | 'medium' | 'low';
  buying_trigger: boolean;
  confidence: number;
  metadata?: Record<string, any>;
  created_at: string;
}

export interface SignalsSummary {
  total_signals: number;
  high_priority: number;
  buying_triggers: number;
  signal_strength: 'HOT' | 'WARM' | 'NEUTRAL' | 'COLD';
  recent_signals: Signal[];
  by_category: Array<{ category: SignalCategory; count: number }>;
}

interface UseSignalsOptions {
  accountId?: string;
  lookbackDays?: number;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

export function useSignals(options: UseSignalsOptions = {}) {
  const {
    accountId,
    lookbackDays = 90,
    autoRefresh = false,
    refreshInterval = 300000, // 5 minutes
  } = options;

  const [signals, setSignals] = useState<Signal[]>([]);
  const [summary, setSummary] = useState<SignalsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSignals = useCallback(async () => {
    if (!accountId) return;

    try {
      setLoading(true);
      setError(null);

      const data = await api.get(`/accounts/${accountId}/signals?lookback_days=${lookbackDays}`);
      setSignals(data.signals || []);
      setSummary(data.summary || null);
    } catch (err: any) {
      console.error('Failed to fetch signals:', err);
      setError(err.message || 'Failed to fetch signals');
    } finally {
      setLoading(false);
    }
  }, [accountId, lookbackDays]);

  useEffect(() => {
    if (accountId) {
      fetchSignals();
    }
  }, [accountId, fetchSignals]);

  useEffect(() => {
    if (!autoRefresh || !accountId) return;

    const interval = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      fetchSignals();
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, accountId, fetchSignals]);

  const refreshSignals = useCallback(async (forceCheck = false) => {
    if (!accountId) return;

    try {
      setLoading(true);
      setError(null);

      // Trigger new signal check via chat tool
      const result = await api.post('/chat/message', {
        message: `Check market signals for account ${accountId}`,
        force_check: forceCheck,
      });

      // Refetch signals after check
      await fetchSignals();
      return result;
    } catch (err: any) {
      console.error('Failed to refresh signals:', err);
      setError(err.message || 'Failed to refresh signals');
      throw err;
    }
  }, [accountId, fetchSignals]);

  return {
    signals,
    summary,
    loading,
    error,
    refetch: fetchSignals,
    refreshSignals,
  };
}
