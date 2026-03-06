import { useState, useEffect } from 'react';
import { api } from '../lib/api';

export interface InlineActionEvidence {
  label: string;
  value: string;
  signal_type: 'conversation' | 'stakeholder' | 'activity' | 'timing' | 'keyword';
}

export interface InlineAction {
  id: string;
  action_type: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  summary: string;
  confidence: number;
  from_value: string | null;
  to_value: string | null;
  evidence: InlineActionEvidence[];
  impact_label: string | null;
  urgency_label: string | null;
  execution_status: string;
  created_at: string;
  deal_name?: string;
  target_deal_id?: string;
}

export function useInlineActions(dealId?: string) {
  const [actions, setActions] = useState<InlineAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dealId) {
      setActions([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    api
      .get(`/deals/${dealId}/actions`)
      .then((response) => {
        setActions(response.data.actions || []);
        setError(null);
      })
      .catch((err) => {
        console.error('[useInlineActions] Fetch failed:', err);
        setError(err.message);
        setActions([]);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [dealId]);

  const executeAction = async (actionId: string, overrideStage?: string) => {
    try {
      await api.post(`/actions/${actionId}/execute-inline`, {
        override_stage: overrideStage,
      });
      // Remove executed action from list
      setActions((prev) => prev.filter((a) => a.id !== actionId));
    } catch (err: any) {
      throw new Error(err.response?.data?.error || 'Failed to execute action');
    }
  };

  const dismissAction = async (actionId: string) => {
    try {
      await api.post(`/actions/${actionId}/dismiss`);
      // Remove dismissed action from list
      setActions((prev) => prev.filter((a) => a.id !== actionId));
    } catch (err: any) {
      throw new Error(err.response?.data?.error || 'Failed to dismiss action');
    }
  };

  return {
    actions,
    loading,
    error,
    executeAction,
    dismissAction,
  };
}
