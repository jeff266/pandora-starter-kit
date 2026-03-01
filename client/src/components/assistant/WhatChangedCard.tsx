import React from 'react';

function fmt(n: number): string {
  if (!n && n !== 0) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function delta(curr: number, prev?: number): string {
  if (prev == null) return '';
  const d = curr - prev;
  return ` (${d >= 0 ? '+' : ''}${fmt(d)})`;
}

interface WhatChangedCardProps {
  whatChanged: any;
  briefType: string;
}

export default function WhatChangedCard({ whatChanged: wc, briefType }: WhatChangedCardProps) {
  if (!wc) return null;

  const sinceLabel = wc.since_date ? `Since ${wc.since_date}` : briefType === 'pulse' ? 'Since Monday' : 'Week over week';
  const netDelta = (wc as any).total_pipeline_delta;

  if (wc.nothing_moved) {
    return (
      <div style={{ padding: '4px 0', color: '#6B7280', fontSize: 13, fontStyle: 'italic' }}>
        Nothing material moved {wc.since_date ? `since ${wc.since_date}` : 'since Monday'}.
      </div>
    );
  }

  return (
    <div style={{ padding: '4px 0' }}>
      {briefType === 'pulse' && (
        <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{sinceLabel}</div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '3px 0', color: '#6B7280', fontWeight: 400, fontSize: 11 }}>Event</th>
            <th style={{ textAlign: 'right', color: '#6B7280', fontWeight: 400, fontSize: 11 }}>Count</th>
            <th style={{ textAlign: 'right', color: '#6B7280', fontWeight: 400, fontSize: 11 }}>Amount</th>
            {wc.created?.prev_count != null && (
              <th style={{ textAlign: 'right', color: '#6B7280', fontWeight: 400, fontSize: 11 }}>vs Prior</th>
            )}
          </tr>
        </thead>
        <tbody>
          {[
            { label: 'Created', key: 'created', color: '#60A5FA' },
            { label: 'Won', key: 'won', color: '#34D399' },
            { label: 'Lost', key: 'lost', color: '#F87171' },
            { label: 'Pushed', key: 'pushed', color: '#F59E0B' },
          ].map(row => {
            const d = wc[row.key];
            if (!d || d.count === 0) return null;
            return (
              <tr key={row.key} style={{ borderBottom: '1px solid #1F2937' }}>
                <td style={{ padding: '4px 0', color: row.color, fontWeight: 500 }}>{row.label}</td>
                <td style={{ textAlign: 'right', color: '#E5E7EB' }}>{d.count}</td>
                <td style={{ textAlign: 'right', color: '#E5E7EB' }}>{fmt(d.amount)}</td>
                {d.prev_count != null && (
                  <td style={{ textAlign: 'right', color: '#6B7280', fontSize: 11 }}>{delta(d.amount, d.prev_amount)}</td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      {netDelta != null && (
        <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#6B7280' }}>Net pipeline</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: netDelta >= 0 ? '#34D399' : '#F87171' }}>
            {netDelta >= 0 ? '+' : ''}{fmt(netDelta)}
          </span>
        </div>
      )}

      {wc.streak && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#F59E0B', fontStyle: 'italic' }}>
          {wc.streak}
        </div>
      )}
    </div>
  );
}
