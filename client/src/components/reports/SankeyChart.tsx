import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { SankeyChartData } from './types';
import { api } from '../../lib/api';
import { colors, fonts } from '../../styles/theme';

// Stage color palette
const STAGE_COLORS = ['#818cf8', '#34d399', '#fbbf24', '#f472b6', '#60a5fa', '#a78bfa', '#2dd4bf'];
const LOST_COLOR = '#f87171';
const LOST_BAR_COLOR = '#991b1b';

// Layout constants
const NODE_W = 28;
const MAX_H = 220;
const MIN_H = 20;
const MAX_LOST_H = 48;  // max height of below-axis lost bars
const LABEL_TOP = 80;   // space above chart area for name/count labels
const BOTTOM_H = 90;    // space below baseline for lost bars + labels
const SIDE_PAD = 28;
const GAP = 80;

type FilterKey = string;

// ============================================================================
// Helpers
// ============================================================================

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function truncate(s: string, max: number) {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// ============================================================================
// Main Component
// ============================================================================

interface SankeyChartProps {
  data?: SankeyChartData;
  chartData?: SankeyChartData;
  workspaceId?: string;
  hideFilters?: boolean;
  showRaw?: boolean;
}

export default function SankeyChart({ data, chartData: chartDataProp, hideFilters = false, showRaw = false }: SankeyChartProps) {
  const initialData = (data ?? chartDataProp) ?? null;
  const [chartData, setChartData] = useState<SankeyChartData | null>(initialData);
  const [loading, setLoading] = useState(false);
  const [hoveredFlow, setHoveredFlow] = useState<number | null>(null);
  const [openMathCard, setOpenMathCard] = useState<number | null>(null);
  const [containerW, setContainerW] = useState(700);
  const svgContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = svgContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setContainerW(w);
    });
    ro.observe(el);
    setContainerW(el.clientWidth || 700);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const next = (data ?? chartDataProp) ?? null;
    if (next) setChartData(next);
  }, [data, chartDataProp]);

  if (!chartData) return null;

  const activeFilterKey = (() => {
    const af = chartData.activeFilter;
    if (af.type === 'all') return 'all';
    if (af.type === 'pipeline') return `pipeline:${af.id}`;
    return `scope:${af.id}`;
  })();

  const { stages, flows, conversionRates, periodLabel, availableFilters } = chartData;

  const hasFilters =
    !hideFilters && (availableFilters.pipelines.length > 0 || availableFilters.scopes.length > 0);

  const handleFilterChange = useCallback(
    async (key: FilterKey) => {
      if (key === activeFilterKey || loading) return;
      setLoading(true);
      try {
        let path = '/analysis/sankey';
        if (key.startsWith('pipeline:')) {
          path += `?pipeline=${encodeURIComponent(key.slice(9))}`;
        } else if (key.startsWith('scope:')) {
          path += `?scopeId=${encodeURIComponent(key.slice(6))}`;
        }
        const fresh = (await api.get(path)) as SankeyChartData;
        setChartData(fresh);
      } catch (err) {
        console.error('[SankeyChart] Filter fetch failed:', err);
      } finally {
        setLoading(false);
      }
    },
    [activeFilterKey, loading]
  );

  // ── SVG Layout ──────────────────────────────────────────────────────────────
  const n = stages.length;
  if (n === 0) return null;

  // Use historical deal throughput (entered) for bar height.
  // This gives a naturally decreasing funnel: early stages always see more
  // deals entering than late stages, so bars taper left-to-right.
  // entered/enteredValue are the historical throughput fields.
  // Fall back to deals/value if entered is missing (old cached data).
  const getEntered = (s: (typeof stages)[0]) => s.entered ?? s.deals ?? 0;
  const getEnteredValue = (s: (typeof stages)[0]) => s.enteredValue ?? s.value ?? 0;

  const maxEntered = Math.max(...stages.map(s => getEntered(s)), 1);

  const nodeH = stages.map(s => Math.max(MIN_H, (getEntered(s) / maxEntered) * MAX_H));

  // Dynamic gap: always spread bars to fill the full container width.
  // No upper cap — bars stretch edge-to-edge regardless of stage count.
  // Minimum of 20px prevents bars from touching on very dense charts.
  const effectiveGap = n > 1
    ? Math.max(20, (containerW - 2 * SIDE_PAD - n * NODE_W) / (n - 1))
    : GAP;

  const nodeX = stages.map((_, i) => SIDE_PAD + i * (NODE_W + effectiveGap));
  // bottom-align all bars to a common baseline
  const baseline = LABEL_TOP + MAX_H;
  const nodeY = nodeH.map(h => baseline - h);
  // Full bar height flows onward — lost deals are shown BELOW the baseline, not inside the bar
  const flowH = nodeH.slice();
  // Below-baseline lost bar height scaled relative to main bar max
  const lostBarH = stages.map(s =>
    s.lostCount > 0 ? Math.max(3, (s.lostCount / maxEntered) * MAX_LOST_H) : 0
  );

  // svgW is now always the measured container width — no viewBox scaling.
  const svgW = containerW;
  const svgH = LABEL_TOP + MAX_H + BOTTOM_H;

  // Helper: flow band path between stage i and i+1.
  //
  // Uses a constant-width ribbon: both the source side and dest side have the
  // same height (bandH). Because top and bottom Bezier curves share identical
  // control-point Y offsets, they are always exactly bandH apart — they cannot
  // converge, cross, or create a butterfly regardless of bar height differences.
  //
  // Band height is sized by pairwise deal flow: what fraction of the source's
  // deals advance to the next stage, applied to the source bar's flow height,
  // then capped at the dest bar's flow height. This prevents balloon expansion
  // when a small bar connects to a large bar.
  function flowBandPath(i: number): string {
    const x1 = nodeX[i] + NODE_W;
    const x2 = nodeX[i + 1];
    const midX = (x1 + x2) / 2;

    // Use pairwise flow data when available, fall back to min of adjacent entered counts.
    // Proportion is computed against entered (historical throughput), not the snapshot count.
    const flow = flows.find(f => f.fromId === stages[i].id && f.toId === stages[i + 1].id);
    const flowDeals = flow?.deals ?? Math.min(getEntered(stages[i]), getEntered(stages[i + 1]));
    const srcEntered = Math.max(getEntered(stages[i]), 1);
    const proportion = Math.min(flowDeals / srcEntered, 1);

    // Constant bandH on both sides — the only butterfly-free guarantee
    const bandH = Math.max(2, Math.min(proportion * flowH[i], flowH[i + 1]));

    // Top-align the ribbon on both bars
    const y1t = nodeY[i];
    const y1b = nodeY[i] + bandH;
    const y2t = nodeY[i + 1];
    const y2b = nodeY[i + 1] + bandH;

    return [
      `M ${x1} ${y1t}`,
      `C ${midX} ${y1t} ${midX} ${y2t} ${x2} ${y2t}`,
      `L ${x2} ${y2b}`,
      `C ${midX} ${y2b} ${midX} ${y1b} ${x1} ${y1b}`,
      'Z',
    ].join(' ');
  }

  // Funnel silhouette envelope path (traces tops of all bars + baseline back)
  function funnelPath(): string {
    const parts: string[] = [];
    // start at top-left of first bar
    parts.push(`M ${nodeX[0]} ${nodeY[0]}`);
    // bezier curves along tops
    for (let i = 0; i < n - 1; i++) {
      const x1 = nodeX[i] + NODE_W;
      const x2 = nodeX[i + 1];
      const midX = (x1 + x2) / 2;
      const y1 = nodeY[i];
      const y2 = nodeY[i + 1];
      parts.push(`L ${x1} ${y1}`);
      parts.push(`C ${midX} ${y1} ${midX} ${y2} ${x2} ${y2}`);
    }
    // right side of last bar (top to bottom)
    parts.push(`L ${nodeX[n - 1] + NODE_W} ${nodeY[n - 1]}`);
    parts.push(`L ${nodeX[n - 1] + NODE_W} ${baseline}`);
    // along baseline back to start
    parts.push(`L ${nodeX[0]} ${baseline}`);
    parts.push('Z');
    return parts.join(' ');
  }

  return (
    <div
      style={{
        background: colors.surfaceRaised,
        borderRadius: 10,
        border: `1px solid ${colors.border}`,
        overflow: 'hidden',
      }}
    >
      {/* Keyframes */}
      <style>{`@keyframes pandora-sankey-spin { to { transform: rotate(360deg); } }`}</style>

      {/* Header */}
      <div
        style={{
          padding: '14px 20px 0',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <h4
            style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 600,
              color: colors.text,
              fontFamily: fonts.sans,
            }}
          >
            Pipeline Funnel
          </h4>
          <div style={{ fontSize: 12, color: colors.textMuted, fontFamily: fonts.sans, marginTop: 2 }}>
            Historical deal throughput per stage · closed lost shown below axis
            {periodLabel && ` · ${periodLabel}`}
          </div>
        </div>
        <span
          style={{
            fontSize: 11,
            color: colors.textMuted,
            fontFamily: fonts.sans,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            marginTop: 2,
          }}
        >
          {chartData.activeFilter.label}
        </span>
      </div>

      {/* Filter bar */}
      {hasFilters && (
        <div
          style={{
            padding: '10px 20px 0',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            alignItems: 'center',
          }}
        >
          <FilterPill
            label="All Deals"
            filterKey="all"
            active={activeFilterKey === 'all'}
            onClick={handleFilterChange}
            loading={loading}
          />

          {availableFilters.pipelines.length > 0 && (
            <>
              <Divider />
              {availableFilters.pipelines.map(p => (
                <FilterPill
                  key={`pipeline:${p}`}
                  label={p}
                  filterKey={`pipeline:${p}`}
                  active={activeFilterKey === `pipeline:${p}`}
                  onClick={handleFilterChange}
                  loading={loading}
                  icon="▶"
                />
              ))}
            </>
          )}

          {availableFilters.scopes.length > 0 && (
            <>
              <Divider />
              {availableFilters.scopes.map(s => (
                <FilterPill
                  key={`scope:${s.id}`}
                  label={s.name}
                  filterKey={`scope:${s.id}`}
                  active={activeFilterKey === `scope:${s.id}`}
                  onClick={handleFilterChange}
                  loading={loading}
                  icon="◈"
                />
              ))}
            </>
          )}
        </div>
      )}

      {/* SVG Sankey */}
      <div ref={svgContainerRef} style={{ padding: '14px 20px 0', position: 'relative' }}>
        {loading && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 10,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                width: 24,
                height: 24,
                border: `2px solid ${colors.border}`,
                borderTopColor: colors.accent,
                borderRadius: '50%',
                animation: 'pandora-sankey-spin 0.7s linear infinite',
              }}
            />
          </div>
        )}

        <svg
          width={svgW}
          height={svgH}
          style={{ display: 'block', opacity: loading ? 0.35 : 1, transition: 'opacity 0.2s' }}
        >
          {/* 1. Funnel silhouette — subtle filled area tracing bar tops to baseline */}
          <path
            d={funnelPath()}
            fill="#0f172a"
            fillOpacity={0.5}
            stroke={STAGE_COLORS[0]}
            strokeOpacity={0.08}
            strokeWidth={1}
          />

          {/* 2. Flow bands */}
          {stages.slice(0, -1).map((_, i) => {
            const x1 = nodeX[i] + NODE_W;
            const x2 = nodeX[i + 1];
            const midX = (x1 + x2) / 2;
            const tooltipY = nodeY[i] + flowH[i] / 2;
            const color = STAGE_COLORS[i % STAGE_COLORS.length];
            const isHovered = hoveredFlow === i;
            const flow = flows.find(f => f.fromId === stages[i].id && f.toId === stages[i + 1].id);

            return (
              <g key={i}>
                <path
                  d={flowBandPath(i)}
                  fill={color}
                  fillOpacity={isHovered ? 0.52 : 0.28}
                  stroke="none"
                  style={{ cursor: 'default', transition: 'fill-opacity 0.15s' }}
                  onMouseEnter={() => setHoveredFlow(i)}
                  onMouseLeave={() => setHoveredFlow(null)}
                />
                {isHovered && flow && (
                  <g>
                    <rect
                      x={midX - 52}
                      y={tooltipY - 14}
                      width={104}
                      height={22}
                      rx={5}
                      fill={colors.surface as string}
                      stroke={colors.border as string}
                      strokeWidth={1}
                    />
                    <text
                      x={midX}
                      y={tooltipY + 1}
                      textAnchor="middle"
                      fontSize={11}
                      fill={colors.text as string}
                      fontFamily={fonts.sans}
                      style={{ pointerEvents: 'none' }}
                    >
                      {flow.deals} deals · {formatCurrency(flow.value)}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Baseline axis line — separates above (entered) from below (closed lost) */}
          <line
            x1={0}
            y1={baseline}
            x2={svgW}
            y2={baseline}
            stroke={colors.border as string}
            strokeWidth={1}
            strokeDasharray="3 3"
          />

          {/* 3 & 4. Bar segments + labels */}
          {stages.map((stage, i) => {
            const color = STAGE_COLORS[i % STAGE_COLORS.length];
            const stageName = showRaw && stage.rawLabel ? stage.rawLabel : stage.label;
            const cx = nodeX[i] + NODE_W / 2;

            return (
              <g key={stage.id}>
                {/* Main bar — sized by historical entries, extends UP from baseline */}
                {flowH[i] > 0 && (
                  <rect
                    x={nodeX[i]}
                    y={nodeY[i]}
                    width={NODE_W}
                    height={flowH[i]}
                    fill={color}
                    rx={flowH[i] > 4 ? 2 : 0}
                  />
                )}

                {/* Below-baseline lost bar — closed/lost deals, extends DOWN from baseline */}
                {lostBarH[i] > 0 && (
                  <rect
                    x={nodeX[i]}
                    y={baseline}
                    width={NODE_W}
                    height={lostBarH[i]}
                    fill={LOST_BAR_COLOR}
                    rx={lostBarH[i] > 4 ? 2 : 0}
                  />
                )}

                {/* Stage name — just above bar top */}
                <text
                  x={cx}
                  y={nodeY[i] - 26}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight="700"
                  fill={color}
                  fontFamily={fonts.sans}
                >
                  {truncate(stageName, 14)}
                </text>

                {/* Entered deal count — one line below name */}
                <text
                  x={cx}
                  y={nodeY[i] - 12}
                  textAnchor="middle"
                  fontSize={10}
                  fill={colors.textMuted as string}
                  fontFamily={fonts.sans}
                >
                  {getEntered(stage)} deal{getEntered(stage) !== 1 ? 's' : ''}
                </text>

                {/* ARR value — just below baseline */}
                {nodeH[i] >= 30 && (
                  <text
                    x={cx}
                    y={baseline + 14}
                    textAnchor="middle"
                    fontSize={10}
                    fill={color}
                    fontFamily={fonts.sans}
                    fontWeight="600"
                  >
                    {formatCurrency(getEnteredValue(stage))}
                  </text>
                )}

                {/* Lost count label — below the lost bar */}
                {stage.lostCount > 0 && (
                  <text
                    x={cx}
                    y={baseline + lostBarH[i] + 16}
                    textAnchor="middle"
                    fontSize={9}
                    fill={LOST_COLOR}
                    fontFamily={fonts.sans}
                  >
                    -{stage.lostCount} lost
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* Legend */}
        <div
          style={{
            display: 'flex',
            gap: 18,
            alignItems: 'center',
            padding: '4px 2px 10px',
            fontFamily: fonts.sans,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: STAGE_COLORS[0], opacity: 0.85 }} />
            <span style={{ fontSize: 11, color: colors.textMuted }}>Deals entered</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: LOST_BAR_COLOR }} />
            <span style={{ fontSize: 11, color: colors.textMuted }}>Closed lost (below axis)</span>
          </div>
          <div style={{ flex: 1, textAlign: 'right' }}>
            <span style={{ fontSize: 10, color: colors.textMuted }}>
              Band = deals that progressed · Hover for detail
            </span>
          </div>
        </div>
      </div>

      {/* Conversion rate grid */}
      {conversionRates.length > 0 && (
        <div
          style={{
            padding: '0 20px 18px',
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.min(conversionRates.length, 5)}, 1fr)`,
            gap: 8,
          }}
        >
          {conversionRates.map((cr, i) => {
            const fromStage = stages[i];
            const toStage = stages[i + 1];
            const displayFrom = showRaw && fromStage?.rawLabel ? fromStage.rawLabel : cr.fromLabel;
            const displayTo = showRaw && toStage?.rawLabel ? toStage.rawLabel : cr.toLabel;
            const isOpen = openMathCard === i;
            return (
              <div
                key={i}
                onClick={() => setOpenMathCard(isOpen ? null : i)}
                onMouseEnter={() => setOpenMathCard(i)}
                onMouseLeave={() => setOpenMathCard(null)}
                style={{
                  background: colors.surface,
                  borderRadius: 6,
                  padding: '7px 10px',
                  border: `1px solid ${isOpen ? colors.accent : colors.border}`,
                  cursor: 'pointer',
                  transition: 'border-color 0.15s',
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    color: colors.textMuted,
                    fontFamily: fonts.sans,
                    marginBottom: 3,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {truncate(displayFrom, 9)} → {truncate(displayTo, 9)}
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                  <span
                    style={{
                      fontSize: 18,
                      fontWeight: 700,
                      color: colors.text,
                      fontFamily: fonts.sans,
                    }}
                  >
                    {cr.rate}%
                  </span>
                  {cr.delta !== undefined && cr.delta !== 0 && (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: cr.delta > 0 ? '#22c55e' : '#ef4444',
                        fontFamily: fonts.sans,
                      }}
                    >
                      {cr.delta > 0 ? '▲' : '▼'}
                      {Math.abs(cr.delta)}pp
                    </span>
                  )}
                  <span style={{ fontSize: 9, color: colors.textMuted, marginLeft: 'auto', fontFamily: fonts.sans }}>ⓘ</span>
                </div>
                {isOpen && cr.denominator > 0 && (
                  <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${colors.border}` }}>
                    <div style={{ fontSize: 10, color: colors.textMuted, fontFamily: fonts.mono, lineHeight: 1.6 }}>
                      {cr.numerator} advanced<br />
                      ÷ {cr.denominator} eligible<br />
                      = {cr.rate}%
                    </div>
                    {cr.startOfPeriod > 0 && (
                      <div style={{ fontSize: 9, color: colors.textMuted, fontFamily: fonts.sans, marginTop: 3 }}>
                        {cr.entered} entered + {cr.startOfPeriod} at period start
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Filter Pill
// ============================================================================

function FilterPill({
  label,
  filterKey,
  active,
  onClick,
  loading,
  icon,
}: {
  label: string;
  filterKey: FilterKey;
  active: boolean;
  onClick: (key: FilterKey) => void;
  loading: boolean;
  icon?: string;
}) {
  return (
    <button
      disabled={loading}
      onClick={() => onClick(filterKey)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 10px',
        borderRadius: 99,
        fontSize: 12,
        fontFamily: fonts.sans,
        fontWeight: active ? 600 : 400,
        border: `1px solid ${active ? colors.accent : colors.border}`,
        background: active ? colors.accentSoft : 'transparent',
        color: active ? colors.accent : colors.textSecondary,
        cursor: loading ? 'default' : 'pointer',
        transition: 'border-color 0.15s, background 0.15s, color 0.15s',
        opacity: loading ? 0.55 : 1,
        outline: 'none',
        lineHeight: '1.4',
      }}
    >
      {icon && (
        <span style={{ fontSize: 8, lineHeight: 1 }}>{icon}</span>
      )}
      {label}
    </button>
  );
}

// ============================================================================
// Divider
// ============================================================================

function Divider() {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 1,
        height: 16,
        background: colors.border,
        margin: '0 2px',
        flexShrink: 0,
        alignSelf: 'center',
      }}
    />
  );
}
