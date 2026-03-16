import React from 'react';

interface PixelAvatarProps {
  size?: number;
  borderRadius?: number;
  style?: React.CSSProperties;
}

const PANDORA_SRC = '/avatars/char-14.png';
const BULL_SRC = '/avatars/char-15.png';
const BEAR_SRC = '/avatars/char-08.png';

function PixelImg({
  src,
  size,
  borderRadius,
  style,
}: {
  src: string;
  size: number;
  borderRadius: number;
  style?: React.CSSProperties;
}) {
  return (
    <img
      src={src}
      alt=""
      style={{
        width: size,
        height: size,
        borderRadius,
        imageRendering: 'pixelated',
        objectFit: 'cover',
        display: 'block',
        flexShrink: 0,
        ...style,
      }}
    />
  );
}

export function PixelAvatarPandora({ size = 32, borderRadius = 6, style }: PixelAvatarProps) {
  return <PixelImg src={PANDORA_SRC} size={size} borderRadius={borderRadius} style={style} />;
}

export function PixelAvatarBull({ size = 32, borderRadius = 6, style }: PixelAvatarProps) {
  return <PixelImg src={BULL_SRC} size={size} borderRadius={borderRadius} style={style} />;
}

export function PixelAvatarBear({ size = 32, borderRadius = 6, style }: PixelAvatarProps) {
  return <PixelImg src={BEAR_SRC} size={size} borderRadius={borderRadius} style={style} />;
}
