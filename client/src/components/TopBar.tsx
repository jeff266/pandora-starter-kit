import React, { useState, Component, type ReactNode, type ErrorInfo } from 'react';
import { colors, fonts } from '../styles/theme';
import { formatTimeAgo } from '../lib/format';
import { useNavigate } from 'react-router-dom';
import LensDropdown from './LensDropdown';

class LensBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(err: Error, info: ErrorInfo) { console.warn('[LensBoundary]', err.message); }
  render() { return this.state.hasError ? null : this.props.children; }
}

interface TopBarProps {
  title: string;
  subtitle?: string;
  lastRefreshed?: Date | null;
  actions?: React.ReactNode;
  dateRange?: string;
  onDateRangeChange?: (range: string) => void;
  onRefresh?: () => void;
  onMenuToggle?: () => void;
  governancePending?: number;
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
  governancePending = 0,
}: TopBarProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const navigate = useNavigate();

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
      background: colors.bg,
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

        <LensBoundary><LensDropdown /></LensBoundary>

        {governancePending > 0 && (
          <button
            onClick={() => navigate('/governance')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 10px',
              borderRadius: 6,
              background: colors.orangeSoft,
              border: `1px solid ${colors.orange}`,
              color: colors.orange,
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              animation: 'pulse 2s infinite',
            }}
          >
            <span style={{ fontSize: 14 }}>●</span>
            {governancePending} pending
            <style>{`
              @keyframes pulse {
                0% { opacity: 1; }
                50% { opacity: 0.7; }
                100% { opacity: 1; }
              }
            `}</style>
          </button>
        )}

        {/* Refresh Button and Last Refreshed */}
        {onRefresh && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {lastRefreshed && (
              <span style={{ fontSize: 11, color: colors.textSecondary, whiteSpace: 'nowrap' }}>
                Updated {formatTimeAgo(lastRefreshed.toISOString())}
              </span>
            )}
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '5px 10px',
                borderRadius: 6,
                border: `1px solid ${colors.border}`,
                background: colors.surface,
                color: colors.textSecondary,
                fontSize: 12,
                fontFamily: fonts.sans,
                fontWeight: 500,
                cursor: isRefreshing ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s ease',
                opacity: isRefreshing ? 0.6 : 1,
                whiteSpace: 'nowrap',
              }}
              onMouseEnter={(e) => {
                if (!isRefreshing) {
                  (e.currentTarget as HTMLButtonElement).style.background = colors.surfaceHover;
                  (e.currentTarget as HTMLButtonElement).style.color = colors.text;
                  (e.currentTarget as HTMLButtonElement).style.borderColor = colors.borderLight;
                }
              }}
              onMouseLeave={(e) => {
                if (!isRefreshing) {
                  (e.currentTarget as HTMLButtonElement).style.background = colors.surface;
                  (e.currentTarget as HTMLButtonElement).style.color = colors.textSecondary;
                  (e.currentTarget as HTMLButtonElement).style.borderColor = colors.border;
                }
              }}
              title="Sync navigation badges and counts"
            >
              <span style={{
                display: 'inline-block',
                fontSize: 13,
                animation: isRefreshing ? 'spin 0.8s linear infinite' : 'none',
              }}>↻</span>
              Sync
              <style>{`
                @keyframes spin {
                  to { transform: rotate(360deg); }
                }
              `}</style>
            </button>
          </div>
        )}

        {/* Actions */}
        {actions}
      </div>
    </header>
  );
}
