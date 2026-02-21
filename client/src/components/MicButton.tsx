import React from 'react';

interface MicButtonProps {
  listening: boolean;
  supported: boolean;
  onClick: () => void;
  size?: number;
}

export function MicButton({ listening, supported, onClick, size = 32 }: MicButtonProps) {
  if (!supported) return null;

  return (
    <button
      onClick={onClick}
      title={listening ? 'Stop listening' : 'Voice input'}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        flexShrink: 0,
        background: listening ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255,255,255,0.06)',
        border: `1px solid ${listening ? 'rgba(239, 68, 68, 0.4)' : 'rgba(255,255,255,0.1)'}`,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 0.2s',
        position: 'relative',
      }}
    >
      {/* Mic icon */}
      <svg width={size * 0.45} height={size * 0.45} viewBox="0 0 16 16" fill="none">
        <rect x="5" y="1" width="6" height="9" rx="3" fill={listening ? '#ef4444' : '#8896AB'} />
        <path d="M3 7v1a5 5 0 0 0 10 0V7" stroke={listening ? '#ef4444' : '#8896AB'} strokeWidth="1.5" strokeLinecap="round" />
        <line x1="8" y1="13" x2="8" y2="15" stroke={listening ? '#ef4444' : '#8896AB'} strokeWidth="1.5" strokeLinecap="round" />
      </svg>

      {/* Pulsing ring when listening */}
      {listening && (
        <span style={{
          position: 'absolute',
          inset: -3,
          borderRadius: '50%',
          border: '2px solid rgba(239, 68, 68, 0.4)',
          animation: 'micPulse 1.5s ease-in-out infinite',
        }} />
      )}

      <style>{`
        @keyframes micPulse {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 0; transform: scale(1.3); }
        }
      `}</style>
    </button>
  );
}
