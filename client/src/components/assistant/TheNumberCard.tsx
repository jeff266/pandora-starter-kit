import React, { useState, useEffect } from 'react';
import ChartRenderer from '../shared/ChartRenderer';
import { api } from '../../lib/api';

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
  expandedRow?: ExpandedRow;
  onExpandedRowChange?: (row: ExpandedRow) => void;
  forecastAccuracyNote?: string;
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

export default function TheNumberCard({ theNumber: n, briefType, deltaMode, reps, expandedRow: controlledExpanded, onExpandedRowChange, forecastAccuracyNote }: TheNumberCardProps) {
  const [internalExpanded, setInternalExpanded] = useState<ExpandedRow>(null);
  const expanded = controlledExpanded !== undefined ? controlledExpanded : internalExpanded;

  if (!n) return null;

  const toggle = (row: ExpandedRow) => {
    const next = expanded === row ? null : row;
    if (onExpandedRowChange) onExpandedRowChange(next);
    else setInternalExpanded(next);
  };

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

  const attainmentSummary = {
    wonThisPeriod: n.won_this_period,
    target,
    attainmentPct: n.attainment_pct,
    daysRemaining: n.days_remaining,
    weeksRemaining: n.weeks_remaining,
  };

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
        {expanded === 'attainment' && <AttainmentMathPanel summary={attainmentSummary} />}
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
            {expanded === 'attainment' && <AttainmentMathPanel summary={attainmentSummary} />}
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
      {n.chart_spec && (
        <div style={{ marginBottom: 12 }}>
          <ChartRenderer spec={n.chart_spec} compact={false} />
        </div>
      )}
      <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: '#E5E7EB' }}>{fmt(n.pipeline_total)}</span>
        <span style={{ fontSize: 20, color: dirColor }}>{dir}</span>
        {n.wow_pts != null && <span style={{ fontSize: 13, color: '#6B7280' }}>{n.wow_pts > 0 ? '+' : ''}{n.wow_pts}pts</span>}
      </div>
      {n.attainment_pct != null && (
        <>
          <ClickableRow label="Attainment" value={`${n.attainment_pct.toFixed(0)}%`} onClick={() => toggle('attainment')} expanded={expanded === 'attainment'} />
          {expanded === 'attainment' && <AttainmentMathPanel summary={attainmentSummary} />}
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
      {forecastAccuracyNote && (
        <div style={{ marginTop: 8, fontSize: 11, color: '#6B7280', fontStyle: 'italic', borderTop: '1px solid #1F2937', paddingTop: 8 }}>
          {forecastAccuracyNote}
        </div>
      )}
    </div>
  );
}

interface AttainmentSummary {
  wonThisPeriod: number | null;
  target: number | null;
  attainmentPct: number | null;
  daysRemaining: number | null;
  weeksRemaining: number | null;
}

interface AttainmentDeal {
  name: string;
  amount: number;
  close_date: string;
}

interface AttainmentMathResponse {
  mathKey: string;
  title: string;
  hasTarget: boolean;
  calculation: { numerator: { value: string; label: string }; denominator: { value: string; label: string }; result: { value: string }; note: string };
  deals: AttainmentDeal[];
  total_count: number;
}

function AttainmentMathPanel({ summary }: { summary: AttainmentSummary }) {
  const [deals, setDeals] = useState<AttainmentDeal[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    (api.get('/briefing/math/attainment') as Promise<AttainmentMathResponse>)
      .then((data) => {
        if (cancelled) return;
        setDeals(data.deals ?? []);
        setTotalCount(data.total_count ?? 0);
      })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const additionalCount = deals ? totalCount - deals.length : 0;

  return (
    <MathPanel>
      {summary.wonThisPeriod != null && <MathRow label="Closed won (this period)" value={fmt(summary.wonThisPeriod)} />}
      {summary.target != null && <MathRow label="Period target" value={fmt(summary.target)} />}
      <MathRow label="Attainment" value={`${summary.attainmentPct?.toFixed(0) ?? '—'}%`} />
      {summary.daysRemaining != null && <MathRow label="Days remaining" value={String(summary.daysRemaining)} />}
      {summary.weeksRemaining != null && <MathRow label="Weeks remaining" value={String(summary.weeksRemaining)} />}
      {loading && (
        <div style={{ marginTop: 6, color: '#6B7280', fontSize: 11 }}>Loading deals…</div>
      )}
      {error && (
        <div style={{ marginTop: 6, color: '#F87171', fontSize: 11 }}>Failed to load deal breakdown</div>
      )}
      {deals && deals.length === 0 && !loading && (
        <div style={{ marginTop: 6, color: '#6B7280', fontSize: 11 }}>No contributing deals in this period</div>
      )}
      {deals && deals.length > 0 && (
        <div style={{ marginTop: 6, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 6 }}>
          <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 4 }}>Contributing deals</div>
          {deals.map((d, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '2px 0' }}>
              <span style={{ color: '#9CA3AF', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '55%' }}>{d.name}</span>
              <span style={{ color: '#D1D5DB', fontSize: 11, fontVariantNumeric: 'tabular-nums', display: 'flex', gap: 8 }}>
                <span style={{ color: '#6B7280' }}>{d.close_date ? new Date(d.close_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}</span>
                {fmt(d.amount)}
              </span>
            </div>
          ))}
          {additionalCount > 0 && (
            <div style={{ fontSize: 11, color: '#6B7280', marginTop: 4, fontStyle: 'italic' }}>
              + {additionalCount} additional deal{additionalCount !== 1 ? 's' : ''} not listed
            </div>
          )}
        </div>
      )}
    </MathPanel>
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
