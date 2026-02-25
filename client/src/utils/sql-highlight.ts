import { colors } from '../styles/theme';

export function highlightSQL(sql: string): string {
  const tokens: { start: number; end: number; html: string }[] = [];

  const kwPattern =
    /\b(SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|CROSS|ON|AND|OR|NOT|IN|AS|GROUP|BY|ORDER|HAVING|COUNT|SUM|MAX|MIN|AVG|DISTINCT|FILTER|CASE|WHEN|THEN|ELSE|END|IS|NULL|BETWEEN|LIKE|ILIKE|LIMIT|OFFSET|DESC|ASC|INTERVAL|CURRENT_DATE|NOW|COALESCE|date_trunc|ROUND|NULLIF|EXTRACT|DAY|WITH|RECURSIVE|OVER|PARTITION|ROW_NUMBER|RANK|UNION|ALL|EXISTS|CAST|TRUE|FALSE)\b/gi;

  const commentPattern = /(--.*$)/gm;
  const stringPattern = /('(?:[^'\\]|\\.)*')/g;
  const numberPattern = /\b(\d+\.?\d*)\b/g;
  const paramPattern = /(\$\d+)/g;

  function collect(pattern: RegExp, style: string) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(sql)) !== null) {
      tokens.push({
        start: m.index,
        end: m.index + m[0].length,
        html: `<span style="${style}">${escapeHtml(m[0])}</span>`,
      });
    }
  }

  collect(commentPattern, `color:${colors.textTertiary};font-style:italic`);
  collect(stringPattern, `color:${colors.green}`);
  collect(kwPattern, `color:${colors.accent};font-weight:600`);
  collect(numberPattern, `color:${colors.yellow}`);
  collect(paramPattern, `color:${colors.yellow}`);

  tokens.sort((a, b) => a.start - b.start);

  const filtered: typeof tokens = [];
  let lastEnd = 0;
  for (const t of tokens) {
    if (t.start >= lastEnd) {
      filtered.push(t);
      lastEnd = t.end;
    }
  }

  let result = '';
  let pos = 0;
  for (const t of filtered) {
    if (t.start > pos) {
      result += escapeHtml(sql.slice(pos, t.start));
    }
    result += t.html;
    pos = t.end;
  }
  if (pos < sql.length) {
    result += escapeHtml(sql.slice(pos));
  }

  return result;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
