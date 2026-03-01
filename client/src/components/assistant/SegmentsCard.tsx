import React from 'react';

function fmt(n: number): string {
  if (!n && n !== 0) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

interface SegmentsCardProps {
  segments: any;
}

export default function SegmentsCard({ segments }: SegmentsCardProps) {
  if (!segments) return null;

  if (segments.omitted) {
    return (
      <div style={{ padding: '4px 0', color: '#6B7280', fontSize: 12, fontStyle: 'italic' }}>
        {segments.reason || 'Segment breakdown unchanged.'}
      </div>
    );
  }

  const items = segments.items || [];
  if (items.length === 0) return <div style={{ color: '#6B7280', fontSize: 12 }}>No segment data.</div>;

  const total = items.reduce((s: number, i: any) => s + (i.pipeline || 0), 0);

  return (
    <div style={{ padding: '4px 0' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '3px 0', color: '#6B7280', fontWeight: 400, fontSize: 11 }}>
              {segments.dimension || 'Segment'}
            </th>
            <th style={{ textAlign: 'right', color: '#6B7280', fontWeight: 400, fontSize: 11 }}>Pipeline</th>
            <th style={{ textAlign: 'right', color: '#6B7280', fontWeight: 400, fontSize: 11 }}>Deals</th>
            <th style={{ textAlign: 'right', color: '#6B7280', fontWeight: 400, fontSize: 11 }}>Avg</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item: any, i: number) => {
            const pct = total > 0 ? (item.pipeline / total) * 100 : 0;
            return (
              <tr key={i} style={{ borderBottom: '1px solid #1F2937' }}>
                <td style={{ padding: '5px 0' }}>
                  <div style={{ fontSize: 12, color: '#E5E7EB' }}>{item.label}</div>
                  <div style={{ height: 3, background: '#1F2937', borderRadius: 2, marginTop: 3 }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: '#6488EA', borderRadius: 2 }} />
                  </div>
                </td>
                <td style={{ textAlign: 'right', color: '#E5E7EB', verticalAlign: 'top', paddingTop: 5 }}>{fmt(item.pipeline)}</td>
                <td style={{ textAlign: 'right', color: '#9CA3AF', verticalAlign: 'top', paddingTop: 5 }}>{item.count}</td>
                <td style={{ textAlign: 'right', color: '#9CA3AF', verticalAlign: 'top', paddingTop: 5 }}>{fmt(item.avg_deal)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
