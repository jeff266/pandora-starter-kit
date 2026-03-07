import React from 'react';
import { colors, fonts } from '../../styles/theme';
import { StrategicReasoningOutput } from '../../../../server/skills/strategic-reasoner';

interface StrategicCardProps {
  data: StrategicReasoningOutput;
}

export default function StrategicCard({ data }: StrategicCardProps) {
  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 12,
      overflow: 'hidden',
      marginBottom: 16,
      boxShadow: '0 4px 12px rgba(0,0,0,0.05)'
    }}>
      <div style={{
        background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        color: '#fff'
      }}>
        <span style={{ fontSize: 18 }}>🧠</span>
        <span style={{ fontWeight: 600, fontSize: 14 }}>Strategic Analysis</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ 
            fontSize: 10, 
            background: 'rgba(255,255,255,0.2)', 
            padding: '2px 6px', 
            borderRadius: 4,
            fontWeight: 700
          }}>
            {data.confidence}% CONFIDENCE
          </div>
        </div>
      </div>

      <div style={{ padding: 16 }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', marginBottom: 6 }}>Hypothesis</div>
          <div style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.5, color: colors.text }}>
            {data.hypothesis}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: colors.green, textTransform: 'uppercase', marginBottom: 8 }}>Supporting Evidence</div>
            {data.supportingEvidence.map((e, i) => (
              <div key={i} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: colors.text }}>{e.label}</div>
                <div style={{ fontSize: 12, color: colors.textSecondary }}>{e.value}</div>
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: colors.red, textTransform: 'uppercase', marginBottom: 8 }}>What doesn't fit</div>
            {data.contradictingEvidence.map((e, i) => (
              <div key={i} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: colors.text }}>{e.label}</div>
                <div style={{ fontSize: 12, color: colors.textSecondary }}>{e.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ 
          background: colors.bg, 
          borderRadius: 8, 
          padding: 14, 
          marginBottom: 20,
          borderLeft: `4px solid ${colors.accent}`
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: colors.accent, textTransform: 'uppercase', marginBottom: 6 }}>Recommendation</div>
          <div style={{ fontSize: 13, lineHeight: 1.6, color: colors.text }}>
            {data.recommendation}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', marginBottom: 8 }}>What you give up</div>
            {data.tradeoffs.map((t, i) => (
              <div key={i} style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 4, display: 'flex', gap: 6 }}>
                <span>•</span> {t}
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', marginBottom: 8 }}>Watch for</div>
            {data.watchFor.map((w, i) => (
              <div key={i} style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 4, display: 'flex', gap: 6 }}>
                <span>•</span> {w}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
