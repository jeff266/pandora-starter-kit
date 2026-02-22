import React, { useRef, useEffect } from 'react';
import { colors, fonts } from '../../styles/theme';
import { Send } from 'lucide-react';

interface Props {
  value: string;
  onChange: (val: string) => void;
  onSubmit: () => void;
  placeholder: string;
  disabled: boolean;
}

export default function CopilotInput({ value, onChange, onSubmit, placeholder, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '12px 16px',
      borderTop: `1px solid ${colors.border}`,
      background: colors.surface,
    }}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        style={{
          flex: 1,
          padding: '10px 14px',
          borderRadius: 10,
          border: `1px solid ${colors.border}`,
          background: colors.bg,
          color: colors.text,
          font: `400 14px ${fonts.sans}`,
          outline: 'none',
          opacity: disabled ? 0.5 : 1,
        }}
      />
      <button
        onClick={onSubmit}
        disabled={disabled || !value.trim()}
        style={{
          padding: '10px 12px',
          borderRadius: 10,
          border: 'none',
          background: value.trim() ? colors.accent : colors.surfaceHover,
          color: value.trim() ? '#fff' : colors.textMuted,
          cursor: value.trim() && !disabled ? 'pointer' : 'not-allowed',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <Send size={16} />
      </button>
    </div>
  );
}
