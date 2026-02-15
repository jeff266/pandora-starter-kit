import React from 'react';
import { colors } from '../styles/theme';

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: number;
  style?: React.CSSProperties;
}

export default function Skeleton({ width = '100%', height = 16, borderRadius = 4, style }: SkeletonProps) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius,
        background: colors.surfaceHover,
        animation: 'skeleton-pulse 1.5s ease-in-out infinite',
        ...style,
      }}
    />
  );
}

export function SkeletonCard({ height = 120 }: { height?: number }) {
  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 10,
      padding: 16,
      height,
    }}>
      <Skeleton width={120} height={12} />
      <Skeleton width={80} height={24} style={{ marginTop: 12 }} />
      <Skeleton width={100} height={10} style={{ marginTop: 8 }} />
    </div>
  );
}
