import React from 'react';

interface PixelAvatarProps {
  size?: number;
  style?: React.CSSProperties;
}

function PixelGrid({
  grid,
  primary,
  secondary,
  size,
}: {
  grid: number[][];
  primary: string;
  secondary: string;
  size: number;
}) {
  const cols = grid[0].length;
  const rows = grid.length;
  const cell = size / cols;
  const rects: React.ReactNode[] = [];
  grid.forEach((row, r) => {
    row.forEach((v, c) => {
      if (v === 0) return;
      rects.push(
        <rect
          key={`${r}-${c}`}
          x={c * cell}
          y={r * cell}
          width={cell}
          height={cell}
          fill={v === 2 ? secondary : primary}
        />
      );
    });
  });
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ imageRendering: 'pixelated', display: 'block', flexShrink: 0 }}
      shapeRendering="crispEdges"
    >
      {rects}
    </svg>
  );
}

const BEAR_GRID = [
  [0,1,1,0,0,0,0,0,0,0,0,0,0,1,1,0],
  [1,1,1,1,0,0,0,0,0,0,0,0,1,1,1,1],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,1,1,2,2,1,1,1,1,1,1,2,2,1,1,1],
  [1,1,1,2,2,1,1,1,1,1,1,2,2,1,1,1],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,1,1,1,1,1,2,2,2,2,1,1,1,1,1,1],
  [1,1,1,1,1,1,2,2,2,2,1,1,1,1,1,1],
  [1,1,1,1,1,1,1,2,2,1,1,1,1,1,1,1],
  [0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0],
  [0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0],
  [0,0,0,1,1,1,1,1,1,1,1,1,1,0,0,0],
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
];

const BULL_GRID = [
  [0,1,0,0,0,0,0,0,0,0,0,0,0,0,1,0],
  [1,1,1,0,0,0,0,0,0,0,0,0,0,1,1,1],
  [0,1,1,1,0,0,0,0,0,0,0,1,1,1,0,0],
  [0,0,1,1,1,1,1,1,1,1,1,1,1,0,0,0],
  [0,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0],
  [1,1,1,2,2,1,1,1,1,1,1,2,2,1,1,1],
  [1,1,1,2,2,1,1,1,1,1,1,2,2,1,1,1],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,1,1,1,1,2,2,1,1,2,2,1,1,1,1,1],
  [1,1,1,1,1,2,2,1,1,2,2,1,1,1,1,1],
  [0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0],
  [0,0,1,1,1,1,1,1,1,1,1,1,1,1,0,0],
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
];

const PANDORA_GRID = [
  [0,0,0,0,0,0,0,2,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,2,2,2,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0],
  [0,0,1,1,1,1,1,1,1,1,1,1,1,0,0,0],
  [0,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0],
  [1,1,1,2,2,2,1,1,1,2,2,2,1,1,1,0],
  [1,1,1,2,2,2,1,1,1,2,2,2,1,1,1,0],
  [1,1,1,2,2,2,1,1,1,2,2,2,1,1,1,0],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0],
  [1,1,1,1,2,2,2,2,2,2,2,1,1,1,1,0],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0],
  [0,1,1,1,1,1,1,1,1,1,1,1,1,1,0,0],
  [0,0,1,1,1,1,1,1,1,1,1,1,1,0,0,0],
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
];

export function PixelAvatarBear({ size = 32, style }: PixelAvatarProps) {
  return (
    <div style={style}>
      <PixelGrid grid={BEAR_GRID} primary="#f97068" secondary="#1a0500" size={size} />
    </div>
  );
}

export function PixelAvatarBull({ size = 32, style }: PixelAvatarProps) {
  return (
    <div style={style}>
      <PixelGrid grid={BULL_GRID} primary="#14b8a6" secondary="#001a19" size={size} />
    </div>
  );
}

export function PixelAvatarPandora({ size = 32, style }: PixelAvatarProps) {
  return (
    <div style={style}>
      <PixelGrid grid={PANDORA_GRID} primary="#818cf8" secondary="#22d3ee" size={size} />
    </div>
  );
}
