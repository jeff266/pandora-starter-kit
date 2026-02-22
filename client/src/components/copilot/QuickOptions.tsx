import React from 'react';
import { colors, fonts } from '../../styles/theme';
import type { QuickOption } from './copilot-steps';
import {
  BarChart3, ShieldAlert, TrendingUp, SearchCheck, Trophy, Users,
  Crown, ClipboardList, Settings, Building2,
  Sunrise, CalendarDays, Clock, MousePointerClick,
  MessageSquare, Monitor, Mail, LayoutDashboard,
  type LucideIcon,
} from 'lucide-react';

const iconMap: Record<string, LucideIcon> = {
  BarChart3, ShieldAlert, TrendingUp, SearchCheck, Trophy, Users,
  Crown, ClipboardList, Settings, Building2,
  Sunrise, CalendarDays, Clock, MousePointerClick,
  MessageSquare, Monitor, Mail, LayoutDashboard,
};

interface Props {
  options: QuickOption[];
  onSelect: (option: QuickOption) => void;
  multiSelect?: boolean;
  selected?: string[];
}

export default function QuickOptions({ options, onSelect, multiSelect, selected = [] }: Props) {
  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 8,
    }}>
      {options.map(option => {
        const isSelected = selected.includes(option.value);
        const IconComponent = option.icon ? iconMap[option.icon] : null;
        return (
          <button
            key={option.value}
            onClick={() => onSelect(option)}
            style={{
              padding: '8px 14px',
              borderRadius: 10,
              border: `1px solid ${isSelected ? colors.accent : colors.border}`,
              background: isSelected ? colors.accentSoft : colors.surface,
              color: isSelected ? colors.accent : colors.text,
              font: `400 13px ${fonts.sans}`,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.15s',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {IconComponent && <IconComponent size={16} style={{ flexShrink: 0, opacity: 0.85 }} />}
            <span>
              <span style={{ fontWeight: 500 }}>{option.label}</span>
              {option.description && (
                <span style={{ display: 'block', fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                  {option.description}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
