import React, { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { colors, fonts } from '../../styles/theme';

interface CollapsibleSectionProps {
  title: string;
  children: React.ReactNode;
  defaultCollapsed?: boolean;
  onToggle?: (collapsed: boolean) => void;
  badge?: string | number;
  className?: string;
}

export function CollapsibleSection({
  title,
  children,
  defaultCollapsed = false,
  onToggle,
  badge,
  className,
}: CollapsibleSectionProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  const handleToggle = () => {
    const newCollapsed = !isCollapsed;
    setIsCollapsed(newCollapsed);
    onToggle?.(newCollapsed);
  };

  return (
    <div
      className={className}
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      {/* Section Header */}
      <div
        onClick={handleToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: 16,
          cursor: 'pointer',
          userSelect: 'none',
          transition: 'background 0.15s ease',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = colors.surfaceHover)}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        {/* Chevron Icon */}
        <div style={{ display: 'flex', alignItems: 'center', color: colors.textSecondary }}>
          {isCollapsed ? <ChevronRight size={20} /> : <ChevronDown size={20} />}
        </div>

        {/* Title */}
        <h3
          style={{
            flex: 1,
            margin: 0,
            fontSize: 16,
            fontWeight: 600,
            color: colors.text,
            fontFamily: fonts.body,
          }}
        >
          {title}
        </h3>

        {/* Badge (optional count indicator) */}
        {badge !== undefined && badge !== null && (
          <div
            style={{
              padding: '4px 10px',
              borderRadius: 12,
              background: colors.surfaceHover,
              color: colors.textSecondary,
              fontSize: 13,
              fontWeight: 500,
              fontFamily: fonts.body,
            }}
          >
            {badge}
          </div>
        )}
      </div>

      {/* Section Content with smooth collapse animation */}
      <div
        style={{
          maxHeight: isCollapsed ? 0 : '10000px',
          overflow: 'hidden',
          transition: 'max-height 0.3s ease',
        }}
      >
        <div style={{ padding: '0 16px 16px 16px' }}>{children}</div>
      </div>
    </div>
  );
}
