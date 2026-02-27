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
  won_p75: number | null;
  won_sample: number;
  won_confidence: string;
  lost_median: number | null;
  lost_sample: number;
  lost_confidence: string;
  is_inverted: boolean;
}

interface OpenAverage {
  avg: number;
  count: number;
}

interface BenchmarksResponse {
  benchmarks: StageBenchmark[];
  open_averages: Record<string, OpenAverage>;
  pipelines: string[];
  last_computed_at: string | null;
}

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

function fmtDays(d: number | null): string {
  if (d === null) return '—';
  if (d < 1) return '<1d';
  return `${Math.round(d)}d`;
}

function ConfidenceBadge({ tier, sample }: { tier: string; sample: number }) {
  const style: React.CSSProperties = {
    display: 'inline-block',
    fontSize: 9,
    padding: '1px 5px',
    borderRadius: 4,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.3px',
  };
  if (tier === 'high') return <span style={{ ...style, background: '#38A16918', color: '#38A169' }}>High · {sample}</span>;
  if (tier === 'directional') return <span style={{ ...style, background: '#D69E2E18', color: '#D69E2E' }}>Dir · {sample}</span>;
  return <span style={{ ...style, background: '#94a3b818', color: '#94a3b8', opacity: 0.7 }}>Low · {sample}</span>;
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
        <button
          onClick={load}
          style={{ padding: '8px 16px', borderRadius: 6, border: `1px solid ${colors.border}`, background: 'transparent', color: colors.accent, cursor: 'pointer', fontSize: 12, fontFamily: fonts.sans }}
        >
          Retry
        </button>
      </div>
    );
  }

  const benchmarks = data?.benchmarks ?? [];

  // Get unique stages ordered by display_order
  const stages = [...new Map(
    benchmarks
      .filter(b => selectedPipeline === 'all' || b.pipeline === selectedPipeline || b.pipeline === 'all')
      .map(b => [b.stage_normalized, { stage: b.stage, stage_normalized: b.stage_normalized, display_order: b.display_order }])
  ).values()].sort((a, b) => {
    if (a.display_order !== null && b.display_order !== null) return a.display_order - b.display_order;
    if (a.display_order !== null) return -1;
    if (b.display_order !== null) return 1;
    return a.stage.localeCompare(b.stage);
  });

  // Available segments from data (filter out 'all' if others exist)
  const availableSegs = SEGMENTS.filter(seg =>
    benchmarks.some(b => b.segment === seg)
  );

  const getBenchmark = (stageNorm: string, segment: string): StageBenchmark | undefined =>
    benchmarks.find(b => b.stage_normalized === stageNorm && b.segment === segment);

  const openAvg = data?.open_averages ?? {};

  return (
    <div style={{ padding: '24px 32px', fontFamily: fonts.sans }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: colors.text, margin: 0, marginBottom: 4 }}>
            Stage Velocity Benchmarks
          </h1>
          <div style={{ fontSize: 12, color: colors.textMuted }}>
            How long deals spend in each stage — benchmarked against your own closed deals by segment.
            {data?.last_computed_at && (
              <span style={{ marginLeft: 8 }}>
                Last updated {new Date(data.last_computed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {data?.pipelines && data.pipelines.length > 1 && (
            <select
              value={selectedPipeline}
              onChange={e => setSelectedPipeline(e.target.value)}
              style={{
                padding: '6px 10px', borderRadius: 6, border: `1px solid ${colors.border}`,
                background: colors.surface, color: colors.text, fontSize: 12, fontFamily: fonts.sans,
              }}
            >
              <option value="all">All Pipelines</option>
              {data.pipelines.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            style={{
              padding: '7px 14px', borderRadius: 6,
              border: `1px solid ${colors.border}`,
              background: refreshing ? colors.surfaceHover : colors.surface,
              color: colors.text, fontSize: 12, cursor: refreshing ? 'wait' : 'pointer',
              fontFamily: fonts.sans,
            }}
          >
            {refreshing ? 'Refreshing…' : '↻ Refresh Benchmarks'}
          </button>
        </div>
      </div>

      {stages.length === 0 ? (
        <div style={{
          padding: 48,
          textAlign: 'center',
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          color: colors.textMuted,
          fontSize: 13,
        }}>
          <div style={{ marginBottom: 12, fontSize: 32 }}>📊</div>
          <div style={{ fontWeight: 600, marginBottom: 8, color: colors.text }}>No Benchmarks Yet</div>
          <div style={{ maxWidth: 400, margin: '0 auto', marginBottom: 20 }}>
            Benchmarks are computed from your closed deals. Once you have at least 3 closed-won or closed-lost deals in a stage, velocity data will appear here.
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            style={{
              padding: '8px 20px', borderRadius: 6,
              background: colors.accent, color: '#fff',
              border: 'none', fontSize: 13, cursor: 'pointer', fontFamily: fonts.sans,
            }}
          >
            {refreshing ? 'Computing…' : 'Compute Now'}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {availableSegs.map(seg => {
            const collapsed = collapsedSegments.has(seg);
            return (
              <div key={seg} style={{
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: 10,
                overflow: 'hidden',
              }}>
                {/* Segment header */}
                <div
                  onClick={() => toggleSegment(seg)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 18px',
                    cursor: 'pointer',
                    borderBottom: collapsed ? 'none' : `1px solid ${colors.border}`,
                    background: colors.surfaceRaised,
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>
                    {SEGMENT_LABEL[seg] ?? seg}
                  </span>
                  <span style={{ fontSize: 11, color: colors.textMuted }}>{collapsed ? '▼' : '▲'}</span>
                </div>

                {!collapsed && (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                          <th style={{ padding: '10px 16px', textAlign: 'left', color: colors.textMuted, fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap', width: 140 }}>
                            Metric
                          </th>
                          {stages.map(s => (
                            <th key={s.stage_normalized} style={{ padding: '10px 12px', textAlign: 'center', color: colors.textMuted, fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap', minWidth: 110 }}>
                              {s.stage}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {/* Won median row */}
                        <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                          <td style={{ padding: '10px 16px', color: colors.textSecondary, whiteSpace: 'nowrap' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#38A169', display: 'inline-block' }} />
                              Won median
                            </span>
                          </td>
                          {stages.map(s => {
                            const b = getBenchmark(s.stage_normalized, seg);
                            return (
                              <td key={s.stage_normalized} style={{ padding: '10px 12px', textAlign: 'center', opacity: b?.won_confidence === 'insufficient' ? 0.4 : 1 }}>
                                <div style={{ fontWeight: 600, color: '#38A169' }}>{fmtDays(b?.won_median ?? null)}</div>
                                {b && <ConfidenceBadge tier={b.won_confidence} sample={b.won_sample} />}
                              </td>
                            );
                          })}
                        </tr>

                        {/* Lost median row */}
                        <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                          <td style={{ padding: '10px 16px', color: colors.textSecondary, whiteSpace: 'nowrap' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#E53E3E', display: 'inline-block' }} />
                              Lost median
                            </span>
                          </td>
                          {stages.map(s => {
                            const b = getBenchmark(s.stage_normalized, seg);
                            return (
                              <td key={s.stage_normalized} style={{ padding: '10px 12px', textAlign: 'center', opacity: b?.lost_confidence === 'insufficient' ? 0.4 : 1 }}>
                                <div style={{ fontWeight: 600, color: '#E53E3E' }}>{fmtDays(b?.lost_median ?? null)}</div>
                                {b && <ConfidenceBadge tier={b.lost_confidence} sample={b.lost_sample} />}
                              </td>
                            );
                          })}
                        </tr>

                        {/* Signal gap row */}
                        <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                          <td style={{ padding: '10px 16px', color: colors.textSecondary, whiteSpace: 'nowrap' }}>
                            Signal gap
                          </td>
                          {stages.map(s => {
                            const b = getBenchmark(s.stage_normalized, seg);
                            const ratio = b?.won_median && b?.lost_median ? (b.lost_median / b.won_median) : null;
                            const gapColor = signalGapColor(b?.won_median ?? null, b?.lost_median ?? null);
                            return (
                              <td key={s.stage_normalized} style={{ padding: '10px 12px', textAlign: 'center' }}>
                                {b?.is_inverted ? (
                                  <span style={{ fontSize: 10, color: '#805AD5', fontWeight: 600 }} title="Inverted: winners spend longer here">
                                    ⚠ Inverted
                                  </span>
                                ) : ratio !== null ? (
                                  <span style={{ fontWeight: 600, color: gapColor }}>
                                    {ratio.toFixed(1)}×
                                  </span>
                                ) : '—'}
                              </td>
                            );
                          })}
                        </tr>

                        {/* Open now avg row */}
                        <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                          <td style={{ padding: '10px 16px', color: colors.textSecondary, whiteSpace: 'nowrap' }}>
                            Open now (avg)
                          </td>
                          {stages.map(s => {
                            const b = getBenchmark(s.stage_normalized, seg);
                            const open = openAvg[s.stage_normalized];
                            if (!open) return <td key={s.stage_normalized} style={{ padding: '10px 12px', textAlign: 'center', color: colors.textMuted }}>—</td>;
                            const openColor = b?.lost_median && open.avg > b.lost_median
                              ? '#E53E3E'
                              : b?.won_median && open.avg > b.won_median
                              ? '#D69E2E'
                              : colors.textSecondary;
                            return (
                              <td key={s.stage_normalized} style={{ padding: '10px 12px', textAlign: 'center' }}>
                                <div style={{ fontWeight: 600, color: openColor }}>{fmtDays(open.avg)}</div>
                                <div style={{ fontSize: 10, color: colors.textMuted }}>{open.count} deal{open.count !== 1 ? 's' : ''}</div>
                              </td>
                            );
                          })}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Reading guide */}
      <details style={{ marginTop: 28 }}>
        <summary style={{ fontSize: 12, color: colors.textMuted, cursor: 'pointer', padding: '8px 0' }}>
          How to read this grid
        </summary>
        <div style={{
          marginTop: 10,
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 16,
          fontSize: 12,
          color: colors.textSecondary,
          lineHeight: 1.7,
        }}>
          <p style={{ margin: '0 0 8px' }}>
            <strong>Won median</strong>: How long deals that closed won spent in this stage. This is your target pace.
          </p>
          <p style={{ margin: '0 0 8px' }}>
            <strong>Lost median</strong>: How long deals that closed lost spent here. Deals crossing this threshold enter Critical territory.
          </p>
          <p style={{ margin: '0 0 8px' }}>
            <strong>Signal gap</strong>: Lost median ÷ Won median. Higher = more diagnostic power. 5× means you can catch at-risk deals very early. &lt;2× means the stage is noisy — don't over-index on it.
          </p>
          <p style={{ margin: '0 0 8px' }}>
            <strong>⚠ Inverted</strong>: Won deals spend <em>longer</em> in this stage than lost deals. Rushing through may signal poor qualification, not speed. Don't flag fast deals here as healthy.
          </p>
          <p style={{ margin: 0 }}>
            <strong>Confidence tiers</strong>: High (≥20 deals), Directional (5–19), Insufficient (&lt;5). Treat insufficient data as directional guidance only.
          </p>
        </div>
      </details>
    </div>
  );
}
