import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { colors } from '../../styles/theme';

function fmt(n?: number): string {
  if (n == null) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

interface DealsToWatchCardProps {
  deals: any;
  highlightNames?: string[];
  briefType?: string;
  onAsk?: (q: string) => void;
}

export default function DealsToWatchCard({ deals, highlightNames = [], briefType, onAsk }: DealsToWatchCardProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const navigate = useNavigate();

  if (!deals) return null;

  const items: any[] = deals.items || [];
  if (items.length === 0) return <div style={{ color: colors.textSecondary, fontSize: 12, padding: '4px 0' }}>No deals to watch.</div>;

  const isQuarterClose = briefType === 'quarter_close';

  const sorted = [...items].sort((a, b) => {
    const aH = highlightNames.includes(a.name) ? -1 : 0;
    const bH = highlightNames.includes(b.name) ? -1 : 0;
    if (aH !== bH) return aH - bH;
    if (isQuarterClose && a.close_date && b.close_date) return a.close_date.localeCompare(b.close_date);
    const sevOrder: Record<string, number> = { critical: 0, warning: 1, positive: 2, info: 3 };
    return (sevOrder[a.severity] ?? 3) - (sevOrder[b.severity] ?? 3);
  });

  return (
    <div style={{ padding: '4px 0' }}>
      {sorted.map((deal, i) => {
        const isHighlighted = highlightNames.includes(deal.name);
        const isOpen = expanded[deal.name];
        const sevColor = deal.severity === 'critical' ? '#F87171' : deal.severity === 'warning' ? '#F59E0B' : deal.severity === 'positive' ? '#34D399' : '#6B7280';
        const sevDot = deal.severity === 'critical' ? '🔴' : deal.severity === 'warning' ? '🟡' : deal.severity === 'positive' ? '🟢' : '⚪';

        return (
          <div
            key={i}
            style={{
              marginBottom: 5,
              borderRadius: 6,
              background: colors.surfaceRaised,
              border: `1px solid ${isHighlighted ? colors.yellow + '40' : colors.border}`,
              overflow: 'hidden',
            }}
          >
            <button
              onClick={() => setExpanded(e => ({ ...e, [deal.name]: !e[deal.name] }))}
              style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '8px 10px', textAlign: 'left' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ fontSize: 12, marginTop: 1 }}>{sevDot}</span>
                  <div>
                    <div
                      style={{ fontSize: 13, color: colors.accent, fontWeight: 500, cursor: 'pointer' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (deal.id) navigate(`/deals/${deal.id}`);
                      }}
                    >
                      {deal.name}
                    </div>
                    <div style={{ fontSize: 11, color: colors.textSecondary, marginTop: 2 }}>
                      {deal.owner} · {deal.stage}
                      {isQuarterClose && deal.close_date && <span style={{ color: colors.yellow, marginLeft: 6 }}>closes {deal.close_date}</span>}
                    </div>
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 8 }}>
                  <div style={{ fontSize: 13, color: colors.text, fontWeight: 600 }}>{fmt(deal.amount)}</div>
                  <div style={{ fontSize: 10, color: colors.textMuted }}>{isOpen ? '▴' : '▾'}</div>
                </div>
              </div>
            </button>

            {isOpen && (
              <div style={{ padding: '0 10px 10px', borderTop: `1px solid ${colors.border}` }}>
                {deal.signal_text && (
                  <div style={{ fontSize: 12, color: sevColor, fontStyle: 'italic', marginTop: 6 }}>
                    {deal.signal_text}
                  </div>
                )}
                {!isQuarterClose && deal.close_date && (
                  <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 4 }}>Close date: {deal.close_date}</div>
                )}
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  {deal.id && (
                    <button
                      onClick={() => navigate(`/deals/${deal.id}`)}
                      style={{
                        fontSize: 11,
                        fontWeight: 500,
                        padding: '3px 8px',
                        borderRadius: 4,
                        background: 'transparent',
                        color: colors.accent,
                        border: `1px solid ${colors.accent}40`,
                        cursor: 'pointer',
                      }}
                    >
                      Open Deal ↗
                    </button>
                  )}
                  {onAsk && (
                    <button
                      onClick={() => onAsk(`Tell me about the ${deal.name} deal`)}
                      style={{
                        fontSize: 11,
                        fontWeight: 500,
                        padding: '3px 8px',
                        borderRadius: 4,
                        background: 'transparent',
                        color: colors.accent,
                        border: `1px solid ${colors.accent}40`,
                        cursor: 'pointer',
                      }}
                    >
                      Ask about this deal →
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
