import React from 'react';

interface SaveAsAgentBannerProps {
  suggestedName?: string;
  isLoading: boolean;
  onSave: () => void;
  onDismiss: () => void;
}

export default function SaveAsAgentBanner({
  suggestedName,
  isLoading,
  onSave,
  onDismiss,
}: SaveAsAgentBannerProps) {
  return (
    <div style={{
      margin: '0 12px 8px',
      background: 'linear-gradient(135deg, #1a2540 0%, #1e2230 100%)',
      borderLeft: '3px solid #4d8ef0',
      borderTop: '1px solid #2a3a5c',
      borderRight: '1px solid #2a3a5c',
      borderBottom: '1px solid #2a3a5c',
      borderRadius: '0 8px 8px 0',
      padding: '10px 12px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      animation: 'slideUpBanner 200ms ease-out',
    }}>
      <style>{`
        @keyframes slideUpBanner {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#a8c4f0', marginBottom: 1 }}>
          {isLoading ? (
            '💡 Analyzing your conversation…'
          ) : suggestedName ? (
            <>💡 Looks like a <span style={{ color: '#c6d8ff' }}>{suggestedName}</span></>
          ) : (
            '💡 Looks like a recurring workflow'
          )}
        </div>
        <div style={{ fontSize: 11, color: '#64748b' }}>
          Save this as a recurring Agent?
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
        <button
          onClick={onSave}
          disabled={isLoading}
          style={{
            background: isLoading ? '#2a3a5c' : '#3a5cb8',
            border: 'none',
            borderRadius: 5,
            color: isLoading ? '#64748b' : '#fff',
            padding: '5px 11px',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            fontSize: 12,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            transition: 'background 0.15s',
          }}
        >
          {isLoading ? (
            <>
              <span style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                border: '2px solid #4d6a9c',
                borderTopColor: '#7aa3e0',
                borderRadius: '50%',
                animation: 'spinBanner 0.6s linear infinite',
              }} />
              Analyzing…
            </>
          ) : (
            'Save as Agent →'
          )}
        </button>
        <style>{`@keyframes spinBanner { to { transform: rotate(360deg); } }`}</style>

        <button
          onClick={onDismiss}
          style={{
            background: 'none',
            border: 'none',
            color: '#64748b',
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
            padding: '2px 4px',
          }}
          title="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
}
