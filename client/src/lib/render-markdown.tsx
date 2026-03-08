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

  lines.forEach((line, idx) => {
    if (line.startsWith('### ')) {
      result.push(
        <span key={idx} style={{ fontSize: 12, fontWeight: 600, display: 'block', marginTop: 8, marginBottom: 2 }}>
          {applyInline(line.slice(4))}
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
  });

  return <>{result}</>;
}
