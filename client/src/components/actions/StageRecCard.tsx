/**
 * Stage Recommendation Card
 *
 * Reusable inline action card for surfacing stage update recommendations.
 * Rendered in: Ask Pandora chat, Deal List badges, Deal Detail signals panel.
 */

import { useState } from 'react';
import { colors, fonts } from '../../styles/theme';
import { Icon } from '../icons';

interface Evidence {
  label: string;
  value: string;
  signal_type: 'conversation' | 'stakeholder' | 'activity' | 'timing' | 'keyword';
}

interface InlineAction {
  id: string;
  action_type: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  summary: string;
  confidence: number;
  from_value: string | null;
  to_value: string | null;
  evidence: Evidence[];
  impact_label: string | null;
  urgency_label: string | null;
  execution_status: string;
  created_at: string;
  deal_name?: string;
}

interface StageRecCardProps {
  action: InlineAction;
  onExecute: (overrideStage?: string) => Promise<void>;
  onDismiss: () => Promise<void>;
  loading?: boolean;
  compact?: boolean; // Smaller variant for chat
}

type CardState = 'pending' | 'loading' | 'executed' | 'dismissed';

const EVIDENCE_ICONS: Record<Evidence['signal_type'], string> = {
  conversation: 'network',
  stakeholder: 'connections',
  activity: 'flow',
  timing: 'target',
  keyword: 'filter',
};

export default function StageRecCard({
  action,
  onExecute,
  onDismiss,
  loading = false,
  compact = false,
}: StageRecCardProps) {
  const [state, setState] = useState<CardState>('pending');
  const [evidenceExpanded, setEvidenceExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [customStage, setCustomStage] = useState(action.to_value || '');
  const [executing, setExecuting] = useState(false);
  const [resolveFindingsToo, setResolveFindingsToo] = useState(true);

  const isUpdateStage = action.action_type === 'update_stage';

  // Executed state
  if (state === 'executed') {
    return (
      <div style={{
        margin: compact ? '8px 0' : '10px 0',
        borderRadius: compact ? 6 : 8,
        border: `1px solid ${colors.greenBorder}`,
        background: colors.greenSoft,
        padding: compact ? '8px 12px' : '11px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        <Icon name="check" size={14} color={colors.green} />
        <span style={{ fontSize: compact ? 12 : 13, color: colors.green, fontWeight: 500, fontFamily: fonts.sans }}>
          Stage updated to <strong>{customStage || action.to_value}</strong> in {action.deal_name ? 'CRM' : 'HubSpot'}
        </span>
        <span style={{ fontSize: 11, color: colors.textMuted, marginLeft: 'auto', fontFamily: fonts.sans }}>just now</span>
      </div>
    );
  }

  // Dismissed state
  if (state === 'dismissed') {
    return (
      <div style={{
        margin: compact ? '8px 0' : '10px 0',
        borderRadius: compact ? 6 : 8,
        border: `1px solid ${colors.border}`,
        background: colors.surface,
        padding: compact ? '8px 12px' : '11px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        opacity: 0.5,
      }}>
        <Icon name="info" size={13} color={colors.textMuted} />
        <span style={{ fontSize: 12, color: colors.textMuted, fontFamily: fonts.sans }}>Recommendation dismissed</span>
      </div>
    );
  }

  const handleExecute = async () => {
    setExecuting(true);
    try {
      await onExecute(editing && customStage !== action.to_value ? customStage : undefined);
      setState('executed');
    } catch (err) {
      console.error('[StageRecCard] Execute failed:', err);
      alert(`Failed to execute: ${(err as Error).message}`);
    } finally {
      setExecuting(false);
    }
  };

  const handleDismiss = async () => {
    try {
      await onDismiss(resolveFindingsToo);
      setState('dismissed');
    } catch (err) {
      console.error('[StageRecCard] Dismiss failed:', err);
    }
  };

  const severityColor = action.severity === 'critical' ? colors.red : colors.orange;
  const severityBg = action.severity === 'critical' ? colors.redSoft : colors.orangeSoft;
  const severityBorder = action.severity === 'critical' ? colors.redBorder : colors.orangeBorder;

  const iconName = isUpdateStage ? 'target' : 'flow';

  return (
    <div style={{
      margin: compact ? '8px 0' : '10px 0',
      borderRadius: compact ? 8 : 10,
      border: `1px solid ${severityBorder}`,
      background: `linear-gradient(135deg, ${colors.surfaceRaised} 0%, ${colors.surface} 100%)`,
      overflow: 'hidden',
      boxShadow: `0 0 0 1px ${colors.border}, 0 ${compact ? '2px 12px' : '4px 20px'} rgba(0,0,0,0.4)`,
    }}>
      {/* Card Header */}
      <div style={{
        padding: compact ? '10px 12px' : '12px 14px 11px',
        borderBottom: `1px solid ${colors.border}`,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
      }}>
        <div style={{
          width: compact ? 24 : 28,
          height: compact ? 24 : 28,
          borderRadius: 6,
          flexShrink: 0,
          background: severityBg,
          border: `1px solid ${severityBorder}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <Icon name={iconName} size={compact ? 12 : 14} color={severityColor} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: compact ? 12 : 13, fontWeight: 600, color: colors.text, fontFamily: fonts.sans }}>
              {action.title}
            </span>
            {action.confidence > 0 && (
              <ConfidencePill pct={action.confidence} compact={compact} />
            )}
          </div>

          {/* Stage transition row */}
          {isUpdateStage && action.from_value && action.to_value && (
            <div style={{
              fontSize: compact ? 11 : 12,
              color: colors.textSecondary,
              marginTop: 5,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexWrap: 'wrap',
            }}>
              <span style={{ color: colors.textMuted, fontFamily: fonts.sans }}>Current:</span>
              <StagePill label={action.from_value} variant="from" compact={compact} />
              <Icon name="arrow" size={12} color={colors.textMuted} />
              <span style={{ color: colors.textMuted, fontFamily: fonts.sans }}>Recommended:</span>

              {editing ? (
                <input
                  value={customStage}
                  onChange={(e) => setCustomStage(e.target.value)}
                  onBlur={() => setEditing(false)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setEditing(false);
                    if (e.key === 'Escape') {
                      setCustomStage(action.to_value || '');
                      setEditing(false);
                    }
                  }}
                  autoFocus
                  style={{
                    background: colors.accentSoft,
                    border: `1px solid ${colors.accentGlow}`,
                    borderRadius: 4,
                    padding: '1px 7px',
                    fontSize: compact ? 10 : 11,
                    color: colors.accent,
                    fontWeight: 600,
                    fontFamily: fonts.sans,
                    outline: 'none',
                    width: 130,
                  }}
                />
              ) : (
                <StagePill label={customStage} variant="to" compact={compact} />
              )}

              <button
                onClick={() => setEditing(!editing)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'flex',
                  opacity: 0.6,
                }}
                title="Edit recommended stage"
              >
                <Icon name="edit" size={compact ? 10 : 11} color={colors.textMuted} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Reasoning/Summary */}
      <div style={{
        padding: compact ? '9px 12px' : '11px 14px',
        borderBottom: `1px solid ${colors.border}`,
      }}>
        <p style={{
          fontSize: compact ? 11.5 : 12.5,
          color: colors.textSecondary,
          lineHeight: 1.65,
          margin: 0,
          fontFamily: fonts.sans,
        }}>
          {action.summary}
        </p>
      </div>

      {/* Collapsible Evidence */}
      {action.evidence.length > 0 && (
        <div>
          <button
            onClick={() => setEvidenceExpanded(!evidenceExpanded)}
            style={{
              width: '100%',
              background: 'none',
              border: 'none',
              borderBottom: evidenceExpanded ? `1px solid ${colors.border}` : 'none',
              cursor: 'pointer',
              padding: compact ? '7px 12px' : '9px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              color: colors.textMuted,
            }}
          >
            <Icon
              name={evidenceExpanded ? 'chevron-down' : 'chevron-right'}
              size={12}
              color={colors.textMuted}
            />
            <span style={{ fontSize: compact ? 10 : 11, fontFamily: fonts.sans }}>
              {evidenceExpanded ? 'Hide' : 'Show'} evidence ({action.evidence.length} signals)
            </span>
          </button>

          {evidenceExpanded && (
            <div style={{ padding: compact ? '2px 12px' : '4px 14px 2px' }}>
              {action.evidence.map((e, i) => (
                <EvidenceRow key={i} evidence={e} compact={compact} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Action Buttons */}
      <div style={{
        padding: compact ? '8px 12px' : '10px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        background: 'rgba(0,0,0,0.15)',
      }}>
        {/* Checkbox for findings resolution */}
        <label style={{
          fontSize: 11,
          color: colors.textMuted,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          cursor: 'pointer',
        }}>
          <input
            type="checkbox"
            checked={resolveFindingsToo}
            onChange={(e) => setResolveFindingsToo(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          Also resolve related findings
        </label>

        {/* Buttons row */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={handleExecute}
            disabled={executing || loading}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: compact ? '6px 12px' : '7px 14px',
            borderRadius: 6,
            cursor: executing || loading ? 'not-allowed' : 'pointer',
            background: executing || loading ? colors.surfaceHover : colors.accent,
            border: 'none',
            fontSize: compact ? 11 : 12,
            fontWeight: 600,
            color: '#fff',
            fontFamily: fonts.sans,
            boxShadow: executing || loading ? 'none' : `0 0 16px ${colors.accentGlow}`,
            opacity: executing || loading ? 0.6 : 1,
          }}
        >
          {executing || loading ? (
            <>
              <Icon name="filter" size={13} color="#fff" />
              Updating...
            </>
          ) : (
            <>
              <Icon name="check" size={13} color="#fff" />
              {isUpdateStage ? 'Update in CRM' : 'Execute'}
            </>
          )}
        </button>

        <button
          onClick={handleDismiss}
          disabled={executing || loading}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: compact ? '6px 10px' : '7px 12px',
            borderRadius: 6,
            cursor: executing || loading ? 'not-allowed' : 'pointer',
            background: 'none',
            border: `1px solid ${colors.border}`,
            fontSize: compact ? 11 : 12,
            color: colors.textMuted,
            fontFamily: fonts.sans,
            opacity: executing || loading ? 0.4 : 1,
          }}
        >
          <Icon name="info" size={12} color={colors.textMuted} />
          Dismiss
        </button>

        <span style={{
          fontSize: compact ? 10 : 11,
          color: colors.textDim,
          marginLeft: 'auto',
          fontFamily: 'monospace',
        }}>
          {formatTimeAgo(action.created_at)}
        </span>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function ConfidencePill({ pct, compact }: { pct: number; compact?: boolean }) {
  const color = pct >= 80 ? colors.green : pct >= 60 ? colors.yellow : colors.orange;
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      fontSize: compact ? 10 : 11,
      fontWeight: 600,
      color,
      background: `${color}18`,
      border: `1px solid ${color}30`,
      borderRadius: 4,
      padding: compact ? '1px 6px' : '2px 7px',
      fontFamily: 'monospace',
    }}>
      {pct}% confidence
    </span>
  );
}

function StagePill({ label, variant, compact }: { label: string; variant: 'from' | 'to' | 'default'; compact?: boolean }) {
  const styles: Record<typeof variant, any> = {
    default: { bg: colors.surfaceRaised, border: colors.border, text: colors.textSecondary },
    from: { bg: colors.orangeSoft, border: colors.orangeBorder, text: colors.orange },
    to: { bg: colors.accentSoft, border: colors.accentGlow, text: colors.accent },
  };

  const s = styles[variant] || styles.default;

  return (
    <span style={{
      fontSize: compact ? 10 : 11,
      fontWeight: 600,
      letterSpacing: '0.03em',
      color: s.text,
      background: s.bg,
      border: `1px solid ${s.border}`,
      borderRadius: 4,
      padding: compact ? '1px 6px' : '2px 8px',
      fontFamily: fonts.sans,
    }}>
      {label}
    </span>
  );
}

function EvidenceRow({ evidence, compact }: { evidence: Evidence; compact?: boolean }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 8,
      padding: compact ? '6px 0' : '7px 0',
      borderBottom: `1px solid ${colors.border}`,
    }}>
      <div style={{ marginTop: 1 }}>
        <Icon name={EVIDENCE_ICONS[evidence.signal_type] || 'filter'} size={compact ? 12 : 13} color={colors.textMuted} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: compact ? 10 : 11, color: colors.textMuted, marginBottom: 2, fontFamily: fonts.sans }}>
          {evidence.label}
        </div>
        <div style={{ fontSize: compact ? 11 : 12, color: colors.textSecondary, lineHeight: 1.5, fontFamily: fonts.sans }}>
          {evidence.value}
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}
