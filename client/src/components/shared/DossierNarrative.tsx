import React from 'react';
import { colors } from '../../styles/theme';
import { renderMarkdown } from '../../lib/render-markdown';

interface DossierNarrativeProps {
  narrative?: string | null;
  recommended_actions?: string[];
  narrative_generated_at?: string | null;
  loading?: boolean;
  onGenerate: () => void;
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

export default function DossierNarrative({
  narrative,
  recommended_actions = [],
  narrative_generated_at,
  loading = false,
  onGenerate,
}: DossierNarrativeProps) {
  if (!narrative && !loading) {
    return (
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          padding: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ fontSize: 13, color: colors.textSecondary }}>
          Generate an AI summary of this dossier
        </span>
        <button
          onClick={onGenerate}
          disabled={loading}
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: loading ? colors.textMuted : colors.accent,
            background: colors.accentSoft,
            border: 'none',
            padding: '6px 12px',
            borderRadius: 6,
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          Generate Summary
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        background: colors.surface,
        border: `2px solid ${colors.accent}33`,
        borderRadius: 10,
        padding: 20,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: colors.accent, margin: 0 }}>
            AI Summary
          </h3>
          {narrative_generated_at && !loading && (
            <span style={{ fontSize: 10, color: colors.textMuted }}>
              {formatTimeAgo(narrative_generated_at)}
            </span>
          )}
        </div>
        {!loading && (
          <button
            onClick={onGenerate}
            style={{
              fontSize: 11,
              color: colors.accent,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Regenerate
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ padding: 20, textAlign: 'center' }}>
          <div
            style={{
              width: 24,
              height: 24,
              border: `2px solid ${colors.border}`,
              borderTopColor: colors.accent,
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
              margin: '0 auto',
            }}
          />
        </div>
      ) : narrative ? (
        <>
          <div
            style={{
              fontSize: 14,
              lineHeight: 1.6,
              color: colors.text,
              margin: 0,
              marginBottom: recommended_actions.length > 0 ? 16 : 0,
              whiteSpace: 'pre-wrap',
            }}
          >
            {renderMarkdown(narrative)}
          </div>
          {recommended_actions.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: colors.textSecondary, marginBottom: 8 }}>
                Recommended Actions
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {recommended_actions.map((action, idx) => (
                  <div
                    key={idx}
                    style={{
                      fontSize: 13,
                      color: colors.text,
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                    }}
                  >
                    <span style={{ color: colors.accent, flexShrink: 0 }}>→</span>
                    <span>{action}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <p style={{ fontSize: 13, color: colors.textMuted, textAlign: 'center' }}>
          Failed to generate narrative. Please try again.
        </p>
      )}
    </div>
  );
}
