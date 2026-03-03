import React, { useState } from 'react';
import { colors, fonts } from '../../styles/theme';
import { formatDateTime, formatDuration } from '../../lib/format';
import { api } from '../../lib/api';
import type { InvestigationRun, HistoryPagination } from '../../hooks/useInvestigationHistory';

interface Props {
  runs: InvestigationRun[];
  pagination: HistoryPagination;
  loading: boolean;
  onPageChange: (offset: number) => void;
  onRowClick: (run: InvestigationRun) => void;
}

type SortKey = 'completedAt' | 'skillId' | 'status' | 'durationMs' | 'atRiskCount' | 'criticalCount' | 'warningCount';

function statusBadge(status: string) {
  switch (status) {
    case 'completed':             return { label: 'Completed',   bg: 'rgba(34,197,94,0.12)',  color: '#22c55e' };
    case 'completed_with_errors': return { label: 'W/ Errors',   bg: 'rgba(245,158,11,0.12)', color: '#f59e0b' };
    case 'failed':                return { label: 'Failed',      bg: 'rgba(239,68,68,0.12)',  color: '#ef4444' };
    case 'running':               return { label: 'Running',     bg: 'rgba(59,130,246,0.12)', color: '#3b82f6' };
    default:                      return { label: status,        bg: 'rgba(90,101,120,0.12)', color: colors.textSecondary };
  }
}

function atRiskBadge(count: number) {
  if (count >= 10) return { bg: 'rgba(239,68,68,0.12)', color: '#ef4444' };
  if (count >= 5)  return { bg: 'rgba(245,158,11,0.12)', color: '#f59e0b' };
  return { bg: 'rgba(90,101,120,0.10)', color: colors.textSecondary };
}

function skillLabel(id: string) {
  const map: Record<string, string> = {
    'deal-risk-review':    'Deal Risk Review',
    'data-quality-audit':  'Data Quality Audit',
    'forecast-rollup':     'Forecast Rollup',
  };
  return map[id] ?? id;
}

async function triggerExport(runId: string, format: 'csv' | 'xlsx') {
  try {
    const data: any = await api.post('/investigation/export', { runId, format });
    if (data.downloadUrl) {
      window.open(data.downloadUrl, '_blank');
    }
  } catch (err) {
    console.error('[Export] Failed:', err);
  }
}

const COLS: { key: SortKey; label: string; align?: 'right' }[] = [
  { key: 'completedAt',   label: 'Date' },
  { key: 'skillId',       label: 'Skill' },
  { key: 'status',        label: 'Status' },
  { key: 'durationMs',    label: 'Duration', align: 'right' },
  { key: 'atRiskCount',   label: 'At Risk',  align: 'right' },
  { key: 'criticalCount', label: 'Critical', align: 'right' },
  { key: 'warningCount',  label: 'Warning',  align: 'right' },
];

export default function InvestigationHistoryTable({
  runs, pagination, loading, onPageChange, onRowClick,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('completedAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [exportingId, setExportingId] = useState<string | null>(null);

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  const sorted = [...runs].sort((a, b) => {
    let av: any, bv: any;
    switch (sortKey) {
      case 'completedAt':   av = a.completedAt ?? ''; bv = b.completedAt ?? ''; break;
      case 'skillId':       av = a.skillId; bv = b.skillId; break;
      case 'status':        av = a.status; bv = b.status; break;
      case 'durationMs':    av = a.durationMs ?? 0; bv = b.durationMs ?? 0; break;
      case 'atRiskCount':   av = a.summary.atRiskCount; bv = b.summary.atRiskCount; break;
      case 'criticalCount': av = a.summary.criticalCount; bv = b.summary.criticalCount; break;
      case 'warningCount':  av = a.summary.warningCount; bv = b.summary.warningCount; break;
    }
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const { total, limit, offset } = pagination;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);

  async function handleExport(e: React.MouseEvent, runId: string, format: 'csv' | 'xlsx') {
    e.stopPropagation();
    setExportingId(`${runId}-${format}`);
    await triggerExport(runId, format);
    setExportingId(null);
  }

  return (
    <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
              {COLS.map(col => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  style={{
                    padding: '10px 14px',
                    textAlign: col.align ?? 'left',
                    fontSize: 10,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: sortKey === col.key ? colors.accent : colors.textMuted,
                    fontFamily: fonts.sans,
                    fontWeight: 600,
                    cursor: 'pointer',
                    userSelect: 'none',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {col.label} {sortKey === col.key ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                </th>
              ))}
              <th style={{ padding: '10px 14px', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: colors.textMuted, fontFamily: fonts.sans }}>
                Export
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={COLS.length + 1} style={{ padding: 32, textAlign: 'center', color: colors.textMuted, fontSize: 13 }}>
                  Loading…
                </td>
              </tr>
            )}
            {!loading && sorted.length === 0 && (
              <tr>
                <td colSpan={COLS.length + 1} style={{ padding: 32, textAlign: 'center', color: colors.textMuted, fontSize: 13 }}>
                  No investigation runs found
                </td>
              </tr>
            )}
            {!loading && sorted.map(run => {
              const sb = statusBadge(run.status);
              const arb = atRiskBadge(run.summary.atRiskCount);
              return (
                <tr
                  key={run.runId}
                  onClick={() => onRowClick(run)}
                  style={{
                    borderBottom: `1px solid ${colors.borderLight}`,
                    cursor: 'pointer',
                    transition: 'background 0.12s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={{ padding: '10px 14px', fontSize: 12, color: colors.textSecondary, whiteSpace: 'nowrap' }}>
                    {run.completedAt ? formatDateTime(run.completedAt) : '—'}
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: 12, color: colors.text }}>
                    {skillLabel(run.skillId)}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: 10,
                      fontSize: 11,
                      fontWeight: 600,
                      background: sb.bg,
                      color: sb.color,
                    }}>
                      {sb.label}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: 12, color: colors.textSecondary, textAlign: 'right' }}>
                    {formatDuration(run.durationMs)}
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: 10,
                      fontSize: 11,
                      fontWeight: 600,
                      background: arb.bg,
                      color: arb.color,
                    }}>
                      {run.summary.atRiskCount}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: 12, color: run.summary.criticalCount > 0 ? '#ef4444' : colors.textSecondary, textAlign: 'right' }}>
                    {run.summary.criticalCount}
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: 12, color: run.summary.warningCount > 0 ? '#f59e0b' : colors.textSecondary, textAlign: 'right' }}>
                    {run.summary.warningCount}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                      {(['csv', 'xlsx'] as const).map(fmt => (
                        <button
                          key={fmt}
                          disabled={exportingId === `${run.runId}-${fmt}` || run.status !== 'completed'}
                          onClick={e => handleExport(e, run.runId, fmt)}
                          style={{
                            padding: '2px 7px',
                            borderRadius: 5,
                            border: `1px solid ${colors.border}`,
                            background: 'transparent',
                            color: run.status === 'completed' ? colors.textSecondary : colors.textMuted,
                            fontSize: 10,
                            fontFamily: fonts.sans,
                            cursor: run.status === 'completed' ? 'pointer' : 'default',
                            opacity: run.status === 'completed' ? 1 : 0.4,
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                          }}
                        >
                          {exportingId === `${run.runId}-${fmt}` ? '…' : fmt}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', borderTop: `1px solid ${colors.border}`,
      }}>
        <div style={{ fontSize: 12, color: colors.textMuted }}>
          {total > 0 ? `Showing ${from}–${to} of ${total}` : 'No results'}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            disabled={offset === 0 || loading}
            onClick={() => onPageChange(Math.max(0, offset - limit))}
            style={{
              padding: '4px 12px', borderRadius: 6,
              border: `1px solid ${colors.border}`,
              background: 'transparent', color: colors.textSecondary,
              fontSize: 12, cursor: offset === 0 ? 'default' : 'pointer',
              opacity: offset === 0 ? 0.4 : 1,
            }}
          >
            Previous
          </button>
          <button
            disabled={to >= total || loading}
            onClick={() => onPageChange(offset + limit)}
            style={{
              padding: '4px 12px', borderRadius: 6,
              border: `1px solid ${colors.border}`,
              background: 'transparent', color: colors.textSecondary,
              fontSize: 12, cursor: to >= total ? 'default' : 'pointer',
              opacity: to >= total ? 0.4 : 1,
            }}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
