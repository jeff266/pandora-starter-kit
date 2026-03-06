/**
 * InlineActionsPanel
 *
 * Displays pending inline actions (stage updates, etc.) for deals mentioned in conversation.
 * Automatically fetches actions for deal IDs found in the response.
 */

import { useEffect, useState } from 'react';
import { colors, fonts } from '../../styles/theme';
import StageRecCard from '../actions/StageRecCard';
import { api } from '../../lib/api';
import type { InlineAction } from '../../hooks/useInlineActions';

interface InlineActionsPanelProps {
  dealIds: string[];
  compact?: boolean;
}

export default function InlineActionsPanel({ dealIds, compact = false }: InlineActionsPanelProps) {
  const [actions, setActions] = useState<InlineAction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (dealIds.length === 0) {
      setActions([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    // Fetch actions for all deal IDs
    Promise.all(
      dealIds.map((dealId) =>
        api
          .get(`/deals/${dealId}/actions`)
          .then((res) => res.data.actions || [])
          .catch(() => [])
      )
    )
      .then((results) => {
        const allActions = results.flat();
        setActions(allActions);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [dealIds]);

  const handleExecute = async (actionId: string, overrideStage?: string) => {
    try {
      await api.post(`/actions/${actionId}/execute-inline`, {
        override_stage: overrideStage,
      });
      setActions((prev) => prev.filter((a) => a.id !== actionId));
    } catch (err: any) {
      throw new Error(err.response?.data?.error || 'Failed to execute action');
    }
  };

  const handleDismiss = async (actionId: string) => {
    try {
      await api.post(`/actions/${actionId}/dismiss`);
      setActions((prev) => prev.filter((a) => a.id !== actionId));
    } catch (err: any) {
      throw new Error(err.response?.data?.error || 'Failed to dismiss action');
    }
  };

  if (loading) {
    return (
      <div
        style={{
          padding: compact ? '8px 12px' : '10px 14px',
          fontSize: 11,
          color: colors.textMuted,
          fontFamily: fonts.sans,
        }}
      >
        Loading recommendations...
      </div>
    );
  }

  if (actions.length === 0) {
    return null;
  }

  const stageUpdateActions = actions.filter((a) => a.action_type === 'update_stage');

  if (stageUpdateActions.length === 0) {
    return null;
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: colors.textMuted,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: 8,
          fontFamily: fonts.sans,
        }}
      >
        Recommended Actions
      </div>
      {stageUpdateActions.map((action) => (
        <StageRecCard
          key={action.id}
          action={action}
          onExecute={(overrideStage) => handleExecute(action.id, overrideStage)}
          onDismiss={() => handleDismiss(action.id)}
          compact={compact}
        />
      ))}
    </div>
  );
}
