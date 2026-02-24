import React, { useState } from 'react';
import { ChevronDown, ChevronUp, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { colors, fonts } from '../../styles/theme';

interface MetricEvidence {
  formula: string;
  [key: string]: any;
}

interface MetricCardProps {
  label: string;
  value: string;
  subtitle?: string;
  trend?: number;
  trendDirection?: 'up' | 'down' | 'flat';
  trendPositive?: boolean;
  evidence?: MetricEvidence;
  loading?: boolean;
}

export function MetricCard({
  label,
  value,
  subtitle,
  trend,
  trendDirection = 'flat',
  trendPositive = true,
  evidence,
  loading = false,
}: MetricCardProps) {
  const [showMath, setShowMath] = useState(false);

  // Determine trend color based on direction and whether "up" is positive
  const getTrendColor = () => {
    if (trendDirection === 'flat') return colors.textSecondary;
    if (trendDirection === 'up') return trendPositive ? colors.green : colors.red;
    return trendPositive ? colors.red : colors.green; // down
  };

  const getTrendIcon = () => {
    if (trendDirection === 'up') return <TrendingUp size={16} />;
    if (trendDirection === 'down') return <TrendingDown size={16} />;
    return <Minus size={16} />;
  };

  return (
    <div
      style={{
        flex: '1 1 200px',
        minWidth: 200,
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: 16,
        transition: 'all 0.15s ease',
      }}
    >
      {/* Card Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        {/* Value */}
        <div
          style={{
            fontSize: 28,
            fontWeight: 600,
            color: loading ? colors.textSecondary : colors.text,
            fontFamily: fonts.body,
            lineHeight: 1.2,
          }}
        >
          {loading ? '—' : value}
        </div>

        {/* Trend Indicator */}
        {!loading && trend !== undefined && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              color: getTrendColor(),
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            {getTrendIcon()}
            <span>{Math.abs(trend)}%</span>
          </div>
        )}
      </div>

      {/* Label */}
      <div
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: colors.textSecondary,
          marginBottom: 4,
          fontFamily: fonts.body,
        }}
      >
        {label}
      </div>

      {/* Subtitle */}
      {subtitle && (
        <div
          style={{
            fontSize: 12,
            color: colors.textSecondary,
            marginBottom: 8,
            fontFamily: fonts.body,
          }}
        >
          {subtitle}
        </div>
      )}

      {/* Show Math Button */}
      {evidence && !loading && (
        <button
          onClick={() => setShowMath(!showMath)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            background: 'none',
            border: 'none',
            color: colors.accent,
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
            padding: '4px 0',
            marginTop: 8,
            fontFamily: fonts.body,
          }}
        >
          {showMath ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          Show Math
        </button>
      )}

      {/* Evidence Panel (expandable) */}
      {showMath && evidence && (
        <div
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: `1px solid ${colors.border}`,
          }}
        >
          {/* Formula */}
          <div
            style={{
              padding: 8,
              background: colors.bg,
              borderRadius: 6,
              fontFamily: fonts.mono,
              fontSize: 11,
              color: colors.textSecondary,
              marginBottom: 8,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {evidence.formula}
          </div>

          {/* Additional Details */}
          {Object.entries(evidence)
            .filter(([key]) => key !== 'formula')
            .map(([key, val]) => (
              <div
                key={key}
                style={{
                  fontSize: 11,
                  color: colors.textSecondary,
                  marginBottom: 4,
                  fontFamily: fonts.body,
                }}
              >
                <strong style={{ color: colors.text, textTransform: 'capitalize' }}>
                  {key.replace(/_/g, ' ')}:
                </strong>{' '}
                {typeof val === 'object' ? JSON.stringify(val) : String(val)}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
