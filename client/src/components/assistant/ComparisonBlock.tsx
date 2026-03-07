import React from 'react';
import { colors, fonts } from '../../styles/theme';

export interface MetricChange {
  label: string;
  current: number;
  prior: number;
  delta: number;
  direction: 'up' | 'down' | 'flat';
  unit: 'pct' | 'ratio' | 'days' | 'currency';
}

export interface ComparisonItem {
  category: string;
  entity_id?: string;
  entity_name?: string;
  status: 'resolved' | 'persisted' | 'new';
  message: string;
  occurrence_count: number;
}

export interface DocumentComparison {
  prior_brief_id: string;
  prior_date: string;
  metrics: MetricChange[];
  findings: ComparisonItem[];
}

interface ComparisonBlockProps {
  comparison: DocumentComparison;
}

export default function ComparisonBlock({ comparison }: ComparisonBlockProps) {
  if (!comparison) return null;

  const formatValue = (m: MetricChange) => {
    if (m.unit === 'pct') return `${Math.round(m.current)}%`;
    if (m.unit === 'ratio') return `${m.current.toFixed(1)}x`;
    if (m.unit === 'currency') return `$${(m.current / 1000).toFixed(0)}K`;
    return m.current;
  };

  const formatDelta = (m: MetricChange) => {
    const prefix = m.delta > 0 ? '+' : '';
    if (m.unit === 'pct') return `${prefix}${Math.round(m.delta)}pts`;
    if (m.unit === 'ratio') return `${prefix}${m.delta.toFixed(1)}x`;
    if (m.unit === 'currency') return `${prefix}$${(m.delta / 1000).toFixed(0)}K`;
    return `${prefix}${m.delta}`;
  };

  const getDirectionIcon = (direction: 'up' | 'down' | 'flat') => {
    switch (direction) {
      case 'up': return '↑';
      case 'down': return '↓';
      default: return '→';
    }
  };

  const getDirectionColor = (direction: 'up' | 'down' | 'flat', unit: string) => {
    if (direction === 'flat') return colors.textMuted;
    
    // For days remaining, down is actually bad if we want more time, but usually down is just closer to end.
    // For coverage and attainment, up is good.
    if (direction === 'up') return colors.green;
    return colors.coral;
  };

  const getStatusIcon = (status: 'resolved' | 'persisted' | 'new') => {
    switch (status) {
      case 'resolved': return '✓';
      case 'persisted': return '→';
      case 'new': return '⚡';
    }
  };

  const getStatusColor = (status: 'resolved' | 'persisted' | 'new') => {
    switch (status) {
      case 'resolved': return colors.green;
      case 'persisted': return colors.yellow;
      case 'new': return colors.coral;
    }
  };

  return (
    <div style={{
      margin: '16px 0',
      padding: '12px 16px',
      background: colors.surfaceRaised,
      borderRadius: 12,
      border: `1px solid ${colors.border}`,
      fontFamily: fonts.sans,
    }}>
      <div style={{
        fontSize: 10,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: colors.textMuted,
        marginBottom: 10,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <span>Since last week ({new Date(comparison.prior_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ color: colors.green }}>✓ resolved</span>
          <span style={{ color: colors.yellow }}>→ persisted</span>
          <span style={{ color: colors.coral }}>⚡ new</span>
        </div>
      </div>

      {/* Metrics Row */}
      {comparison.metrics.length > 0 && (
        <div style={{
          display: 'flex',
          gap: 16,
          marginBottom: 12,
          flexWrap: 'wrap',
          borderBottom: `1px solid ${colors.border}`,
          paddingBottom: 12
        }}>
          {comparison.metrics.map((m, i) => (
            <div key={i} style={{ fontSize: 13 }}>
              <span style={{ color: colors.textSecondary, marginRight: 4 }}>{m.label}:</span>
              <span style={{ fontWeight: 600, color: colors.text }}>{formatValue(m)}</span>
              <span style={{ 
                marginLeft: 6, 
                color: getDirectionColor(m.direction, m.unit) as string,
                fontWeight: 700,
                fontSize: 12
              }}>
                {getDirectionIcon(m.direction)} {formatDelta(m)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Findings List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {comparison.findings.map((f, i) => (
          <div key={i} style={{ 
            display: 'flex', 
            alignItems: 'flex-start', 
            gap: 10,
            fontSize: 13,
            lineHeight: 1.5
          }}>
            <span style={{ 
              color: getStatusColor(f.status) as string, 
              fontWeight: 'bold',
              flexShrink: 0,
              width: 14,
              textAlign: 'center'
            }}>
              {getStatusIcon(f.status)}
            </span>
            <div style={{ color: colors.textSecondary }}>
              {f.status === 'resolved' && <span style={{ fontWeight: 600, color: colors.green, marginRight: 4 }}>Resolved:</span>}
              {f.status === 'new' && <span style={{ fontWeight: 600, color: colors.coral, marginRight: 4 }}>New:</span>}
              {f.message}
              {f.entity_name && <span style={{ color: colors.text, fontWeight: 500 }}> · {f.entity_name}</span>}
              {f.occurrence_count >= 3 && f.status !== 'resolved' && (
                <span style={{ 
                  color: colors.coral, 
                  fontSize: 11, 
                  fontWeight: 600,
                  marginLeft: 6,
                  whiteSpace: 'nowrap'
                }}>
                  · {f.occurrence_count} consecutive weeks
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
