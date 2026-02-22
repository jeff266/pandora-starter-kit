import React from 'react';
import { colors, fonts } from '../../styles/theme';
import type { QuickOption } from './copilot-steps';

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
            {option.icon && <span style={{ fontSize: 16 }}>{option.icon}</span>}
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
