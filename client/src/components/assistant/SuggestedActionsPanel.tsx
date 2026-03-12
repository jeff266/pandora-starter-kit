import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { ActionCard, type ActionCardItem } from '../deals/ActionCard';
import type { SuggestedAction } from './useConversationStream';
import { colors, fonts } from '../../styles/theme';

interface SuggestedActionsPanelProps {
  actions: SuggestedAction[];
  onDismissAll: () => void;
}

export default function SuggestedActionsPanel({ actions, onDismissAll }: SuggestedActionsPanelProps) {
  const [cards, setCards] = useState<ActionCardItem[]>([]);
  const [syncing, setSyncing] = useState(true);
  const [syncError, setSyncError] = useState(false);

  useEffect(() => {
    if (actions.length === 0) {
      setSyncing(false);
      return;
    }
    let cancelled = false;
    setSyncing(true);
    setSyncError(false);

    api.post('/suggested-actions/sync', { actions })
      .then((res: { cards: ActionCardItem[] }) => {
        if (!cancelled) {
          setCards(res.cards ?? []);
          setSyncing(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSyncing(false);
          setSyncError(true);
        }
      });

    return () => { cancelled = true; };
  }, [actions]);

  function removeCard(id: string) {
    setCards(prev => prev.filter(c => c.id !== id));
  }

  if (syncing) {
    return (
      <div style={{
        marginTop: 12,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: '12px 14px',
        background: colors.surface,
      }}>
        <div style={{ fontSize: 12, color: colors.textMuted, fontFamily: fonts.sans }}>
          Identifying actions…
        </div>
      </div>
    );
  }

  if (syncError || cards.length === 0) return null;

  return (
    <div style={{
      marginTop: 12,
      border: `1px solid ${colors.border}`,
      borderRadius: 10,
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '10px 14px',
        borderBottom: `1px solid ${colors.border}`,
        background: `${colors.accent}08`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{
          fontSize: 12,
          fontWeight: 700,
          color: colors.accent,
          fontFamily: fonts.sans,
          letterSpacing: '0.03em',
        }}>
          ⚡ {cards.length} action{cards.length !== 1 ? 's' : ''} from this analysis
        </span>
        <button
          onClick={onDismissAll}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 11,
            color: colors.textMuted,
            fontFamily: fonts.sans,
            padding: 0,
          }}
        >
          Dismiss all
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 14px' }}>
        {cards.map(card => (
          <ActionCard
            key={card.id}
            item={card}
            onRemove={removeCard}
          />
        ))}
      </div>
    </div>
  );
}
