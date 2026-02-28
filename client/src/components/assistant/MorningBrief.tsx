import React from 'react';
import { colors } from '../../styles/theme';

interface BriefItem {
  id: string;
  operator_name: string;
  operator_icon: string;
  operator_color: string;
  severity: 'critical' | 'warning' | 'info';
  headline: string;
  body: string;
  skill_run_id: string | null;
  created_at: string;
}

interface MorningBriefProps {
  items?: BriefItem[];
  loading?: boolean;
  onItemClick?: (item: BriefItem) => void;
}

const SEV_COLOR: Record<string, string> = {
  critical: '#ff8c82',
  warning: '#FBBF24',
  info: '#48af9b',
};

function SkeletonCard() {
  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8, padding: '12px 14px', marginBottom: 8 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: colors.surfaceRaised, marginTop: 4, flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <div style={{ width: 60, height: 18, background: colors.surfaceRaised, borderRadius: 4 }} />
          </div>
          <div style={{ width: '80%', height: 13, background: colors.surfaceRaised, borderRadius: 4, marginBottom: 4 }} />
          <div style={{ width: '55%', height: 11, background: colors.surfaceRaised, borderRadius: 4 }} />
        </div>
      </div>
    </div>
  );
}

export default function MorningBrief({ items, loading, onItemClick }: MorningBriefProps) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
        This Morning
      </div>
      {loading || !items ? (
        <>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </>
      ) : items.length === 0 ? (
        <div style={{ fontSize: 13, color: colors.textMuted, padding: '8px 0' }}>No recent findings.</div>
      ) : (
        items.map(item => {
          const sevColor = SEV_COLOR[item.severity] ?? colors.accent;
          return (
            <div
              key={item.id}
              onClick={() => onItemClick?.(item)}
              style={{
                background: colors.surface, border: `1px solid ${colors.border}`,
                borderRadius: 8, padding: '12px 14px', marginBottom: 8,
                cursor: onItemClick ? 'pointer' : 'default',
                transition: 'border-color 0.15s',
              }}
              onMouseEnter={e => { if (onItemClick) (e.currentTarget as HTMLDivElement).style.borderColor = colors.accent; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = colors.border; }}
            >
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div style={{
                  width: 8, height: 8, borderRadius: '50%', background: sevColor, flexShrink: 0, marginTop: 4,
                  boxShadow: item.severity === 'critical' ? `0 0 6px ${sevColor}` : undefined,
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: 11, padding: '1px 7px', borderRadius: 4,
                      background: `${item.operator_color}18`, color: item.operator_color,
                      fontWeight: 600, border: `1px solid ${item.operator_color}40`,
                      whiteSpace: 'nowrap',
                    }}>
                      {item.operator_icon} {item.operator_name}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: colors.text, marginBottom: 3, lineHeight: 1.4 }}>
                    {item.headline}
                  </div>
                  <div style={{ fontSize: 11, color: colors.textMuted, lineHeight: 1.4 }}>
                    {item.body}
                  </div>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
