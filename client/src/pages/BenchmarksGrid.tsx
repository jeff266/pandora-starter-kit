import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { useWorkspace } from '../context/WorkspaceContext';

interface StageBenchmark {
  stage: string;
  stage_normalized: string;
  display_order: number | null;
  pipeline: string;
  segment: string;
  won_median: number | null;
  won_avg: number | null;
  won_p75: number | null;
  won_sample: number;
  won_confidence: string;
  lost_median: number | null;
  lost_avg: number | null;
  lost_sample: number;
  lost_confidence: string;
  is_inverted: boolean;
}

interface RawBenchmark {
  stage: string;
  pipeline: string;
  stage_normalized: string;
  display_order: number | null;
  won_median: number | null;
  won_avg: number | null;
  won_sample: number;
  lost_median: number | null;
  lost_avg: number | null;
  lost_sample: number;
}

interface OpenAverage {
  avg: number;
  count: number;
}

interface CycleTime {
  won_median: number | null;
  won_avg: number | null;
  won_sample: number;
  lost_median: number | null;
  lost_avg: number | null;
  lost_sample: number;
}

interface BenchmarksResponse {
  benchmarks: StageBenchmark[];
  raw_benchmarks: RawBenchmark[];
  open_averages: Record<string, OpenAverage>;
  pipelines: string[];
  last_computed_at: string | null;
  cycle_time?: CycleTime;
}

interface MathDeal {
  id: string;
  name: string;
  amount: string | null;
  outcome: string;
  pipeline: string;
  duration_days: string;
  entered_at: string;
  exited_at: string | null;
  stage_display_name: string;
}

interface MathModalState {
  stage_normalized: string;
  label: string;
  segment: string;
  outcome: 'won' | 'lost' | 'open';
  pipeline: string | null;
  median: number | null;
  avg: number | null;
  deals: MathDeal[] | null;
  loading: boolean;
}

type ViewMode = 'grouped' | 'raw';

const SEGMENTS = ['all', 'smb', 'mid_market', 'enterprise'] as const;
const SEGMENT_LABEL: Record<string, string> = {
  all: 'All Deals',
  smb: 'SMB',
  mid_market: 'Mid-Market',
  enterprise: 'Enterprise',
};

function signalGapColor(wonMedian: number | null, lostMedian: number | null): string {
  if (!wonMedian || !lostMedian) return colors.textMuted;
  const ratio = lostMedian / wonMedian;
  if (ratio >= 5) return '#38A169';
  if (ratio >= 2) return '#D69E2E';
  return colors.textMuted;
}

function fmtDays(d: number | null | undefined): string {
  if (d == null) return '—';
  if (d < 1) return '<1d';
  return `${Math.round(d)}d`;
}

function fmtAmount(a: string | null): string {
  if (!a) return '—';
  const n = parseFloat(a);
  if (isNaN(n)) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}

function fmtDate(s: string | null): string {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

function ToggleButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '5px 12px', fontSize: 12, fontFamily: fonts.sans,
        fontWeight: active ? 600 : 400, border: 'none', borderRadius: 5,
        cursor: 'pointer', background: active ? colors.accent : 'transparent',
        color: active ? '#fff' : colors.textMuted, transition: 'all 0.15s',
      }}
    >
      {children}
    </button>
  );
}

function ConfidenceDot({ tier, sample }: { tier: string; sample: number }) {
  const [show, setShow] = useState(false);
  const color = tier === 'high' ? '#38A169' : tier === 'directional' ? '#D69E2E' : '#94a3b8';
  const label = tier === 'high'
    ? `High confidence · N=${sample} deals`
    : tier === 'directional'
    ? `Directional · N=${sample} deals (treat as indicative)`
    : `Insufficient data · N=${sample} deals`;

  return (
    <span
      style={{ position: 'relative', display: 'inline-block', verticalAlign: 'middle', marginLeft: 4, cursor: 'default' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: color, opacity: 0.75 }} />
      {show && (
        <div style={{
          position: 'absolute', bottom: '130%', left: '50%', transform: 'translateX(-50%)',
          background: '#1e2433', color: '#e2e8f0', fontSize: 11, padding: '5px 9px', borderRadius: 5,
          whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 200, marginBottom: 4,
          boxShadow: '0 2px 8px rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.08)',
        }}>
          {label}
        </div>
      )}
    </span>
  );
}

function csvEscape(val: string | null | undefined): string {
  const s = val ?? '';
  return `"${s.replace(/"/g, '""')}"`;
}

function exportModalCsv(modal: MathModalState): void {
  if (!modal.deals || modal.deals.length === 0) return;
  const isOpen = modal.outcome === 'open';

  const headers = isOpen
    ? ['Deal ID', 'Deal', 'Amount', 'Stage', 'Days in Stage', 'In Stage Since']
    : ['Deal ID', 'Deal', 'Amount', 'Stage', 'Duration (days)', 'Entered', 'Exited'];

  const rows = modal.deals.map(d => {
    const dur = d.duration_days != null ? String(Math.round(parseFloat(d.duration_days))) : '';
    const entered = d.entered_at ? new Date(d.entered_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '';
    const exited = d.exited_at ? new Date(d.exited_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '';
    const amount = d.amount ? String(Math.round(parseFloat(d.amount))) : '';
    return isOpen
      ? [csvEscape(d.id), csvEscape(d.name), csvEscape(amount), csvEscape(d.stage_display_name), dur, entered]
      : [csvEscape(d.id), csvEscape(d.name), csvEscape(amount), csvEscape(d.stage_display_name), dur, entered, exited];
  });

  const slug = modal.stage_normalized.replace(/_/g, '-');
  const filename = `${slug}-${modal.outcome}-math.csv`;
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function MathModal({ modal, onClose }: { modal: MathModalState; onClose: () => void }) {
  const isOpen = modal.outcome === 'open';
  const outcomeColor = isOpen ? '#D69E2E' : modal.outcome === 'won' ? '#38A169' : '#E53E3E';
  const outcomeLabel = isOpen ? 'Open Now' : modal.outcome === 'won' ? 'Closed-Won' : 'Closed-Lost';
  const segLabel = SEGMENT_LABEL[modal.segment] ?? modal.segment;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: colors.surface, borderRadius: '12px 12px 0 0',
          border: `1px solid ${colors.border}`, borderBottom: 'none',
          width: '100%', maxWidth: 860, maxHeight: '72vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 -4px 32px rgba(0,0,0,0.3)',
        }}
      >
        <div style={{ padding: '18px 24px', borderBottom: `1px solid ${colors.border}`, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: colors.text, marginBottom: 3 }}>
              Show Math — <span style={{ color: outcomeColor }}>{outcomeLabel}</span> · {modal.label}
            </div>
            <div style={{ fontSize: 12, color: colors.textMuted }}>
              {isOpen
                ? <>Deals currently in this stage{modal.avg != null ? <> · avg <strong style={{ color: outcomeColor }}>{fmtDays(modal.avg)}</strong></> : ''}</>
                : <>{segLabel}{modal.pipeline ? ` · ${modal.pipeline}` : ''}{modal.median != null ? ` · median ${fmtDays(modal.median)}` : ''}</>
              }
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {modal.deals && modal.deals.length > 0 && (
              <button
                onClick={() => exportModalCsv(modal)}
                style={{
                  padding: '5px 11px', fontSize: 11, fontFamily: fonts.sans, fontWeight: 500,
                  border: `1px solid ${colors.border}`, borderRadius: 5, background: 'transparent',
                  color: colors.textSecondary, cursor: 'pointer',
                }}
              >
                Export CSV
              </button>
            )}
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', color: colors.textMuted, cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 4 }}
            >
              ×
            </button>
          </div>
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {modal.loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: colors.textMuted, fontSize: 13 }}>Loading deals…</div>
          ) : !modal.deals || modal.deals.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: colors.textMuted, fontSize: 13 }}>No deals found for this filter.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${colors.border}`, position: 'sticky', top: 0, background: colors.surface }}>
                  <th style={{ padding: '10px 16px', textAlign: 'left', color: colors.textMuted, fontWeight: 600, fontSize: 11 }}>Deal</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right', color: colors.textMuted, fontWeight: 600, fontSize: 11 }}>Amount</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', color: colors.textMuted, fontWeight: 600, fontSize: 11 }}>Stage</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', color: colors.textMuted, fontWeight: 600, fontSize: 11 }}>{isOpen ? 'Days in Stage' : 'Duration'}</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', color: colors.textMuted, fontWeight: 600, fontSize: 11 }}>{isOpen ? 'In Stage Since' : 'Entered'}</th>
                  {!isOpen && <th style={{ padding: '10px 12px', textAlign: 'center', color: colors.textMuted, fontWeight: 600, fontSize: 11 }}>Exited</th>}
                </tr>
              </thead>
              <tbody>
                {modal.deals.map((deal, i) => {
                  const dur = parseFloat(deal.duration_days);
                  const isMedian = !isOpen && modal.median != null && Math.abs(dur - modal.median) < 0.5;
                  return (
                    <tr
                      key={`${deal.id}-${i}`}
                      style={{
                        borderBottom: `1px solid ${colors.border}`,
                        background: isMedian ? `${outcomeColor}10` : 'transparent',
                      }}
                    >
                      <td style={{ padding: '9px 16px', color: colors.text, fontWeight: 500, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {deal.name}
                        {isMedian && <span style={{ marginLeft: 6, fontSize: 10, color: outcomeColor, fontWeight: 600 }}>← median</span>}
                      </td>
                      <td style={{ padding: '9px 12px', textAlign: 'right', color: colors.textSecondary }}>{fmtAmount(deal.amount)}</td>
                      <td style={{ padding: '9px 12px', color: colors.textMuted, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{deal.stage_display_name}</td>
                      <td style={{ padding: '9px 12px', textAlign: 'center', fontWeight: 600, color: outcomeColor }}>{fmtDays(dur)}</td>
                      <td style={{ padding: '9px 12px', textAlign: 'center', color: colors.textMuted }}>{fmtDate(deal.entered_at)}</td>
                      {!isOpen && <td style={{ padding: '9px 12px', textAlign: 'center', color: colors.textMuted }}>{fmtDate(deal.exited_at)}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ padding: '12px 24px', borderTop: `1px solid ${colors.border}`, fontSize: 11, color: colors.textMuted, flexShrink: 0 }}>
          Showing deals sorted by time spent in stage · capped at 100 · highlighted row is closest to median
        </div>
      </div>
    </div>
  );
}

export default function BenchmarksGrid() {
  const { currentWorkspace } = useWorkspace();
  const workspaceId = currentWorkspace?.id;

  const [data, setData] = useState<BenchmarksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedPipeline, setSelectedPipeline] = useState<string>('all');
  const [collapsedSegments, setCollapsedSegments] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('grouped');
  const [showActualNames, setShowActualNames] = useState(false);
  const [metricMode, setMetricMode] = useState<'median' | 'average'>('median');
  const [mathModal, setMathModal] = useState<MathModalState | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const result: BenchmarksResponse = await api.get(
        `/stage-benchmarks?pipeline=${encodeURIComponent(selectedPipeline)}`
      );
      setData(result);
    } catch (err: any) {
      setError(err.message || 'Failed to load benchmarks');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, selectedPipeline]);

  useEffect(() => { load(); }, [load]);

  const handleRefresh = async () => {
    if (!workspaceId) return;
    setRefreshing(true);
    try {
      await api.post('/stage-benchmarks/refresh', {});
      await load();
    } catch (err: any) {
      setError(err.message || 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  const openMath = useCallback(async (
    stage_normalized: string,
    outcome: 'won' | 'lost',
    label: string,
    segment: string,
    median: number | null,
    pipeline?: string,
  ) => {
    setMathModal({ stage_normalized, label, segment, outcome, pipeline: pipeline ?? null, median, avg: null, deals: null, loading: true });
    try {
      const params = new URLSearchParams({ stage_normalized, outcome, segment: segment || 'all' });
      if (pipeline && pipeline !== 'all') params.set('pipeline', pipeline);
      const result = await api.get(`/stage-benchmarks/math?${params}`);
      setMathModal(prev => prev ? { ...prev, deals: result.deals, loading: false } : null);
    } catch {
      setMathModal(prev => prev ? { ...prev, deals: [], loading: false } : null);
    }
  }, []);

  const openOpenMath = useCallback(async (stageNorm: string, label: string, avg: number, pipeline?: string) => {
    setMathModal({ stage_normalized: stageNorm, label, segment: 'all', outcome: 'open', pipeline: pipeline ?? null, median: null, avg, deals: null, loading: true });
    try {
      const params = new URLSearchParams({ stage_normalized: stageNorm, outcome: 'open', segment: 'all' });
      if (pipeline && pipeline !== 'all') params.set('pipeline', pipeline);
      const result = await api.get(`/stage-benchmarks/math?${params}`);
      setMathModal(prev => prev ? { ...prev, deals: result.deals, loading: false } : null);
    } catch {
      setMathModal(prev => prev ? { ...prev, deals: [], loading: false } : null);
    }
  }, []);

  const toggleSegment = (seg: string) => {
    setCollapsedSegments(prev => {
      const next = new Set(prev);
      next.has(seg) ? next.delete(seg) : next.add(seg);
      return next;
    });
  };

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', fontSize: 13, color: colors.textMuted, fontFamily: fonts.sans }}>
        Loading stage benchmarks...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 40, textAlign: 'center', fontSize: 13, color: colors.textMuted, fontFamily: fonts.sans }}>
        <div style={{ marginBottom: 12 }}>{error}</div>
        <button onClick={load} style={{ padding: '8px 16px', borderRadius: 6, border: `1px solid ${colors.border}`, background: 'transparent', color: colors.accent, cursor: 'pointer', fontSize: 12, fontFamily: fonts.sans }}>
          Retry
        </button>
      </div>
    );
  }

  const benchmarks = data?.benchmarks ?? [];
  const rawBenchmarks = data?.raw_benchmarks ?? [];

  // ── Grouped mode ─────────────────────────────────────────────────────────────
  const stages = [...new Map(
    benchmarks.map(b => [b.stage_normalized, { stage: b.stage, stage_normalized: b.stage_normalized, display_order: b.display_order }])
  ).values()].sort((a, b) => a.stage_normalized.localeCompare(b.stage_normalized));

  const availableSegs = SEGMENTS.filter(seg => benchmarks.some(b => b.segment === seg));
  const getBenchmark = (stageNorm: string, segment: string): StageBenchmark | undefined =>
    benchmarks.find(b => b.stage_normalized === stageNorm && b.segment === segment);
  const openAvg = data?.open_averages ?? {};

  // Build norm → actual stage names map for the "show actual names" toggle
  const normToActualNames = new Map<string, string[]>();
  for (const rb of rawBenchmarks) {
    if (selectedPipeline === 'all' || rb.pipeline === selectedPipeline) {
      const existing = normToActualNames.get(rb.stage_normalized) ?? [];
      if (!existing.includes(rb.stage)) normToActualNames.set(rb.stage_normalized, [...existing, rb.stage]);
    }
  }

  const stageHeaderLabel = (norm: string, fallback: string) =>
    showActualNames && selectedPipeline !== 'all'
      ? (normToActualNames.get(norm)?.join(' · ') || fallback)
      : fallback;

  // ── Raw mode ──────────────────────────────────────────────────────────────────
  const uniquePipelines = [...new Set(benchmarks.map(b => b.pipeline))].filter(p => Boolean(p) && p !== 'all').sort();

  const formatPipelineName = (p: string) =>
    p.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const hasGroupedData = stages.length > 0;
  const hasRawData = rawBenchmarks.length > 0;
  const hasAnyData = hasGroupedData || hasRawData;

  // ── Shared cell renderers ─────────────────────────────────────────────────────
  const wonCell = (b: StageBenchmark | undefined, stageNorm: string, seg: string, pipelineName?: string) => {
    const val = metricMode === 'median' ? (b?.won_median ?? null) : (b?.won_avg ?? null);
    return (
      <td
        key={`${stageNorm}_${seg}_won`}
        onClick={() => b?.won_median != null ? openMath(stageNorm, 'won', stageHeaderLabel(stageNorm, b.stage), seg, b.won_median, pipelineName ?? selectedPipeline) : undefined}
        style={{
          padding: '10px 12px', textAlign: 'center',
          opacity: b?.won_confidence === 'insufficient' ? 0.45 : 1,
          cursor: b?.won_median != null ? 'pointer' : 'default',
        }}
        title={b?.won_median != null ? 'Click to see deals' : undefined}
      >
        <span style={{ fontWeight: 600, color: '#38A169' }}>{fmtDays(val)}</span>
        {b && <ConfidenceDot tier={b.won_confidence} sample={b.won_sample} />}
      </td>
    );
  };

  const lostCell = (b: StageBenchmark | undefined, stageNorm: string, seg: string, pipelineName?: string) => {
    const val = metricMode === 'median' ? (b?.lost_median ?? null) : (b?.lost_avg ?? null);
    return (
      <td
        key={`${stageNorm}_${seg}_lost`}
        onClick={() => b?.lost_median != null ? openMath(stageNorm, 'lost', stageHeaderLabel(stageNorm, b.stage), seg, b.lost_median, pipelineName ?? selectedPipeline) : undefined}
        style={{
          padding: '10px 12px', textAlign: 'center',
          opacity: b?.lost_confidence === 'insufficient' ? 0.45 : 1,
          cursor: b?.lost_median != null ? 'pointer' : 'default',
        }}
        title={b?.lost_median != null ? 'Click to see deals' : undefined}
      >
        <span style={{ fontWeight: 600, color: '#E53E3E' }}>{fmtDays(val)}</span>
        {b && <ConfidenceDot tier={b.lost_confidence} sample={b.lost_sample} />}
      </td>
    );
  };

  const metricLabel = metricMode === 'median' ? 'median' : 'avg';

  const renderBenchmarkTable = (
    stageList: Array<{ stage: string; stage_normalized: string; display_order: number | null }>,
    seg: string,
    getBench: (norm: string, s: string) => StageBenchmark | undefined,
    pipelineName?: string,
  ) => (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
            <th style={{ padding: '10px 16px', textAlign: 'left', color: colors.textMuted, fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap', width: 140 }}>Metric</th>
            {stageList.map(s => (
              <th key={s.stage_normalized} style={{ padding: '10px 12px', textAlign: 'center', color: colors.textMuted, fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap', minWidth: 110 }}>
                {stageHeaderLabel(s.stage_normalized, s.stage)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
            <td style={{ padding: '10px 16px', color: colors.textSecondary, whiteSpace: 'nowrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#38A169', display: 'inline-block' }} />
                Won {metricLabel}
              </span>
            </td>
            {stageList.map(s => wonCell(getBench(s.stage_normalized, seg), s.stage_normalized, seg, pipelineName))}
          </tr>
          <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
            <td style={{ padding: '10px 16px', color: colors.textSecondary, whiteSpace: 'nowrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#E53E3E', display: 'inline-block' }} />
                Lost {metricLabel}
              </span>
            </td>
            {stageList.map(s => lostCell(getBench(s.stage_normalized, seg), s.stage_normalized, seg, pipelineName))}
          </tr>
          <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
            <td style={{ padding: '10px 16px', color: colors.textSecondary, whiteSpace: 'nowrap' }}>Signal gap</td>
            {stageList.map(s => {
              const b = getBench(s.stage_normalized, seg);
              const ratio = b?.won_median && b?.lost_median ? (b.lost_median / b.won_median) : null;
              const gapColor = signalGapColor(b?.won_median ?? null, b?.lost_median ?? null);
              return (
                <td key={s.stage_normalized} style={{ padding: '10px 12px', textAlign: 'center' }}>
                  {b?.is_inverted ? (
                    <span style={{ fontSize: 10, color: '#805AD5', fontWeight: 600 }} title="Winners spend longer here — rushing through may signal poor qualification">⚠ Inverted</span>
                  ) : ratio !== null ? (
                    <span style={{ fontWeight: 600, color: gapColor }}>{ratio.toFixed(1)}×</span>
                  ) : '—'}
                </td>
              );
            })}
          </tr>
          <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
            <td style={{ padding: '10px 16px', color: colors.textSecondary, whiteSpace: 'nowrap' }}>Open now (avg)</td>
            {stageList.map(s => {
              const b = getBench(s.stage_normalized, seg);
              const open = openAvg[s.stage_normalized];
              if (!open) return <td key={s.stage_normalized} style={{ padding: '10px 12px', textAlign: 'center', color: colors.textMuted }}>—</td>;
              const openColor = b?.lost_median && open.avg > b.lost_median ? '#E53E3E'
                : b?.won_median && open.avg > b.won_median ? '#D69E2E'
                : colors.textSecondary;
              return (
                <td
                  key={s.stage_normalized}
                  style={{ padding: '10px 12px', textAlign: 'center', cursor: 'pointer' }}
                  onClick={() => openOpenMath(s.stage_normalized, s.stage, open.avg, pipelineName)}
                  title="Click to see open deals"
                >
                  <div style={{ fontWeight: 600, color: openColor }}>{fmtDays(open.avg)}</div>
                  <div style={{ fontSize: 10, color: colors.textMuted }}>{open.count} deal{open.count !== 1 ? 's' : ''}</div>
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );

  return (
    <div style={{ padding: '24px 32px', fontFamily: fonts.sans }}>
      {mathModal && <MathModal modal={mathModal} onClose={() => setMathModal(null)} />}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: colors.text, margin: 0, marginBottom: 4 }}>
            Stage Velocity Benchmarks
          </h1>
          <div style={{ fontSize: 12, color: colors.textMuted }}>
            How long deals spend in each stage — benchmarked against your own closed deals.
            {data?.last_computed_at && (
              <span style={{ marginLeft: 8 }}>
                Last updated {new Date(data.last_computed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* View mode toggle */}
          <div style={{ display: 'flex', background: colors.surfaceHover, borderRadius: 7, padding: 2, border: `1px solid ${colors.border}` }}>
            <ToggleButton active={viewMode === 'grouped'} onClick={() => setViewMode('grouped')}>
              Grouped
            </ToggleButton>
            <ToggleButton active={viewMode === 'raw'} onClick={() => setViewMode('raw')}>
              Deal Stages
            </ToggleButton>
          </div>

          {/* Metric mode toggle */}
          <div style={{ width: 1, height: 20, background: colors.border, flexShrink: 0 }} />
          <div style={{ display: 'flex', background: colors.surfaceHover, borderRadius: 7, padding: 2, border: `1px solid ${colors.border}` }}>
            <ToggleButton active={metricMode === 'median'} onClick={() => setMetricMode('median')}>
              Median
            </ToggleButton>
            <ToggleButton active={metricMode === 'average'} onClick={() => setMetricMode('average')}>
              Average
            </ToggleButton>
          </div>

          {/* Show actual stage names toggle (Grouped mode only, single pipeline) */}
          {viewMode === 'grouped' && selectedPipeline !== 'all' && (
            <button
              onClick={() => setShowActualNames(v => !v)}
              style={{
                padding: '5px 10px', fontSize: 11, fontFamily: fonts.sans, borderRadius: 5,
                border: `1px solid ${colors.border}`, cursor: 'pointer',
                background: showActualNames ? `${colors.accent}20` : 'transparent',
                color: showActualNames ? colors.accent : colors.textMuted,
              }}
              title="Toggle between normalized stage categories and your actual CRM stage names"
            >
              {showActualNames ? '✓ ' : ''}CRM names
            </button>
          )}

          {data?.pipelines && data.pipelines.length > 1 && (
            <select
              value={selectedPipeline}
              onChange={e => setSelectedPipeline(e.target.value)}
              style={{ padding: '6px 10px', borderRadius: 6, border: `1px solid ${colors.border}`, background: colors.surface, color: colors.text, fontSize: 12, fontFamily: fonts.sans }}
            >
              <option value="all">All Pipelines</option>
              {data.pipelines.map(p => <option key={p} value={p}>{formatPipelineName(p)}</option>)}
            </select>
          )}

          <button
            onClick={handleRefresh}
            disabled={refreshing}
            style={{
              padding: '7px 14px', borderRadius: 6, border: `1px solid ${colors.border}`,
              background: refreshing ? colors.surfaceHover : colors.surface,
              color: colors.text, fontSize: 12, cursor: refreshing ? 'wait' : 'pointer', fontFamily: fonts.sans,
            }}
          >
            {refreshing ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {!hasAnyData ? (
        <div style={{ padding: 48, textAlign: 'center', background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, color: colors.textMuted, fontSize: 13 }}>
          <div style={{ marginBottom: 12, fontSize: 32 }}>📊</div>
          <div style={{ fontWeight: 600, marginBottom: 8, color: colors.text }}>No Benchmarks Yet</div>
          <div style={{ maxWidth: 400, margin: '0 auto', marginBottom: 20 }}>
            Benchmarks are computed from your closed deals. Once you have at least 3 closed-won or closed-lost deals in a stage, velocity data will appear here.
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            style={{ padding: '8px 20px', borderRadius: 6, background: colors.accent, color: '#fff', border: 'none', fontSize: 13, cursor: 'pointer', fontFamily: fonts.sans }}
          >
            {refreshing ? 'Computing…' : 'Compute Now'}
          </button>
        </div>
      ) : viewMode === 'grouped' ? (
        /* ── GROUPED VIEW ── */
        !hasGroupedData ? (
          <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: colors.textMuted }}>
            No grouped benchmark data. Try clicking Refresh or switch to Deal Stages view.
          </div>
        ) : selectedPipeline === 'all' && uniquePipelines.length > 1 ? (
          /* Pipeline-grouped layout */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {uniquePipelines.map(pipelineName => {
              const pipelineBenches = benchmarks.filter(b => b.pipeline === pipelineName);
              const pipelineStages = [...new Map(
                pipelineBenches.map(b => [b.stage_normalized, { stage: b.stage, stage_normalized: b.stage_normalized, display_order: b.display_order }])
              ).values()].sort((a, b) => a.stage_normalized.localeCompare(b.stage_normalized));
              const pipelineSegs = SEGMENTS.filter(seg => pipelineBenches.some(b => b.segment === seg));
              const getPB = (stageNorm: string, seg: string) =>
                pipelineBenches.find(b => b.stage_normalized === stageNorm && b.segment === seg);
              const pipelineCollapsed = collapsedSegments.has(`pipeline_${pipelineName}`);

              return (
                <div key={pipelineName} style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: 'hidden' }}>
                  <div
                    onClick={() => setCollapsedSegments(prev => {
                      const next = new Set(prev); const k = `pipeline_${pipelineName}`;
                      next.has(k) ? next.delete(k) : next.add(k); return next;
                    })}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', cursor: 'pointer', borderBottom: pipelineCollapsed ? 'none' : `1px solid ${colors.border}`, background: colors.surfaceRaised }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>{formatPipelineName(pipelineName)}</span>
                      <span style={{ fontSize: 10, color: colors.textMuted, background: colors.surfaceHover, padding: '1px 6px', borderRadius: 10 }}>
                        {pipelineStages.length} stage{pipelineStages.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <span style={{ fontSize: 11, color: colors.textMuted }}>{pipelineCollapsed ? '▼' : '▲'}</span>
                  </div>

                  {!pipelineCollapsed && (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {pipelineSegs.map((seg, segIdx) => {
                        const segKey = `${pipelineName}_seg_${seg}`;
                        const segCollapsed = collapsedSegments.has(segKey);
                        return (
                          <div key={seg} style={{ borderTop: segIdx > 0 ? `1px solid ${colors.border}` : undefined }}>
                            <div
                              onClick={() => setCollapsedSegments(prev => { const next = new Set(prev); next.has(segKey) ? next.delete(segKey) : next.add(segKey); return next; })}
                              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 18px', cursor: 'pointer', borderBottom: segCollapsed ? 'none' : `1px solid ${colors.border}`, background: 'rgba(0,0,0,0.03)' }}
                            >
                              <span style={{ fontSize: 12, fontWeight: 500, color: colors.textSecondary }}>{SEGMENT_LABEL[seg] ?? seg}</span>
                              <span style={{ fontSize: 10, color: colors.textMuted }}>{segCollapsed ? '▼' : '▲'}</span>
                            </div>
                            {!segCollapsed && renderBenchmarkTable(pipelineStages, seg, getPB, pipelineName)}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          /* Single-pipeline segment layout */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {availableSegs.map(seg => {
              const collapsed = collapsedSegments.has(seg);
              return (
                <div key={seg} style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: 'hidden' }}>
                  <div
                    onClick={() => toggleSegment(seg)}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', cursor: 'pointer', borderBottom: collapsed ? 'none' : `1px solid ${colors.border}`, background: colors.surfaceRaised }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>{SEGMENT_LABEL[seg] ?? seg}</span>
                    <span style={{ fontSize: 11, color: colors.textMuted }}>{collapsed ? '▼' : '▲'}</span>
                  </div>
                  {!collapsed && renderBenchmarkTable(stages, seg, getBenchmark)}
                </div>
              );
            })}
          </div>
        )
      ) : (
        /* ── DEAL STAGES VIEW ── */
        !hasRawData ? (
          <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: colors.textMuted }}>
            No raw stage data found. Stage history may be recorded using internal API IDs rather than display names.
          </div>
        ) : (() => {
          // Group by pipeline first when multiple pipelines exist, then by stage_normalized
          const pipelineNames = [...new Set(rawBenchmarks.map(rb => rb.pipeline ?? ''))].sort();
          const multiPipeline = pipelineNames.length > 1;

          const renderNormGroups = (stagesForPipeline: RawBenchmark[]) => {
            const grouped: Record<string, RawBenchmark[]> = {};
            for (const rb of stagesForPipeline) {
              if (!grouped[rb.stage_normalized]) grouped[rb.stage_normalized] = [];
              grouped[rb.stage_normalized].push(rb);
            }
            const normKeys = Object.keys(grouped).sort((a, b) => {
              const minA = Math.min(...grouped[a].map(s => s.display_order ?? 999));
              const minB = Math.min(...grouped[b].map(s => s.display_order ?? 999));
              return minA - minB || a.localeCompare(b);
            });
            return normKeys.map(normKey => {
              const cKey = `raw_${normKey}`;
              const collapsed = collapsedSegments.has(cKey);
              const groupLabel = normKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
              const groupStages = grouped[normKey];
              return (
                <div key={normKey} style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: 'hidden' }}>
                  <div
                    onClick={() => setCollapsedSegments(prev => { const next = new Set(prev); next.has(cKey) ? next.delete(cKey) : next.add(cKey); return next; })}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', cursor: 'pointer', borderBottom: collapsed ? 'none' : `1px solid ${colors.border}`, background: colors.surfaceRaised }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>{groupLabel}</span>
                      <span style={{ fontSize: 10, color: colors.textMuted, background: colors.surfaceHover, padding: '1px 6px', borderRadius: 10 }}>
                        {groupStages.length} stage{groupStages.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <span style={{ fontSize: 11, color: colors.textMuted }}>{collapsed ? '▼' : '▲'}</span>
                  </div>
                  {!collapsed && (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                            <th style={{ padding: '10px 16px', textAlign: 'left', color: colors.textMuted, fontWeight: 600, fontSize: 11, width: 200 }}>Stage Name</th>
                            <th style={{ padding: '10px 12px', textAlign: 'center', color: '#38A169', fontWeight: 600, fontSize: 11, minWidth: 100 }}>Won {metricLabel}</th>
                            <th style={{ padding: '10px 12px', textAlign: 'center', color: '#E53E3E', fontWeight: 600, fontSize: 11, minWidth: 100 }}>Lost {metricLabel}</th>
                            <th style={{ padding: '10px 12px', textAlign: 'center', color: colors.textMuted, fontWeight: 600, fontSize: 11, minWidth: 80 }}>Signal gap</th>
                          </tr>
                        </thead>
                        <tbody>
                          {groupStages.map(rb => {
                            const wonVal = metricMode === 'median' ? rb.won_median : rb.won_avg;
                            const lostVal = metricMode === 'median' ? rb.lost_median : rb.lost_avg;
                            const ratio = rb.won_median && rb.lost_median ? rb.lost_median / rb.won_median : null;
                            const gapColor = signalGapColor(rb.won_median, rb.lost_median);
                            return (
                              <tr key={`${rb.pipeline}-${rb.stage}`} style={{ borderBottom: `1px solid ${colors.border}` }}>
                                <td style={{ padding: '10px 16px', color: colors.text, fontWeight: 500 }}>{rb.stage}</td>
                                <td style={{ padding: '10px 12px', textAlign: 'center', cursor: rb.won_median != null ? 'pointer' : 'default' }}
                                  onClick={() => rb.won_median != null ? openMath(rb.stage_normalized, 'won', rb.stage, 'all', rb.won_median, rb.pipeline || selectedPipeline) : undefined}>
                                  {wonVal !== null && wonVal !== undefined ? (
                                    <span><span style={{ fontWeight: 600, color: '#38A169' }}>{fmtDays(wonVal)}</span><ConfidenceDot tier={rb.won_sample >= 20 ? 'high' : rb.won_sample >= 5 ? 'directional' : 'insufficient'} sample={rb.won_sample} /></span>
                                  ) : <span style={{ color: colors.textMuted }}>—</span>}
                                </td>
                                <td style={{ padding: '10px 12px', textAlign: 'center', cursor: rb.lost_median != null ? 'pointer' : 'default' }}
                                  onClick={() => rb.lost_median != null ? openMath(rb.stage_normalized, 'lost', rb.stage, 'all', rb.lost_median, rb.pipeline || selectedPipeline) : undefined}>
                                  {lostVal !== null && lostVal !== undefined ? (
                                    <span><span style={{ fontWeight: 600, color: '#E53E3E' }}>{fmtDays(lostVal)}</span><ConfidenceDot tier={rb.lost_sample >= 20 ? 'high' : rb.lost_sample >= 5 ? 'directional' : 'insufficient'} sample={rb.lost_sample} /></span>
                                  ) : <span style={{ color: colors.textMuted }}>—</span>}
                                </td>
                                <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                                  {ratio !== null ? <span style={{ fontWeight: 600, color: gapColor }}>{ratio.toFixed(1)}×</span> : '—'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            });
          };

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {multiPipeline ? pipelineNames.map(pName => {
                const pStages = rawBenchmarks.filter(rb => (rb.pipeline ?? '') === pName);
                const pKey = `pipeline_raw_${pName}`;
                const pCollapsed = collapsedSegments.has(pKey);
                return (
                  <div key={pName} style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: 'hidden' }}>
                    <div
                      onClick={() => setCollapsedSegments(prev => { const next = new Set(prev); next.has(pKey) ? next.delete(pKey) : next.add(pKey); return next; })}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', cursor: 'pointer', borderBottom: pCollapsed ? 'none' : `1px solid ${colors.border}`, background: colors.surfaceRaised }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>{pName || 'Default Pipeline'}</span>
                      <span style={{ fontSize: 11, color: colors.textMuted }}>{pCollapsed ? '▼' : '▲'}</span>
                    </div>
                    {!pCollapsed && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 16px' }}>
                        {renderNormGroups(pStages)}
                      </div>
                    )}
                  </div>
                );
              }) : renderNormGroups(rawBenchmarks)}
            </div>
          );
        })()
      )}

      {/* Closed (total) — standalone summary card, rendered once regardless of view */}
      {data?.cycle_time && (data.cycle_time.won_median != null || data.cycle_time.lost_median != null) && (() => {
        const ct = data.cycle_time!;
        const ctWonVal = metricMode === 'median' ? ct.won_median : ct.won_avg;
        const ctLostVal = metricMode === 'median' ? ct.lost_median : ct.lost_avg;
        const ratio = ct.won_median && ct.lost_median ? ct.lost_median / ct.won_median : null;
        const gapColor = signalGapColor(ct.won_median, ct.lost_median);
        return (
          <div style={{ marginTop: 16, background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ padding: '12px 18px', background: colors.surfaceRaised, borderBottom: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>Closed</span>
              <span style={{ fontSize: 10, color: colors.textMuted, background: colors.surfaceHover, padding: '1px 6px', borderRadius: 10 }}>total sales cycle</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                    <th style={{ padding: '10px 16px', textAlign: 'left', color: colors.textMuted, fontWeight: 600, fontSize: 11, width: 200 }}>Metric</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center', color: '#38A169', fontWeight: 600, fontSize: 11, minWidth: 100 }}>Won {metricLabel}</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center', color: '#E53E3E', fontWeight: 600, fontSize: 11, minWidth: 100 }}>Lost {metricLabel}</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center', color: colors.textMuted, fontWeight: 600, fontSize: 11, minWidth: 80 }}>Signal gap</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ padding: '10px 16px', color: colors.text, fontWeight: 500 }}>Total sales cycle</td>
                    <td
                      style={{ padding: '10px 12px', textAlign: 'center', cursor: ct.won_median != null ? 'pointer' : 'default' }}
                      onClick={() => ct.won_median != null ? openMath('_cycle_total', 'won', 'Closed (total)', 'all', ct.won_median, selectedPipeline !== 'all' ? selectedPipeline : undefined) : undefined}
                    >
                      {ctWonVal != null ? (
                        <span>
                          <span style={{ fontWeight: 700, color: '#38A169' }}>{fmtDays(ctWonVal)}</span>
                          <ConfidenceDot tier={ct.won_sample >= 20 ? 'high' : ct.won_sample >= 5 ? 'directional' : 'insufficient'} sample={ct.won_sample} />
                        </span>
                      ) : <span style={{ color: colors.textMuted }}>—</span>}
                    </td>
                    <td
                      style={{ padding: '10px 12px', textAlign: 'center', cursor: ct.lost_median != null ? 'pointer' : 'default' }}
                      onClick={() => ct.lost_median != null ? openMath('_cycle_total', 'lost', 'Closed (total)', 'all', ct.lost_median, selectedPipeline !== 'all' ? selectedPipeline : undefined) : undefined}
                    >
                      {ctLostVal != null ? (
                        <span>
                          <span style={{ fontWeight: 700, color: '#E53E3E' }}>{fmtDays(ctLostVal)}</span>
                          <ConfidenceDot tier={ct.lost_sample >= 20 ? 'high' : ct.lost_sample >= 5 ? 'directional' : 'insufficient'} sample={ct.lost_sample} />
                        </span>
                      ) : <span style={{ color: colors.textMuted }}>—</span>}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                      {ratio != null ? <span style={{ fontWeight: 600, color: gapColor }}>{ratio.toFixed(1)}×</span> : '—'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* Reading guide */}
      <details style={{ marginTop: 28 }}>
        <summary style={{ fontSize: 12, color: colors.textMuted, cursor: 'pointer', padding: '8px 0' }}>
          How to read this grid
        </summary>
        <div style={{ marginTop: 10, background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8, padding: 16, fontSize: 12, color: colors.textSecondary, lineHeight: 1.7 }}>
          <p style={{ margin: '0 0 8px' }}>
            <strong>Grouped view</strong>: Stages are collapsed into normalized categories (Evaluation, Qualification, etc.) across all matching CRM stage names. Toggle "CRM names" to see your actual stage names in the column headers.
          </p>
          <p style={{ margin: '0 0 8px' }}>
            <strong>Deal Stages view</strong>: Shows each individual CRM stage name with its own won/lost benchmarks. Click any number to see the deals behind the calculation.
          </p>
          <p style={{ margin: '0 0 8px' }}>
            <strong>Signal gap</strong>: Lost median ÷ Won median. Higher = more diagnostic power. 5× means you can catch at-risk deals very early.
          </p>
          <p style={{ margin: '0 0 8px' }}>
            <strong>⚠ Inverted</strong>: Won deals spend <em>longer</em> in this stage than lost deals — rushing through may signal poor qualification.
          </p>
          <p style={{ margin: '0 0 8px' }}>
            <strong>Confidence dot</strong>: Hover the small colored dot next to any number to see sample size and confidence level. Green = high (≥20 deals), amber = directional (5–19), grey = insufficient (&lt;5).
          </p>
          <p style={{ margin: 0 }}>
            <strong>Show math</strong>: Click any Won or Lost median number to see the individual deals that make up that calculation.
          </p>
        </div>
      </details>
    </div>
  );
}
