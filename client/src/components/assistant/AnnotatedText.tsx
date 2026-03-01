import React from 'react';

interface Claim {
  text: string;
  drilldown: string;
  verified?: boolean;
}

interface AnnotatedTextProps {
  text: string;
  claims?: Claim[];
  onDrilldown: (drilldown: string) => void;
  style?: React.CSSProperties;
}

/**
 * Renders prose text with verified claims as clickable blue underlined spans.
 * Each claim is matched by exact substring (case-insensitive, first occurrence only).
 * Clicking a claim calls onDrilldown with the drilldown identifier.
 */
export default function AnnotatedText({ text, claims, onDrilldown, style }: AnnotatedTextProps) {
  if (!text) return null;
  if (!claims || claims.length === 0) {
    return <span style={style}>{text}</span>;
  }

  // Build sorted, de-duped list of claims with their positions in the text
  const lowerText = text.toLowerCase();
  const positioned: Array<{ start: number; end: number; claim: Claim }> = [];
  const seen = new Set<string>();

  for (const claim of claims) {
    if (seen.has(claim.drilldown)) continue;
    const idx = lowerText.indexOf(claim.text.toLowerCase());
    if (idx === -1) continue;
    positioned.push({ start: idx, end: idx + claim.text.length, claim });
    seen.add(claim.drilldown);
  }

  // Sort by position and remove overlaps (keep earlier one)
  positioned.sort((a, b) => a.start - b.start);
  const noOverlap: typeof positioned = [];
  let lastEnd = 0;
  for (const p of positioned) {
    if (p.start >= lastEnd) {
      noOverlap.push(p);
      lastEnd = p.end;
    }
  }

  if (noOverlap.length === 0) return <span style={style}>{text}</span>;

  // Build segments: alternating plain text and clickable spans
  const segments: React.ReactNode[] = [];
  let cursor = 0;

  for (const { start, end, claim } of noOverlap) {
    if (start > cursor) {
      segments.push(text.slice(cursor, start));
    }
    segments.push(
      <button
        key={claim.drilldown}
        onClick={() => onDrilldown(claim.drilldown)}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          color: '#6488EA',
          textDecoration: 'underline',
          textDecorationStyle: 'dotted',
          textDecorationColor: 'rgba(100, 136, 234, 0.5)',
          textUnderlineOffset: 3,
          fontSize: 'inherit',
          fontFamily: 'inherit',
          lineHeight: 'inherit',
        }}
        title={`Show math for: ${claim.text}`}
      >
        {text.slice(start, end)}
      </button>
    );
    cursor = end;
  }

  if (cursor < text.length) {
    segments.push(text.slice(cursor));
  }

  return <span style={style}>{segments}</span>;
}
