import React, { useState, useMemo } from 'react';
import { colors, fonts } from '../../styles/theme';
import { formatCurrency, formatPercent } from '../../lib/format';
import type { ForecastAnnotation } from '../../hooks/useForecastAnnotations';

export interface RepRow {
  rep_name: string;
  rep_email: string;
  deals: number;
  pipeline: number;
  stage_weighted: number;
  category_weighted: number;
  mc_p50: number;
  actual: number;
  quota: number;
}

interface RepTableProps {
  reps: RepRow[];
  annotations?: ForecastAnnotation[];
}

type SortKey = keyof Omit<RepRow, 'rep_email'>;
type SortDir = 'asc' | 'desc';

const SEVERITY_BORDER: Record<string, string> = {
  critical: colors.red,
  warning: colors.yellow,
  positive: colors.green,
  info: colors.accent,
};

const SEVERITY_BG: Record<string, string> = {
  critical: colors.redSoft,
  warning: colors.yellowSoft,
  positive: colors.greenSoft,
  info: colors.accentSoft,
};

const COLUMNS: { key: SortKey; label: string; align: 'left' | 'right'; format: (v: any) => string }[] = [
  { key: 'rep_name', label: 'Rep', align: 'left', format: (v: string) => v },
  { key: 'deals', label: 'Deals', align: 'right', format: (v: number) => String(v) },
  { key: 'pipeline', label: 'Pipeline', align: 'right', format: formatCurrency },
  { key: 'stage_weighted', label: 'Stage W', align: 'right', format: formatCurrency },
  { key: 'category_weighted', label: 'Cat W', align: 'right', format: formatCurrency },
  { key: 'mc_p50', label: 'MC P50', align: 'right', format: formatCurrency },
  { key: 'actual', label: 'Actual', align: 'right', format: formatCurrency },
  { key: 'quota', label: 'Quota', align: 'right', format: formatCurrency },
];

function attainmentPct(actual: number, quota: number): number {
  if (!quota || quota <= 0) return 0;
  return actual / quota;
}

export default function RepTable({ reps, annotations = [] }: RepTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('pipeline');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const repAnnotations = useMemo(() => {
    const map = new Map<string, ForecastAnnotation[]>();
    for (const a of annotations) {
      if (a.anchor.type === 'rep') {
        const email = a.anchor.rep_email;
        if (!map.has(email)) map.set(email, []);
        map.get(email)!.push(a);
      }
    }
    return map;
  }, [annotations]);

  const sorted = useMemo(() => {
    const copy = [...reps];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const na = Number(av) || 0;
      const nb = Number(bv) || 0;
      return sortDir === 'asc' ? na - nb : nb - na;
    });
    return copy;
  }, [reps, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  if (!reps.length) {
    return (
      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: '32px 24px',
        textAlign: 'center',
        fontFamily: fonts.sans,
      }}>
        <div style={{ fontSize: 14, color: colors.textMuted }}>No rep data available</div>
      </div>
    );
  }

  const sortArrow = (key: SortKey) => {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 8,
      overflow: 'hidden',
    }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontFamily: fonts.sans,
          fontSize: 13,
        }}>
          <thead>
            <tr>
              {COLUMNS.map(col => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  style={{
                    padding: '10px 12px',
                    textAlign: col.align,
                    fontSize: 11,
                    fontWeight: 600,
                    color: sortKey === col.key ? colors.accent : colors.textMuted,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    borderBottom: `1px solid ${colors.border}`,
                    cursor: 'pointer',
                    userSelect: 'none',
                    whiteSpace: 'nowrap',
                    background: colors.surface,
                    position: 'sticky',
                    top: 0,
                    zIndex: 10,
                  }}
                >
                  {col.label}{sortArrow(col.key)}
                </th>
              ))}
              <th style={{
                padding: '10px 12px',
                textAlign: 'right',
                fontSize: 11,
                fontWeight: 600,
                color: colors.textMuted,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                borderBottom: `1px solid ${colors.border}`,
                background: colors.surface,
                position: 'sticky',
                top: 0,
                zIndex: 10,
                minWidth: 120,
              }}>
                Attainment
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((rep) => {
              const pct = attainmentPct(rep.actual, rep.quota);
              const barColor = pct >= 1 ? colors.green : pct >= 0.7 ? colors.yellow : colors.red;
              const repAnns = repAnnotations.get(rep.rep_email) || [];

              return (
                <React.Fragment key={rep.rep_email}>
                  <tr
                    style={{ transition: 'background 0.12s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    {COLUMNS.map(col => (
                      <td
                        key={col.key}
                        style={{
                          padding: '10px 12px',
                          textAlign: col.align,
                          color: col.key === 'rep_name' ? colors.text : colors.textSecondary,
                          fontWeight: col.key === 'rep_name' ? 600 : 400,
                          borderBottom: repAnns.length ? 'none' : `1px solid ${colors.border}`,
                          whiteSpace: 'nowrap',
                          fontFamily: col.key === 'rep_name' ? fonts.sans : fonts.mono,
                          fontSize: col.key === 'rep_name' ? 13 : 12,
                        }}
                      >
                        {col.format(rep[col.key])}
                      </td>
                    ))}
                    <td style={{
                      padding: '10px 12px',
                      textAlign: 'right',
                      borderBottom: repAnns.length ? 'none' : `1px solid ${colors.border}`,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                        <div style={{
                          width: 60,
                          height: 6,
                          background: colors.surfaceActive,
                          borderRadius: 3,
                          overflow: 'hidden',
                        }}>
                          <div style={{
                            width: `${Math.min(pct * 100, 100)}%`,
                            height: '100%',
                            background: barColor,
                            borderRadius: 3,
                            transition: 'width 0.3s',
                          }} />
                        </div>
                        <span style={{
                          fontSize: 12,
                          fontFamily: fonts.mono,
                          color: barColor,
                          fontWeight: 600,
                          minWidth: 42,
                          textAlign: 'right',
                        }}>
                          {formatPercent(pct)}
                        </span>
                      </div>
                    </td>
                  </tr>
                  {repAnns.map(ann => (
                    <tr key={ann.id}>
                      <td
                        colSpan={COLUMNS.length + 1}
                        style={{
                          padding: '0 12px 0 24px',
                          borderBottom: `1px solid ${colors.border}`,
                        }}
                      >
                        <div style={{
                          borderLeft: `3px solid ${SEVERITY_BORDER[ann.severity] || colors.accent}`,
                          background: SEVERITY_BG[ann.severity] || colors.accentSoft,
                          borderRadius: '0 4px 4px 0',
                          padding: '6px 10px',
                          marginBottom: 6,
                          marginTop: 2,
                        }}>
                          <div style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: SEVERITY_BORDER[ann.severity] || colors.text,
                            fontFamily: fonts.sans,
                          }}>
                            {ann.title}
                          </div>
                          {ann.body && (
                            <div style={{
                              fontSize: 11,
                              color: colors.textSecondary,
                              marginTop: 2,
                              lineHeight: 1.4,
                              fontFamily: fonts.sans,
                            }}>
                              {ann.body.split('.')[0]}.
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
