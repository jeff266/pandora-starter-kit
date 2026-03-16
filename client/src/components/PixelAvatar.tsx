import React from 'react';
import { useSystemAvatars } from '../context/SystemAvatarContext';

interface PixelAvatarProps {
  size?: number;
  borderRadius?: number;
  style?: React.CSSProperties;
}

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
  const { pandoraSrc } = useSystemAvatars();
  return <PixelImg src={pandoraSrc} size={size} borderRadius={borderRadius} style={style} />;
}

export function PixelAvatarBull({ size = 32, borderRadius = 6, style }: PixelAvatarProps) {
  const { bullSrc } = useSystemAvatars();
  return <PixelImg src={bullSrc} size={size} borderRadius={borderRadius} style={style} />;
}

export function PixelAvatarBear({ size = 32, borderRadius = 6, style }: PixelAvatarProps) {
  const { bearSrc } = useSystemAvatars();
  return <PixelImg src={bearSrc} size={size} borderRadius={borderRadius} style={style} />;
}
