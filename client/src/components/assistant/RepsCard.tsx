import React, { useState } from 'react';
import ChartRenderer from '../shared/ChartRenderer';

function fmt(n?: number): string {
  if (n == null) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

interface RepsCardProps {
  reps: any;
  highlightEmails?: string[];
  briefType?: string;
  onAsk?: (q: string) => void;
}

export default function RepsCard({ reps, highlightEmails = [], briefType, onAsk }: RepsCardProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (!reps) return null;

  if (reps.omitted || (reps.items?.length === 0 && reps.reason)) {
    return (
      <div style={{ padding: '4px 0', color: '#6B7280', fontSize: 12, fontStyle: 'italic' }}>
        {reps.reason || 'No rep changes.'}
      </div>
    );
  }

  const items: any[] = reps.items || [];
  if (items.length === 0) return <div style={{ color: '#6B7280', fontSize: 12 }}>No rep data.</div>;

  const sorted = [...items].sort((a, b) => {
    const aH = highlightEmails.includes(a.email) ? -1 : 0;
    const bH = highlightEmails.includes(b.email) ? -1 : 0;
    return aH - bH || (b.pipeline || 0) - (a.pipeline || 0);
  });

  return (
    <div style={{ padding: '4px 0' }}>
      {reps.chart_spec && (
        <div style={{ marginBottom: 12 }}>
          <ChartRenderer spec={reps.chart_spec} compact={false} />
        </div>
      )}
      {sorted.map((rep) => {
        const isHighlighted = highlightEmails.includes(rep.email);
        const isExpanded = expanded[rep.email];
        const att = rep.attainment_pct;
        const flagColor = rep.flag_severity === 'critical' ? '#F87171' : rep.flag_severity === 'warning' ? '#F59E0B' : undefined;

        return (
          <div
            key={rep.email}
            style={{
              marginBottom: 6,
              borderRadius: 6,
              background: isHighlighted ? '#1C1A14' : '#1A1A1A',
              border: `1px solid ${isHighlighted ? '#F59E0B40' : '#1F2937'}`,
              overflow: 'hidden',
            }}
          >
            <button
              onClick={() => setExpanded(e => ({ ...e, [rep.email]: !e[rep.email] }))}
              style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '8px 10px', textAlign: 'left' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {flagColor && <span style={{ width: 8, height: 8, borderRadius: '50%', background: flagColor, display: 'inline-block', flexShrink: 0 }} />}
                  <span style={{ fontSize: 13, color: '#E5E7EB', fontWeight: 500 }}>{rep.name}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 12, color: '#9CA3AF' }}>{fmt(rep.pipeline)}</span>
                  {att != null && (
                    <span style={{ fontSize: 12, color: att < 60 ? '#F87171' : att < 80 ? '#F59E0B' : '#34D399', fontWeight: 600 }}>
                      {att}%
                    </span>
                  )}
                  <span style={{ color: '#4B5563', fontSize: 12 }}>{isExpanded ? '▴' : '▾'}</span>
                </div>
              </div>

              {att != null && (
                <div style={{ marginTop: 5, height: 3, background: '#1F2937', borderRadius: 2 }}>
                  <div style={{ height: '100%', width: `${Math.min(att, 100)}%`, background: att < 60 ? '#F87171' : att < 80 ? '#F59E0B' : '#34D399', borderRadius: 2, transition: 'width 0.3s' }} />
                </div>
              )}
            </button>

            {isExpanded && (
              <div style={{ padding: '0 10px 10px', borderTop: '1px solid #1F2937' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', marginTop: 8 }}>
                  {rep.quota && <StatRow label="Quota" value={fmt(rep.quota)} />}
                  {rep.closed != null && <StatRow label="Closed" value={fmt(rep.closed)} />}
                  {rep.gap != null && <StatRow label="Gap" value={fmt(rep.gap)} color="#F87171" />}
                  {rep.deal_count != null && <StatRow label="Open deals" value={String(rep.deal_count)} />}
                </div>
                {rep.flag && (
                  <div style={{ marginTop: 8, fontSize: 12, color: flagColor || '#9CA3AF', fontStyle: 'italic' }}>
                    {rep.flag}{rep.flag_weeks > 1 ? ` (week ${rep.flag_weeks})` : ''}
                  </div>
                )}
                {onAsk && (
                  <button
                    onClick={() => onAsk(`Tell me more about ${rep.name}`)}
                    style={{ marginTop: 8, fontSize: 11, color: '#6488EA', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  >
                    Ask about {rep.name.split(' ')[0]} →
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StatRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#6B7280', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 13, color: color || '#E5E7EB', fontWeight: 500 }}>{value}</div>
    </div>
  );
}
