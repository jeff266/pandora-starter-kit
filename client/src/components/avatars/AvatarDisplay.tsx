import React from 'react';
import { isPixelAvatar } from './avatar-data';

interface Props {
  value: string | null | undefined;
  size?: number;
  fallbackEmoji?: string;
  fallbackInitials?: string;
  borderRadius?: number | string;
  style?: React.CSSProperties;
}

export default function AvatarDisplay({
  value,
  size = 36,
  fallbackEmoji,
  fallbackInitials,
  borderRadius = 8,
  style,
}: Props) {
  if (value && isPixelAvatar(value)) {
    return (
      <img
        src={value}
        alt="avatar"
        style={{
          width: size,
          height: size,
          borderRadius,
          imageRendering: 'pixelated',
          objectFit: 'cover',
          flexShrink: 0,
          ...style,
        }}
      />
    );
  }

  if (value && (value.startsWith('http://') || value.startsWith('https://'))) {
    return (
      <img
        src={value}
        alt="avatar"
        style={{
          width: size,
          height: size,
          borderRadius,
          objectFit: 'cover',
          flexShrink: 0,
          ...style,
        }}
      />
    );
  }

  if (fallbackEmoji || value) {
    return (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        fontSize: size * 0.6,
        flexShrink: 0,
        ...style,
      }}>
        {value || fallbackEmoji}
      </span>
    );
  }

  if (fallbackInitials) {
    return (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius,
        fontSize: size * 0.4,
        fontWeight: 600,
        color: '#fff',
        background: '#5a67d8',
        flexShrink: 0,
        ...style,
      }}>
        {fallbackInitials}
      </span>
    );
  }

  return null;
}
