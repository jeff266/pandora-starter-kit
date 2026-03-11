import React from 'react';
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
  onShowData?: () => void;
  isExpanded?: boolean;
  onToggle?: () => void;
  onAskPandora?: () => void;
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
  onShowData,
  isExpanded = false,
  onToggle,
  onAskPandora,
}: MetricCardProps) {
  const [hovered, setHovered] = React.useState(false);
  const getTrendColor = () => {
    if (trendDirection === 'flat') return colors.textSecondary;
    if (trendDirection === 'up') return trendPositive ? colors.green : colors.red;
    return trendPositive ? colors.red : colors.green;
  };

  const getTrendIcon = () => {
    if (trendDirection === 'up') return <TrendingUp size={16} />;
    if (trendDirection === 'down') return <TrendingDown size={16} />;
    return <Minus size={16} />;
  };

  const handleToggle = () => {
    if (onToggle) onToggle();
  };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        flex: '1 1 200px',
        minWidth: 200,
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: 16,
        transition: 'all 0.15s ease',
        cursor: onAskPandora ? 'pointer' : 'default',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
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

      {evidence && !loading && (
        <button
          onClick={handleToggle}
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
          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          Show Math
        </button>
      )}

      {isExpanded && evidence && (
        <div
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: `1px solid ${colors.border}`,
            animation: 'fadeInDown 0.2s ease',
          }}
        >
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

          {onShowData && (
            <button
              onClick={onShowData}
              style={{
                marginTop: 8,
                padding: '6px 12px',
                background: colors.accent,
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: fonts.body,
                transition: 'opacity 0.15s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.9')}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
            >
              Show Data
            </button>
          )}
        </div>
      )}

      {onAskPandora && !loading && (
        <button
          onClick={(e) => { e.stopPropagation(); onAskPandora(); }}
          title="Ask Pandora about this →"
          style={{
            marginTop: 10,
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            padding: '5px 10px',
            border: `1px solid ${colors.accent}44`,
            borderRadius: 6,
            background: hovered ? `${colors.accent}18` : 'transparent',
            color: colors.accent,
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: fonts.body,
            transition: 'background 0.15s, border-color 0.15s',
            opacity: hovered ? 1 : 0.6,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = `${colors.accent}28`;
            e.currentTarget.style.borderColor = colors.accent;
            e.currentTarget.style.opacity = '1';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = hovered ? `${colors.accent}18` : 'transparent';
            e.currentTarget.style.borderColor = `${colors.accent}44`;
            e.currentTarget.style.opacity = hovered ? '1' : '0.6';
          }}
        >
          ⓘ Ask Pandora →
        </button>
      )}
    </div>
  );
}
