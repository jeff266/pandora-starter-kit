import React from 'react';
import type { NarrativeBlock } from '../../../../shared/types/response-blocks';

interface NarrativeBlockViewProps {
  block: NarrativeBlock;
}

const severityColors: Record<NonNullable<NarrativeBlock['severity']>, string> = {
  critical: '#f97316', // coral
  warning: '#d97706',  // amber
  info: '#0d9488',     // teal
  positive: '#16a34a', // green
};

export default function NarrativeBlockView({ block }: NarrativeBlockViewProps) {
  const borderColor = block.severity ? severityColors[block.severity] : 'transparent';

  return (
    <div
      style={{
        borderLeft: `3px solid ${borderColor}`,
        paddingLeft: block.severity ? 12 : 0,
        marginBottom: 8,
        fontSize: 14,
        lineHeight: 1.6,
        color: '#e2e8f0',
      }}
    >
      {renderMarkdownSimple(block.content)}
    </div>
  );
}

// Simple markdown renderer - handles basic formatting
function renderMarkdownSimple(text: string): React.ReactElement {
  const lines = text.split('\n');

  return (
    <>
      {lines.map((line, i) => {
        if (line.trim() === '') {
          return <div key={i} style={{ height: 8 }} />;
        }

        // Headers
        if (line.startsWith('### ')) {
          return (
            <div key={i} style={{ fontSize: 15, fontWeight: 600, marginTop: 10, marginBottom: 4 }}>
              {formatInline(line.slice(4))}
            </div>
          );
        }
        if (line.startsWith('## ')) {
          return (
            <div key={i} style={{ fontSize: 16, fontWeight: 600, marginTop: 12, marginBottom: 6 }}>
              {formatInline(line.slice(3))}
            </div>
          );
        }
        if (line.startsWith('# ')) {
          return (
            <div key={i} style={{ fontSize: 18, fontWeight: 700, marginTop: 14, marginBottom: 8 }}>
              {formatInline(line.slice(2))}
            </div>
          );
        }

        // Lists
        if (line.startsWith('- ') || line.startsWith('* ') || line.startsWith('• ')) {
          return (
            <div key={i} style={{ paddingLeft: 12, marginBottom: 2 }}>
              • {formatInline(line.slice(2))}
            </div>
          );
        }

        // Regular paragraph
        return <div key={i}>{formatInline(line)}</div>;
      })}
    </>
  );
}

// Format inline markdown (bold, links)
function formatInline(text: string): (string | React.ReactElement)[] {
  const parts: (string | React.ReactElement)[] = [];
  const regex = /\*\*(.*?)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[1] !== undefined) {
      // Bold
      parts.push(<strong key={match.index}>{match[1]}</strong>);
    } else if (match[2] && match[3]) {
      // Link
      parts.push(
        <a
          key={match.index}
          href={match[3]}
          style={{ color: '#22d3ee', textDecoration: 'underline' }}
          target={match[3].startsWith('http') ? '_blank' : undefined}
          rel={match[3].startsWith('http') ? 'noopener noreferrer' : undefined}
        >
          {match[2]}
        </a>
      );
    }
    last = regex.lastIndex;
  }

  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
