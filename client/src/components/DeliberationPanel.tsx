import { colors } from '../styles/theme';

export interface DeliberationPerspective {
  role: string;
  label: string;
  emoji: string;
  color: string;
  argument: string;
  data_points: string[];
}

export interface DeliberationVerdict {
  planSufficiency: string;
  missingAction: string | null;
  watchMetric: string;
  conclusion: string;
}

export interface DeliberationUIOutput {
  deliberation_run_id: string;
  hypothesis_id: string | null;
  pattern: string;
  perspectives: DeliberationPerspective[];
  verdict: DeliberationVerdict | null;
  created_at: string;
  token_cost: number;
}

const SUFFICIENCY_COLORS: Record<string, { bg: string; text: string }> = {
  sufficient:   { bg: 'rgba(34,197,94,0.12)',  text: '#22c55e' },
  borderline:   { bg: 'rgba(245,158,11,0.12)', text: '#f59e0b' },
  insufficient: { bg: 'rgba(239,68,68,0.12)',  text: '#ef4444' },
};

function PerspectiveBlock({ p }: { p: DeliberationPerspective }) {
  return (
    <div style={{
      padding: '12px',
      background: colors.surfaceRaised,
      borderRadius: 8,
      border: `1px solid ${colors.border}`,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        marginBottom: '8px',
      }}>
        <span style={{ fontSize: '14px' }}>{p.emoji}</span>
        <span style={{
          fontSize: '10px',
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase' as const,
          color: p.color,
        }}>
          {p.label}
        </span>
      </div>

      <p style={{
        fontSize: '13px',
        lineHeight: 1.6,
        color: colors.text,
        margin: 0,
        marginBottom: p.data_points.length > 0 ? '10px' : 0,
      }}>
        {p.argument}
      </p>

      {p.data_points.length > 0 && (
        <ul style={{
          margin: 0,
          paddingLeft: '16px',
          display: 'flex',
          flexDirection: 'column' as const,
          gap: '4px',
        }}>
          {p.data_points.map((dp, i) => (
            <li key={i} style={{
              fontSize: '12px',
              color: colors.textMuted,
              lineHeight: 1.5,
            }}>
              {dp}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function DeliberationPanel({
  result,
  metric,
  onDismiss,
  onAskPandora,
}: {
  result: DeliberationUIOutput;
  metric: string;
  onDismiss: () => void;
  onAskPandora: () => void;
}) {
  const skeptic  = result.perspectives.find(p => p.role === 'red_team' || p.role === 'prosecutor');
  const advocate = result.perspectives.find(p => p.role === 'plan'     || p.role === 'defense');
  const v        = result.verdict;

  const sufficiencyColors = v
    ? (SUFFICIENCY_COLORS[v.planSufficiency] ?? SUFFICIENCY_COLORS.borderline)
    : SUFFICIENCY_COLORS.borderline;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '2px',
      }}>
        <span style={{
          fontSize: '10px',
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase' as const,
          color: colors.textMuted,
        }}>
          ⚖️ Hypothesis Challenge — {metric}
        </span>
        <span style={{
          fontSize: '10px',
          color: colors.textMuted,
          opacity: 0.6,
        }}>
          {result.token_cost > 0 ? `${result.token_cost} tokens` : ''}
        </span>
      </div>

      {skeptic  && <PerspectiveBlock p={skeptic} />}
      {advocate && <PerspectiveBlock p={advocate} />}

      {v && (
        <div style={{
          padding: '12px',
          background: colors.surfaceRaised,
          borderRadius: 8,
          border: `1px solid ${colors.border}`,
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            marginBottom: '8px',
          }}>
            <span style={{ fontSize: '14px' }}>⚖️</span>
            <span style={{
              fontSize: '10px',
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase' as const,
              color: '#3182CE',
            }}>
              Synthesis
            </span>
            <span style={{
              padding: '2px 8px',
              borderRadius: 6,
              fontSize: '10px',
              fontWeight: 500,
              background: sufficiencyColors.bg,
              color: sufficiencyColors.text,
              textTransform: 'capitalize' as const,
              marginLeft: 'auto',
            }}>
              {v.planSufficiency}
            </span>
          </div>

          {v.conclusion && (
            <p style={{
              fontSize: '13px',
              lineHeight: 1.6,
              color: colors.text,
              margin: 0,
              marginBottom: '8px',
            }}>
              {v.conclusion}
            </p>
          )}

          {v.missingAction && (
            <p style={{
              fontSize: '12px',
              color: colors.textMuted,
              lineHeight: 1.5,
              margin: 0,
              marginBottom: '6px',
            }}>
              <strong style={{ color: colors.text }}>Missing:</strong> {v.missingAction}
            </p>
          )}

          {v.watchMetric && (
            <p style={{
              fontSize: '12px',
              color: colors.textMuted,
              lineHeight: 1.5,
              margin: 0,
            }}>
              <strong style={{ color: colors.text }}>Watch:</strong> {v.watchMetric}
            </p>
          )}
        </div>
      )}

      <div style={{
        display: 'flex',
        gap: '8px',
        marginTop: '4px',
      }}>
        <button
          onClick={onAskPandora}
          style={{
            fontSize: '12px',
            color: colors.accent,
            background: 'none',
            border: `0.5px solid ${colors.border}`,
            borderRadius: 8,
            padding: '5px 12px',
            cursor: 'pointer',
            flex: 1,
          }}
        >
          Ask Pandora about this
        </button>
        <button
          onClick={onDismiss}
          style={{
            fontSize: '12px',
            color: colors.textMuted,
            background: 'none',
            border: `0.5px solid ${colors.border}`,
            borderRadius: 8,
            padding: '5px 12px',
            cursor: 'pointer',
          }}
        >
          Dismiss
        </button>
      </div>

      <style>{`@keyframes dp-fadein { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }`}</style>
    </div>
  );
}
