import React from 'react';
import { colors, fonts } from '../../styles/theme';

interface MetricCardProps {
  label: string;
  value: string;
  subtitle?: string;
  trend?: 'up' | 'down' | 'stable';
  color?: string;
}

export default function MetricCard({ label, value, subtitle, trend, color }: MetricCardProps) {
  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: 16,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: colors.textMuted,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 700,
          fontFamily: fonts.mono,
          color: color || colors.text,
          marginTop: 6,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        {value}
        {trend && (
          <span
            style={{
              fontSize: 14,
              color: trend === 'up' ? colors.green : trend === 'down' ? colors.red : colors.textMuted,
            }}
          >
            {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'}
          </span>
        )}
      </div>
      {subtitle && (
        <div
          style={{
            fontSize: 11,
            color: colors.textMuted,
            marginTop: 4,
          }}
        >
          {subtitle}
        </div>
      )}
    </div>
  );
}
