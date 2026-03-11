import React, { useEffect, useRef } from 'react';
import { colors, fonts } from '../../styles/theme';

export interface ReportContextTarget {
  type: 'metric' | 'narrative' | 'action_item' | 'table_row' | 'deal_card';
  label: string;
  value: string;
  sectionTitle: string;
  blockId: string;
  evidence?: Record<string, any>[];
}

interface ReportContextMenuProps {
  x: number;
  y: number;
  target: ReportContextTarget;
  onAskPandora: (target: ReportContextTarget) => void;
  onCopy: (value: string) => void;
  onShowData?: (target: ReportContextTarget) => void;
  onClose: () => void;
}

export default function ReportContextMenu({
  x,
  y,
  target,
  onAskPandora,
  onCopy,
  onShowData,
  onClose,
}: ReportContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    top: Math.min(y, window.innerHeight - 160),
    left: Math.min(x, window.innerWidth - 260),
    zIndex: 9999,
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: 10,
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
    minWidth: 240,
    overflow: 'hidden',
    fontFamily: fonts.sans,
  };

  const headerStyle: React.CSSProperties = {
    padding: '8px 14px 6px',
    borderBottom: `1px solid ${colors.border}`,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 600,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  };

  const valueStyle: React.CSSProperties = {
    fontSize: 12,
    color: colors.text,
    fontWeight: 600,
    marginTop: 2,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: 212,
  };

  const itemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '9px 14px',
    cursor: 'pointer',
    fontSize: 13,
    color: colors.text,
    background: 'transparent',
    border: 'none',
    width: '100%',
    textAlign: 'left',
    transition: 'background 0.12s',
  };

  return (
    <div ref={menuRef} style={menuStyle} onContextMenu={e => e.preventDefault()}>
      <div style={headerStyle}>
        <div style={labelStyle}>{target.sectionTitle}</div>
        <div style={valueStyle}>{target.label}{target.value ? ` · ${target.value}` : ''}</div>
      </div>

      <div style={{ padding: '4px 0' }}>
        <button
          style={itemStyle}
          onMouseEnter={e => (e.currentTarget.style.background = colors.accentSoft)}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          onClick={() => { onAskPandora(target); onClose(); }}
        >
          <span style={{ fontSize: 15 }}>✦</span>
          <span style={{ color: colors.accent, fontWeight: 500 }}>Ask Pandora about this</span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: colors.textMuted }}>→</span>
        </button>

        <button
          style={itemStyle}
          onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          onClick={() => { onCopy(target.value || target.label); onClose(); }}
        >
          <span style={{ fontSize: 14 }}>⎘</span>
          <span>Copy value</span>
        </button>

        {target.evidence && target.evidence.length > 0 && onShowData && (
          <button
            style={itemStyle}
            onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            onClick={() => { onShowData(target); onClose(); }}
          >
            <span style={{ fontSize: 14 }}>⊞</span>
            <span>Show backing data</span>
          </button>
        )}
      </div>
    </div>
  );
}
