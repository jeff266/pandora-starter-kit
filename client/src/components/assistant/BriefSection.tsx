import React, { useState } from 'react';

interface BriefSectionProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
  highlighted?: boolean;
  omitted?: boolean;
  omitMessage?: string;
  hidden?: boolean;
}

export default function BriefSection({ title, subtitle, children, defaultExpanded = false, highlighted = false, omitted = false, omitMessage, hidden = false }: BriefSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (hidden) return null;

  if (omitted) {
    return (
      <div style={{ padding: '8px 16px', color: '#6B7280', fontSize: 12, fontStyle: 'italic' }}>
        {omitMessage || `${title} unchanged`}
      </div>
    );
  }

  return (
    <div style={{
      marginBottom: 2,
      borderLeft: highlighted ? '2px solid #F59E0B' : '2px solid transparent',
      borderRadius: 6,
      background: '#141414',
      overflow: 'hidden',
    }}>
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: highlighted ? '#F59E0B' : '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {title}
          </span>
          {subtitle && (
            <span style={{ fontSize: 11, color: '#6B7280' }}>{subtitle}</span>
          )}
        </div>
        <span style={{ color: '#4B5563', fontSize: 14, transition: 'transform 0.2s', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
          ▾
        </span>
      </button>
      {expanded && (
        <div style={{ padding: '4px 14px 12px', borderTop: '1px solid #1F2937' }}>
          {children}
        </div>
      )}
    </div>
  );
}
