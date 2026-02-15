import React from 'react';
import { colors } from '../../styles/theme';

interface EmptyStateProps {
  icon?: string;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export default function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div
      style={{
        padding: 60,
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 16,
      }}
    >
      {icon && (
        <div style={{ fontSize: 48, opacity: 0.3 }}>
          {icon}
        </div>
      )}
      <div>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: colors.text, margin: 0 }}>
          {title}
        </h3>
        <p style={{ fontSize: 13, color: colors.textMuted, margin: '8px 0 0' }}>
          {description}
        </p>
      </div>
      {action && (
        <button
          onClick={action.onClick}
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: colors.accent,
            background: colors.accentSoft,
            border: 'none',
            padding: '8px 16px',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
