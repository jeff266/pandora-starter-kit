import React, { useState } from 'react';
import type { TableBlock } from '../../../../shared/types/response-blocks';

interface TableBlockViewProps {
  block: TableBlock;
}

export default function TableBlockView({ block }: TableBlockViewProps) {
  const [expanded, setExpanded] = useState(false);

  const visibleRows = block.maxRows && !expanded
    ? block.rows.slice(0, block.maxRows)
    : block.rows;

  const hiddenCount = block.maxRows && !expanded
    ? block.rows.length - block.maxRows
    : 0;

  return (
    <div style={{ marginBottom: 12 }}>
      {block.title && (
        <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', marginBottom: 8 }}>
          {block.title}
        </div>
      )}
      <div style={{ overflowX: 'auto', borderRadius: 6, border: '1px solid #334155' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#1e293b' }}>
              {block.columns.map((col, i) => (
                <th
                  key={i}
                  style={{
                    padding: '8px 12px',
                    textAlign: 'left',
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#cbd5e1',
                    borderBottom: '1px solid #334155',
                    position: 'sticky',
                    top: 0,
                    background: '#1e293b',
                  }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, i) => (
              <tr
                key={i}
                style={{
                  background: i % 2 === 0 ? '#0f172a' : '#1e293b',
                }}
              >
                {block.columns.map((col, j) => (
                  <td
                    key={j}
                    style={{
                      padding: '8px 12px',
                      fontSize: 13,
                      color: '#e2e8f0',
                      borderBottom: i === visibleRows.length - 1 ? 'none' : '1px solid #334155',
                    }}
                  >
                    {formatCell(row[col.key], col.format)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hiddenCount > 0 && (
        <button
          onClick={() => setExpanded(true)}
          style={{
            marginTop: 8,
            padding: '6px 12px',
            fontSize: 13,
            color: '#22d3ee',
            background: 'transparent',
            border: '1px solid #334155',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          Show {hiddenCount} more
        </button>
      )}
    </div>
  );
}

function formatCell(
  value: string | number | null,
  format?: 'currency' | 'number' | 'percent' | 'date' | 'text'
): string {
  if (value === null || value === undefined) return '—';

  switch (format) {
    case 'currency':
      if (typeof value === 'number') {
        return value >= 1000000
          ? `$${(value / 1000000).toFixed(1)}M`
          : value >= 1000
          ? `$${Math.round(value / 1000)}K`
          : `$${value.toLocaleString()}`;
      }
      return String(value);

    case 'number':
      if (typeof value === 'number') {
        return value.toLocaleString();
      }
      return String(value);

    case 'percent':
      if (typeof value === 'number') {
        return `${value.toFixed(1)}%`;
      }
      return String(value);

    case 'date':
      if (typeof value === 'string') {
        try {
          const date = new Date(value);
          return date.toLocaleDateString();
        } catch {
          return value;
        }
      }
      return String(value);

    case 'text':
    default:
      return String(value);
  }
}
