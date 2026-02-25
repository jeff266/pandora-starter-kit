import React from 'react';
import { colors, fonts } from '../../styles/theme';
import { formatCurrency } from '../../lib/format';
import { useIsMobile } from '../../hooks/useIsMobile';
import { getFormulaLine, type FormulaContext, type MathContext } from '../../lib/forecast-math';

interface Snapshot {
  snapshot_date: string;
  forecast_weighted?: number;
  category_weighted?: number;
  mc_p50?: number;
  mc_p25?: number;
  mc_p75?: number;
  mc_p10?: number;
  mc_p90?: number;
  closed_won?: number;
  pipeline_total?: number;
  quota?: number;
  pipe_gen?: number;
  deal_count?: number;
  [key: string]: any;
}

interface MetricCardsProps {
  current: Snapshot | null;
  previous?: Snapshot | null;
  onMetricClick?: (metric: string, value: number, context: MathContext) => void;
}

function pctChange(curr: number | undefined, prev: number | undefined): { label: string; trend: 'up' | 'down' | 'stable' } | null {
  if (curr == null || prev == null || !Number.isFinite(curr) || !Number.isFinite(prev) || prev === 0) return null;
  const delta = ((curr - prev) / Math.abs(prev)) * 100;
  if (Math.abs(delta) < 0.5) return { label: '0%', trend: 'stable' };
  return {
    label: `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`,
    trend: delta > 0 ? 'up' : 'down',
  };
}

function trendColor(trend: 'up' | 'down' | 'stable'): string {
  if (trend === 'up') return colors.green;
  if (trend === 'down') return colors.red;
  return colors.textMuted;
}

function trendArrow(trend: 'up' | 'down' | 'stable'): string {
  if (trend === 'up') return '↑';
  if (trend === 'down') return '↓';
  return '→';
}

interface CardDef {
  label: string;
  metricKey: string;  // for getFormulaLine
  getValue: (s: Snapshot) => number | undefined;
  format: (v: number) => string;
  color?: string;
  getSubtitle?: (s: Snapshot) => string | null;
}

const cards: CardDef[] = [
  {
    label: 'MC P50',
    metricKey: 'mc_p50',
    getValue: (s) => s.mc_p50,
    format: formatCurrency,
    color: colors.purple,
  },
  {
    label: 'Closed Won',
    metricKey: 'closed_won',
    getValue: (s) => s.closed_won,
    format: formatCurrency,
    color: colors.green,
  },
  {
    label: 'Gap to Quota',
    metricKey: 'gap_to_quota',
    getValue: (s) => {
      const quota = s.quota;
      const closed = s.closed_won ?? 0;
      if (quota == null || !Number.isFinite(quota)) return undefined;
      return quota - closed;
    },
    format: (v) => {
      if (v <= 0) return '$0';
      return formatCurrency(v);
    },
    color: colors.yellow,
    getSubtitle: (s) => {
      const quota = s.quota;
      const closed = s.closed_won ?? 0;
      if (quota == null || !Number.isFinite(quota) || quota === 0) return null;
      const pct = (closed / quota) * 100;
      return `${pct.toFixed(0)}% attainment`;
    },
  },
  {
    label: 'MC Range',
    metricKey: 'mc_range',
    getValue: (s) => s.mc_p25,
    format: (_v) => '--',
    color: colors.accent,
    getSubtitle: (s) => {
      if (s.mc_p25 != null && s.mc_p75 != null) {
        return `${formatCurrency(s.mc_p25)} – ${formatCurrency(s.mc_p75)}`;
      }
      return null;
    },
  },
  {
    label: 'Pipe Gen',
    metricKey: 'pipe_gen',
    getValue: (s) => s.pipe_gen ?? s.pipeline_total,
    format: formatCurrency,
    color: colors.accent,
  },
];

export default function MetricCards({ current, previous, onMetricClick }: MetricCardsProps) {
  const isMobile = useIsMobile();

  if (!current) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(5, 1fr)', gap: 12 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 10,
              padding: 16,
              height: 88,
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(5, 1fr)', gap: 12 }}>
      {cards.map((card) => {
        const val = card.getValue(current);
        const prevVal = previous ? card.getValue(previous) : undefined;
        const change = pctChange(val, prevVal);
        const subtitle = card.getSubtitle?.(current) ?? null;

        let displayValue: string;
        if (card.label === 'MC Range') {
          if (current.mc_p25 != null && current.mc_p75 != null) {
            displayValue = `${formatCurrency(current.mc_p25)} – ${formatCurrency(current.mc_p75)}`;
          } else {
            displayValue = '--';
          }
        } else {
          displayValue = val != null && Number.isFinite(val) ? card.format(val) : '--';
        }

        // Build formula context
        const formulaContext: FormulaContext = {
          dealCount: current.deal_count,
          quota: current.quota,
          closedWon: current.closed_won,
          simulations: 10000,
        };

        const formulaLine = val != null && Number.isFinite(val)
          ? getFormulaLine(card.metricKey, val, formulaContext)
          : '';

        // Build math context for click
        const mathContext: MathContext = {
          ...formulaContext,
          mcResults: {
            p10: current.mc_p10 || 0,
            p25: current.mc_p25 || 0,
            p50: current.mc_p50 || 0,
            p75: current.mc_p75 || 0,
            p90: current.mc_p90 || 0,
          },
        };

        const handleClick = () => {
          if (val != null && Number.isFinite(val) && onMetricClick) {
            onMetricClick(card.metricKey, val, mathContext);
          }
        };

        return (
          <div
            key={card.label}
            onClick={handleClick}
            style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 10,
              padding: 16,
              cursor: onMetricClick ? 'pointer' : 'default',
              transition: 'transform 0.12s, box-shadow 0.12s',
            }}
            onMouseEnter={(e) => {
              if (onMetricClick) {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
              }
            }}
            onMouseLeave={(e) => {
              if (onMetricClick) {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: colors.textMuted,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                fontFamily: fonts.sans,
              }}
            >
              {card.label}
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                fontFamily: fonts.mono,
                color: card.color || colors.text,
                marginTop: 6,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              {displayValue}
              {change && (
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: trendColor(change.trend),
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                  }}
                >
                  {trendArrow(change.trend)} {change.label}
                </span>
              )}
            </div>
            {subtitle && card.label !== 'MC Range' && (
              <div
                style={{
                  fontSize: 11,
                  color: colors.textMuted,
                  marginTop: 4,
                  fontFamily: fonts.sans,
                }}
              >
                {subtitle}
              </div>
            )}
            {formulaLine && (
              <div
                style={{
                  fontSize: 11,
                  color: colors.textMuted,
                  marginTop: 6,
                  fontFamily: fonts.mono,
                  letterSpacing: '-0.01em',
                }}
              >
                → {formulaLine}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
