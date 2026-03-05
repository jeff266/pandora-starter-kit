import React, { useState, useRef, useEffect } from 'react';
import { usePalette, PALETTES } from '../contexts/ThemeContext';
import { colors } from '../styles/theme';

export default function PalettePicker() {
  const { palette, setPalette } = usePalette();
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState<{ bottom: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const active = PALETTES.find(p => p.id === palette) ?? PALETTES[0];
  const darkPalettes  = PALETTES.filter(p => p.mode === 'dark');
  const lightPalettes = PALETTES.filter(p => p.mode === 'light');

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function handleToggle() {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setPanelPos({
      bottom: window.innerHeight - rect.top + 6,
      left: rect.left,
    });
    setOpen(v => !v);
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        ref={buttonRef}
        onClick={handleToggle}
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
        <span style={{ fontSize: 9, color: colors.textMuted }}>▾</span>
      </button>

      {open && panelPos && (
        <div
          ref={panelRef}
          style={{
            position: 'fixed',
            bottom: panelPos.bottom,
            left: panelPos.left,
            background: colors.surface ?? '#0f1219',
            border: `1px solid ${colors.border}`,
            borderRadius: 10, padding: '12px 14px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
            zIndex: 9999,
            display: 'flex', gap: 20,
          }}
        >
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
