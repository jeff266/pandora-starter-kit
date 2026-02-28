import React from 'react';
import { colors } from '../../styles/theme';
import { renderMarkdown } from '../../lib/render-markdown';

interface DossierNarrativeProps {
  narrative?: string | null;
  recommended_actions?: string[];
  narrative_generated_at?: string | null;
  loading?: boolean;
  onGenerate?: () => void;
  fallbackSummary?: string | null;
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function ShimmerLine({ width }: { width: string }) {
  return (
    <div style={{
      height: 14,
      width,
      borderRadius: 4,
      background: `linear-gradient(90deg, ${colors.surfaceHover} 25%, ${colors.surfaceActive || colors.border} 50%, ${colors.surfaceHover} 75%)`,
      backgroundSize: '200% 100%',
      animation: 'pandora-shimmer 1.4s ease-in-out infinite',
      marginBottom: 8,
    }} />
  );
}

export default function DossierNarrative({
  narrative,
  recommended_actions = [],
  narrative_generated_at,
  loading = false,
  onGenerate,
  fallbackSummary,
}: DossierNarrativeProps) {
  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 10,
      padding: '20px 24px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Accent gradient strip */}
      <div style={{
        position: 'absolute',
        top: 0, left: 0, right: 0,
        height: 2,
        background: `linear-gradient(90deg, ${colors.accent}, ${colors.purple || '#a78bfa'})`,
        opacity: 0.7,
      }} />

      <style>{`
        @keyframes pandora-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12 }}>✦</span>
          <span style={{
            fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.1em', color: colors.textMuted,
          }}>
            AI Deal Intelligence
          </span>
          {narrative_generated_at && !loading && (
            <span style={{ fontSize: 10, color: colors.textDim }}>
              · {formatTimeAgo(narrative_generated_at)}
            </span>
          )}
        </div>
        {!loading && narrative && onGenerate && (
          <button
            onClick={onGenerate}
            style={{
              fontSize: 11, color: colors.textMuted,
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '2px 6px', borderRadius: 4,
            }}
            onMouseEnter={e => { e.currentTarget.style.color = colors.accent; }}
            onMouseLeave={e => { e.currentTarget.style.color = colors.textMuted; }}
          >
            Regenerate
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ paddingTop: 4 }}>
          <ShimmerLine width="95%" />
          <ShimmerLine width="80%" />
          <ShimmerLine width="90%" />
          <ShimmerLine width="60%" />
        </div>
      ) : narrative ? (
        <>
          <div style={{
            fontSize: 14, lineHeight: 1.75, color: colors.text,
            margin: 0,
            marginBottom: recommended_actions.length > 0 ? 16 : 0,
            whiteSpace: 'pre-wrap',
          }}>
            {renderMarkdown(narrative)}
          </div>
          {recommended_actions.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                Recommended Actions
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {recommended_actions.map((action, idx) => (
                  <div key={idx} style={{ fontSize: 13, color: colors.text, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span style={{ color: colors.accent, flexShrink: 0 }}>→</span>
                    <span>{action}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : fallbackSummary ? (
        <p style={{ fontSize: 14, lineHeight: 1.75, color: colors.textSecondary, margin: 0, fontStyle: 'italic' }}>
          {fallbackSummary}
        </p>
      ) : (
        <p style={{ fontSize: 13, color: colors.textMuted, margin: 0, fontStyle: 'italic' }}>
          Generating deal intelligence...
        </p>
      )}
    </div>
  );
}
