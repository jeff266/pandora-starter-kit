import React, { useState, useRef, useEffect } from 'react';
import { Settings2 } from 'lucide-react';
import { colors, fonts } from '../../styles/theme';
import { MetricCard } from './MetricCard';
import { formatCurrency, formatNumber, formatPercent } from '../../lib/format';
import type { DashboardPreferences } from '../../hooks/useDashboardPreferences';

interface MetricsData {
  total_pipeline?: { value: number; deal_count: number; trend?: number; trend_direction?: 'up' | 'down' | 'flat' };
  weighted_pipeline?: { value: number; trend?: number; trend_direction?: string };
  coverage_ratio?: { value: number; quota?: number; trend?: number; trend_direction?: string };
  win_rate?: { value: number; period_days?: number; trend?: number; trend_direction?: string };
  open_deals?: { value: number; trend?: number; trend_direction?: string };
  monte_carlo_p50?: { value: number; trend?: number };
}

interface MetricEvidence {
  total_pipeline?: any;
  weighted_pipeline?: any;
  coverage_ratio?: any;
  win_rate?: any;
}

interface MetricsRowProps {
  metrics?: MetricsData;
  evidence?: MetricEvidence;
  visibleCards: DashboardPreferences['metric_cards'];
  onToggleCard: (cardId: keyof DashboardPreferences['metric_cards'], visible: boolean) => void;
  loading?: boolean;
}

export function MetricsRow({ metrics, evidence, visibleCards, onToggleCard, loading = false }: MetricsRowProps) {
  const [showConfigPopover, setShowConfigPopover] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close popover when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setShowConfigPopover(false);
      }
    };

    if (showConfigPopover) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showConfigPopover]);

  const cardConfigs: Array<{
    id: keyof typeof visibleCards;
    label: string;
    getValue: () => string;
    getSubtitle: () => string | undefined;
    getTrend: () => number | undefined;
    getTrendDirection: () => 'up' | 'down' | 'flat';
    trendPositive: boolean;
    getEvidence: () => any;
  }> = [
    {
      id: 'total_pipeline',
      label: 'Total Pipeline',
      getValue: () => formatCurrency(metrics?.total_pipeline?.value || 0),
      getSubtitle: () => `${formatNumber(metrics?.total_pipeline?.deal_count || 0)} deals`,
      getTrend: () => metrics?.total_pipeline?.trend,
      getTrendDirection: () => (metrics?.total_pipeline?.trend_direction as any) || 'flat',
      trendPositive: true,
      getEvidence: () => evidence?.total_pipeline,
    },
    {
      id: 'weighted_pipeline',
      label: 'Weighted Pipeline',
      getValue: () => formatCurrency(metrics?.weighted_pipeline?.value || 0),
      getSubtitle: () => 'Probability-adjusted',
      getTrend: () => metrics?.weighted_pipeline?.trend,
      getTrendDirection: () => (metrics?.weighted_pipeline?.trend_direction as any) || 'flat',
      trendPositive: true,
      getEvidence: () => evidence?.weighted_pipeline,
    },
    {
      id: 'coverage_ratio',
      label: 'Coverage Ratio',
      getValue: () => `${formatNumber(metrics?.coverage_ratio?.value || 0, 1)}x`,
      getSubtitle: () =>
        metrics?.coverage_ratio?.quota ? `vs ${formatCurrency(metrics.coverage_ratio.quota)} quota` : undefined,
      getTrend: () => metrics?.coverage_ratio?.trend,
      getTrendDirection: () => (metrics?.coverage_ratio?.trend_direction as any) || 'flat',
      trendPositive: true,
      getEvidence: () => evidence?.coverage_ratio,
    },
    {
      id: 'win_rate',
      label: 'Win Rate',
      getValue: () => formatPercent(metrics?.win_rate?.value || 0),
      getSubtitle: () => `${metrics?.win_rate?.period_days || 90} day trailing`,
      getTrend: () => metrics?.win_rate?.trend,
      getTrendDirection: () => (metrics?.win_rate?.trend_direction as any) || 'flat',
      trendPositive: true,
      getEvidence: () => evidence?.win_rate,
    },
    {
      id: 'open_deals',
      label: 'Open Deals',
      getValue: () => formatNumber(metrics?.open_deals?.value || 0),
      getSubtitle: () => 'Active opportunities',
      getTrend: () => metrics?.open_deals?.trend,
      getTrendDirection: () => (metrics?.open_deals?.trend_direction as any) || 'flat',
      trendPositive: true,
      getEvidence: () => undefined,
    },
  ];

  return (
    <div style={{ position: 'relative' }}>
      {/* Cards Row */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        {cardConfigs
          .filter((config) => visibleCards[config.id])
          .map((config) => (
            <MetricCard
              key={config.id}
              label={config.label}
              value={config.getValue()}
              subtitle={config.getSubtitle()}
              trend={config.getTrend()}
              trendDirection={config.getTrendDirection()}
              trendPositive={config.trendPositive}
              evidence={config.getEvidence()}
              loading={loading}
            />
          ))}
      </div>

      {/* Card Visibility Toggle Button */}
      <button
        onClick={() => setShowConfigPopover(!showConfigPopover)}
        style={{
          position: 'absolute',
          top: -40,
          right: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          borderRadius: 6,
          border: `1px solid ${colors.border}`,
          background: colors.surface,
          color: colors.textSecondary,
          fontSize: 12,
          cursor: 'pointer',
          transition: 'all 0.15s ease',
          fontFamily: fonts.body,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = colors.surfaceHover;
          e.currentTarget.style.color = colors.text;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = colors.surface;
          e.currentTarget.style.color = colors.textSecondary;
        }}
      >
        <Settings2 size={14} />
        Configure
      </button>

      {/* Card Visibility Popover */}
      {showConfigPopover && (
        <div
          ref={popoverRef}
          style={{
            position: 'absolute',
            top: -40,
            right: 0,
            transform: 'translateY(-8px)',
            width: 240,
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            padding: 12,
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
            zIndex: 100,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: colors.text, marginBottom: 10, fontFamily: fonts.body }}>
            Visible Metrics
          </div>

          {cardConfigs.map((config) => (
            <label
              key={config.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 0',
                cursor: 'pointer',
                fontSize: 13,
                color: colors.text,
                fontFamily: fonts.body,
              }}
            >
              <input
                type="checkbox"
                checked={visibleCards[config.id]}
                onChange={(e) => onToggleCard(config.id, e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              {config.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
