import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { type PandoraRole } from '../context/PandoraRoleContext';
import { colors as themeColors } from '../styles/theme';

const S = {
  bg: themeColors.surface,
  border: themeColors.border,
  border2: themeColors.borderLight,
  teal: '#1D9E75',
  textMuted: themeColors.textMuted,
  textDim: themeColors.textDim,
  text: themeColors.text,
  surface2: themeColors.surfaceRaised,
  font: "'IBM Plex Sans', -apple-system, sans-serif",
};

const PLACEHOLDERS: Record<string, string> = {
  cro:    'Ask about your pipeline, forecast, or team performance…',
  revops: 'Ask about your pipeline, forecast, or team performance…',
  admin:  'Ask about your pipeline, forecast, or team performance…',
  manager:'Ask about your team\'s pipeline, forecast call prep, or data quality…',
  ae:     'Ask about your deals, what to prioritize today, or how to prepare…',
  default:'Ask Pandora anything about your revenue…',
};

const CAPABILITY_CHIPS = [
  '⚡ Live queries',
  '∑ Show math',
  '✓ Action cards',
  '📄 Doc accumulator',
];

interface AskBarProps {
  pandoraRole?: PandoraRole;
  suggestedQuestion?: string;
}

export default function AskBar({ pandoraRole, suggestedQuestion }: AskBarProps) {
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const placeholder = suggestedQuestion
    || PLACEHOLDERS[pandoraRole || 'default']
    || PLACEHOLDERS.default;

  const handleSubmit = () => {
    const msg = input.trim();
    if (!msg) return;
    setInput('');
    navigate(window.location.pathname, { state: { openChatWithMessage: msg } });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  };

  return (
    <div style={{
      position: 'sticky',
      bottom: 0,
      background: S.bg,
      borderTop: `0.5px solid ${S.border}`,
      padding: '8px 14px 12px',
      fontFamily: S.font,
      zIndex: 10,
    }}>
      {/* Capability chips */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {CAPABILITY_CHIPS.map(chip => (
          <span key={chip} style={{
            fontSize: 10,
            color: S.textDim,
            border: `0.5px solid ${S.border2}`,
            borderRadius: 99,
            padding: '2px 8px',
            userSelect: 'none',
          }}>
            {chip}
          </span>
        ))}
      </div>

      {/* Input row */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          style={{
            flex: 1,
            background: S.surface2,
            border: `0.5px solid ${S.border2}`,
            borderRadius: 8,
            padding: '9px 12px',
            fontSize: 13,
            color: S.text,
            fontFamily: S.font,
            outline: 'none',
          }}
          onFocus={e => { e.target.style.borderColor = S.teal; }}
          onBlur={e => { e.target.style.borderColor = S.border2; }}
        />
        <button
          onClick={handleSubmit}
          disabled={!input.trim()}
          style={{
            background: S.teal,
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '9px 16px',
            fontSize: 11,
            fontWeight: 600,
            cursor: input.trim() ? 'pointer' : 'not-allowed',
            opacity: input.trim() ? 1 : 0.5,
            fontFamily: S.font,
            whiteSpace: 'nowrap',
          }}
        >
          Ask Pandora
        </button>
      </div>
    </div>
  );
}
