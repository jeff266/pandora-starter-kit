import React, { useState, useRef } from 'react';
import { colors } from '../../styles/theme';

interface StickyInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
}

export default function StickyInput({ onSend, disabled }: StickyInputProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const hasText = value.trim().length > 0;

  return (
    <div style={{
      padding: '12px 0 4px 0', borderTop: `1px solid ${colors.border}`,
      background: colors.bg, flexShrink: 0,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        background: colors.surface, border: `1px solid ${colors.border}`,
        borderRadius: 10, padding: '8px 12px',
        transition: 'border-color 0.15s',
      }}
        onFocus={() => {}}
      >
        <span style={{ fontSize: 16, color: colors.accent, flexShrink: 0, lineHeight: 1 }}>✦</span>
        <input
          ref={inputRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything..."
          disabled={disabled}
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            fontSize: 13, color: colors.text, fontFamily: 'inherit',
          }}
        />
        <button
          onClick={handleSubmit}
          disabled={!hasText || disabled}
          style={{
            padding: '4px 12px', fontSize: 12, fontWeight: 600,
            border: 'none', borderRadius: 6, cursor: hasText ? 'pointer' : 'default',
            background: hasText ? colors.accent : colors.surfaceRaised,
            color: hasText ? '#0b1014' : colors.textMuted,
            transition: 'all 0.15s', flexShrink: 0,
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
