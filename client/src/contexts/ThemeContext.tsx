import React, { createContext, useContext, useLayoutEffect, useState } from 'react';

export interface PaletteOption {
  id: string;
  name: string;
  bg: string;
  accent: string;
  mode: 'dark' | 'light';
}

export const PALETTES: PaletteOption[] = [
  { id: 'pandora',  name: 'Pandora',  bg: '#0b1014', accent: '#48af9b', mode: 'dark' },
  { id: 'midnight', name: 'Midnight', bg: '#0b1b32', accent: '#83a6ce', mode: 'dark' },
  { id: 'ember',    name: 'Ember',    bg: '#1b1931', accent: '#ed9e59', mode: 'dark' },
  { id: 'crimson',  name: 'Crimson',  bg: '#181a2f', accent: '#fda481', mode: 'dark' },
  { id: 'lavender', name: 'Lavender', bg: '#03122f', accent: '#ae7dac', mode: 'dark' },
  { id: 'ocean',    name: 'Ocean',    bg: '#031716', accent: '#0c969c', mode: 'dark' },
  { id: 'plum',     name: 'Plum',     bg: '#150016', accent: '#845162', mode: 'dark' },
  { id: 'slate',    name: 'Slate',    bg: '#f1f5f9', accent: '#3b82f6', mode: 'light' },
  { id: 'linen',    name: 'Linen',    bg: '#f5f0eb', accent: '#b45309', mode: 'light' },
];

const VALID_IDS = new Set(PALETTES.map(p => p.id));
const STORAGE_KEY = 'pandora_palette';

function applyPalette(id: string) {
  document.documentElement.dataset.palette = id;
}

interface ThemeContextValue {
  palette: string;
  setPalette: (id: string) => void;
  palettes: PaletteOption[];
}

const ThemeContext = createContext<ThemeContextValue>({
  palette: 'pandora',
  setPalette: () => {},
  palettes: PALETTES,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [palette, setPaletteState] = useState<string>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored && VALID_IDS.has(stored) ? stored : 'pandora';
  });

  useLayoutEffect(() => {
    applyPalette(palette);
  }, [palette]);

  const setPalette = (id: string) => {
    if (!VALID_IDS.has(id)) return;
    localStorage.setItem(STORAGE_KEY, id);
    setPaletteState(id);
    applyPalette(id);
  };

  return (
    <ThemeContext.Provider value={{ palette, setPalette, palettes: PALETTES }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function usePalette() {
  return useContext(ThemeContext);
}
