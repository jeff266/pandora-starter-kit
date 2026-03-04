import React, { useState } from 'react';
import { colors, fonts } from '../../styles/theme';

export interface RFMSegmentData {
  segment: string;
  action: string;
  signals: string;
  playbook: string;
  icon: string;
  priority: number;
  colorKey: string;
  r: 'High' | 'Low';
  f: 'High' | 'Low';
  m: 'High' | 'Low';
  recencyDays: number;
  uniqueContacts: number;
  openDealValue: number;
}

interface Props {
  data: RFMSegmentData;
}

const COLOR_MAP: Record<string, { border: string; bg: string; text: string; badge: string }> = {
  green:  { border: '#22c55e', bg: 'rgba(34,197,94,0.07)',   text: '#22c55e', badge: 'rgba(34,197,94,0.15)' },
  red:    { border: '#ef4444', bg: 'rgba(239,68,68,0.07)',   text: '#ef4444', badge: 'rgba(239,68,68,0.15)' },
  blue:   { border: '#6488ea', bg: 'rgba(100,136,234,0.07)', text: '#6488ea', badge: 'rgba(100,136,234,0.15)' },
  orange: { border: '#f97316', bg: 'rgba(249,115,22,0.07)',  text: '#f97316', badge: 'rgba(249,115,22,0.15)' },
  purple: { border: '#a855f7', bg: 'rgba(168,85,247,0.07)',  text: '#a855f7', badge: 'rgba(168,85,247,0.15)' },
  yellow: { border: '#eab308', bg: 'rgba(234,179,8,0.07)',   text: '#eab308', badge: 'rgba(234,179,8,0.15)' },
  rose:   { border: '#f43f5e', bg: 'rgba(244,63,94,0.07)',   text: '#f43f5e', badge: 'rgba(244,63,94,0.15)' },
  stone:  { border: '#78716c', bg: 'rgba(120,113,108,0.07)', text: '#9ca3af', badge: 'rgba(120,113,108,0.12)' },
};

function formatCurrency(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
  if (val === 0) return '$0';
  return `$${val.toFixed(0)}`;
}

export default function AccountRFMSegment({ data }: Props) {
  const [playbookOpen, setPlaybookOpen] = useState(false);
  const palette = COLOR_MAP[data.colorKey] ?? COLOR_MAP.stone;

  const dims: { key: 'r' | 'f' | 'm'; label: string; desc: string }[] = [
    { key: 'r', label: 'Recency', desc: data.recencyDays < 9999 ? `${data.recencyDays}d ago` : 'No activity' },
    { key: 'f', label: 'Frequency', desc: `${data.uniqueContacts} contact${data.uniqueContacts !== 1 ? 's' : ''}` },
    { key: 'm', label: 'Monetary',  desc: formatCurrency(data.openDealValue) },
  ];

  return (
    <div
      style={{
        background: palette.bg,
        border: `1px solid ${palette.border}40`,
        borderLeft: `3px solid ${palette.border}`,
        borderRadius: '0 10px 10px 0',
        padding: '14px 16px',
        fontFamily: fonts.sans,
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22, lineHeight: 1 }}>{data.icon}</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: palette.text, lineHeight: 1.2 }}>
              {data.segment}
            </div>
            <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
              Engagement Segment
            </div>
          </div>
        </div>
        <div style={{
          fontSize: 10,
          fontWeight: 700,
          color: palette.text,
          background: palette.badge,
          border: `1px solid ${palette.border}50`,
          padding: '3px 9px',
          borderRadius: 6,
          whiteSpace: 'nowrap',
          letterSpacing: '0.02em',
          flexShrink: 0,
        }}>
          {data.action}
        </div>
      </div>

      {/* Dimension badges */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {dims.map(({ key, label, desc }) => {
          const isHigh = data[key] === 'High';
          return (
            <div
              key={key}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '4px 8px',
                borderRadius: 6,
                background: isHigh ? palette.badge : 'rgba(120,113,108,0.10)',
                border: `1px solid ${isHigh ? palette.border + '50' : colors.border}`,
              }}
            >
              <span style={{
                fontSize: 10,
                fontWeight: 700,
                color: isHigh ? palette.text : colors.textMuted,
                letterSpacing: '0.05em',
              }}>
                {label[0]}
              </span>
              <span style={{
                fontSize: 10,
                color: isHigh ? palette.text : colors.textMuted,
                fontWeight: isHigh ? 600 : 400,
              }}>
                {isHigh ? '↑' : '↓'} {desc}
              </span>
            </div>
          );
        })}
      </div>

      {/* Signals */}
      <div style={{ marginBottom: 10 }}>
        <div style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: colors.textMuted,
          marginBottom: 5,
        }}>
          What this looks like
        </div>
        <p style={{
          fontSize: 12,
          lineHeight: 1.6,
          color: colors.textSecondary,
          margin: 0,
        }}>
          {data.signals}
        </p>
      </div>

      {/* Playbook — collapsible */}
      <div>
        <button
          onClick={() => setPlaybookOpen(o => !o)}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            fontFamily: fonts.sans,
          }}
        >
          <span style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: palette.text,
          }}>
            {playbookOpen ? '▴ Playbook' : '▾ Playbook'}
          </span>
        </button>
        {playbookOpen && (
          <p style={{
            fontSize: 12,
            lineHeight: 1.6,
            color: colors.textSecondary,
            margin: '6px 0 0 0',
            paddingLeft: 10,
            borderLeft: `2px solid ${palette.border}40`,
          }}>
            {data.playbook}
          </p>
        )}
      </div>
    </div>
  );
}
