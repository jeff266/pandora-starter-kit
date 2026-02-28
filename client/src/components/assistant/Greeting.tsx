import React from 'react';
import { colors } from '../../styles/theme';

interface GreetingPayload {
  headline: string;
  subline: string;
  state_summary: string;
  severity: 'calm' | 'attention' | 'urgent';
  metrics: {
    pipeline_value: number;
    coverage_ratio: number;
    critical_count: number;
    warning_count: number;
    deals_moved: number;
  };
}

interface GreetingProps {
  data?: GreetingPayload;
  loading?: boolean;
}

const SEVERITY_COLOR: Record<string, string> = {
  calm: '#48af9b',
  attention: '#FBBF24',
  urgent: '#ff8c82',
};

export default function Greeting({ data, loading }: GreetingProps) {
  if (loading || !data) {
    return (
      <div style={{ marginBottom: 32 }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: colors.surfaceRaised, marginBottom: 16 }} />
        <div style={{ width: 240, height: 26, background: colors.surfaceRaised, borderRadius: 6, marginBottom: 8 }} />
        <div style={{ width: 180, height: 16, background: colors.surfaceRaised, borderRadius: 6, marginBottom: 4 }} />
        <div style={{ width: 300, height: 14, background: colors.surfaceRaised, borderRadius: 6 }} />
      </div>
    );
  }

  const sevColor = SEVERITY_COLOR[data.severity] ?? colors.accent;
  const { critical_count, warning_count } = data.metrics;
  const sevLabel = critical_count > 0
    ? `${critical_count} critical${warning_count > 0 ? ` · ${warning_count} warning${warning_count !== 1 ? 's' : ''}` : ''}`
    : warning_count > 0
      ? `${warning_count} warning${warning_count !== 1 ? 's' : ''}`
      : 'All clear';

  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{
        width: 52, height: 52, borderRadius: '50%', marginBottom: 16,
        background: 'linear-gradient(135deg, #48af9b 0%, #3a7fc1 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 20, fontWeight: 700, color: '#fff', flexShrink: 0,
        boxShadow: '0 0 20px rgba(72,175,155,0.3)',
      }}>
        ✦
      </div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: colors.text, margin: '0 0 4px 0', lineHeight: 1.2 }}>
        {data.headline}
      </h1>
      <p style={{ fontSize: 14, color: colors.textMuted, margin: '0 0 10px 0' }}>
        {data.subline}
      </p>
      <p style={{ fontSize: 13, color: colors.textSecondary, margin: '0 0 10px 0' }}>
        {data.state_summary}
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: sevColor, boxShadow: `0 0 6px ${sevColor}` }} />
        <span style={{ fontSize: 12, color: sevColor, fontWeight: 500 }}>{sevLabel}</span>
      </div>
    </div>
  );
}
