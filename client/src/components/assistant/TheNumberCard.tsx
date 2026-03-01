import React, { useState } from 'react';

function fmt(n: number): string {
  if (!n && n !== 0) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

interface TheNumberCardProps {
  theNumber: any;
  briefType: string;
  deltaMode?: boolean;
  reps?: any;
}

type ExpandedRow = 'pipeline' | 'attainment' | 'gap' | null;

function MathPanel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.04)',
      borderRadius: 6,
      padding: '8px 12px',
      marginBottom: 4,
      fontSize: 12,
      color: '#9CA3AF',
      lineHeight: 1.7,
    }}>
      {children}
    </div>
  );
}

function MathRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: '#6B7280' }}>{label}</span>
      <span style={{ color: highlight ? '#34D399' : '#D1D5DB', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

export default function TheNumberCard({ theNumber: n, briefType, deltaMode, reps }: TheNumberCardProps) {
  const [expanded, setExpanded] = useState<ExpandedRow>(null);

  if (!n) return null;

  const toggle = (row: ExpandedRow) => setExpanded(prev => prev === row ? null : row);

  const dir = n.direction === 'up' ? '↑' : n.direction === 'down' ? '↓' : '→';
  const dirColor = n.direction === 'up' ? '#34D399' : n.direction === 'down' ? '#F87171' : '#9CA3AF';
  const target = n.won_this_period != null && n.gap != null ? n.won_this_period + n.gap : null;
  const winRatePct = n.forecast?.win_rate ? Math.round(n.forecast.win_rate * 100) : 30;

  const PipelineMath = () => (
    <MathPanel>
      <MathRow label="Total open pipeline" value={fmt(n.pipeline_total)} />
      <MathRow label="Open deals" value={String(n.deal_count)} />
      {n.avg_deal_size > 0 && <MathRow label="Avg deal size" value={fmt(n.avg_deal_size)} />}
      {n.forecast?.weighted > 0 && <MathRow label="Weighted forecast" value={fmt(n.forecast.weighted)} />}
      {reps?.items?.length > 0 && (
        <div style={{ marginTop: 6, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 6 }}>
          {reps.items.map((r: any) => (
            <MathRow key={r.name} label={r.name} value={`${fmt(r.pipeline)} · ${r.deal_count} deals`} />
          ))}
        </div>
      )}
    </MathPanel>
  );

  const AttainmentMath = () => (
    <MathPanel>
      {n.won_this_period != null && <MathRow label="Closed won (this period)" value={fmt(n.won_this_period)} />}
      {target != null && <MathRow label="Period target" value={fmt(target)} />}
      <MathRow label="Attainment" value={`${n.attainment_pct?.toFixed(0) ?? '—'}%`} />
      {n.days_remaining != null && <MathRow label="Days remaining" value={String(n.days_remaining)} />}
      {n.weeks_remaining != null && <MathRow label="Weeks remaining" value={String(n.weeks_remaining)} />}
    </MathPanel>
  );

  const GapMath = () => (
    <MathPanel>
      <MathRow label="Gap to target" value={fmt(n.gap)} />
      {n.required_pipeline > 0 && <MathRow label={`Pipeline needed at ${winRatePct}% win rate`} value={fmt(n.required_pipeline)} />}
      {n.pipeline_total > 0 && <MathRow label="Current pipeline" value={fmt(n.pipeline_total)} />}
      {n.coverage_ratio != null && (
        <MathRow
          label="Coverage ratio"
          value={`${n.coverage_ratio.toFixed(1)}×`}
          highlight={n.coverage_ratio >= 1.5}
        />
      )}
      {n.required_deals_to_close != null && (
        <MathRow label="Deals to close at avg size" value={String(n.required_deals_to_close)} />
      )}
    </MathPanel>
  );

  if (briefType === 'quarter_close') {
    return (
      <div style={{ padding: '4px 0' }}>
        <div style={{ fontSize: 28, fontWeight: 700, color: '#F59E0B', marginBottom: 4 }}>
          {n.days_remaining} <span style={{ fontSize: 16, fontWeight: 500, color: '#9CA3AF' }}>days left</span>
        </div>
        <ClickableRow label="Attainment" value={`${n.attainment_pct?.toFixed(0) ?? '—'}%`} valueColor={n.attainment_pct < 65 ? '#F87171' : '#34D399'} onClick={() => toggle('attainment')} expanded={expanded === 'attainment'} />
        {expanded === 'attainment' && <AttainmentMath />}
        <ClickableRow label="Gap to quota" value={fmt(n.gap)} onClick={() => toggle('gap')} expanded={expanded === 'gap'} />
        {expanded === 'gap' && <GapMath />}
        <ClickableRow label="Pipeline" value={fmt(n.pipeline_total)} sub={`${n.deal_count} deals`} onClick={() => toggle('pipeline')} expanded={expanded === 'pipeline'} />
        {expanded === 'pipeline' && <PipelineMath />}
        <Row label="Coverage on gap" value={n.coverage_on_gap ? `${n.coverage_on_gap.toFixed(1)}×` : '—'} />
        {n.forecast?.weighted > 0 && <Row label="Weighted forecast" value={fmt(n.forecast.weighted)} />}
        {n.forecast?.commit > 0 && <Row label="Commit" value={fmt(n.forecast.commit)} />}
        {n.forecast?.win_rate && <Row label="Win rate" value={pct(n.forecast.win_rate)} />}
      </div>
    );
  }

  if (deltaMode || briefType === 'pulse') {
    return (
      <div style={{ padding: '4px 0' }}>
        <ClickableRow label="Pipeline" value={fmt(n.pipeline_total)} sub={`${n.deal_count} deals`} onClick={() => toggle('pipeline')} expanded={expanded === 'pipeline'} />
        {expanded === 'pipeline' && <PipelineMath />}
        {n.delta_since_monday != null && (
          <Row label="Change since Monday" value={`${n.delta_since_monday >= 0 ? '+' : ''}${fmt(n.delta_since_monday)}`} valueColor={n.delta_since_monday >= 0 ? '#34D399' : '#F87171'} />
        )}
        {n.attainment_pct != null && (
          <>
            <ClickableRow label="Attainment" value={`${n.attainment_pct.toFixed(0)}%`} onClick={() => toggle('attainment')} expanded={expanded === 'attainment'} />
            {expanded === 'attainment' && <AttainmentMath />}
          </>
        )}
        {n.attainment_delta != null && (
          <Row label="Attainment change" value={`${n.attainment_delta >= 0 ? '+' : ''}${n.attainment_delta.toFixed(1)}pts`} valueColor={n.attainment_delta >= 0 ? '#34D399' : '#F87171'} />
        )}
        {n.gap > 0 && (
          <>
            <ClickableRow label="Gap" value={fmt(n.gap)} onClick={() => toggle('gap')} expanded={expanded === 'gap'} />
            {expanded === 'gap' && <GapMath />}
          </>
        )}
      </div>
    );
  }

  if (briefType === 'friday_recap') {
    return (
      <div style={{ padding: '4px 0' }}>
        <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 22, fontWeight: 700, color: '#E5E7EB' }}>{n.attainment_pct?.toFixed(0) ?? '—'}%</span>
          <span style={{ fontSize: 20, color: dirColor }}>{dir}</span>
          {n.wow_pts != null && <span style={{ fontSize: 13, color: '#6B7280' }}>{n.wow_pts > 0 ? '+' : ''}{n.wow_pts}pts WoW</span>}
        </div>
        <ClickableRow label="Pipeline" value={fmt(n.pipeline_total)} sub={`${n.deal_count} deals`} onClick={() => toggle('pipeline')} expanded={expanded === 'pipeline'} />
        {expanded === 'pipeline' && <PipelineMath />}
        {n.gap > 0 && (
          <>
            <ClickableRow label="Gap" value={fmt(n.gap)} onClick={() => toggle('gap')} expanded={expanded === 'gap'} />
            {expanded === 'gap' && <GapMath />}
          </>
        )}
        {n.days_remaining != null && <Row label="Days left in quarter" value={String(n.days_remaining)} />}
      </div>
    );
  }

  // monday_setup default
  return (
    <div style={{ padding: '4px 0' }}>
      <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: '#E5E7EB' }}>{fmt(n.pipeline_total)}</span>
        <span style={{ fontSize: 20, color: dirColor }}>{dir}</span>
        {n.wow_pts != null && <span style={{ fontSize: 13, color: '#6B7280' }}>{n.wow_pts > 0 ? '+' : ''}{n.wow_pts}pts</span>}
      </div>
      {n.attainment_pct != null && (
        <>
          <ClickableRow label="Attainment" value={`${n.attainment_pct.toFixed(0)}%`} onClick={() => toggle('attainment')} expanded={expanded === 'attainment'} />
          {expanded === 'attainment' && <AttainmentMath />}
        </>
      )}
      {n.gap > 0 && (
        <>
          <ClickableRow label="Gap to quota" value={fmt(n.gap)} onClick={() => toggle('gap')} expanded={expanded === 'gap'} />
          {expanded === 'gap' && <GapMath />}
        </>
      )}
      {n.coverage_on_gap > 0 && <Row label="Coverage" value={`${n.coverage_on_gap.toFixed(1)}×`} />}
      {n.forecast?.weighted > 0 && <Row label="Weighted forecast" value={fmt(n.forecast.weighted)} />}
      <ClickableRow label="Deals" value={String(n.deal_count)} onClick={() => toggle('pipeline')} expanded={expanded === 'pipeline'} />
      {expanded === 'pipeline' && <PipelineMath />}
      {n.days_remaining != null && <Row label="Days left in quarter" value={String(n.days_remaining)} />}
    </div>
  );
}

function ClickableRow({ label, value, sub, valueColor, onClick, expanded }: {
  label: string; value: string; sub?: string; valueColor?: string; onClick: () => void; expanded: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        padding: '3px 0',
        width: '100%', background: 'none',
        border: 'none', borderBottom: '1px solid #1F2937',
        cursor: 'pointer', textAlign: 'left',
      }}
    >
      <span style={{ fontSize: 12, color: '#6B7280', display: 'flex', alignItems: 'center', gap: 4 }}>
        {label}
        <span style={{ fontSize: 10, color: '#374151', opacity: 0.7 }}>{expanded ? '▴' : '▾'}</span>
      </span>
      <span style={{ fontSize: 13, fontWeight: 500, color: valueColor || '#E5E7EB' }}>
        {value}{sub && <span style={{ fontSize: 11, color: '#6B7280', marginLeft: 4 }}>{sub}</span>}
      </span>
    </button>
  );
}

function Row({ label, value, sub, valueColor }: { label: string; value: string; sub?: string; valueColor?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '3px 0', borderBottom: '1px solid #1F2937' }}>
      <span style={{ fontSize: 12, color: '#6B7280' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500, color: valueColor || '#E5E7EB' }}>
        {value}{sub && <span style={{ fontSize: 11, color: '#6B7280', marginLeft: 4 }}>{sub}</span>}
      </span>
    </div>
  );
}
