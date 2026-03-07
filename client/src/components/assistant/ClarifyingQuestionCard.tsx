import React from 'react';
import { colors } from '../../styles/theme';

interface Option {
  label: string;
  value: string;
}

interface ClarifyingQuestionCardProps {
  question: string;
  dimension: string;
  options: Option[];
  onSelect: (option: Option) => void;
}

export default function ClarifyingQuestionCard({ question, dimension, options, onSelect }: ClarifyingQuestionCardProps) {
  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 12,
      padding: '16px 20px',
      marginBottom: 20,
      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
      animation: 'slideIn 0.3s ease-out'
    }}>
      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      
      <div style={{ 
        fontSize: 14, 
        fontWeight: 600, 
        color: colors.text, 
        marginBottom: 16,
        lineHeight: 1.4
      }}>
        {question}
      </div>

      <div style={{ 
        display: 'flex', 
        flexWrap: 'wrap', 
        gap: 8 
      }}>
        {options.map((option, i) => (
          <button
            key={i}
            onClick={() => onSelect(option)}
            style={{
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: 500,
              borderRadius: 20,
              border: `1px solid ${colors.border}`,
              background: 'rgba(255, 255, 255, 0.03)',
              color: colors.textSecondary,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              outline: 'none'
            }}
            onMouseEnter={e => {
              const btn = e.currentTarget as HTMLButtonElement;
              btn.style.borderColor = colors.accent;
              btn.style.color = colors.accent;
              btn.style.background = 'rgba(72, 175, 155, 0.1)';
            }}
            onMouseLeave={e => {
              const btn = e.currentTarget as HTMLButtonElement;
              btn.style.borderColor = colors.border;
              btn.style.color = colors.textSecondary;
              btn.style.background = 'rgba(255, 255, 255, 0.03)';
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
