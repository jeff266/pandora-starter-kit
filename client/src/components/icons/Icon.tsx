import React from 'react';
import { colors } from '../../styles/theme';

// Custom icon pack from the extracted neon/futuristic icons
export type IconName =
  // Network & Communication
  | 'wifi'
  | 'globe'
  | 'network'
  | 'connections'
  | 'transfer'
  // Ideas & Intelligence
  | 'lightbulb'
  | 'brain'
  // Analytics & Charts
  | 'chart-growth'
  | 'trending'
  | 'hub'
  | 'target'
  // Process & Flow
  | 'flow'
  | 'filter'
  | 'check-flow'
  | 'refresh'
  // Organization
  | 'building';

// Map icon names to their file paths
const getIconPath = (name: IconName, size: number): string => {
  // Determine which size to use (32, 64, or 128)
  const iconSize = size <= 16 ? 32 : size <= 32 ? 64 : 128;
  return `/icons/${name}-${iconSize}.png`;
};

interface IconProps {
  name: IconName;
  size?: number;
  style?: React.CSSProperties;
  className?: string;
  alt?: string;
}

export function Icon({
  name,
  size = 16,
  style,
  className,
  alt = '',
}: IconProps) {
  const iconPath = getIconPath(name, size);

  return (
    <img
      src={iconPath}
      alt={alt || name}
      width={size}
      height={size}
      style={{
        display: 'inline-block',
        verticalAlign: 'middle',
        ...style,
      }}
      className={className}
    />
  );
}
