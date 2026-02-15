import React from 'react';
import { colors } from '../../styles/theme';

interface SeverityDotProps {
  severity: 'act' | 'watch' | 'notable' | 'info' | string;
  size?: number;
}

const severityColorMap: Record<string, string> = {
  act: colors.red,
  critical: colors.red,
  watch: colors.yellow,
  warning: colors.yellow,
  notable: colors.purple,
  info: colors.accent,
};

export default function SeverityDot({ severity, size = 7 }: SeverityDotProps) {
  const color = severityColorMap[severity] || colors.accent;

  return (
    <span
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        boxShadow: `0 0 6px ${color}44`,
        flexShrink: 0,
      }}
    />
  );
}
