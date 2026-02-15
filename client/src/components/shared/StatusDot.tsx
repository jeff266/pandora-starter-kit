import React from 'react';

interface StatusDotProps {
  color: string;
  size?: number;
}

export default function StatusDot({ color, size = 7 }: StatusDotProps) {
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
