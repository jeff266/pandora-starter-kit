import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { useWorkspace } from '../context/WorkspaceContext';
import { useForecastAnnotations } from '../hooks/useForecastAnnotations';
import { useDemoMode } from '../contexts/DemoModeContext';
import { useIsMobile } from '../hooks/useIsMobile';
import SectionErrorBoundary from '../components/SectionErrorBoundary';
import {
  MetricCards,
  ForecastChart,
  RepTable,
  CoverageBars,
  PipeGenChart,
  DrillDownPanel,
  ChartInsightsSidebar,
  AnnotationsPanel,
} from '../components/forecast';
import { MathBreakdown } from '../components/forecast/MathBreakdown';
import type { RepRow } from '../components/forecast/RepTable';
import type { MathContext, Deal } from '../lib/forecast-math';

interface SnapshotData {
  run_id: string;
  snapshot_date: string;
  scope_id: string | null;
  stage_weighted_forecast: number | null;
  category_weighted_forecast: number | null;
  monte_carlo_p50: number | null;
  monte_carlo_p25: number | null;
  monte_carlo_p75: number | null;
  monte_carlo_p10: number | null;
  monte_carlo_p90: number | null;
  attainment: number | null;
  quota: number | null;
  total_pipeline: number | null;
  weighted_pipeline: number | null;
  deal_count: number | null;
  pipe_gen_this_week: number | null;
  pipe_gen_avg: number | null;
  coverage_ratio: number | null;
  by_rep: any[];
  annotation_count: number;
  isLive?: boolean;
}

function formatCurrency(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
  return `$${val.toFixed(0)}`;
}

export default function ForecastPage() {
  const { currentWorkspace, user } = useWorkspace();
  const { anon } = useDemoMode();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const wsId = currentWorkspace?.id || '';

  const [snapshots, setSnapshots] = useState<SnapshotData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAI, setShowAI] = useState(true);
  const [forecastView, setForecastView] = useState<'company' | 'reps'>('company');
  const [viewInitialized, setViewInitialized] = useState(false);
  const [drillDown, setDrillDown] = useState<{ open: boolean; title: string; deals: any[] }>({ open: false, title: '', deals: [] });
  const [fiscalYearStartMonth, setFiscalYearStartMonth] = useState(1);
  const [mathPanel, setMathPanel] = useState<{ metric: string; value: number; context: MathContext } | null>(null);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [dealsLoading, setDealsLoading] = useState(true);
  const [pipelines, setPipelines] = useState<string[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState<string>('all');
  const [liveQuota, setLiveQuota] = useState<number | null>(null);
  const [runningForecast, setRunningForecast] = useState(false);
  const [forecastRunStatus, setForecastRunStatus] = useState<string | null>(null);

  const { annotations, grouped, dismiss, snooze } = useForecastAnnotations(wsId);

  useEffect(() => {
    if (!wsId) return;
    setLoading(true);
    api.get('/forecast/snapshots?limit=13')
      .then((data: any) => {
        setSnapshots(data.snapshots || []);
        if (data.fiscal_year_start_month) setFiscalYearStartMonth(data.fiscal_year_start_month);
        setError(null);
      })
      .catch((err: any) => {
        console.error('[ForecastPage] Failed to load snapshots:', err);
        setError('Failed to load forecast data');
      })
      .finally(() => setLoading(false));
  }, [wsId]);

  // Fetch pipelines list once
  useEffect(() => {
    if (!wsId) return;
    api.get('/deals/pipelines')
      .then((data: any) => {
        const list: string[] = Array.isArray(data) ? data : data.data || data.pipelines || [];
        setPipelines(list.filter(Boolean));
      })
      .catch(() => {});
  }, [wsId]);

  // Fetch current-period quota for live snapshot
  useEffect(() => {
    if (!wsId) return;
    api.get('/quotas')
      .then((data: any) => {
        const q = data.period?.teamQuota || data.teamTotal || null;
        setLiveQuota(q > 0 ? q : null);
      })
      .catch(() => {});
  }, [wsId]);

  // Fetch deals for Show the Math and live snapshot; re-fetch when pipeline filter changes
  useEffect(() => {
    if (!wsId) return;
    setDealsLoading(true);
    const qs = selectedPipeline !== 'all' ? `?pipelineName=${encodeURIComponent(selectedPipeline)}&limit=2000` : '?limit=2000';
    api.get(`/deals${qs}`)
      .then((data: any) => {
        const dealList = Array.isArray(data) ? data : data.data || data.deals || [];
        setDeals(dealList);
      })
      .catch((err: any) => {
        console.error('[ForecastPage] Failed to load deals:', err);
      })
      .finally(() => setDealsLoading(false));
  }, [wsId, selectedPipeline]);

  // Deduplicate snapshots by week (keep latest per week)
  const weeklySnapshots = useMemo(() => {
    if (snapshots.length === 0) return [];

    const weekMap = new Map<string, SnapshotData>();
    for (const snap of snapshots) {
      const date = new Date(snap.snapshot_date);
      // Get week key as YYYY-WW format
      const year = date.getFullYear();
      const week = Math.floor((date.getTime() - new Date(year, 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));
      const weekKey = `${year}-${week}`;

      // Keep the latest snapshot for each week
      const existing = weekMap.get(weekKey);
      if (!existing || new Date(snap.snapshot_date) > new Date(existing.snapshot_date)) {
        weekMap.set(weekKey, snap);
      }
    }

    // Sort by date ascending
    return Array.from(weekMap.values()).sort((a, b) =>
      new Date(a.snapshot_date).getTime() - new Date(b.snapshot_date).getTime()
    );
  }, [snapshots]);

  // Build a live synthetic snapshot from current deal data when we lack real snapshots
  const liveSnapshot = useMemo((): SnapshotData | null => {
    if (dealsLoading || deals.length === 0) return null;

    const now = new Date();
    const fyMonth = fiscalYearStartMonth - 1;
    const adjustedMonth = (now.getMonth() - fyMonth + 12) % 12;
    const fiscalQuarter = Math.floor(adjustedMonth / 3) + 1;
    const fiscalQStart = new Date(now.getFullYear(), fyMonth + (fiscalQuarter - 1) * 3, 1);
    if (fiscalQStart > now) fiscalQStart.setFullYear(fiscalQStart.getFullYear() - 1);
    const fiscalQEnd = new Date(fiscalQStart.getFullYear(), fiscalQStart.getMonth() + 3, 1);

    // Pipe gen: deals created since last Monday
    const monday = new Date(now);
    const dayOfWeek = now.getDay();
    monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    monday.setHours(0, 0, 0, 0);

    let closedWon = 0;
    let totalPipeline = 0;
    let stageWeighted = 0;
    let pipeGenThisWeek = 0;

    for (const d of deals) {
      const amt = typeof (d as any).amount === 'string'
        ? parseFloat((d as any).amount) || 0
        : ((d as any).amount || 0);
      if (d.stage_normalized === 'closed_won') {
        const closeDate = d.close_date ? new Date(d.close_date) : null;
        if (closeDate && closeDate >= fiscalQStart && closeDate < fiscalQEnd) {
          closedWon += amt;
        }
      } else if (d.stage_normalized !== 'closed_lost') {
        totalPipeline += amt;
        const prob = d.probability > 1 ? d.probability / 100 : (d.probability > 0 ? d.probability : 0.3);
        stageWeighted += amt * prob;
        const createdAt = (d as any).created_at ? new Date((d as any).created_at) : null;
        if (createdAt && createdAt >= monday) {
          pipeGenThisWeek += amt;
        }
      }
    }

    const openCount = deals.filter(d => !['closed_won', 'closed_lost'].includes(d.stage_normalized)).length;
    const quota = liveQuota;
    const coverageRatio = quota && totalPipeline ? totalPipeline / quota : null;

    return {
      run_id: 'live-today',
      snapshot_date: now.toISOString(),
      scope_id: selectedPipeline !== 'all' ? selectedPipeline : null,
      stage_weighted_forecast: stageWeighted + closedWon,
      category_weighted_forecast: null,
      monte_carlo_p50: null,
      monte_carlo_p25: null,
      monte_carlo_p75: null,
      monte_carlo_p10: null,
      monte_carlo_p90: null,
      attainment: closedWon,
      quota,
      total_pipeline: totalPipeline,
      weighted_pipeline: stageWeighted,
      deal_count: openCount,
      pipe_gen_this_week: pipeGenThisWeek || null,
      pipe_gen_avg: null,
      coverage_ratio: coverageRatio,
      by_rep: [],
      annotation_count: 0,
      isLive: true,
    };
  }, [deals, dealsLoading, fiscalYearStartMonth, liveQuota, selectedPipeline]);

  // Augment weekly snapshots with a live "Today" point when we don't have enough for a trend line
  const augmentedSnapshots = useMemo((): SnapshotData[] => {
    if (weeklySnapshots.length >= 2) return weeklySnapshots;
    if (!liveSnapshot) return weeklySnapshots;
    const todayStr = new Date().toDateString();
    const hasToday = weeklySnapshots.some(s => new Date(s.snapshot_date).toDateString() === todayStr);
    if (hasToday) return weeklySnapshots;
    return [...weeklySnapshots, liveSnapshot];
  }, [weeklySnapshots, liveSnapshot]);

  // MetricCards always reads from real snapshots — live snapshot is chart-only
  const latestReal = weeklySnapshots.length > 0 ? weeklySnapshots[weeklySnapshots.length - 1] : null;
  const latest = latestReal ?? liveSnapshot;
  const previous = weeklySnapshots.length > 1 ? weeklySnapshots[weeklySnapshots.length - 2] : null;
  const quota = latest?.quota || liveQuota || null;

  const currentMetrics = useMemo(() => {
    if (!latest) return null;
    return {
      snapshot_date: latest.snapshot_date,
      mc_p50: latest.monte_carlo_p50 ?? undefined,
      mc_p25: latest.monte_carlo_p25 ?? undefined,
      mc_p75: latest.monte_carlo_p75 ?? undefined,
      closed_won: latest.attainment ?? undefined,
      pipeline_total: latest.total_pipeline ?? undefined,
      quota: latest.quota ?? liveQuota ?? undefined,
      pipe_gen: latest.pipe_gen_this_week ?? liveSnapshot?.pipe_gen_this_week ?? undefined,
      forecast_weighted: latest.stage_weighted_forecast ?? undefined,
      category_weighted: latest.category_weighted_forecast ?? undefined,
    };
  }, [latest, liveQuota, liveSnapshot]);

  const previousMetrics = useMemo(() => {
    if (!previous) return null;
    return {
      snapshot_date: previous.snapshot_date,
      mc_p50: previous.monte_carlo_p50 ?? undefined,
      mc_p25: previous.monte_carlo_p25 ?? undefined,
      mc_p75: previous.monte_carlo_p75 ?? undefined,
      closed_won: previous.attainment ?? undefined,
      pipeline_total: previous.total_pipeline ?? undefined,
      quota: previous.quota ?? undefined,
      pipe_gen: previous.pipe_gen_this_week ?? undefined,
      forecast_weighted: previous.stage_weighted_forecast ?? undefined,
      category_weighted: previous.category_weighted_forecast ?? undefined,
    };
  }, [previous]);

  const repRows: RepRow[] = useMemo(() => {
    if (!latest?.by_rep) return [];
    return latest.by_rep.map((r: any) => ({
      rep_name: anon.person(r.rep_name || r.owner_name || 'Unknown'),
      rep_email: r.rep_email || r.owner_email || '',
      deals: r.deal_count || r.deals || 0,
      pipeline: r.total_pipeline || r.pipeline || 0,
      stage_weighted: r.stage_weighted || 0,
      category_weighted: r.category_weighted || 0,
      mc_p50: r.mc_p50 || 0,
      actual: r.closed_won || r.actual || 0,
      quota: r.quota || 0,
    }));
  }, [latest, anon]);

  const isAdmin = currentWorkspace?.role === 'admin';
  const userEmail = user?.email || '';
  const hasRepRow = repRows.some(r => r.rep_email === userEmail);
  const showViewTabs = repRows.length > 0 && (isAdmin || hasRepRow);

  useEffect(() => {
    if (viewInitialized || repRows.length === 0) return;
    if (isAdmin) {
      setForecastView('company');
    } else if (hasRepRow) {
      setForecastView('reps');
    } else {
      setForecastView('company');
    }
    setViewInitialized(true);
  }, [repRows, isAdmin, hasRepRow, viewInitialized]);

  const visibleRepRows = useMemo(() => {
    if (isAdmin) return repRows;
    return repRows.filter(r => r.rep_email === userEmail);
  }, [repRows, isAdmin, userEmail]);

  const weekInfo = useMemo(() => {
    const now = new Date();
    const fyMonth = fiscalYearStartMonth - 1;
    const adjustedMonth = (now.getMonth() - fyMonth + 12) % 12;
    const fiscalQuarter = Math.floor(adjustedMonth / 3) + 1;
    const fiscalQStart = new Date(now.getFullYear(), fyMonth + (fiscalQuarter - 1) * 3, 1);
    if (fiscalQStart > now) fiscalQStart.setFullYear(fiscalQStart.getFullYear() - 1);
    const daysSinceQStart = Math.floor((now.getTime() - fiscalQStart.getTime()) / (1000 * 60 * 60 * 24));
    const weekNum = Math.min(13, Math.floor(daysSinceQStart / 7) + 1);
    const fyYear = now.getMonth() + 1 >= fiscalYearStartMonth ? now.getFullYear() : now.getFullYear() - 1;
    const fyLabel = fiscalYearStartMonth === 1 ? `${fyYear}` : `FY${fyYear + 1}`;
    return {
      label: `Q${fiscalQuarter} ${fyLabel}`,
      weekNum,
      totalWeeks: 13,
    };
  }, [fiscalYearStartMonth]);

  const coverageQuarters = useMemo(() => {
    const q = latest?.quota || 0;
    const p = latest?.total_pipeline || 0;
    if (!q && !p) return [];
    return [{ label: weekInfo.label, pipeline: p, quota: q }];
  }, [latest, weekInfo]);

  const pipeGenWeeks = useMemo(() => {
    return snapshots.slice(-8).map(s => ({
      week_label: new Date(s.snapshot_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      created: s.pipe_gen_this_week || 0,
    }));
  }, [snapshots]);

  const runForecastSkills = async () => {
    setRunningForecast(true);
    try {
      setForecastRunStatus('Running Forecast Rollup...');
      await api.post('/skills/forecast-rollup/run');
      setForecastRunStatus('Running Monte Carlo Simulation...');
      await api.post('/skills/monte-carlo-forecast/run');
      setForecastRunStatus('Done — reloading forecast data...');
      const data: any = await api.get('/forecast/snapshots?limit=13');
      setSnapshots(data.snapshots || []);
      if (data.fiscal_year_start_month) setFiscalYearStartMonth(data.fiscal_year_start_month);
      setForecastRunStatus(null);
    } catch (err: any) {
      setForecastRunStatus(`Failed: ${err.message}`);
      setTimeout(() => setForecastRunStatus(null), 5000);
    } finally {
      setRunningForecast(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: colors.text, fontFamily: fonts.sans }}>Forecast</h1>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} style={{ flex: 1, height: 80, background: colors.surfaceRaised, borderRadius: 8, animation: 'pulse 1.5s infinite' }} />
          ))}
        </div>
        <div style={{ height: 300, background: colors.surfaceRaised, borderRadius: 10, animation: 'pulse 1.5s infinite' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <p style={{ fontSize: 14, color: colors.red, fontFamily: fonts.sans }}>{error}</p>
        <button
          onClick={() => window.location.reload()}
          style={{ marginTop: 12, padding: '6px 16px', background: colors.accent, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontFamily: fonts.sans }}
        >
          Retry
        </button>
      </div>
    );
  }

  const noSnapshotsBanner = snapshots.length === 0 ? (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 8,
      padding: '10px 16px',
      flexWrap: 'wrap',
    }}>
      <p style={{ fontSize: 12, color: colors.textSecondary, fontFamily: fonts.sans, margin: 0 }}>
        Pipeline data is live — run forecast skills weekly to enable trend tracking.
      </p>
      <button
        onClick={runForecastSkills}
        disabled={runningForecast}
        style={{
          padding: '5px 14px',
          background: runningForecast ? colors.surfaceRaised : colors.accent,
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          cursor: runningForecast ? 'not-allowed' : 'pointer',
          fontSize: 12,
          fontWeight: 500,
          fontFamily: fonts.sans,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          whiteSpace: 'nowrap',
          opacity: runningForecast ? 0.8 : 1,
          flexShrink: 0,
        }}
      >
        {runningForecast && (
          <span style={{
            width: 10, height: 10,
            border: '2px solid rgba(255,255,255,0.3)',
            borderTopColor: '#fff', borderRadius: '50%',
            display: 'inline-block',
            animation: 'pandora-spin 0.8s linear infinite',
          }} />
        )}
        {runningForecast ? (forecastRunStatus ?? 'Running...') : 'Capture First Snapshot ▶'}
      </button>
    </div>
  ) : null;

  const dealRiskPanel = (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 10,
      padding: 16,
    }}>
      <h3 style={{ fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 12, fontFamily: fonts.sans }}>
        Deal Risk Alerts
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {grouped.deals.map(a => (
          <div
            key={a.id}
            style={{
              padding: '10px 12px',
              background: colors.surfaceRaised,
              border: `1px solid ${colors.border}`,
              borderLeft: `3px solid ${a.severity === 'critical' ? colors.red : colors.yellow}`,
              borderRadius: 6,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, color: a.severity === 'critical' ? '#fca5a5' : '#fde68a', fontFamily: fonts.sans }}>
              {a.title}
            </div>
            <div style={{ fontSize: 11, color: colors.textSecondary, marginTop: 4, fontFamily: fonts.sans }}>
              {a.body}
            </div>
            {a.impact && (
              <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 4, fontFamily: fonts.sans }}>
                Impact: {a.impact}
              </div>
            )}
            {a.anchor.type === 'deal' && (
              <button
                onClick={() => navigate(`/deals/${a.anchor.type === 'deal' ? (a.anchor as any).deal_id : ''}`)}
                style={{
                  fontSize: 11,
                  color: colors.accent,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  marginTop: 6,
                  fontFamily: fonts.sans,
                }}
              >
                View deal →
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '5px 14px',
    fontSize: 12,
    fontWeight: 500,
    fontFamily: fonts.sans,
    borderRadius: 6,
    border: `1px solid ${active ? colors.accent : colors.border}`,
    background: active ? colors.accent : 'transparent',
    color: active ? '#fff' : colors.textSecondary,
    cursor: 'pointer',
    transition: 'all 0.15s',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: colors.text, fontFamily: fonts.sans, margin: 0 }}>Forecast</h1>
          <span style={{ fontSize: 12, color: colors.textMuted, fontFamily: fonts.mono }}>
            {weekInfo.label} · Week {weekInfo.weekNum} of {weekInfo.totalWeeks}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {pipelines.length > 0 && (
            <select
              value={selectedPipeline}
              onChange={(e) => setSelectedPipeline(e.target.value)}
              style={{
                padding: '5px 10px',
                fontSize: 12,
                fontFamily: fonts.sans,
                borderRadius: 6,
                border: `1px solid ${selectedPipeline !== 'all' ? colors.accent : colors.border}`,
                background: colors.surface,
                color: selectedPipeline !== 'all' ? colors.accent : colors.textSecondary,
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              <option value="all">All Pipelines</option>
              {pipelines.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          )}
          {showViewTabs && (
            <div style={{ display: 'flex', gap: 4 }}>
              <button style={tabStyle(forecastView === 'company')} onClick={() => setForecastView('company')}>Company</button>
              <button style={tabStyle(forecastView === 'reps')} onClick={() => setForecastView('reps')}>By Rep</button>
            </div>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: colors.textSecondary, fontFamily: fonts.sans }}>
            <span>✨ AI Insights</span>
            <div
              onClick={() => setShowAI(!showAI)}
              style={{
                width: 34,
                height: 18,
                borderRadius: 9,
                background: showAI ? colors.accent : colors.surfaceHover,
                position: 'relative',
                cursor: 'pointer',
                transition: 'background 0.2s',
              }}
            >
              <div style={{
                width: 14,
                height: 14,
                borderRadius: '50%',
                background: '#fff',
                position: 'absolute',
                top: 2,
                left: showAI ? 18 : 2,
                transition: 'left 0.2s',
              }} />
            </div>
          </label>
        </div>
      </div>

      <SectionErrorBoundary fallbackMessage="Failed to load metric cards.">
        <MetricCards
          current={currentMetrics}
          previous={previousMetrics}
          onMetricClick={(metric, value, context) => setMathPanel({ metric, value, context })}
        />
      </SectionErrorBoundary>

      {noSnapshotsBanner}

      {forecastView === 'company' && (
        <>
          <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 16, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0, width: isMobile ? '100%' : 'auto' }}>
              <SectionErrorBoundary fallbackMessage="Failed to load forecast chart.">
                <ForecastChart
                  snapshots={augmentedSnapshots}
                  quota={quota}
                  onPointClick={(snapshot, metric) => {
                    console.log('Chart point clicked:', metric, snapshot.snapshot_date);
                  }}
                />
              </SectionErrorBoundary>
            </div>

            {showAI && grouped.chart.length > 0 && (
              <div style={{ width: isMobile ? '100%' : 300, flexShrink: 0 }}>
                <SectionErrorBoundary fallbackMessage="Failed to load chart insights.">
                  <ChartInsightsSidebar
                    annotations={[...grouped.chart, ...grouped.global]}
                    onDismiss={dismiss}
                    onSnooze={snooze}
                  />
                </SectionErrorBoundary>
              </div>
            )}
          </div>

          {showAI && grouped.deals.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
              {dealRiskPanel}
            </div>
          )}
        </>
      )}

      {forecastView === 'reps' && visibleRepRows.length > 0 && (
        <>
          <SectionErrorBoundary fallbackMessage="Failed to load rep table.">
            <RepTable
              reps={visibleRepRows}
              annotations={showAI ? grouped.reps : []}
            />
          </SectionErrorBoundary>
          {showAI && grouped.deals.length > 0 && dealRiskPanel}
        </>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
        {coverageQuarters.length > 0 && (
          <SectionErrorBoundary fallbackMessage="Failed to load coverage bars.">
            <CoverageBars
              quarters={coverageQuarters}
              annotations={showAI ? grouped.coverage : []}
            />
          </SectionErrorBoundary>
        )}

        {pipeGenWeeks.length > 0 && (
          <SectionErrorBoundary fallbackMessage="Failed to load pipe gen chart.">
            <PipeGenChart weeks={pipeGenWeeks} />
          </SectionErrorBoundary>
        )}
      </div>

      {showAI && annotations.length > 0 && grouped.chart.length === 0 && grouped.deals.length === 0 && (
        <SectionErrorBoundary fallbackMessage="Failed to load annotations.">
          <AnnotationsPanel
            workspaceId={wsId}
            defaultExpanded={true}
            showToggle={true}
          />
        </SectionErrorBoundary>
      )}

      <DrillDownPanel
        open={drillDown.open}
        onClose={() => setDrillDown({ open: false, title: '', deals: [] })}
        title={drillDown.title}
        deals={drillDown.deals}
        onDealClick={(dealId) => navigate(`/deals/${dealId}`)}
      />

      {mathPanel && (
        <MathBreakdown
          metric={mathPanel.metric}
          value={mathPanel.value}
          context={mathPanel.context}
          deals={deals}
          workspaceId={wsId}
          onClose={() => setMathPanel(null)}
        />
      )}
    </div>
  );
}
