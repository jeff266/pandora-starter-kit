import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import SectionErrorBoundary from '../components/SectionErrorBoundary';
import SankeyChart from '../components/reports/SankeyChart';
import WinningPathsChart from '../components/pipeline/WinningPathsChart';
import type { SankeyChartData, WinningPathsData } from '../components/reports/types';

interface FilterState {
  pipeline: string;
  scopeId: string;
  sizeBand: string;
}

interface FilterMeta {
  pipelines: string[];
  scopes: Array<{ id: string; name: string }>;
}

const SIZE_BANDS = [
  { label: '< $50K', value: 'small' },
  { label: '$50K–$250K', value: 'mid' },
  { label: '> $250K', value: 'enterprise' },
];

function pill(
  label: string,
  active: boolean,
  onClick: () => void,
  accent?: string
) {
  return (
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
        whiteSpace: 'nowrap' as const,
      }}
    >
      {label}
    </button>
  );
}

export default function PipelinePage() {
  const [filter, setFilter] = useState<FilterState>({ pipeline: '', scopeId: '', sizeBand: '' });
  const [filterMeta, setFilterMeta] = useState<FilterMeta>({ pipelines: [], scopes: [] });

  const [sankeyData, setSankeyData] = useState<SankeyChartData | null>(null);
  const [sankeyLoading, setSankeyLoading] = useState(true);
  const [sankeyError, setSankeyError] = useState<string | null>(null);

  const [pathsData, setPathsData] = useState<WinningPathsData | null>(null);
  const [pathsLoading, setPathsLoading] = useState(true);
  const [pathsError, setPathsError] = useState<string | null>(null);

  const fetchSankey = useCallback(async (f: FilterState) => {
    setSankeyLoading(true);
    setSankeyError(null);
    const params = new URLSearchParams();
    if (f.pipeline) params.set('pipeline', f.pipeline);
    if (f.scopeId) params.set('scopeId', f.scopeId);
    const qs = params.toString();
    try {
      const data = await api.get(`/analysis/sankey${qs ? `?${qs}` : ''}`) as SankeyChartData;
      setSankeyData(data);
    } catch (err: any) {
      setSankeyError(err.message || 'Failed to load funnel data');
    } finally {
      setSankeyLoading(false);
    }
  }, []);

  const fetchPaths = useCallback(async (f: FilterState) => {
    setPathsLoading(true);
    setPathsError(null);
    const params = new URLSearchParams();
    if (f.pipeline) params.set('pipeline', f.pipeline);
    if (f.scopeId) params.set('scopeId', f.scopeId);
    if (f.sizeBand) params.set('sizeBand', f.sizeBand);
    const qs = params.toString();
    try {
      const data = await api.get(`/analysis/winning-paths${qs ? `?${qs}` : ''}`) as WinningPathsData;
      setPathsData(data);
      setFilterMeta({
        pipelines: data.availablePipelines ?? [],
        scopes: (data.availableScopes ?? []).filter(
          (s) => !data.availablePipelines?.some(
            (p) => p.toLowerCase() === s.name.toLowerCase()
          ) && s.name.toLowerCase() !== 'all deals'
        ),
      });
    } catch (err: any) {
      setPathsError(err.message || 'Failed to load winning paths');
    } finally {
      setPathsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSankey(filter);
    fetchPaths(filter);
  }, []);

  function applyFilter(next: FilterState) {
    setFilter(next);
    fetchSankey(next);
    fetchPaths(next);
  }

  function handlePipeline(value: string) {
    const next: FilterState = {
      pipeline: filter.pipeline === value ? '' : value,
      scopeId: '',
      sizeBand: filter.sizeBand,
    };
    applyFilter(next);
  }

  function handleScope(id: string) {
    const next: FilterState = {
      pipeline: '',
      scopeId: filter.scopeId === id ? '' : id,
      sizeBand: filter.sizeBand,
    };
    applyFilter(next);
  }

  function handleSizeBand(value: string) {
    const next: FilterState = {
      ...filter,
      sizeBand: filter.sizeBand === value ? '' : value,
    };
    applyFilter(next);
  }

  const hasFilters = filterMeta.pipelines.length > 0 || filterMeta.scopes.length > 0;

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: hasFilters ? 16 : 24 }}>
        <h1 style={{
          fontSize: 20,
          fontWeight: 700,
          color: colors.text,
          fontFamily: fonts.sans,
          margin: 0,
          lineHeight: 1.2,
        }}>
          Pipeline
        </h1>
        <p style={{
          fontSize: 13,
          color: colors.textMuted,
          margin: '4px 0 0',
          fontFamily: fonts.sans,
        }}>
          Funnel health and winning patterns
        </p>
      </div>

      {hasFilters && (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          alignItems: 'center',
          marginBottom: 20,
          padding: '10px 14px',
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
        }}>
          {pill('All Deals', !filter.pipeline && !filter.scopeId, () => applyFilter({ pipeline: '', scopeId: '', sizeBand: filter.sizeBand }))}
          {filterMeta.pipelines.length > 0 && (
            <>
              <div style={{ width: 1, height: 16, background: colors.border, margin: '0 2px' }} />
              {filterMeta.pipelines.map((p) =>
                pill(`▶ ${p}`, filter.pipeline === p, () => handlePipeline(p))
              )}
            </>
          )}
          {filterMeta.scopes.length > 0 && (
            <>
              <div style={{ width: 1, height: 16, background: colors.border, margin: '0 2px' }} />
              {filterMeta.scopes.map((s) =>
                pill(`◈ ${s.name}`, filter.scopeId === s.id, () => handleScope(s.id), '#a78bfa')
              )}
            </>
          )}
          <div style={{ width: 1, height: 16, background: colors.border, margin: '0 2px' }} />
          {SIZE_BANDS.map((b) =>
            pill(b.label, filter.sizeBand === b.value, () => handleSizeBand(b.value), '#f59e0b')
          )}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <SectionErrorBoundary fallbackMessage="Unable to load pipeline funnel.">
          <div>
            <h2 style={{
              fontSize: 12,
              fontWeight: 600,
              color: colors.textMuted,
              fontFamily: fonts.sans,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              margin: '0 0 10px',
            }}>
              Pipeline Funnel
            </h2>
            {sankeyError ? (
              <div style={{
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: 12,
                padding: 24,
                textAlign: 'center',
                color: colors.textMuted,
                fontSize: 13,
              }}>
                {sankeyError}
              </div>
            ) : sankeyLoading && !sankeyData ? (
              <div style={{
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: 12,
                padding: 40,
                textAlign: 'center',
                color: colors.textMuted,
                fontSize: 13,
              }}>
                Loading funnel data…
              </div>
            ) : sankeyData ? (
              <SankeyChart data={sankeyData} hideFilters />
            ) : null}
          </div>
        </SectionErrorBoundary>

        <SectionErrorBoundary fallbackMessage="Unable to load winning paths.">
          <div>
            <h2 style={{
              fontSize: 12,
              fontWeight: 600,
              color: colors.textMuted,
              fontFamily: fonts.sans,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              margin: '0 0 10px',
            }}>
              Winning Paths
            </h2>
            {pathsError ? (
              <div style={{
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: 12,
                padding: 24,
                textAlign: 'center',
                color: colors.textMuted,
                fontSize: 13,
              }}>
                {pathsError}
              </div>
            ) : pathsLoading && !pathsData ? (
              <div style={{
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: 12,
                padding: 40,
                textAlign: 'center',
                color: colors.textMuted,
                fontSize: 13,
              }}>
                Loading winning paths…
              </div>
            ) : (
              <WinningPathsChart
                data={pathsData}
                hideFilters
              />
            )}
          </div>
        </SectionErrorBoundary>
      </div>
    </div>
  );
}
