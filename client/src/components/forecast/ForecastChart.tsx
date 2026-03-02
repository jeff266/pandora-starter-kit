import React, { useState, useMemo } from 'react';
import { colors, fonts } from '../../styles/theme';

export interface SnapshotPoint {
  snapshot_date: string;
  stage_weighted_forecast: number | null;
  category_weighted_forecast: number | null;
  monte_carlo_p50: number | null;
  monte_carlo_p25: number | null;
  monte_carlo_p75: number | null;
  attainment: number | null;
  quota: number | null;
  isLive?: boolean;
}

interface ForecastChartProps {
  snapshots: SnapshotPoint[];
  quota: number | null;
  onPointClick?: (snapshot: SnapshotPoint, metric: string) => void;
  isRefreshing?: boolean;
}

const LINE_COLORS = {
  stage_weighted: '#3b82f6',
  category_weighted: '#06b6d4',
  mc_p50: '#a78bfa',
  attainment: '#22c55e',
};

const LINE_LABELS: Record<string, string> = {
  stage_weighted: 'Stage Weighted',
  category_weighted: 'Category Weighted',
  mc_p50: 'MC P50',
  attainment: 'Closed Won',
};

function formatCurrency(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
  return `$${val.toFixed(0)}`;
}

function formatWeekLabel(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function ForecastChart({ snapshots, quota, onPointClick, isRefreshing }: ForecastChartProps) {
  const [toggles, setToggles] = useState({
    stage_weighted: true,
    category_weighted: true,
    mc_p50: true,
    attainment: true,
    confidence_band: true,
  });
  const [hoveredPoint, setHoveredPoint] = useState<{ idx: number; metric: string; x: number; y: number; value: number } | null>(null);

  const PADDING = { top: 30, right: 60, bottom: 40, left: 70 };
  const WIDTH = 800;
  const HEIGHT = 340;
  const chartW = WIDTH - PADDING.left - PADDING.right;
  const chartH = HEIGHT - PADDING.top - PADDING.bottom;

  const allValues = useMemo(() => {
    const vals: number[] = [];
    snapshots.forEach(s => {
      if (s.stage_weighted_forecast != null) vals.push(s.stage_weighted_forecast);
      if (s.category_weighted_forecast != null) vals.push(s.category_weighted_forecast);
      if (s.monte_carlo_p50 != null) vals.push(s.monte_carlo_p50);
      if (s.monte_carlo_p75 != null) vals.push(s.monte_carlo_p75);
      if (s.monte_carlo_p25 != null) vals.push(s.monte_carlo_p25);
      if (s.attainment != null) vals.push(s.attainment);
    });
    if (quota != null) vals.push(quota);
    return vals;
  }, [snapshots, quota]);

  const minVal = allValues.length > 0 ? Math.min(...allValues) * 0.85 : 0;
  const maxVal = allValues.length > 0 ? Math.max(...allValues) * 1.15 : 1;
  const range = (maxVal - minVal) || 1;

  const xScale = (i: number) => PADDING.left + (snapshots.length > 1 ? i / (snapshots.length - 1) : 0.5) * chartW;
  const yScale = (v: number) => PADDING.top + chartH - ((v - minVal) / range) * chartH;

  const buildPath = (key: keyof SnapshotPoint) => {
    const points: string[] = [];
    snapshots.forEach((s, i) => {
      const val = s[key] as number | null;
      if (val != null) {
        points.push(`${points.length === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(val).toFixed(1)}`);
      }
    });
    return points.join(' ');
  };

  const confidencePath = useMemo(() => {
    if (!toggles.confidence_band) return null;
    const upper: string[] = [];
    const lower: string[] = [];
    snapshots.forEach((s, i) => {
      if (s.monte_carlo_p25 != null && s.monte_carlo_p75 != null) {
        upper.push(`${upper.length === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(s.monte_carlo_p75).toFixed(1)}`);
        lower.unshift(`L${xScale(i).toFixed(1)},${yScale(s.monte_carlo_p25).toFixed(1)}`);
      }
    });
    if (upper.length < 2) return null;
    return upper.join(' ') + ' ' + lower.join(' ') + ' Z';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshots, toggles.confidence_band]);

  const yTicks = useMemo(() => {
    const count = 5;
    const step = range / count;
    return Array.from({ length: count + 1 }, (_, i) => minVal + step * i);
  }, [minVal, range]);

  const toggle = (key: string) => setToggles(prev => ({ ...prev, [key]: !prev[key as keyof typeof prev] }));

  if (snapshots.length === 0) {
    return (
      <div style={{
        background: colors.surface,
        border: `1px solid ${isRefreshing ? '#6366f1' : colors.border}`,
        borderRadius: 10,
        padding: '56px 40px',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 14,
        transition: 'border-color 0.3s',
      }}>
        {isRefreshing ? (
          <>
            <span style={{
              width: 28, height: 28,
              border: '3px solid rgba(99,102,241,0.2)',
              borderTopColor: '#6366f1',
              borderRadius: '50%',
              display: 'inline-block',
              animation: 'pandora-spin 0.8s linear infinite',
            }} />
            <p style={{ fontSize: 13, color: '#6366f1', fontFamily: fonts.sans, margin: 0, fontWeight: 500 }}>
              Running forecast analysis — this takes about a minute...
            </p>
            <p style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.sans, margin: 0 }}>
              Calculating pipeline coverage, stage-weighted forecast, and Monte Carlo simulation
            </p>
          </>
        ) : (
          <p style={{ fontSize: 13, color: colors.textMuted, fontFamily: fonts.sans, margin: 0 }}>
            Syncing pipeline data...
          </p>
        )}
      </div>
    );
  }

  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 10,
      padding: 20,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: colors.text, fontFamily: fonts.sans }}>
          Forecast vs. Attainment
        </h3>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {Object.entries(LINE_LABELS).map(([key, label]) => (
            <button
              key={key}
              onClick={() => toggle(key)}
              style={{
                fontSize: 11,
                padding: '3px 10px',
                borderRadius: 12,
                border: `1px solid ${toggles[key as keyof typeof toggles] ? LINE_COLORS[key as keyof typeof LINE_COLORS] : colors.borderLight}`,
                background: toggles[key as keyof typeof toggles] ? `${LINE_COLORS[key as keyof typeof LINE_COLORS]}22` : 'transparent',
                color: toggles[key as keyof typeof toggles] ? LINE_COLORS[key as keyof typeof LINE_COLORS] : colors.textMuted,
                cursor: 'pointer',
                fontFamily: fonts.sans,
                fontWeight: 500,
                transition: 'all 0.15s',
              }}
            >
              {label}
            </button>
          ))}
          <button
            onClick={() => toggle('confidence_band')}
            style={{
              fontSize: 11,
              padding: '3px 10px',
              borderRadius: 12,
              border: `1px solid ${toggles.confidence_band ? colors.purple : colors.borderLight}`,
              background: toggles.confidence_band ? `${colors.purpleSoft}` : 'transparent',
              color: toggles.confidence_band ? colors.purple : colors.textMuted,
              cursor: 'pointer',
              fontFamily: fonts.sans,
              fontWeight: 500,
            }}
          >
            P25–P75
          </button>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        style={{ width: '100%', height: 'auto', maxHeight: 380 }}
      >
        {yTicks.map((tick, i) => (
          <g key={i}>
            <line
              x1={PADDING.left}
              x2={WIDTH - PADDING.right}
              y1={yScale(tick)}
              y2={yScale(tick)}
              stroke={colors.border}
              strokeDasharray={i === 0 || i === yTicks.length - 1 ? 'none' : '3,3'}
              strokeWidth={0.5}
            />
            <text
              x={PADDING.left - 8}
              y={yScale(tick) + 4}
              textAnchor="end"
              fill={colors.textMuted}
              fontSize={10}
              fontFamily={fonts.mono}
            >
              {formatCurrency(tick)}
            </text>
          </g>
        ))}

        {snapshots.map((s, i) => (
          <g key={i}>
            <line
              x1={xScale(i)}
              x2={xScale(i)}
              y1={PADDING.top}
              y2={PADDING.top + chartH}
              stroke={s.isLive ? 'rgba(34,197,94,0.25)' : colors.border}
              strokeWidth={s.isLive ? 1 : 0.5}
              strokeDasharray={s.isLive ? '4,3' : '2,4'}
            />
            <text
              x={xScale(i)}
              y={HEIGHT - 18}
              textAnchor="middle"
              fill={s.isLive ? '#22c55e' : colors.textMuted}
              fontSize={10}
              fontFamily={fonts.mono}
              fontWeight={s.isLive ? 600 : 400}
            >
              {formatWeekLabel(s.snapshot_date)}
            </text>
            {s.isLive && (
              <text
                x={xScale(i)}
                y={HEIGHT - 6}
                textAnchor="middle"
                fill="#22c55e"
                fontSize={8}
                fontFamily={fonts.sans}
                fontWeight={600}
                letterSpacing={0.5}
              >
                LIVE
              </text>
            )}
          </g>
        ))}

        {quota != null && (
          <g>
            <line
              x1={PADDING.left}
              x2={WIDTH - PADDING.right}
              y1={yScale(quota)}
              y2={yScale(quota)}
              stroke={colors.red}
              strokeWidth={1.5}
              strokeDasharray="8,4"
            />
            <text
              x={WIDTH - PADDING.right + 4}
              y={yScale(quota) + 4}
              fill={colors.red}
              fontSize={10}
              fontFamily={fonts.mono}
              fontWeight={600}
            >
              Quota
            </text>
          </g>
        )}

        {confidencePath && (
          <path d={confidencePath} fill="rgba(167,139,250,0.12)" stroke="none" />
        )}

        {toggles.attainment && (() => {
          const pts = snapshots
            .map((s, i) => s.attainment != null ? { x: xScale(i), y: yScale(s.attainment) } : null)
            .filter(Boolean) as { x: number; y: number }[];
          if (pts.length < 2) return null;
          const areaPath = `M${pts[0].x},${PADDING.top + chartH} ` +
            pts.map(p => `L${p.x},${p.y}`).join(' ') +
            ` L${pts[pts.length - 1].x},${PADDING.top + chartH} Z`;
          return <path d={areaPath} fill="rgba(34,197,94,0.08)" stroke="none" />;
        })()}

        {toggles.stage_weighted && (
          <path d={buildPath('stage_weighted_forecast')} fill="none" stroke={LINE_COLORS.stage_weighted} strokeWidth={2} />
        )}
        {toggles.category_weighted && (
          <path d={buildPath('category_weighted_forecast')} fill="none" stroke={LINE_COLORS.category_weighted} strokeWidth={2} />
        )}
        {toggles.mc_p50 && (
          <path d={buildPath('monte_carlo_p50')} fill="none" stroke={LINE_COLORS.mc_p50} strokeWidth={2.5} />
        )}
        {toggles.attainment && (
          <path d={buildPath('attainment')} fill="none" stroke={LINE_COLORS.attainment} strokeWidth={2} />
        )}

        {snapshots.map((s, i) => (
          <g key={`dots-${i}`}>
            {toggles.stage_weighted && s.stage_weighted_forecast != null && (
              <circle
                cx={xScale(i)} cy={yScale(s.stage_weighted_forecast)} r={3}
                fill={LINE_COLORS.stage_weighted} stroke={colors.surface} strokeWidth={1.5}
                style={{ cursor: 'pointer' }}
                onMouseEnter={(e) => setHoveredPoint({ idx: i, metric: 'stage_weighted', x: xScale(i), y: yScale(s.stage_weighted_forecast!), value: s.stage_weighted_forecast! })}
                onMouseLeave={() => setHoveredPoint(null)}
                onClick={() => onPointClick?.(s, 'stage_weighted')}
              />
            )}
            {toggles.category_weighted && s.category_weighted_forecast != null && (
              <circle
                cx={xScale(i)} cy={yScale(s.category_weighted_forecast)} r={3}
                fill={LINE_COLORS.category_weighted} stroke={colors.surface} strokeWidth={1.5}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHoveredPoint({ idx: i, metric: 'category_weighted', x: xScale(i), y: yScale(s.category_weighted_forecast!), value: s.category_weighted_forecast! })}
                onMouseLeave={() => setHoveredPoint(null)}
                onClick={() => onPointClick?.(s, 'category_weighted')}
              />
            )}
            {toggles.mc_p50 && s.monte_carlo_p50 != null && (
              <circle
                cx={xScale(i)} cy={yScale(s.monte_carlo_p50)} r={4}
                fill={LINE_COLORS.mc_p50} stroke={colors.surface} strokeWidth={1.5}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHoveredPoint({ idx: i, metric: 'mc_p50', x: xScale(i), y: yScale(s.monte_carlo_p50!), value: s.monte_carlo_p50! })}
                onMouseLeave={() => setHoveredPoint(null)}
                onClick={() => onPointClick?.(s, 'mc_p50')}
              />
            )}
            {toggles.attainment && s.attainment != null && (
              <circle
                cx={xScale(i)} cy={yScale(s.attainment)} r={3}
                fill={LINE_COLORS.attainment} stroke={colors.surface} strokeWidth={1.5}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHoveredPoint({ idx: i, metric: 'attainment', x: xScale(i), y: yScale(s.attainment!), value: s.attainment! })}
                onMouseLeave={() => setHoveredPoint(null)}
                onClick={() => onPointClick?.(s, 'attainment')}
              />
            )}
          </g>
        ))}

        {hoveredPoint && (
          <g>
            <rect
              x={hoveredPoint.x - 40}
              y={hoveredPoint.y - 28}
              width={80}
              height={22}
              rx={4}
              fill={colors.surfaceRaised}
              stroke={colors.borderLight}
              strokeWidth={1}
            />
            <text
              x={hoveredPoint.x}
              y={hoveredPoint.y - 14}
              textAnchor="middle"
              fill={colors.text}
              fontSize={11}
              fontFamily={fonts.mono}
              fontWeight={600}
            >
              {formatCurrency(hoveredPoint.value)}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
