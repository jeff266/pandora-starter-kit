import React, { useEffect, useRef } from 'react';

interface ContextMenuProps {
  x: number;
  y: number;
  sectionTitle?: string;
  onNote: () => void;
  onChart: () => void;
  onFlag: () => void;
  onClose: () => void;
}

export function ContextMenu({ x, y, sectionTitle, onNote, onChart, onFlag, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('mousedown', handleClick);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('mousedown', handleClick);
      window.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const adjustedX = Math.min(x, window.innerWidth - 200);
  const adjustedY = Math.min(y, window.innerHeight - 160);

  const itemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    padding: '8px 14px',
    background: 'none',
    border: 'none',
    fontSize: 13,
    color: '#374151',
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
  };

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: adjustedX,
        top: adjustedY,
        zIndex: 1000,
        background: 'white',
        border: '0.5px solid #E2E8F0',
        borderRadius: 8,
        boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
        padding: '4px 0',
        minWidth: 180,
        fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
      }}
      onContextMenu={e => e.preventDefault()}
    >
      {sectionTitle && (
        <div style={{
          padding: '5px 14px 4px',
          fontSize: 10,
          fontWeight: 600,
          color: '#94A3B8',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          borderBottom: '0.5px solid #F1F5F9',
          marginBottom: 2,
        }}>
          {sectionTitle}
        </div>
      )}
      {[
        { icon: '✎', label: 'Add note', action: onNote },
        { icon: '▤', label: 'Insert chart', action: onChart },
        { icon: '⚑', label: 'Flag for review', action: onFlag },
      ].map(item => (
        <button
          key={item.label}
          onClick={() => { item.action(); onClose(); }}
          style={itemStyle}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#F8FAFC'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
        >
          <span style={{ fontSize: 14, color: '#64748B', width: 16, textAlign: 'center' }}>
            {item.icon}
          </span>
          {item.label}
        </button>
      ))}
    </div>
  );
}
