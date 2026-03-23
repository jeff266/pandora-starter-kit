import React from 'react';

function applyInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  const boldRegex = /\*\*(.+?)\*\*/g;
  let match: RegExpExecArray | null;

  while ((match = boldRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }
    parts.push(
      <strong key={match.index} style={{ fontWeight: 700 }}>
        {match[1]}
      </strong>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

export function renderMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n');
  const result: React.ReactNode[] = [];
  let listBuffer: string[] = [];
  let listStartIdx = 0;

  function flushList() {
    if (listBuffer.length === 0) return;
    result.push(
      <ul key={`list-${listStartIdx}`} style={{ margin: '4px 0 4px 0', paddingLeft: 20, listStyleType: 'disc' }}>
        {listBuffer.map((item, i) => (
          <li key={i} style={{ marginBottom: 4, lineHeight: 1.6 }}>
            {applyInline(item)}
          </li>
        ))}
      </ul>
    );
    listBuffer = [];
  }

  lines.forEach((line, idx) => {
    if (line.startsWith('- ')) {
      if (listBuffer.length === 0) listStartIdx = idx;
      listBuffer.push(line.slice(2));
    } else {
      flushList();
      if (line.trim() === '---') {
        result.push(
          <hr key={idx} style={{ border: 'none', borderTop: '1px solid #374151', margin: '12px 0' }} />
        );
      } else if (line.startsWith('### ')) {
        result.push(
          <span key={idx} style={{ fontSize: 12, fontWeight: 600, display: 'block', marginTop: 8, marginBottom: 2 }}>
            {applyInline(line.slice(4))}
          </span>
        );
      } else if (line.startsWith('# ')) {
        result.push(
          <span key={idx} style={{ fontSize: 16, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginTop: 16, marginBottom: 6 }}>
            {applyInline(line.slice(2))}
          </span>
        );
      } else if (line.startsWith('## ')) {
        result.push(
          <span key={idx} style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginTop: 12, marginBottom: 4 }}>
            {applyInline(line.slice(3))}
          </span>
        );
      } else if (line.trim() === '') {
        result.push(<br key={idx} />);
      } else {
        result.push(<span key={idx}>{applyInline(line)}</span>);
      }
    }
  });

  flushList();

  return <>{result}</>;
}
