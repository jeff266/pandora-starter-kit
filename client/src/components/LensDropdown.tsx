import React, { useState, useRef, useEffect } from 'react';
import { useLens } from '../contexts/LensContext';
import { colors, fonts } from '../styles/theme';

export default function LensDropdown() {
  const { activeLens, setLens, filters, loading } = useLens();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const activeFilter = filters.find(f => f.id === activeLens);
  const hasLens = !!activeLens && !!activeFilter;

  if (loading && filters.length === 0) return null;
  if (filters.length === 0) return null;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          borderRadius: 8,
          border: hasLens ? `1px solid ${colors.accent}` : `1px solid ${colors.border}`,
          background: hasLens ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.04)',
          color: hasLens ? colors.accent : colors.textSecondary,
          fontSize: fonts.sizes.sm,
          fontFamily: fonts.mono,
          cursor: 'pointer',
          transition: 'all 0.15s',
          whiteSpace: 'nowrap',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
        {hasLens ? activeFilter.label : 'All Data'}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6 }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          right: 0,
          minWidth: 240,
          maxHeight: 320,
          overflowY: 'auto',
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          zIndex: 100,
          padding: 4,
        }}>
          <div style={{
            padding: '8px 12px 6px',
            fontSize: fonts.sizes.xs,
            color: colors.textMuted,
            fontFamily: fonts.mono,
            textTransform: 'uppercase',
            letterSpacing: 1,
          }}>
            Workspace Lens
          </div>

          <LensOption
            label="All Data"
            description="No filter applied"
            selected={!activeLens}
            onClick={() => { setLens(null); setOpen(false); }}
          />

          {filters.map(f => (
            <LensOption
              key={f.id}
              label={f.label}
              description={f.description || f.entity_type}
              selected={activeLens === f.id}
              onClick={() => { setLens(f.id); setOpen(false); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LensOption({ label, description, selected, onClick }: {
  label: string;
  description?: string;
  selected: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '8px 12px',
        borderRadius: 6,
        border: 'none',
        background: selected ? 'rgba(99,102,241,0.12)' : hovered ? 'rgba(255,255,255,0.04)' : 'transparent',
        color: selected ? colors.accent : colors.text,
        fontSize: fonts.sizes.sm,
        fontFamily: fonts.body,
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'all 0.1s',
      }}
    >
      <div style={{
        width: 16,
        height: 16,
        borderRadius: '50%',
        border: selected ? `2px solid ${colors.accent}` : `2px solid ${colors.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}>
        {selected && (
          <div style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: colors.accent,
          }} />
        )}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: selected ? 600 : 400 }}>{label}</div>
        {description && (
          <div style={{
            fontSize: fonts.sizes.xs,
            color: colors.textMuted,
            marginTop: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {description}
          </div>
        )}
      </div>
    </button>
  );
}
