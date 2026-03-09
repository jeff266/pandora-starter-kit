import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import SectionErrorBoundary from '../components/SectionErrorBoundary';
import BenchmarksGrid from './BenchmarksGrid';
import SankeyChart from '../components/reports/SankeyChart';
import WinningPathsChart from '../components/pipeline/WinningPathsChart';
import { useWorkspace } from '../context/WorkspaceContext';
import type { SankeyChartData, WinningPathsData } from '../components/reports/types';

interface Pipeline { id: string; name: string; }

type TabId = 'stage-velocity' | 'pipeline-history' | 'winning-paths';

const TABS: { id: TabId; label: string }[] = [
  { id: 'stage-velocity', label: 'Stage Velocity' },
  { id: 'pipeline-history', label: 'Pipeline History' },
  { id: 'winning-paths', label: 'Winning Paths' },
];

const PERIOD_PRESETS: { label: string; days: number | 'ytd' }[] = [
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '180d', days: 180 },
  { label: 'YTD', days: 'ytd' },
];

function getYtdDays(): number {
  const now = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  return Math.max(1, Math.ceil((now.getTime() - jan1.getTime()) / 86_400_000));
}

function resolveDays(preset: number | 'ytd'): number {
  return preset === 'ytd' ? getYtdDays() : preset;
}

export default function PipelineMechanicsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get('tab') as TabId) ?? 'stage-velocity';
  const { currentWorkspace } = useWorkspace();

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [activePipeline, setActivePipeline] = useState<string | null>(null);

  useEffect(() => {
    if (!currentWorkspace?.id) return;
    api.get('/deals/crm-pipelines')
      .then((data: any) => setPipelines(Array.isArray(data) ? data : []))
      .catch(() => setPipelines([]));
  }, [currentWorkspace?.id]);

  function setTab(id: TabId) {
    setActivePipeline(null);
    setSearchParams({ tab: id }, { replace: true });
  }

  const scopeButtonStyle = (active: boolean) => ({
    padding: '4px 12px',
    borderRadius: 5,
    border: 'none',
    fontSize: 12,
    fontFamily: fonts.sans,
    fontWeight: active ? 600 : 400,
    background: active ? `${colors.accent}18` : 'transparent',
    color: active ? colors.accent : colors.textMuted,
    cursor: 'pointer' as const,
    transition: 'all 0.12s',
    outline: 'none',
    whiteSpace: 'nowrap' as const,
  });

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1200, margin: '0 auto', fontFamily: fonts.sans }}>
      {/* Page header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: colors.text, margin: 0, lineHeight: 1.2 }}>
          Pipeline Mechanics
        </h1>
        <p style={{ fontSize: 13, color: colors.textMuted, margin: '4px 0 0' }}>
          Stage benchmarks, funnel health, and winning patterns
        </p>
      </div>

      {/* Tab bar + scope filter row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <div style={{
          display: 'flex',
          gap: 2,
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          padding: 4,
          width: 'fit-content',
        }}>
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setTab(tab.id)}
              style={{
                padding: '6px 18px',
                borderRadius: 7,
                border: 'none',
                fontSize: 13,
                fontFamily: fonts.sans,
                fontWeight: activeTab === tab.id ? 600 : 400,
                background: activeTab === tab.id ? colors.accentSoft : 'transparent',
                color: activeTab === tab.id ? colors.accent : colors.textMuted,
                cursor: 'pointer',
                transition: 'all 0.15s',
                outline: 'none',
                whiteSpace: 'nowrap' as const,
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Pipeline filter — shown when workspace has multiple CRM pipelines */}
        {pipelines.length > 1 && (
          <div style={{
            display: 'flex',
            gap: 2,
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            padding: 3,
            flexWrap: 'wrap',
          }}>
            <button onClick={() => setActivePipeline(null)} style={scopeButtonStyle(activePipeline === null)}>
              All
            </button>
            {pipelines.map(p => (
              <button key={p.id} onClick={() => setActivePipeline(p.id)} style={scopeButtonStyle(activePipeline === p.id)}>
                {p.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tab content */}
      <SectionErrorBoundary fallbackMessage="Unable to load this view.">
        {activeTab === 'stage-velocity' && (
          <BenchmarksGrid hideHeader pipelineOverride={activePipeline ?? 'all'} />
        )}
        {activeTab === 'pipeline-history' && (
          <PipelineHistoryTab pipeline={activePipeline} />
        )}
        {activeTab === 'winning-paths' && (
          <WinningPathsTab scopeId={activePipeline} />
        )}
      </SectionErrorBoundary>
    </div>
  );
}

// ── Pipeline History Tab ──────────────────────────────────────────────────────

function PipelineHistoryTab({ pipeline }: { pipeline: string | null }) {
  const [activePeriod, setActivePeriod] = useState<number | 'ytd'>(90);
  const [showRaw, setShowRaw] = useState(false);
  const [sankeyData, setSankeyData] = useState<SankeyChartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSankey = useCallback(async (
    period: number | 'ytd',
    activePipeline: string | null = null,
    raw = false,
  ) => {
    setLoading(true);
    setError(null);
    try {
      const days = resolveDays(period);
      let url = `/analysis/sankey?periodDays=${days}`;
      if (activePipeline) url += `&pipeline=${encodeURIComponent(activePipeline)}`;
      if (raw) url += `&raw=true`;
      const data = await api.get(url) as SankeyChartData;
      setSankeyData(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load funnel data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSankey(activePeriod, pipeline, showRaw);
  }, [pipeline]);

  function handlePeriod(preset: number | 'ytd') {
    setActivePeriod(preset);
    fetchSankey(preset, pipeline, showRaw);
  }

  function handleRawToggle(isRaw: boolean) {
    setShowRaw(isRaw);
    fetchSankey(activePeriod, pipeline, isRaw);
  }

  return (
    <div>
      {/* Controls row */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginBottom: 16,
        flexWrap: 'wrap',
      }}>
        {/* Period presets */}
        <div style={{
          display: 'flex',
          gap: 2,
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 3,
        }}>
          {PERIOD_PRESETS.map(p => (
            <button
              key={String(p.days)}
              onClick={() => handlePeriod(p.days)}
              style={{
                padding: '4px 12px',
                borderRadius: 5,
                border: 'none',
                fontSize: 12,
                fontFamily: fonts.sans,
                fontWeight: activePeriod === p.days ? 600 : 400,
                background: activePeriod === p.days ? colors.accentSoft : 'transparent',
                color: activePeriod === p.days ? colors.accent : colors.textMuted,
                cursor: 'pointer',
                transition: 'all 0.12s',
                outline: 'none',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Normalized / Deal Stages toggle — always shown; Deal Stages refetches raw data */}
        <div style={{
          display: 'flex',
          gap: 2,
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 3,
        }}>
          {(['Normalized', 'Deal Stages'] as const).map(option => {
            const isRaw = option === 'Deal Stages';
            const active = showRaw === isRaw;
            return (
              <button
                key={option}
                onClick={() => handleRawToggle(isRaw)}
                style={{
                  padding: '4px 12px',
                  borderRadius: 5,
                  border: 'none',
                  fontSize: 12,
                  fontFamily: fonts.sans,
                  fontWeight: active ? 600 : 400,
                  background: active ? `${colors.accent}18` : 'transparent',
                  color: active ? colors.accent : colors.textMuted,
                  cursor: 'pointer',
                  transition: 'all 0.12s',
                  outline: 'none',
                }}
              >
                {option}
              </button>
            );
          })}
        </div>

      </div>

      {/* Chart */}
      {error ? (
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 12,
          padding: 32,
          textAlign: 'center',
          color: colors.textMuted,
          fontSize: 13,
        }}>
          {error}
        </div>
      ) : loading && !sankeyData ? (
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
        <SankeyChart data={sankeyData} hideFilters showRaw={showRaw} />
      ) : null}
    </div>
  );
}

// ── Winning Paths Tab ─────────────────────────────────────────────────────────

function WinningPathsTab({ scopeId }: { scopeId: string | null }) {
  const [pathsData, setPathsData] = useState<WinningPathsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const url = scopeId ? `/analysis/winning-paths?scopeId=${encodeURIComponent(scopeId)}` : '/analysis/winning-paths';
    api.get(url)
      .then((data: any) => { if (!cancelled) setPathsData(data as WinningPathsData); })
      .catch((err: any) => { if (!cancelled) setError(err.message || 'Failed to load winning paths'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scopeId]);

  if (error) {
    return (
      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 12,
        padding: 32,
        textAlign: 'center',
        color: colors.textMuted,
        fontSize: 13,
      }}>
        {error}
      </div>
    );
  }

  if (loading && !pathsData) {
    return (
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
    );
  }

  return (
    <WinningPathsChart
      data={pathsData}
      onDataChange={setPathsData}
    />
  );
}
