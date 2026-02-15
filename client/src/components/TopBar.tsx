import React from 'react';
import { colors, fonts } from '../styles/theme';
import { formatTimeAgo } from '../lib/format';

interface TopBarProps {
  title: string;
  subtitle?: string;
  lastRefreshed?: Date | null;
  actions?: React.ReactNode;
}

export default function TopBar({ title, subtitle, lastRefreshed, actions }: TopBarProps) {
  return (
    <header style={{
      position: 'sticky',
      top: 0,
      zIndex: 50,
      padding: '14px 28px',
      background: 'rgba(6,8,12,0.85)',
      backdropFilter: 'blur(12px)',
      borderBottom: `1px solid ${colors.border}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      fontFamily: fonts.sans,
    }}>
      <div>
        <h1 style={{ fontSize: 17, fontWeight: 700, color: colors.text }}>
          {title}
        </h1>
        {subtitle && (
          <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
            {subtitle}
          </p>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {lastRefreshed && (
          <span style={{ fontSize: 11, color: colors.textDim }}>
            Updated {formatTimeAgo(lastRefreshed.toISOString())}
          </span>
        )}
        {actions}
      </div>
    </header>
  );
}
