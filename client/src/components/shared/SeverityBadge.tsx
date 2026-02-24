import React from 'react';

export type Severity = "critical" | "high" | "medium" | "low";

interface SeverityBadgeProps {
  severity: Severity;
  className?: string;
}

const severityConfig = {
  critical: {
    label: "Critical",
    bg: '#ef4444',
    color: '#fff',
  },
  high: {
    label: "High",
    bg: '#f97316',
    color: '#fff',
  },
  medium: {
    label: "Medium",
    bg: '#eab308',
    color: '#fff',
  },
  low: {
    label: "Low",
    bg: '#3b82f6',
    color: '#fff',
  },
};

export function SeverityBadge({ severity, className }: SeverityBadgeProps) {
  const config = severityConfig[severity];

  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: 11,
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 4,
        backgroundColor: config.bg,
        color: config.color,
      }}
      className={className}
    >
      {config.label}
    </span>
  );
}
