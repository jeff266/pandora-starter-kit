import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

export interface Action {
  id: string;
  action_type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  summary?: string;
  recommended_steps?: string[];
  target_deal_name?: string;
  target_entity_name?: string;
  deal_name?: string;
  target_deal_id?: string;
  target_account_id?: string;
  owner_email?: string;
  impact_amount?: number;
  urgency_label?: string;
  execution_status: 'open' | 'in_progress' | 'executed' | 'dismissed' | 'rejected' | 'snoozed' | 'failed';
  execution_result?: Array<{
    type: 'crm_update' | 'crm_note' | 'slack_notify';
    target: string;
    result: any;
    error?: string;
  }>;
  executed_at?: string;
  executed_by?: string;
  snoozed_until?: string;
  dismissed_reason?: string;
  source_skill: string;
  source_run_id?: string;
  created_at: string;
  execution_payload?: {
    crm_updates?: Array<{ field: string; current_value: any; proposed_value: any }>;
  };
}

export interface ActionsSummary {
  open_total: number;
  open_critical: number;
  open_warning: number;
  open_info: number;
  in_progress: number;
  executed_7d: number;
  total_impact_at_risk: number;
  reps_with_actions: number;
  by_type: Array<{ action_type: string; count: number }>;
  by_rep: Array<{ owner_email: string; action_count: number; critical_count: number }>;
}

interface UseActionsOptions {
  status?: string;
  limit?: number;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

export function useActions(options: UseActionsOptions = {}) {
  const {
    status = 'all',
    limit = 200,
    autoRefresh = true,
    refreshInterval = 120000, // 2 minutes
  } = options;

  const [actions, setActions] = useState<Action[]>([]);
  const [summary, setSummary] = useState<ActionsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchActions = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      const [summaryData, actionsData] = await Promise.all([
        api.get('/action-items/summary'),
        api.get(`/action-items?status=${status}&limit=${limit}`),
      ]);

      setSummary(summaryData);
      setActions(actionsData.actions || []);
    } catch (err: any) {
      console.error('Failed to fetch actions:', err);
      setError(err.message || 'Failed to fetch actions');
    } finally {
      if (isRefresh) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }, [status, limit]);

  useEffect(() => {
    fetchActions();
  }, [fetchActions]);

  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      fetchActions(true);
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, fetchActions]);

  const executeAction = useCallback(async (actionId: string, actor = 'user') => {
    try {
      const result = await api.post(`/action-items/${actionId}/execute`, { actor });
      await fetchActions();
      return result;
    } catch (err: any) {
      throw new Error(err.message || 'Failed to execute action');
    }
  }, [fetchActions]);

  const snoozeAction = useCallback(async (actionId: string, days: number) => {
    try {
      await api.post(`/action-items/${actionId}/snooze`, { days });
      await fetchActions();
    } catch (err: any) {
      throw new Error(err.message || 'Failed to snooze action');
    }
  }, [fetchActions]);

  const dismissAction = useCallback(async (actionId: string, reason?: string) => {
    try {
      await api.post(`/action-items/${actionId}/dismiss`, { reason });
      await fetchActions();
    } catch (err: any) {
      throw new Error(err.message || 'Failed to dismiss action');
    }
  }, [fetchActions]);

  return {
    actions,
    summary,
    loading,
    refreshing,
    error,
    refetch: fetchActions,
    executeAction,
    snoozeAction,
    dismissAction,
  };
}
