import { colors } from '../styles/theme';

/**
 * Syntax highlight SQL queries for display in read-only contexts.
 * Returns HTML string with inline styles.
 */
export function highlightSQL(sql: string): string {
  const kw =
    /\b(SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|CROSS|ON|AND|OR|NOT|IN|AS|GROUP|BY|ORDER|HAVING|COUNT|SUM|MAX|MIN|AVG|DISTINCT|FILTER|CASE|WHEN|THEN|ELSE|END|IS|NULL|BETWEEN|LIKE|ILIKE|LIMIT|OFFSET|DESC|ASC|INTERVAL|CURRENT_DATE|NOW|COALESCE|date_trunc|ROUND|NULLIF|EXTRACT|DAY|WITH|RECURSIVE|OVER|PARTITION|ROW_NUMBER|RANK|UNION|ALL|EXISTS|CAST|TRUE|FALSE)\b/gi;

  return sql
    .replace(/(--.*$)/gm, `<span style="color:${colors.textTertiary};font-style:italic">$1</span>`)
    .replace(/('(?:[^'\\]|\\.)*')/g, `<span style="color:${colors.green}">$1</span>`)
    .replace(kw, `<span style="color:${colors.accent};font-weight:600">$&</span>`)
    .replace(/\b(\d+\.?\d*)\b/g, `<span style="color:${colors.yellow}">$1</span>`);
}
