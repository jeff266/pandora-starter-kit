import React from 'react';
import { usePalette } from '../contexts/ThemeContext';

export default function PalettePicker() {
  const { palette, setPalette, palettes } = usePalette();

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {palettes.map(p => {
        const active = palette === p.id;
        return (
          <button
            key={p.id}
            title={p.name}
            onClick={() => setPalette(p.id)}
            style={{
              width: 18,
              height: 18,
              borderRadius: '50%',
              background: p.bg,
              border: active ? '2px solid #fff' : '2px solid transparent',
              boxShadow: active
                ? `0 0 0 1px ${p.accent}, inset 0 0 0 3px ${p.bg}`
                : `inset 0 0 0 4px ${p.accent}`,
              cursor: 'pointer',
              padding: 0,
              flexShrink: 0,
              transition: 'box-shadow 0.15s, border-color 0.15s',
              outline: 'none',
            }}
          />
        );
      })}
    </div>
  );
}
