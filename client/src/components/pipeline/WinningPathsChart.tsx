import React, { useState } from 'react';
import { colors, fonts } from '../../styles/theme';
import { api } from '../../lib/api';
import type { WinningPath, WinningPathsData } from '../reports/types';

const SIZE_BANDS = [
  { label: 'All Sizes', value: '' },
  { label: '< $50K', value: 'small' },
  { label: '$50K–$250K', value: 'mid' },
  { label: '> $250K', value: 'enterprise' },
];

function fmtCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

function StageChips({ stages, compact = false }: { stages: string[]; compact?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: compact ? 3 : 4 }}>
      {stages.map((stage, i) => (
        <React.Fragment key={i}>
          <span style={{
            fontSize: compact ? 10 : 11,
            fontFamily: fonts.sans,
            fontWeight: 500,
            color: colors.text,
            background: colors.surfaceHover,
            border: `1px solid ${colors.border}`,
            borderRadius: 4,
            padding: compact ? '1px 5px' : '2px 7px',
            whiteSpace: 'nowrap',
          }}>
            {stage}
          </span>
          {i < stages.length - 1 && (
            <span style={{ fontSize: compact ? 9 : 10, color: colors.textMuted }}>→</span>
          )}
        </React.Fragment>
      ))}
      <span style={{
        fontSize: compact ? 10 : 11,
        fontWeight: 600,
        color: '#34D399',
        background: 'rgba(52, 211, 153, 0.12)',
        border: '1px solid rgba(52, 211, 153, 0.3)',
        borderRadius: 4,
        padding: compact ? '1px 5px' : '2px 7px',
        marginLeft: 2,
      }}>
        ✓ Won
      </span>
    </div>
  );
}

function PathRow({
  path,
  maxCount,
  rank,
}: {
  path: WinningPath;
  maxCount: number;
  rank: number;
}) {
  const barWidth = maxCount > 0 ? (path.count / maxCount) * 100 : 0;

  return (
    <div style={{
      padding: '12px 0',
      borderBottom: `1px solid ${colors.border}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{
            fontSize: 10,
            fontWeight: 700,
            color: colors.textMuted,
            background: colors.surfaceHover,
            borderRadius: '50%',
            width: 18,
            height: 18,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
            {rank}
          </span>
          <div style={{ minWidth: 0 }}>
            <StageChips stages={path.sequence} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 16, flexShrink: 0, textAlign: 'right' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>{path.count}</div>
            <div style={{ fontSize: 10, color: colors.textMuted }}>deals</div>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>{fmtCurrency(path.avgArrUsd)}</div>
            <div style={{ fontSize: 10, color: colors.textMuted }}>avg ARR</div>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>{Math.round(path.avgCycleDays)}d</div>
            <div style={{ fontSize: 10, color: colors.textMuted }}>avg cycle</div>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          flex: 1,
          height: 4,
          background: colors.surfaceHover,
          borderRadius: 2,
          overflow: 'hidden',
        }}>
          <div style={{
            width: `${barWidth}%`,
            height: '100%',
            background: 'linear-gradient(90deg, #48af9b, #3a7fc1)',
            borderRadius: 2,
            transition: 'width 0.4s ease',
          }} />
        </div>
        <span style={{ fontSize: 10, color: colors.textMuted, minWidth: 32, textAlign: 'right' }}>
          {Math.round(barWidth)}%
        </span>
      </div>
    </div>
  );
}

function LoadingShimmer() {
  return (
    <div style={{ padding: '4px 0' }}>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ padding: '12px 0', borderBottom: `1px solid ${colors.border}` }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <div style={{ width: 18, height: 18, borderRadius: '50%', background: colors.surfaceHover }} />
            <div style={{ flex: 1, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[60, 80, 55, 70].map((w, j) => (
                <div key={j} style={{ width: w, height: 20, borderRadius: 4, background: colors.surfaceHover,
                  animation: 'pulse 1.5s ease-in-out infinite',
                  animationDelay: `${i * 0.1 + j * 0.05}s`,
                }} />
              ))}
            </div>
          </div>
          <div style={{ height: 4, borderRadius: 2, background: colors.surfaceHover, width: `${65 - i * 15}%` }} />
        </div>
      ))}
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  );
}

interface WinningPathsChartProps {
  data: WinningPathsData | null;
  workspaceId?: string;
  embedded?: boolean;
  hideFilters?: boolean;
  onDataChange?: (data: WinningPathsData) => void;
}

export default function WinningPathsChart({
  data: initialData,
  workspaceId,
  embedded = false,
  hideFilters = false,
  onDataChange,
}: WinningPathsChartProps) {
  const [data, setData] = useState<WinningPathsData | null>(initialData);
  const [loading, setLoading] = useState(false);
  const [activePipeline, setActivePipeline] = useState<string>('');
  const [activeScopeId, setActiveScopeId] = useState<string>('');
  const [activeSizeBand, setActiveSizeBand] = useState<string>('');
  const [sortBy, setSortBy] = useState<'count' | 'arr'>('count');

  React.useEffect(() => {
    if (initialData) setData(initialData);
  }, [initialData]);

  async function applyFilter(pipeline: string, scopeId: string, sizeBand: string) {
    setLoading(true);
    const params = new URLSearchParams();
    if (pipeline) params.set('pipeline', pipeline);
    if (scopeId) params.set('scopeId', scopeId);
    if (sizeBand) params.set('sizeBand', sizeBand);
    const qs = params.toString();
    try {
      const fresh = await api.get(`/analysis/winning-paths${qs ? `?${qs}` : ''}`);
      setData(fresh);
      if (onDataChange) onDataChange(fresh);
    } catch (e) {
      console.error('[WinningPathsChart] filter fetch error', e);
    } finally {
      setLoading(false);
    }
  }

  function handlePipeline(value: string) {
    const next = activePipeline === value ? '' : value;
    setActivePipeline(next);
    setActiveScopeId('');
    applyFilter(next, '', activeSizeBand);
  }

  function handleScope(id: string) {
    const next = activeScopeId === id ? '' : id;
    setActiveScopeId(next);
    setActivePipeline('');
    applyFilter('', next, activeSizeBand);
  }

  function handleSizeBand(value: string) {
    const next = activeSizeBand === value ? '' : value;
    setActiveSizeBand(next);
    applyFilter(activePipeline, activeScopeId, next);
  }

  const currentData = data;
  const paths = currentData?.paths ?? [];

  const sorted = [...paths].sort((a, b) =>
    sortBy === 'arr' ? b.avgArrUsd - a.avgArrUsd : b.count - a.count
  );

  const maxCount = sorted.length > 0 ? Math.max(...sorted.map((p) => p.count)) : 1;

  const pill = (label: string, active: boolean, onClick: () => void, accent?: string) => (
    <button
      key={label}
      onClick={onClick}
      style={{
        fontSize: 11,
        fontFamily: fonts.sans,
        fontWeight: 500,
        padding: '3px 10px',
        borderRadius: 20,
        border: `1px solid ${active ? (accent ?? colors.accent) : colors.border}`,
        background: active ? (accent ? `${accent}22` : colors.accentSoft) : 'transparent',
        color: active ? (accent ?? colors.accent) : colors.textMuted,
        cursor: 'pointer',
        transition: 'all 0.15s',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 12,
      overflow: 'hidden',
    }}>
      <div style={{ padding: '14px 16px', borderBottom: `1px solid ${colors.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: embedded ? 0 : 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: colors.text, fontFamily: fonts.sans }}>
              Winning Paths
            </span>
            {currentData && (
              <span style={{
                fontSize: 10, fontWeight: 600, color: colors.textMuted,
                background: colors.surfaceHover, padding: '1px 7px', borderRadius: 10,
              }}>
                {currentData.totalWins} wins
              </span>
            )}
          </div>
          {!embedded && (
            <div style={{ display: 'flex', gap: 4 }}>
              {(['count', 'arr'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSortBy(s)}
                  style={{
                    fontSize: 10,
                    fontFamily: fonts.sans,
                    padding: '2px 8px',
                    borderRadius: 6,
                    border: `1px solid ${sortBy === s ? colors.accent : colors.border}`,
                    background: sortBy === s ? colors.accentSoft : 'transparent',
                    color: sortBy === s ? colors.accent : colors.textMuted,
                    cursor: 'pointer',
                  }}
                >
                  {s === 'count' ? 'By Volume' : 'By ARR'}
                </button>
              ))}
            </div>
          )}
        </div>

        {!embedded && !hideFilters && currentData && (currentData.availablePipelines.length > 0 || currentData.availableScopes.length > 0) && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {pill('All Deals', !activePipeline && !activeScopeId, () => { setActivePipeline(''); setActiveScopeId(''); applyFilter('', '', activeSizeBand); })}
            {currentData.availablePipelines.map((p) =>
              pill(`▶ ${p}`, activePipeline === p, () => handlePipeline(p))
            )}
            {currentData.availableScopes.map((s) =>
              pill(`◈ ${s.name}`, activeScopeId === s.id, () => handleScope(s.id), '#a78bfa')
            )}
            <div style={{ width: 1, background: colors.border, margin: '0 2px', alignSelf: 'stretch' }} />
            {SIZE_BANDS.slice(1).map((b) =>
              pill(b.label, activeSizeBand === b.value, () => handleSizeBand(b.value), '#f59e0b')
            )}
          </div>
        )}
      </div>

      <div style={{ padding: '0 16px' }}>
        {loading ? (
          <LoadingShimmer />
        ) : sorted.length === 0 ? (
          <div style={{
            padding: '32px 0',
            textAlign: 'center',
            color: colors.textMuted,
            fontSize: 13,
            fontStyle: 'italic',
          }}>
            No winning path data yet — deals need to reach Closed Won with stage history tracked.
          </div>
        ) : (
          sorted.map((path, i) => (
            <PathRow key={i} path={path} maxCount={maxCount} rank={i + 1} />
          ))
        )}
      </div>
    </div>
  );
}
