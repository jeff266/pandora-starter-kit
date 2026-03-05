import React, { useState, useRef, useEffect } from 'react';
import { usePalette, PALETTES } from '../contexts/ThemeContext';
import { colors } from '../styles/theme';

export default function PalettePicker() {
  const { palette, setPalette } = usePalette();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const active = PALETTES.find(p => p.id === palette) ?? PALETTES[0];
  const darkPalettes  = PALETTES.filter(p => p.mode === 'dark');
  const lightPalettes = PALETTES.filter(p => p.mode === 'light');

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const Swatch = ({ p }: { p: typeof PALETTES[0] }) => {
    const isActive = palette === p.id;
    return (
      <button
        title={p.name}
        onClick={() => { setPalette(p.id); setOpen(false); }}
        style={{
          width: 20, height: 20, borderRadius: '50%',
          background: p.bg,
          border: isActive ? `2px solid ${active.mode === 'light' ? '#0f172a' : '#fff'}` : '2px solid transparent',
          boxShadow: isActive
            ? `0 0 0 1.5px ${p.accent}`
            : `inset 0 0 0 4px ${p.accent}`,
          cursor: 'pointer', padding: 0, flexShrink: 0,
          transition: 'box-shadow 0.15s, border-color 0.15s',
          outline: 'none',
        }}
      />
    );
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Trigger */}
      <button
        onClick={() => setOpen(v => !v)}
        title={`Theme: ${active.name}`}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          background: 'none', border: `1px solid ${colors.borderLight ?? colors.border}`,
          borderRadius: 6, padding: '3px 7px', cursor: 'pointer',
          transition: 'border-color 0.15s',
        }}
      >
        <span style={{
          width: 12, height: 12, borderRadius: '50%',
          background: active.bg,
          boxShadow: `inset 0 0 0 3px ${active.accent}`,
          flexShrink: 0, display: 'inline-block',
        }} />
        <span style={{ fontSize: 11, color: colors.textMuted, whiteSpace: 'nowrap' }}>{active.name}</span>
        <span style={{ fontSize: 9, color: colors.textDim }}>▾</span>
      </button>

      {/* Popout panel — opens upward */}
      {open && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', left: 0,
          background: colors.surface ?? '#0f1219',
          border: `1px solid ${colors.border}`,
          borderRadius: 10, padding: '12px 14px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
          zIndex: 200, minWidth: 220,
          display: 'flex', gap: 20,
        }}>
          {/* Dark column */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, color: colors.textMuted, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>Dark</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {darkPalettes.map(p => (
                <button
                  key={p.id}
                  onClick={() => { setPalette(p.id); setOpen(false); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    background: palette === p.id ? (colors.accentSoft ?? 'rgba(255,255,255,0.05)') : 'none',
                    border: 'none', borderRadius: 5, padding: '3px 6px',
                    cursor: 'pointer', width: '100%', textAlign: 'left',
                  }}
                >
                  <span style={{
                    width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                    background: p.bg,
                    boxShadow: palette === p.id ? `0 0 0 1.5px ${p.accent}` : `inset 0 0 0 4px ${p.accent}`,
                    border: palette === p.id ? '2px solid #fff' : '2px solid transparent',
                  }} />
                  <span style={{ fontSize: 12, color: palette === p.id ? colors.accent : colors.textSecondary, fontWeight: palette === p.id ? 600 : 400 }}>
                    {p.name}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Divider */}
          <div style={{ width: 1, background: colors.border, flexShrink: 0 }} />

          {/* Light column */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, color: colors.textMuted, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>Light</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {lightPalettes.map(p => (
                <button
                  key={p.id}
                  onClick={() => { setPalette(p.id); setOpen(false); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    background: palette === p.id ? (colors.accentSoft ?? 'rgba(0,0,0,0.05)') : 'none',
                    border: 'none', borderRadius: 5, padding: '3px 6px',
                    cursor: 'pointer', width: '100%', textAlign: 'left',
                  }}
                >
                  <span style={{
                    width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                    background: p.bg,
                    border: palette === p.id ? `2px solid ${p.accent}` : `2px solid ${p.accent}44`,
                    boxShadow: palette === p.id ? `0 0 0 1.5px ${p.accent}` : 'none',
                  }} />
                  <span style={{ fontSize: 12, color: palette === p.id ? colors.accent : colors.textSecondary, fontWeight: palette === p.id ? 600 : 400 }}>
                    {p.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
