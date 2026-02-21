import React, { useState } from 'react';
import { colors, fonts } from '../styles/theme';
import { formatTimeAgo } from '../lib/format';

interface TopBarProps {
  title: string;
  subtitle?: string;
  lastRefreshed?: Date | null;
  actions?: React.ReactNode;
  dateRange?: string;
  onDateRangeChange?: (range: string) => void;
  onRefresh?: () => void;
  onMenuToggle?: () => void;
}

const timeRangeOptions = [
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This Week' },
  { value: 'this_month', label: 'This Month' },
  { value: 'this_quarter', label: 'This Quarter' },
];

export default function TopBar({
  title,
  subtitle,
  lastRefreshed,
  actions,
  dateRange = 'today',
  onDateRangeChange,
  onRefresh,
  onMenuToggle,
}: TopBarProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      if (onRefresh) {
        await onRefresh();
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleDateRangeChange = (range: string) => {
    if (onDateRangeChange) {
      onDateRangeChange(range);
    }
  };

  return (
    <header style={{
      position: 'sticky',
      top: 0,
      zIndex: 50,
      padding: onMenuToggle ? '14px 12px' : '14px 28px',
      background: 'rgba(6,8,12,0.85)',
      backdropFilter: 'blur(12px)',
      borderBottom: `1px solid ${colors.border}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      fontFamily: fonts.sans,
      gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        {onMenuToggle && (
          <button
            onClick={onMenuToggle}
            style={{
              background: 'none', border: 'none', color: colors.text,
              fontSize: 20, cursor: 'pointer', padding: '4px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
            aria-label="Open menu"
          >
            {'\u2630'}
          </button>
        )}
        <h1 style={{ fontSize: onMenuToggle ? 15 : 17, fontWeight: 700, color: colors.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {title}
        </h1>
        {subtitle && (
          <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
            {subtitle}
          </p>
        )}
      </div>
      
      <div style={{ display: 'flex', alignItems: 'center', gap: onMenuToggle ? 8 : 24, flexShrink: 0 }}>
        {/* Time Range Selector — hidden on mobile */}
        {onDateRangeChange && !onMenuToggle && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {timeRangeOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => handleDateRangeChange(option.value)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: 'none',
                  fontSize: 12,
                  fontWeight: 500,
                  fontFamily: fonts.sans,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  background: dateRange === option.value
                    ? `rgba(59,130,246,0.15)`
                    : 'transparent',
                  color: dateRange === option.value
                    ? colors.accent
                    : colors.textMuted,
                }}
                onMouseEnter={(e) => {
                  if (dateRange !== option.value) {
                    (e.currentTarget as HTMLButtonElement).style.background = `rgba(59,130,246,0.08)`;
                    (e.currentTarget as HTMLButtonElement).style.color = colors.accent;
                  }
                }}
                onMouseLeave={(e) => {
                  if (dateRange !== option.value) {
                    (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                    (e.currentTarget as HTMLButtonElement).style.color = colors.textMuted;
                  }
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}

        {/* Refresh Button and Last Refreshed */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {lastRefreshed && (
            <span style={{ fontSize: 11, color: colors.textDim, whiteSpace: 'nowrap' }}>
              Updated {formatTimeAgo(lastRefreshed.toISOString())}
            </span>
          )}
          {onRefresh && (
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              style={{
                width: 24,
                height: 24,
                borderRadius: 4,
                border: `1px solid ${colors.border}`,
                background: colors.surface,
                color: colors.text,
                fontSize: 12,
                cursor: isRefreshing ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s ease',
                opacity: isRefreshing ? 0.6 : 1,
              }}
              onMouseEnter={(e) => {
                if (!isRefreshing) {
                  (e.currentTarget as HTMLButtonElement).style.background = colors.surfaceHover;
                  (e.currentTarget as HTMLButtonElement).style.borderColor = colors.borderLight;
                }
              }}
              onMouseLeave={(e) => {
                if (!isRefreshing) {
                  (e.currentTarget as HTMLButtonElement).style.background = colors.surface;
                  (e.currentTarget as HTMLButtonElement).style.borderColor = colors.border;
                }
              }}
              title="Refresh data"
            >
              <span style={{
                display: 'inline-block',
                animation: isRefreshing ? 'spin 0.8s linear infinite' : 'none',
              }}>
                ↻
              </span>
              <style>{`
                @keyframes spin {
                  to { transform: rotate(360deg); }
                }
              `}</style>
            </button>
          )}
        </div>

        {/* Actions */}
        {actions}
      </div>
    </header>
  );
}
