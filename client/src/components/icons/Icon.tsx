import React from 'react';
import {
  Lock,
  Sparkles,
  Timer,
  MessageCircle,
  AlertTriangle,
  Lightbulb,
  BarChart3,
  Building2,
  TrendingUp,
  Users,
  Activity,
  Zap,
  Target,
  RefreshCw,
  CheckCircle2,
  Circle,
  Info,
  Bell,
  Radio,
  type LucideIcon,
} from 'lucide-react';
import { colors } from '../../styles/theme';

export type IconName =
  | 'lock'
  | 'sparkles'
  | 'timer'
  | 'chat'
  | 'warning'
  | 'lightbulb'
  | 'chart'
  | 'building'
  | 'trending'
  | 'users'
  | 'activity'
  | 'zap'
  | 'target'
  | 'refresh'
  | 'check'
  | 'dot'
  | 'info'
  | 'bell'
  | 'signal';

const iconMap: Record<IconName, LucideIcon> = {
  lock: Lock,
  sparkles: Sparkles,
  timer: Timer,
  chat: MessageCircle,
  warning: AlertTriangle,
  lightbulb: Lightbulb,
  chart: BarChart3,
  building: Building2,
  trending: TrendingUp,
  users: Users,
  activity: Activity,
  zap: Zap,
  target: Target,
  refresh: RefreshCw,
  check: CheckCircle2,
  dot: Circle,
  info: Info,
  bell: Bell,
  signal: Radio,
};

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  gradient?: boolean;
  style?: React.CSSProperties;
  className?: string;
}

export function Icon({
  name,
  size = 16,
  color,
  gradient = false,
  style,
  className,
}: IconProps) {
  const IconComponent = iconMap[name];

  if (!IconComponent) {
    console.warn(`Icon "${name}" not found`);
    return null;
  }

  // Gradient style for neon effect (matching the icon pack aesthetic)
  const gradientStyle: React.CSSProperties = gradient
    ? {
        background: 'linear-gradient(135deg, #a78bfa 0%, #3b82f6 50%, #06b6d4 100%)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        filter: 'drop-shadow(0 0 2px rgba(167, 139, 250, 0.5))',
      }
    : {};

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...gradientStyle,
        ...style,
      }}
      className={className}
    >
      <IconComponent
        size={size}
        color={gradient ? undefined : (color || colors.text)}
        strokeWidth={2}
      />
    </span>
  );
}
