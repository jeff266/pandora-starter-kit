/**
 * Inline Actions Prompt
 *
 * Asks user permission before showing stage recommendation cards.
 * Only reveals actions after user explicitly opts in.
 */

import { useState } from 'react';
import { colors, fonts } from '../../styles/theme';
import StageRecCard from '../actions/StageRecCard';
import type { InlineAction } from './useConversationStream';

interface InlineActionsPromptProps {
  actions: InlineAction[];
  onExecute: (actionId: string, overrideStage?: string) => Promise<void>;
  onDismiss: (actionId: string) => Promise<void>;
}

export default function InlineActionsPrompt({ actions, onExecute, onDismiss }: InlineActionsPromptProps) {
  const [showActions, setShowActions] = useState<boolean | null>(null);

  // User hasn't decided yet - show prompt
  if (showActions === null) {
    const criticalCount = actions.filter(a => a.severity === 'critical').length;
    const warningCount = actions.filter(a => a.severity === 'warning').length;

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
            I found {actions.length} stage recommendation{actions.length !== 1 ? 's' : ''} based on this data
          </div>
          <div style={{
            fontSize: 11,
            color: colors.textMuted,
            fontFamily: fonts.sans,
          }}>
            {criticalCount > 0 && <span style={{ color: colors.red, fontWeight: 600 }}>{criticalCount} critical</span>}
            {criticalCount > 0 && warningCount > 0 && <span style={{ color: colors.textMuted }}> • </span>}
            {warningCount > 0 && <span style={{ color: colors.orange, fontWeight: 600 }}>{warningCount} warning</span>}
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

  // User said no - don't show anything
  if (showActions === false) {
    return null;
  }

  // User said yes - show the actions
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
        Stage Recommendations
      </div>
      {actions.map(action => (
        <StageRecCard
          key={action.id}
          action={{ ...action, execution_status: 'open' }}
          onExecute={async (overrideStage) => {
            await onExecute(action.id, overrideStage);
          }}
          onDismiss={async () => {
            await onDismiss(action.id);
          }}
          compact={true}
        />
      ))}
    </div>
  );
}
