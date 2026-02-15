import React, { useState } from 'react';
import { colors } from '../../styles/theme';

interface DossierNarrativeProps {
  narrative?: string;
  loading?: boolean;
  onGenerate: () => void;
}

export default function DossierNarrative({
  narrative,
  loading = false,
  onGenerate,
}: DossierNarrativeProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!narrative && !isExpanded) {
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
          onClick={() => {
            setIsExpanded(true);
            onGenerate();
          }}
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
          {loading ? 'Generating...' : 'Generate Summary'}
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
        <h3 style={{ fontSize: 13, fontWeight: 600, color: colors.accent, margin: 0 }}>
          AI Summary
        </h3>
        {!loading && !narrative && (
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
        <p
          style={{
            fontSize: 14,
            lineHeight: 1.6,
            color: colors.text,
            margin: 0,
          }}
        >
          {narrative}
        </p>
      ) : (
        <p style={{ fontSize: 13, color: colors.textMuted, textAlign: 'center' }}>
          Failed to generate narrative. Please try again.
        </p>
      )}
    </div>
  );
}
