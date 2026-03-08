import React, { useState, useCallback } from 'react';
import type { SankeyChartData } from './types';
import { api } from '../../lib/api';
import { colors, fonts } from '../../styles/theme';

// Stage color palette — cycles across stages
const STAGE_COLORS = ['#6366f1', '#8b5cf6', '#0ea5e9', '#f59e0b', '#22c55e', '#ec4899', '#14b8a6'];

// SVG layout constants
const CARD_W = 130;
const CARD_H_MAX = 200;
const CARD_H_MIN = 60;
const GAP = 90;
const SVG_PAD_X = 30;
const SVG_PAD_Y = 24;
const BADGE_ROW_H = 28;

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
}

export default function SankeyChart({ data, chartData: chartDataProp, hideFilters = false }: SankeyChartProps) {
  const initialData = (data ?? chartDataProp) ?? null;
  const [chartData, setChartData] = useState<SankeyChartData | null>(initialData);
  const [loading, setLoading] = useState(false);
  const [hoveredFlow, setHoveredFlow] = useState<string | null>(null);

  React.useEffect(() => {
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

  // SVG Layout
  const n = stages.length;
  if (n === 0) return null;

  const maxDeals = Math.max(...stages.map(s => Math.max(s.deals, 1)));
  const cardHeights = stages.map(s =>
    CARD_H_MIN + Math.round(((s.deals / maxDeals) * (CARD_H_MAX - CARD_H_MIN)))
  );
  const maxCardH = Math.max(...cardHeights);

  const cardXs = stages.map((_, i) => SVG_PAD_X + i * (CARD_W + GAP));
  const cardYs = cardHeights.map(h => SVG_PAD_Y + (maxCardH - h) / 2);

  const svgW = SVG_PAD_X * 2 + n * CARD_W + (n - 1) * GAP;
  const svgH = SVG_PAD_Y * 2 + maxCardH + BADGE_ROW_H;

  const flowMap = new Map(flows.map(f => [`${f.fromId}→${f.toId}`, f]));
  const maxFlow = Math.max(...flows.map(f => f.deals), 1);

  return (
    <div
      style={{
        background: colors.surfaceRaised,
        borderRadius: 10,
        border: `1px solid ${colors.border}`,
        overflow: 'hidden',
      }}
    >
      {/* Keyframes for loading spinner */}
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
          {periodLabel && (
            <span
              style={{
                fontSize: 12,
                color: colors.textMuted,
                fontFamily: fonts.sans,
              }}
            >
              {periodLabel}
            </span>
          )}
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
      <div style={{ padding: '14px 20px 0', position: 'relative' }}>
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
          viewBox={`0 0 ${svgW} ${svgH}`}
          width="100%"
          style={{ display: 'block', opacity: loading ? 0.35 : 1, transition: 'opacity 0.2s' }}
        >
          {/* Flow curves */}
          {stages.slice(0, -1).map((fromStage, i) => {
            const toStage = stages[i + 1];
            const flow = flowMap.get(`${fromStage.id}→${toStage.id}`);
            if (!flow || flow.deals === 0) return null;

            const fromX = cardXs[i] + CARD_W;
            const toX = cardXs[i + 1];
            const fromY = cardYs[i] + cardHeights[i] / 2;
            const toY = cardYs[i + 1] + cardHeights[i + 1] / 2;
            const midX = (fromX + toX) / 2;
            const strokeW = Math.max(2, Math.round((flow.deals / maxFlow) * 36));
            const color = STAGE_COLORS[i % STAGE_COLORS.length];
            const flowKey = `${fromStage.id}→${toStage.id}`;
            const isHovered = hoveredFlow === flowKey;

            return (
              <g key={flowKey}>
                <path
                  d={`M ${fromX} ${fromY} C ${midX} ${fromY} ${midX} ${toY} ${toX} ${toY}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={strokeW}
                  strokeOpacity={isHovered ? 0.7 : 0.25}
                  style={{ transition: 'stroke-opacity 0.15s', cursor: 'default' }}
                  onMouseEnter={() => setHoveredFlow(flowKey)}
                  onMouseLeave={() => setHoveredFlow(null)}
                />
                {isHovered && (
                  <text
                    x={midX}
                    y={Math.min(fromY, toY) - 10}
                    textAnchor="middle"
                    fontSize={11}
                    fill={colors.text as string}
                    fontFamily={fonts.sans}
                  >
                    {flow.deals} deals · {formatCurrency(flow.value)}
                  </text>
                )}
              </g>
            );
          })}

          {/* Stage cards */}
          {stages.map((stage, i) => {
            const x = cardXs[i];
            const y = cardYs[i];
            const h = cardHeights[i];
            const color = STAGE_COLORS[i % STAGE_COLORS.length];

            return (
              <g key={stage.id}>
                {/* Card background */}
                <rect
                  x={x}
                  y={y}
                  width={CARD_W}
                  height={h}
                  rx={8}
                  fill={color}
                  fillOpacity={0.1}
                  stroke={color}
                  strokeOpacity={0.35}
                  strokeWidth={1}
                />

                {/* Stage name */}
                <text
                  x={x + CARD_W / 2}
                  y={y + 16}
                  textAnchor="middle"
                  fontSize={10}
                  fontWeight="600"
                  fill={color}
                  fontFamily={fonts.sans}
                >
                  {truncate(stage.label, 16)}
                </text>

                {/* Deal count */}
                <text
                  x={x + CARD_W / 2}
                  y={y + h / 2 + (h > 90 ? 6 : 4)}
                  textAnchor="middle"
                  fontSize={h > 90 ? 26 : 20}
                  fontWeight="700"
                  fill={colors.text as string}
                  fontFamily={fonts.sans}
                >
                  {stage.deals}
                </text>

                {/* ARR value */}
                {h > 80 && (
                  <text
                    x={x + CARD_W / 2}
                    y={y + h / 2 + (h > 90 ? 24 : 20)}
                    textAnchor="middle"
                    fontSize={11}
                    fill={colors.textSecondary as string}
                    fontFamily={fonts.sans}
                  >
                    {formatCurrency(stage.value)}
                  </text>
                )}

                {/* Won / Lost badges below card */}
                {(stage.won > 0 || stage.lostCount > 0) && (
                  <>
                    {stage.won > 0 && (
                      <text
                        x={x + CARD_W / 2 - (stage.lostCount > 0 ? 22 : 0)}
                        y={y + h + 18}
                        textAnchor="middle"
                        fontSize={10}
                        fill="#22c55e"
                        fontFamily={fonts.sans}
                      >
                        ↑{stage.won}w
                      </text>
                    )}
                    {stage.lostCount > 0 && (
                      <text
                        x={x + CARD_W / 2 + (stage.won > 0 ? 22 : 0)}
                        y={y + h + 18}
                        textAnchor="middle"
                        fontSize={10}
                        fill="#ef4444"
                        fontFamily={fonts.sans}
                      >
                        ↓{stage.lostCount}l
                      </text>
                    )}
                  </>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Conversion rate grid */}
      {conversionRates.length > 0 && (
        <div
          style={{
            padding: '12px 20px 18px',
            display: 'grid',
            gridTemplateColumns: `repeat(${Math.min(conversionRates.length, 5)}, 1fr)`,
            gap: 8,
          }}
        >
          {conversionRates.map((cr, i) => (
            <div
              key={i}
              style={{
                background: colors.surface,
                borderRadius: 6,
                padding: '7px 10px',
                border: `1px solid ${colors.border}`,
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
                {truncate(cr.fromLabel, 9)} → {truncate(cr.toLabel, 9)}
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
              </div>
            </div>
          ))}
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
