import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  tte_forecast: number | null;
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
  isFuture?: boolean;
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
  const [pipelines, setPipelines] = useState<{id: string; name: string}[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState<string>('all');
  const [allActiveTargets, setAllActiveTargets] = useState<any[]>([]);
  const [runningForecast, setRunningForecast] = useState(false);
  const [forecastRunStatus, setForecastRunStatus] = useState<string | null>(null);
  const autoTriggeredRef = useRef(false);

  // Pipeline+quarter-scoped MC results — fetched separately from global snapshot MC
  const [pipelineMc, setPipelineMc] = useState<{
    p50: number; p25: number; p75: number; p10: number; p90: number;
  } | null>(null);
  const [runningMc, setRunningMc] = useState(false);
  const [mcRunStatus, setMcRunStatus] = useState<string | null>(null);

  // New historical series data
  const [stageWeightedData, setStageWeightedData] = useState<any>(null);
  const [categoryWeightedData, setCategoryWeightedData] = useState<any>(null);
  const [tteData, setTteData] = useState<any>(null);
  const [seriesLoading, setSeriesLoading] = useState(false);

  // Sales roster for filtering reps
  const [roster, setRoster] = useState<any[]>([]);

  const { annotations, grouped, dismiss, snooze} = useForecastAnnotations(wsId);

  // Fetch sales roster
  useEffect(() => {
    if (!wsId) return;
    api.get('/sales-reps/roster')
      .then((data: any) => {
        setRoster(data.reps || []);
      })
      .catch(() => {
        setRoster([]);
      });
  }, [wsId]);

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

  // Load historical forecast series
  useEffect(() => {
    if (!wsId) return;

    // Calculate current quarter
    const now = new Date();
    const fyMonth = fiscalYearStartMonth - 1;
    const adjustedMonth = (now.getMonth() - fyMonth + 12) % 12;
    const fiscalQuarter = Math.floor(adjustedMonth / 3) + 1;
    const quarter = `${now.getFullYear()}-Q${fiscalQuarter}`;

    setSeriesLoading(true);

    // Build query params
    const pipelineParam = selectedPipeline !== 'all' ? `&pipeline=${encodeURIComponent(selectedPipeline)}` : '';

    // Fetch all three series - use Promise.allSettled for resilience
    Promise.allSettled([
      api.get(`/forecast/stage-weighted-series?quarter=${quarter}${pipelineParam}`),
      api.get(`/forecast/category-weighted-series?quarter=${quarter}${pipelineParam}`),
      api.get(`/forecast/tte-series?quarter=${quarter}${pipelineParam}`),
    ])
      .then((results) => {
        // Handle each result independently
        const [stageResult, categoryResult, tteResult] = results;

        if (stageResult.status === 'fulfilled') {
          console.log('[ForecastPage] Stage Weighted Data:', stageResult.value);
          setStageWeightedData(stageResult.value);
        } else {
          console.error('[ForecastPage] Stage Weighted failed:', stageResult.reason);
          setStageWeightedData(null);
        }

        if (categoryResult.status === 'fulfilled') {
          console.log('[ForecastPage] Category Weighted Data:', categoryResult.value);
          setCategoryWeightedData(categoryResult.value);
        } else {
          console.error('[ForecastPage] Category Weighted failed:', categoryResult.reason);
          setCategoryWeightedData(null);
        }

        if (tteResult.status === 'fulfilled') {
          console.log('[ForecastPage] TTE Data:', tteResult.value);
          setTteData(tteResult.value);
        } else {
          console.error('[ForecastPage] TTE failed:', tteResult.reason);
          setTteData(null);
        }
      })
      .finally(() => setSeriesLoading(false));
  }, [wsId, fiscalYearStartMonth, selectedPipeline]);

  // Auto-trigger forecast run when data is missing or stale (>8 days since last snapshot)
  useEffect(() => {
    if (loading || autoTriggeredRef.current || runningForecast || !wsId) return;
    const isStale = snapshots.length === 0 ||
      ((Date.now() - new Date(snapshots[snapshots.length - 1].snapshot_date).getTime()) > 8 * 24 * 60 * 60 * 1000);
    if (isStale) {
      autoTriggeredRef.current = true;
      runForecastSkills();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, wsId]);

  // Fetch pipelines list once
  useEffect(() => {
    if (!wsId) return;
    api.get('/deals/pipelines')
      .then((data: any) => {
        const raw = Array.isArray(data) ? data : data.data || [];
        const list = raw.filter((s: any) => s && s.id && s.name);
        setPipelines(list);
      })
      .catch(() => {});
  }, [wsId]);

  // Fetch current-period targets — store all rows so quota can be derived per-pipeline reactively
  useEffect(() => {
    if (!wsId) return;
    api.get('/targets?active_only=true')
      .then((data: any) => {
        const rows: any[] = data.targets || data.data || [];
        if (rows.length === 0) return;
        const today = new Date().toISOString().slice(0, 10);
        const current = rows.filter((r: any) =>
          r.is_active !== false &&
          (!r.metric || r.metric === 'arr' || r.metric === 'revenue') &&
          r.period_start <= today &&
          r.period_end >= today
        );
        // Fall back to most-recent active targets if none cover today
        if (current.length === 0) {
          const sorted = [...rows].sort((a, b) => b.period_start.localeCompare(a.period_start));
          setAllActiveTargets(sorted.slice(0, 5));
        } else {
          setAllActiveTargets(current);
        }
      })
      .catch(() => {});
  }, [wsId]);

  // Fetch deals for Show the Math and live snapshot; re-fetch when pipeline filter changes
  useEffect(() => {
    if (!wsId) return;
    setDealsLoading(true);
    const qs = selectedPipeline !== 'all' ? `?scopeId=${encodeURIComponent(selectedPipeline)}&limit=2000` : '?limit=2000';
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

  // Derive quota from state — plain variable, no hook, recalculates on every render
  const liveQuota: number | null = (() => {
    if (allActiveTargets.length === 0) return null;
    if (selectedPipeline !== 'all') {
      const pipelineTargets = allActiveTargets.filter(
        (r: any) => r.pipeline_name && r.pipeline_name === selectedPipeline && !r.assigned_to_email && !r.assigned_to_user_id
      );
      if (pipelineTargets.length > 0) {
        const total = pipelineTargets.reduce((sum: number, r: any) => sum + (Number(r.amount) || 0), 0);
        if (total > 0) return total;
      }
    }
    const companyLevel = allActiveTargets.filter(
      (r: any) => !r.assigned_to_email && !r.assigned_to_user_id && !r.pipeline_name
    );
    const toSum = companyLevel.length > 0 ? companyLevel : allActiveTargets;
    const total = toSum.reduce((sum: number, r: any) => sum + (Number(r.amount) || 0), 0);
    return total > 0 ? total : null;
  })();

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
      tte_forecast: null,
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

  // Quarter-level time series built entirely from deal data (filtered by pipeline).
  // 13 Monday-aligned weekly buckets for the current fiscal quarter.
  // This is the single source of truth for the chart, pipe gen bars, and pipe_gen metric card.
  const quarterSeries = useMemo((): SnapshotData[] => {
    const now = new Date();
    const fyMonth = fiscalYearStartMonth - 1;
    const adjustedMonth = (now.getMonth() - fyMonth + 12) % 12;
    const fiscalQuarter = Math.floor(adjustedMonth / 3) + 1;
    const fiscalQStart = new Date(now.getFullYear(), fyMonth + (fiscalQuarter - 1) * 3, 1);
    if (fiscalQStart > now) fiscalQStart.setFullYear(fiscalQStart.getFullYear() - 1);

    // Find the Monday on or before fiscalQStart for weekly alignment
    const fyStartDay = fiscalQStart.getDay();
    const daysBack = fyStartDay === 0 ? 6 : fyStartDay - 1;
    const quarterMonday = new Date(fiscalQStart);
    quarterMonday.setDate(fiscalQStart.getDate() - daysBack);
    quarterMonday.setHours(0, 0, 0, 0);

    // Pre-parse deal fields once for performance
    const parsedDeals = deals.map(d => ({
      d,
      amt: typeof (d as any).amount === 'string' ? parseFloat((d as any).amount) || 0 : ((d as any).amount || 0),
      closeDate: d.close_date ? new Date(d.close_date) : null,
      createdAt: (d as any).created_at
        ? new Date((d as any).created_at)
        : (d as any).created_date ? new Date((d as any).created_date) : null,
    }));

    let runningClosedWon = 0;
    const series: SnapshotData[] = [];

    for (let w = 0; w < 13; w++) {
      const weekStart = new Date(quarterMonday);
      weekStart.setDate(quarterMonday.getDate() + w * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);

      const isCurrentWeek = weekStart <= now && now <= weekEnd;

      let weekClosedWon = 0;
      let weekPipeGen = 0;
      let currentWeekPipeline = 0;
      let currentWeekStageWeighted = 0;

      for (const { d, amt, closeDate, createdAt } of parsedDeals) {
        // Closed won this week: close_date in [weekStart, weekEnd] AND >= fiscalQStart
        if (d.stage_normalized === 'closed_won' && closeDate) {
          if (closeDate >= weekStart && closeDate <= weekEnd && closeDate >= fiscalQStart) {
            weekClosedWon += amt;
          }
        }
        // Pipe gen: deals created in this week AND on/after the fiscal quarter start
        if (createdAt && createdAt >= weekStart && createdAt <= weekEnd && createdAt >= fiscalQStart) {
          weekPipeGen += amt;
        }
        // Open pipeline & stage weighted — only needed for current week
        if (isCurrentWeek && d.stage_normalized !== 'closed_won' && d.stage_normalized !== 'closed_lost') {
          currentWeekPipeline += amt;
          const prob = d.probability > 1 ? d.probability / 100 : (d.probability > 0 ? d.probability : 0.3);
          currentWeekStageWeighted += amt * prob;
        }
      }

      runningClosedWon += weekClosedWon;

      // Overlay MC data from any real snapshot that falls in this week
      const matchSnap = weeklySnapshots.find(s => {
        const sd = new Date(s.snapshot_date);
        return sd >= weekStart && sd <= weekEnd;
      });

      // Get data from new series endpoints - match by week date overlap, not array index
      // Backend uses Saturday week-endings, frontend uses Monday-Sunday weeks
      const findSeriesWeek = (seriesData: any) => {
        if (!seriesData?.series) return null;
        return seriesData.series.find((s: any) => {
          const seriesWeekEnd = new Date(s.weekEnding);
          // Check if the series week-ending falls within this frontend week
          return seriesWeekEnd >= weekStart && seriesWeekEnd <= weekEnd;
        });
      };

      const stageWeek = findSeriesWeek(stageWeightedData);
      const categoryWeek = findSeriesWeek(categoryWeightedData);
      const tteWeek = findSeriesWeek(tteData);

      if (w === 0) {
        console.log('[QuarterSeries] Week 0 data:', {
          weekStart: weekStart.toISOString(),
          weekEnd: weekEnd.toISOString(),
          stageWeek,
          categoryWeek,
          tteWeek,
          totalSeriesLength: stageWeightedData?.series?.length,
        });
      }

      // Fallback: if series data is null and this is current week, use live calculation
      const stageWeightedValue = stageWeek?.stageWeighted ??
        (isCurrentWeek ? (runningClosedWon + currentWeekStageWeighted) : null);

      series.push({
        run_id: isCurrentWeek ? 'live-today' : `week-${w + 1}`,
        snapshot_date: isCurrentWeek ? now.toISOString() : weekStart.toISOString(),
        scope_id: selectedPipeline !== 'all' ? selectedPipeline : null,
        // Use historical series data from new endpoints
        stage_weighted_forecast: stageWeightedValue,
        category_weighted_forecast: categoryWeek?.categoryWeighted ?? null,
        tte_forecast: tteWeek?.tteForecast ?? null,
        monte_carlo_p50: matchSnap?.monte_carlo_p50 ?? null,
        monte_carlo_p25: matchSnap?.monte_carlo_p25 ?? null,
        monte_carlo_p75: matchSnap?.monte_carlo_p75 ?? null,
        monte_carlo_p10: matchSnap?.monte_carlo_p10 ?? null,
        monte_carlo_p90: matchSnap?.monte_carlo_p90 ?? null,
        attainment: runningClosedWon,
        quota: liveQuota,
        total_pipeline: isCurrentWeek ? currentWeekPipeline : null,
        weighted_pipeline: isCurrentWeek ? currentWeekStageWeighted : null,
        deal_count: null,
        pipe_gen_this_week: weekPipeGen || null,
        pipe_gen_avg: null,
        coverage_ratio: isCurrentWeek && liveQuota ? currentWeekPipeline / liveQuota : null,
        by_rep: [],
        annotation_count: matchSnap?.annotation_count ?? 0,
        isLive: isCurrentWeek,
        isFuture: weekStart > now,
      });
    }

    return series;
  }, [deals, fiscalYearStartMonth, liveQuota, weeklySnapshots, selectedPipeline, stageWeightedData, categoryWeightedData, tteData]);

  // MC data always comes from the latest real snapshot (skill run)
  // Pipeline-filtered metrics come from liveSnapshot when a specific pipeline is selected
  const latestReal = weeklySnapshots.length > 0 ? weeklySnapshots[weeklySnapshots.length - 1] : null;
  const latest = latestReal ?? liveSnapshot;
  const previous = weeklySnapshots.length > 1 ? weeklySnapshots[weeklySnapshots.length - 2] : null;

  // When a pipeline is selected, use liveSnapshot for pipeline-scoped numbers; fall back to latestReal
  const pipelineMetricSource = (selectedPipeline !== 'all' && liveSnapshot) ? liveSnapshot : latest;
  const quota = pipelineMetricSource?.quota || liveQuota || null;

  const currentMetrics = useMemo(() => {
    if (!pipelineMetricSource && !latestReal) return null;
    const src = pipelineMetricSource;
    const mcSrc = latestReal ?? src;
    // Pipe gen is quarter-to-date: sum all weekly pipe gen from quarterSeries
    const quarterPipeGen = quarterSeries.reduce((sum, w) => sum + (w.pipe_gen_this_week || 0), 0) || undefined;
    // Closed deal count from live deal data
    const now = new Date();
    const fyMonth = fiscalYearStartMonth - 1;
    const adjustedMonth = (now.getMonth() - fyMonth + 12) % 12;
    const fiscalQuarter = Math.floor(adjustedMonth / 3) + 1;
    const fiscalQStart = new Date(now.getFullYear(), fyMonth + (fiscalQuarter - 1) * 3, 1);
    if (fiscalQStart > now) fiscalQStart.setFullYear(fiscalQStart.getFullYear() - 1);
    const fiscalQEnd = new Date(fiscalQStart.getFullYear(), fiscalQStart.getMonth() + 3, 1);
    const closedDealCount = deals.filter(d => {
      if (d.stage_normalized !== 'closed_won') return false;
      const cd = d.close_date ? new Date(d.close_date) : null;
      return cd && cd >= fiscalQStart && cd < fiscalQEnd;
    }).length;
    // When a pipeline is selected and we have a pipeline-scoped MC run, use those values
    // instead of the global snapshot MC (which doesn't reflect the filtered pipeline).
    const mcP50 = (selectedPipeline !== 'all' && pipelineMc) ? pipelineMc.p50 : (mcSrc?.monte_carlo_p50 ?? undefined);
    const mcP25 = (selectedPipeline !== 'all' && pipelineMc) ? pipelineMc.p25 : (mcSrc?.monte_carlo_p25 ?? undefined);
    const mcP75 = (selectedPipeline !== 'all' && pipelineMc) ? pipelineMc.p75 : (mcSrc?.monte_carlo_p75 ?? undefined);

    return {
      snapshot_date: src?.snapshot_date ?? new Date().toISOString(),
      mc_p50: mcP50,
      mc_p25: mcP25,
      mc_p75: mcP75,
      closed_won: src?.attainment ?? undefined,
      closed_deal_count: closedDealCount || undefined,
      pipeline_total: src?.total_pipeline ?? undefined,
      quota: src?.quota ?? liveQuota ?? undefined,
      pipe_gen: quarterPipeGen,
      forecast_weighted: src?.stage_weighted_forecast ?? undefined,
      category_weighted: src?.category_weighted_forecast ?? undefined,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineMetricSource, latestReal, liveQuota, quarterSeries, deals, fiscalYearStartMonth, selectedPipeline, pipelineMc]);

  const previousMetrics = useMemo(() => {
    // When a pipeline is selected the "previous" snapshot is all-pipeline — comparing it against
    // pipeline-filtered current values would produce misleading trend arrows, so we hide it.
    if (selectedPipeline !== 'all') return null;
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
  }, [previous, selectedPipeline]);

  // Rep rows from skill snapshot (all-pipeline, used when no filter is active)
  const snapshotRepRows: RepRow[] = useMemo(() => {
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

  // Rep rows computed from live deal data when a pipeline filter is active
  const dealRepRows: RepRow[] = useMemo(() => {
    if (selectedPipeline === 'all' || deals.length === 0) return [];

    const now = new Date();
    const fyMonth = fiscalYearStartMonth - 1;
    const adjustedMonth = (now.getMonth() - fyMonth + 12) % 12;
    const fiscalQuarter = Math.floor(adjustedMonth / 3) + 1;
    const fiscalQStart = new Date(now.getFullYear(), fyMonth + (fiscalQuarter - 1) * 3, 1);
    if (fiscalQStart > now) fiscalQStart.setFullYear(fiscalQStart.getFullYear() - 1);
    const fiscalQEnd = new Date(fiscalQStart.getFullYear(), fiscalQStart.getMonth() + 3, 1);

    const byOwner = new Map<string, { name: string; email: string; closedWon: number; pipeline: number; stageWeighted: number; dealCount: number }>();

    for (const d of deals) {
      const email = ((d as any).owner_email || (d as any).owner || '').trim().toLowerCase();
      const name = (d as any).owner_name || (d as any).owner || 'Unknown';
      const amt = typeof (d as any).amount === 'string' ? parseFloat((d as any).amount) || 0 : ((d as any).amount || 0);

      // Skip deals without a valid email
      if (!email) continue;

      if (!byOwner.has(email)) byOwner.set(email, { name, email, closedWon: 0, pipeline: 0, stageWeighted: 0, dealCount: 0 });
      const row = byOwner.get(email)!;

      if (d.stage_normalized === 'closed_won') {
        const closeDate = d.close_date ? new Date(d.close_date) : null;
        if (closeDate && closeDate >= fiscalQStart && closeDate < fiscalQEnd) {
          row.closedWon += amt;
          row.dealCount += 1;
        }
      } else if (d.stage_normalized !== 'closed_lost') {
        row.pipeline += amt;
        const prob = d.probability > 1 ? d.probability / 100 : (d.probability > 0 ? d.probability : 0.3);
        row.stageWeighted += amt * prob;
        row.dealCount += 1;
      }
    }

    return Array.from(byOwner.values())
      .filter(r => r.dealCount > 0)
      .map(r => ({
        rep_name: anon.person(r.name),
        rep_email: r.email,
        deals: r.dealCount,
        pipeline: r.pipeline,
        stage_weighted: r.stageWeighted,
        category_weighted: 0,
        mc_p50: 0,
        actual: r.closedWon,
        quota: 0,
      }))
      .sort((a, b) => (b.pipeline + b.actual) - (a.pipeline + a.actual));
  }, [deals, selectedPipeline, fiscalYearStartMonth, anon]);

  // Use deal-derived rows when a pipeline filter is active; fall back to skill snapshot rows
  const repRows: RepRow[] = selectedPipeline !== 'all' ? dealRepRows : snapshotRepRows;

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
    // If the roster is configured, only show reps who are on it and quota_eligible.
    // If roster is empty (not yet set up), fall back to showing all reps so the table
    // is never blank for new workspaces.
    const filtered = roster.length > 0
      ? repRows.filter(r => {
          const rosterEntry = roster.find(rr =>
            rr.rep_email === r.rep_email || rr.rep_name === r.rep_name
          );
          return rosterEntry && rosterEntry.quota_eligible !== false;
        })
      : repRows;

    // Deduplicate by email — keep the row with the larger pipeline value
    const byEmail = new Map<string, RepRow>();
    for (const r of filtered) {
      const key = r.rep_email || r.rep_name;
      const existing = byEmail.get(key);
      if (!existing || r.pipeline > existing.pipeline) {
        byEmail.set(key, r);
      }
    }
    const deduped = Array.from(byEmail.values());

    if (isAdmin) return deduped;
    return deduped.filter(r => r.rep_email === userEmail);
  }, [repRows, roster, isAdmin, userEmail]);

  const weekInfo = useMemo(() => {
    const now = new Date();
    const fyMonth = fiscalYearStartMonth - 1;
    const adjustedMonth = (now.getMonth() - fyMonth + 12) % 12;
    const fiscalQuarter = Math.floor(adjustedMonth / 3) + 1;
    const fiscalQStart = new Date(now.getFullYear(), fyMonth + (fiscalQuarter - 1) * 3, 1);
    if (fiscalQStart > now) fiscalQStart.setFullYear(fiscalQStart.getFullYear() - 1);
    // Last day of the fiscal quarter (day 0 of the next month = last day of current month)
    const fiscalQEnd = new Date(fiscalQStart.getFullYear(), fiscalQStart.getMonth() + 3, 0);
    const quarterEndISO = fiscalQEnd.toISOString().slice(0, 10);
    const daysSinceQStart = Math.floor((now.getTime() - fiscalQStart.getTime()) / (1000 * 60 * 60 * 24));
    const weekNum = Math.min(13, Math.floor(daysSinceQStart / 7) + 1);
    const fyYear = now.getMonth() + 1 >= fiscalYearStartMonth ? now.getFullYear() : now.getFullYear() - 1;
    const fyLabel = fiscalYearStartMonth === 1 ? `${fyYear}` : `FY${fyYear + 1}`;
    return {
      label: `Q${fiscalQuarter} ${fyLabel}`,
      quarterEndISO,
      weekNum,
      totalWeeks: 13,
    };
  }, [fiscalYearStartMonth]);

  const coverageQuarters = useMemo(() => {
    const q = quota || 0;
    const p = pipelineMetricSource?.total_pipeline || 0;
    if (!q && !p) return [];
    return [{ label: weekInfo.label, pipeline: p, quota: q }];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineMetricSource, quota, weekInfo]);

  // Pipe gen bars — derived from quarterSeries so they react to the pipeline filter
  const pipeGenWeeks = useMemo(() => {
    return quarterSeries.map(w => ({
      week_label: new Date(w.snapshot_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      created: w.pipe_gen_this_week || 0,
    }));
  }, [quarterSeries]);

  // Run MC simulation scoped to the selected pipeline + current fiscal quarter.
  // Does NOT re-run forecast-rollup — only the MC step. Used when global data is fresh
  // but no pipeline-specific MC run exists yet.
  const runMcForPipeline = async () => {
    if (!wsId || selectedPipeline === 'all' || runningMc) return;
    setRunningMc(true);
    setMcRunStatus('Starting simulation…');
    try {
      await api.post('/skills/monte-carlo-forecast/run', {
        params: {
          pipelineFilter: selectedPipeline,
          forecastWindowEnd: weekInfo.quarterEndISO,
        },
      });
      setMcRunStatus('Simulation running — checking for results…');
      // Poll every 10s for up to 5 minutes
      const start = Date.now();
      await new Promise<void>((resolve) => {
        const poll = setInterval(async () => {
          try {
            const path = `/monte-carlo/latest?pipeline=${encodeURIComponent(selectedPipeline)}&quarterEnd=${encodeURIComponent(weekInfo.quarterEndISO)}`;
            const res: any = await api.get(path);
            const cc = res?.commandCenter;
            if (cc && typeof cc.p50 === 'number') {
              setPipelineMc({ p50: cc.p50, p25: cc.p25 ?? cc.p50, p75: cc.p75 ?? cc.p50, p10: cc.p10 ?? cc.p50, p90: cc.p90 ?? cc.p50 });
              clearInterval(poll);
              resolve();
            }
          } catch {}
          if (Date.now() - start > 300_000) { clearInterval(poll); resolve(); }
        }, 10_000);
      });
    } catch (err: any) {
      setMcRunStatus(`Failed: ${err?.message ?? 'unknown error'}`);
      setTimeout(() => setMcRunStatus(null), 5000);
    } finally {
      setRunningMc(false);
      setMcRunStatus(null);
    }
  };

  // Fetch pipeline+quarter-scoped MC results whenever the active pipeline or fiscal quarter changes.
  // Falls back silently if no pipeline-specific run exists yet (pipelineMc stays null).
  useEffect(() => {
    if (!wsId || selectedPipeline === 'all') {
      setPipelineMc(null);
      return;
    }
    const { quarterEndISO } = weekInfo;
    const path = `/monte-carlo/latest?pipeline=${encodeURIComponent(selectedPipeline)}&quarterEnd=${encodeURIComponent(quarterEndISO)}`;
    api.get(path)
      .then((res: any) => {
        const cc = res?.commandCenter;
        if (cc && typeof cc.p50 === 'number') {
          setPipelineMc({ p50: cc.p50, p25: cc.p25 ?? cc.p50, p75: cc.p75 ?? cc.p50, p10: cc.p10 ?? cc.p50, p90: cc.p90 ?? cc.p50 });
        } else {
          setPipelineMc(null);
        }
      })
      .catch(() => setPipelineMc(null));
  }, [wsId, selectedPipeline, weekInfo.quarterEndISO]);

  const runForecastSkills = async () => {
    setRunningForecast(true);
    try {
      setForecastRunStatus('Running Forecast Rollup...');
      await api.post('/skills/forecast-rollup/run');
      setForecastRunStatus('Running Monte Carlo Simulation...');
      // Pass pipeline filter and the fiscal quarter end date so the MC run is scoped correctly.
      // When no pipeline is selected this behaves identically to the old global run.
      const mcParams: Record<string, any> = {};
      if (selectedPipeline !== 'all') {
        mcParams.pipelineFilter = selectedPipeline;
        mcParams.forecastWindowEnd = weekInfo.quarterEndISO;
      }
      await api.post('/skills/monte-carlo-forecast/run', Object.keys(mcParams).length ? { params: mcParams } : undefined);
      setForecastRunStatus('Done — reloading forecast data...');
      const data: any = await api.get('/forecast/snapshots?limit=13');
      setSnapshots(data.snapshots || []);
      if (data.fiscal_year_start_month) setFiscalYearStartMonth(data.fiscal_year_start_month);
      // Re-fetch pipeline MC now that a fresh run exists
      if (selectedPipeline !== 'all') {
        const path = `/monte-carlo/latest?pipeline=${encodeURIComponent(selectedPipeline)}&quarterEnd=${encodeURIComponent(weekInfo.quarterEndISO)}`;
        api.get(path)
          .then((res: any) => {
            const cc = res?.commandCenter;
            if (cc && typeof cc.p50 === 'number') {
              setPipelineMc({ p50: cc.p50, p25: cc.p25 ?? cc.p50, p75: cc.p75 ?? cc.p50, p10: cc.p10 ?? cc.p50, p90: cc.p90 ?? cc.p50 });
            }
          })
          .catch(() => {});
      }
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

  const daysSinceLastSnapshot = snapshots.length > 0
    ? Math.floor((Date.now() - new Date(snapshots[snapshots.length - 1].snapshot_date).getTime()) / (1000 * 60 * 60 * 24))
    : null;
  const isStale = snapshots.length === 0 || (daysSinceLastSnapshot !== null && daysSinceLastSnapshot > 8);

  const forecastStatusBanner = (runningForecast || isStale) ? (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      background: runningForecast ? 'rgba(99,102,241,0.08)' : colors.surface,
      border: `1px solid ${runningForecast ? colors.accent : colors.border}`,
      borderRadius: 8,
      padding: '12px 16px',
      flexWrap: 'wrap',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        {runningForecast && (
          <span style={{
            width: 14, height: 14,
            border: `2px solid ${colors.accent}33`,
            borderTopColor: colors.accent,
            borderRadius: '50%',
            display: 'inline-block',
            flexShrink: 0,
            animation: 'pandora-spin 0.8s linear infinite',
          }} />
        )}
        <p style={{ fontSize: 13, color: runningForecast ? colors.accent : colors.textSecondary, fontFamily: fonts.sans, margin: 0 }}>
          {runningForecast
            ? (forecastRunStatus ?? 'Refreshing forecast data...')
            : snapshots.length === 0
              ? 'Pipeline data is live — run forecast skills weekly to enable trend tracking and Monte Carlo simulation.'
              : `Last snapshot was ${daysSinceLastSnapshot} days ago — refreshing forecast data...`}
        </p>
      </div>
      {!runningForecast && (
        <button
          onClick={runForecastSkills}
          style={{
            padding: '5px 14px',
            background: colors.accent,
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 500,
            fontFamily: fonts.sans,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {snapshots.length === 0 ? 'Generate First Forecast ▶' : 'Run Now ▶'}
        </button>
      )}
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
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
          {/* MC trigger — visible when a pipeline is filtered but no scoped MC result exists yet */}
          {selectedPipeline !== 'all' && !pipelineMc && (
            <button
              onClick={runMcForPipeline}
              disabled={runningMc}
              title={`Run Monte Carlo simulation scoped to this pipeline for ${weekInfo.label}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '5px 12px',
                fontSize: 12,
                fontFamily: fonts.sans,
                fontWeight: 500,
                borderRadius: 6,
                border: `1px solid ${colors.purple}`,
                background: runningMc ? 'transparent' : `${colors.purple}18`,
                color: runningMc ? colors.textMuted : colors.purple,
                cursor: runningMc ? 'default' : 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s',
              }}
            >
              {runningMc ? (
                <>
                  <span style={{
                    width: 10, height: 10,
                    border: `1.5px solid ${colors.purple}44`,
                    borderTopColor: colors.purple,
                    borderRadius: '50%',
                    display: 'inline-block',
                    animation: 'pandora-spin 0.8s linear infinite',
                    flexShrink: 0,
                  }} />
                  {mcRunStatus ?? 'Running…'}
                </>
              ) : (
                <>Run MC ▶</>
              )}
            </button>
          )}
          {showViewTabs && (
            <div style={{ display: 'flex', gap: 4 }}>
              <button style={tabStyle(forecastView === 'company')} onClick={() => setForecastView('company')}>Company</button>
              <button style={tabStyle(forecastView === 'reps')} onClick={() => setForecastView('reps')}>By Rep</button>
            </div>
          )}
          <label title="Shows/hides AI-generated risk alerts, forecast annotations, and deal insights overlaid on the chart and rep table" style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: colors.textSecondary, fontFamily: fonts.sans }}>
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

      {forecastStatusBanner}

      {/* Inline MC prompt — shows below metric cards when pipeline is selected but MC data is absent */}
      {selectedPipeline !== 'all' && !pipelineMc && !runningMc && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          padding: '8px 14px',
          background: `${colors.purple}0d`,
          border: `1px solid ${colors.purple}33`,
          borderRadius: 7,
          fontSize: 12,
          fontFamily: fonts.sans,
          color: colors.textMuted,
        }}>
          <span>MC P50 and MC Range require a simulation run scoped to this pipeline.</span>
          <button
            onClick={runMcForPipeline}
            style={{
              padding: '4px 12px',
              fontSize: 11,
              fontFamily: fonts.sans,
              fontWeight: 500,
              borderRadius: 5,
              border: `1px solid ${colors.purple}`,
              background: `${colors.purple}18`,
              color: colors.purple,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            Run simulation ▶
          </button>
        </div>
      )}

      <SectionErrorBoundary fallbackMessage="Failed to load metric cards.">
        <MetricCards
          current={currentMetrics}
          previous={previousMetrics}
          onMetricClick={(metric, value, context) => {
            // For pipe_gen, show all deals created this quarter (QTD)
            if (metric === 'pipe_gen') {
              const nowPg = new Date();
              const fyMonthPg = fiscalYearStartMonth - 1;
              const adjMonthPg = (nowPg.getMonth() - fyMonthPg + 12) % 12;
              const fqPg = Math.floor(adjMonthPg / 3) + 1;
              const qStartPg = new Date(nowPg.getFullYear(), fyMonthPg + (fqPg - 1) * 3, 1);
              if (qStartPg > nowPg) qStartPg.setFullYear(qStartPg.getFullYear() - 1);

              const dealsThisQuarter = deals.filter(d => {
                const createdDate = (d as any).created_at ? new Date((d as any).created_at) : null;
                return createdDate && createdDate >= qStartPg && createdDate <= nowPg;
              });

              context = {
                ...context,
                deals: dealsThisQuarter,
                week_label: 'Quarter to Date',
                week_start: qStartPg.toISOString(),
                week_end: nowPg.toISOString(),
              };
            }
            setMathPanel({ metric, value, context });
          }}
        />
      </SectionErrorBoundary>

      {forecastView === 'company' && (
        <>
          <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: 16, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0, width: isMobile ? '100%' : 'auto' }}>
              <SectionErrorBoundary fallbackMessage="Failed to load forecast chart.">
                <ForecastChart
                  snapshots={quarterSeries}
                  quota={quota}
                  isRefreshing={runningForecast}
                  onPointClick={(snapshot, metric) => {
                    // ForecastChart passes short keys ('stage_weighted') but SnapshotData uses
                    // longer field names ('stage_weighted_forecast'). Map them here.
                    const FIELD_ALIAS: Record<string, string> = {
                      stage_weighted: 'stage_weighted_forecast',
                      category_weighted: 'category_weighted_forecast',
                    };
                    const fieldKey = FIELD_ALIAS[metric] ?? metric;
                    const value = snapshot[fieldKey as keyof typeof snapshot];
                    if (value == null || typeof value !== 'number') return;

                    // Build context based on metric
                    let context: any = {
                      period: fiscalYearStartMonth,
                      quota: liveQuota,
                    };

                    if (metric === 'attainment' || metric === 'closed_won') {
                      // Closed won deals up to this snapshot date
                      const snapshotDate = new Date(snapshot.snapshot_date);
                      const closedDeals = deals.filter(d =>
                        d.stage_normalized === 'closed_won' &&
                        d.close_date &&
                        new Date(d.close_date) <= snapshotDate
                      );
                      context.deals = closedDeals;
                      context.closedWon = value;
                    } else if (metric === 'stage_weighted' || metric === 'tte_forecast' || metric === 'category_weighted') {
                      // Pass all live deals so MathBreakdown can render the deal breakdown table
                      context.deals = deals;
                    }

                    setMathPanel({
                      metric,
                      value,
                      context,
                    });
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
                <PipeGenChart
                  weeks={pipeGenWeeks}
                  subtitle={`${weekInfo.label} · by Week`}
                  onBarClick={(weekIndex, weekData) => {
                    const weekSnapshot = quarterSeries[weekIndex];
                    if (!weekSnapshot) return;

                    // snapshot_date represents the Monday (start of week)
                    const weekStart = new Date(weekSnapshot.snapshot_date);
                    weekStart.setHours(0, 0, 0, 0);
                    const weekEnd = new Date(weekStart);
                    weekEnd.setDate(weekStart.getDate() + 6);  // Add 6 days to get Sunday
                    weekEnd.setHours(23, 59, 59, 999);

                    const dealsInWeek = deals.filter(d => {
                      const createdDate = new Date(d.created_at);
                      return createdDate >= weekStart && createdDate <= weekEnd;
                    });

                    setMathPanel({
                      metric: 'pipe_gen',
                      value: weekData.created,
                      context: {
                        week_label: weekData.week_label,
                        week_start: weekStart.toISOString(),
                        week_end: weekEnd.toISOString(),
                        deals: dealsInWeek,
                      },
                    });
                  }}
                />
              </SectionErrorBoundary>
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
