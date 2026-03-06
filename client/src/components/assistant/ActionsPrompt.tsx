/**
 * Actions Prompt
 *
 * Asks user permission before showing recommended action cards.
 * Only reveals actions after user explicitly opts in.
 */

import { useState } from 'react';
import { colors, fonts } from '../../styles/theme';
import ActionCard, { type RecommendedAction } from './ActionCard';

interface ActionsPromptProps {
  actions: RecommendedAction[];
  onDismiss: (id: string) => void;
}

export default function ActionsPrompt({ actions, onDismiss }: ActionsPromptProps) {
  const [showActions, setShowActions] = useState<boolean | null>(null);

  if (showActions === null) {
    return (
      <div style={{
        marginBottom: 16,
        padding: '12px 14px',
        borderRadius: 8,
        background: colors.surfaceRaised,
        border: `1px solid ${colors.border}`,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}>
        <div style={{
          width: 28,
          height: 28,
          borderRadius: 6,
          flexShrink: 0,
          background: colors.accentSoft,
          border: `1px solid ${colors.accentGlow}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 14,
        }}>
          ✦
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 12,
            fontWeight: 600,
            color: colors.text,
            marginBottom: 3,
            fontFamily: fonts.sans,
          }}>
            I found {actions.length} recommended action{actions.length !== 1 ? 's' : ''} based on this data
          </div>
          <div style={{
            fontSize: 11,
            color: colors.textMuted,
            fontFamily: fonts.sans,
          }}>
            {actions.map(a => a.type).filter((v, i, arr) => arr.indexOf(v) === i).join(' • ')}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button
            onClick={() => setShowActions(true)}
            style={{
              padding: '6px 12px',
              fontSize: 11,
              fontWeight: 600,
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              background: colors.accent,
              color: '#fff',
              fontFamily: fonts.sans,
              boxShadow: `0 0 12px ${colors.accentGlow}`,
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.9')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            Yes, show actions
          </button>

          <button
            onClick={() => setShowActions(false)}
            style={{
              padding: '6px 12px',
              fontSize: 11,
              fontWeight: 500,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              cursor: 'pointer',
              background: 'transparent',
              color: colors.textSecondary,
              fontFamily: fonts.sans,
            }}
            onMouseEnter={e => (e.currentTarget.style.color = colors.text)}
            onMouseLeave={e => (e.currentTarget.style.color = colors.textSecondary)}
          >
            No thanks
          </button>
        </div>
      </div>
    );
  }

  if (showActions === false) {
    return null;
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        fontSize: 10,
        fontWeight: 600,
        color: colors.textMuted,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        marginBottom: 8,
        fontFamily: fonts.sans,
      }}>
        Recommended Actions
      </div>
      {actions.map(action => (
        <ActionCard key={action.id} action={action} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
