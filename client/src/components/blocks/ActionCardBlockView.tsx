import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { ActionCardBlock } from '../../../../shared/types/response-blocks';

interface ActionCardBlockViewProps {
  block: ActionCardBlock;
}

const severityColors: Record<ActionCardBlock['severity'], string> = {
  critical: '#f97316', // coral
  warning: '#d97706',  // amber
  info: '#0d9488',     // teal
};

export default function ActionCardBlockView({ block }: ActionCardBlockViewProps) {
  const navigate = useNavigate();

  const handleClick = () => {
    if (block.cta_href) {
      navigate(block.cta_href);
    } else {
      navigate('/actions');
    }
  };

  return (
    <div
      style={{
        border: '1px solid #334155',
        borderLeft: `4px solid ${severityColors[block.severity]}`,
        borderRadius: 6,
        padding: 12,
        marginBottom: 8,
        background: '#0f172a',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ flex: 1 }}>
          {block.target_entity_name && (
            <div
              style={{
                display: 'inline-block',
                padding: '2px 8px',
                fontSize: 11,
                fontWeight: 500,
                color: '#94a3b8',
                background: '#1e293b',
                borderRadius: 4,
                marginBottom: 6,
              }}
            >
              {block.target_entity_name}
            </div>
          )}
          <div style={{ fontSize: 14, fontWeight: 500, color: '#e2e8f0', marginBottom: 4 }}>
            {block.title}
          </div>
          <div
            style={{
              fontSize: 13,
              color: '#94a3b8',
              lineHeight: 1.4,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {block.rationale}
          </div>
        </div>
        <button
          onClick={handleClick}
          style={{
            padding: '6px 12px',
            fontSize: 13,
            fontWeight: 500,
            color: '#22d3ee',
            background: 'transparent',
            border: '1px solid #334155',
            borderRadius: 4,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {block.cta_label}
        </button>
      </div>
    </div>
  );
}
