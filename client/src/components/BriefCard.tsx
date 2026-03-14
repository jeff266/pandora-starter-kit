import React from 'react';
import { colors } from '../styles/theme';

type Category = 'risk' | 'opportunity' | 'watch' | 'hygiene' | 'action';
type ChipStatus = 'done' | 'pending' | 'needs';

interface Chip {
  text: string;
  status: ChipStatus;
}

interface CardAction {
  label: string;
  variant: 'primary' | 'secondary' | 'danger';
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
}

interface BriefCardProps {
  rank: number;
  category: Category;
  eyebrow: string;
  title: string;
  body: string;
  chips?: Chip[];
  mathKey?: string;
  onClick: () => void;
  onMathClick?: (mathKey: string) => void;
  actions?: CardAction[];
  is_watched?: boolean;
  dismissed?: boolean;
}

const CATEGORY_STYLES: Record<Category, { border: string; badgeBg: string; badgeColor: string; badgeBorder: string; label: string }> = {
  risk:        { border: '#ef4444', badgeBg: 'rgba(239,68,68,0.10)',    badgeColor: '#ef4444', badgeBorder: 'rgba(239,68,68,0.22)',    label: 'Risk' },
  opportunity: { border: '#1D9E75', badgeBg: 'rgba(29,158,117,0.10)',  badgeColor: '#1D9E75', badgeBorder: 'rgba(29,158,117,0.22)',   label: 'Opportunity' },
  watch:       { border: '#eab308', badgeBg: 'rgba(234,179,8,0.10)',   badgeColor: '#eab308', badgeBorder: 'rgba(234,179,8,0.22)',    label: 'Watch' },
  hygiene:     { border: '#378ADD', badgeBg: 'rgba(55,138,221,0.10)',  badgeColor: '#378ADD', badgeBorder: 'rgba(55,138,221,0.22)',   label: 'Hygiene' },
  action:      { border: '#a78bfa', badgeBg: 'rgba(167,139,250,0.10)', badgeColor: '#a78bfa', badgeBorder: 'rgba(167,139,250,0.22)',  label: 'Action' },
};

const CHIP_STYLES: Record<ChipStatus, { bg: string; color: string; dot: string; icon?: string }> = {
  done:    { bg: 'rgba(29,158,117,0.10)',  color: '#1D9E75', dot: '#1D9E75' },
  pending: { bg: 'rgba(234,179,8,0.10)',   color: '#eab308', dot: '#eab308' },
  needs:   { bg: 'rgba(239,68,68,0.10)',   color: '#ef4444', dot: '#ef4444', icon: '!' },
};

const VARIANT_STYLES: Record<'primary' | 'secondary' | 'danger', React.CSSProperties> = {
  primary:   { background: '#1D9E75', color: '#fff', border: 'none' },
  secondary: { background: 'transparent', color: '#94a3b8', border: '0.5px solid #242b3a' },
  danger:    { background: 'transparent', color: '#ef4444', border: '0.5px solid rgba(239,68,68,0.5)' },
};

const NUMBER_RE = /(\d[\d,.$%]*(?:\.\d+)?[KMB%]?)/g;

function renderTitle(title: string, mathKey?: string, onMathClick?: (k: string) => void) {
  if (!mathKey || !onMathClick) return title;
  const parts = title.split(NUMBER_RE);
  return parts.map((part, i) => {
    if (NUMBER_RE.test(part) || /^\d/.test(part)) {
      NUMBER_RE.lastIndex = 0;
      return (
        <span
          key={i}
          onClick={e => { e.stopPropagation(); onMathClick(mathKey); }}
          style={{ borderBottom: '1px dashed currentColor', cursor: 'pointer' }}
        >
          {part}↗
        </span>
      );
    }
    return part;
  });
}

export default function BriefCard({ rank, category, eyebrow, title, body, chips, mathKey, onClick, onMathClick, actions, is_watched, dismissed }: BriefCardProps) {
  const cat = CATEGORY_STYLES[category] || CATEGORY_STYLES.watch;
  const [hovered, setHovered] = React.useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: colors.surface,
        border: `0.5px solid ${hovered ? colors.borderLight : colors.border}`,
        borderRadius: 10,
        borderLeft: `2px solid ${cat.border}`,
        padding: '12px 13px',
        cursor: 'pointer',
        transition: dismissed ? 'opacity 0.2s, max-height 0.2s' : 'border-color 0.15s',
        opacity: dismissed ? 0 : 1,
        maxHeight: dismissed ? 0 : undefined,
        overflow: dismissed ? 'hidden' : undefined,
        fontFamily: "'IBM Plex Sans', -apple-system, sans-serif",
      }}
    >
      {/* TOP ROW: rank + badge + eyebrow + watched indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 10, color: colors.textDim, fontWeight: 600, minWidth: 14 }}>#{rank}</span>
        <span style={{
          fontSize: 9,
          fontWeight: 600,
          color: cat.badgeColor,
          background: cat.badgeBg,
          border: `0.5px solid ${cat.badgeBorder}`,
          borderRadius: 99,
          padding: '2px 7px',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}>
          {cat.label}
        </span>
        <span style={{ fontSize: 11, color: colors.textMuted, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {eyebrow}
        </span>
        {is_watched && (
          <span
            title="You're watching this deal"
            style={{ fontSize: 12, color: '#eab308', flexShrink: 0, cursor: 'default', lineHeight: 1 }}
          >
            👁
          </span>
        )}
      </div>

      {/* TITLE */}
      <div style={{ fontSize: 13, fontWeight: 500, color: colors.text, marginBottom: 5, lineHeight: 1.4 }}>
        {renderTitle(title, mathKey, onMathClick)}
        {mathKey && (
          <span
            onClick={e => { e.stopPropagation(); if (onMathClick) onMathClick(mathKey); }}
            style={{ fontSize: 10, color: colors.textDim, marginLeft: 6, cursor: 'pointer' }}
          >
            ∑ Show math
          </span>
        )}
      </div>

      {/* BODY */}
      {body && (
        <div style={{ fontSize: 12, color: colors.textSecondary, lineHeight: 1.5, marginBottom: chips && chips.length ? 8 : 0 }}>
          {body}
        </div>
      )}

      {/* CHIPS */}
      {chips && chips.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {chips.map((chip, i) => {
            const cs = CHIP_STYLES[chip.status];
            return (
              <span key={i} style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 10,
                color: cs.color,
                background: cs.bg,
                borderRadius: 99,
                padding: '2px 8px',
              }}>
                <span style={{ fontSize: 7, lineHeight: 1, color: cs.dot }}>
                  {cs.icon ? cs.icon : '●'}
                </span>
                {chip.text}
              </span>
            );
          })}
        </div>
      )}

      {/* ACTION BUTTONS */}
      {actions && actions.length > 0 && (
        <div
          onClick={e => e.stopPropagation()}
          style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10, marginBottom: 2 }}
        >
          {actions.map((action, i) => (
            <button
              key={i}
              disabled={action.disabled}
              onClick={e => { e.stopPropagation(); action.onClick(e); }}
              style={{
                fontSize: 11,
                padding: '4px 11px',
                borderRadius: 6,
                cursor: action.disabled ? 'default' : 'pointer',
                fontFamily: "'IBM Plex Sans', -apple-system, sans-serif",
                opacity: action.disabled ? 0.6 : 1,
                transition: 'opacity 0.15s',
                ...VARIANT_STYLES[action.variant],
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}

      {/* FOOTER */}
      <div style={{ fontSize: 10, color: colors.textDim, marginTop: 4 }}>
        Tap to drill in →
      </div>
    </div>
  );
}
