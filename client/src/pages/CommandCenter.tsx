import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { formatCurrency, formatNumber, formatPercent, formatTimeAgo, severityColor } from '../lib/format';
import Skeleton, { SkeletonCard } from '../components/Skeleton';
import { SeverityDot } from '../components/shared';
import QuotaBanner from '../components/QuotaBanner';
import { useWorkspace } from '../context/WorkspaceContext';
import SectionErrorBoundary from '../components/SectionErrorBoundary';
import MonteCarloPanel from '../components/MonteCarloPanel';
import { useDemoMode } from '../contexts/DemoModeContext';
import { useLens } from '../contexts/LensContext';
import { useIsMobile } from '../hooks/useIsMobile';
import { useDashboardPreferences } from '../hooks/useDashboardPreferences';
import {
  CollapsibleSection,
  DashboardHeader,
  MetricsRow,
  PipelineChart,
  ActionsWidget,
  SignalsWidget,
  FindingsFeed,
} from '../components/dashboard';
import CompactAlerts from '../components/command-center/CompactAlerts';
import AnnotatedPipelineChart from '../components/command-center/AnnotatedPipelineChart';
import ConnectorStatusStrip from '../components/command-center/ConnectorStatusStrip';

interface FindingAssumption {
  label: string;
  config_path: string;
  current_value: string | number | string[] | null;
  correctable: boolean;
  correction_prompt: string | null;
  correction_value: string | number | string[] | null;
}

interface Finding {
  id: string;
  severity: string;
  message: string;
  skill_id: string;
  skill_name?: string;
  deal_id?: string;
  deal_name?: string;
  account_name?: string;
  owner_email?: string;
  owner_name?: string;
  found_at: string;
  status: string;
  assumptions?: FindingAssumption[];
}

interface PipelineStage {
  stage: string;
  stage_normalized: string;
  deal_count: number;
  total_value: number;
  weighted_value: number;
  probability?: number;
  findings?: {
    act: number;
    watch: number;
    notable: number;
    info: number;
  };
}

interface StageDeal {
  id: string;
  name: string;
  amount?: number;
  owner_name?: string;
  owner_email?: string;
  days_in_stage?: number;
  stage?: string;
}

interface DealSummaryFull {
  id: string;
  name: string;
  owner_name: string;
  owner_email: string;
  amount: number;
  probability: number;
  days_in_stage: number;
  close_date: string;
  forecast_category: string;
  findings: string[];
}

interface SelectedStage {
  stage: string;
  stage_normalized: string;
  deal_count: number;
  total_value: number;
  weighted_value: number;
  deals: DealSummaryFull[];
  deals_total: number;
}

interface ThreadMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
  isThinking?: boolean;
  tokens_used?: number;
}

function PushBanner() {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(() => localStorage.getItem('pandora_push_banner_dismissed') === 'true');
  const [hasRules, setHasRules] = useState<boolean | null>(null);

  useEffect(() => {
    if (dismissed) return;
    api.get('/push/rules').then(d => {
      const rules = d.rules || [];
      setHasRules(rules.some((r: any) => r.is_active));
    }).catch(() => {});
  }, [dismissed]);

  if (dismissed || hasRules === null || hasRules) return null;

  return (
    <div style={{
      background: colors.accentSoft,
      border: `1px solid rgba(59,130,246,0.2)`,
      borderRadius: 8,
      padding: '10px 16px',
      marginBottom: 0,
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      fontFamily: fonts.sans,
      fontSize: 13,
    }}>
      <span style={{ fontSize: 16 }}>{'\uD83D\uDCA1'}</span>
      <span style={{ color: colors.textSecondary }}>
        Push findings to Slack automatically —{' '}
        <span
          onClick={() => navigate('/push')}
          style={{ color: colors.accent, cursor: 'pointer', textDecoration: 'underline' }}
        >
          Set up delivery rules
        </span>
      </span>
      <button
        onClick={() => {
          setDismissed(true);
          localStorage.setItem('pandora_push_banner_dismissed', 'true');
        }}
        style={{
          marginLeft: 'auto',
          background: 'transparent',
          color: colors.textMuted,
          border: 'none',
          fontSize: 16,
          cursor: 'pointer',
          padding: '2px 6px',
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  );
}

export default function CommandCenter() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading, currentWorkspace } = useWorkspace();
  const { anon } = useDemoMode();
  const isMobile = useIsMobile();
  const { activeLens } = useLens();
  const wsId = currentWorkspace?.id || '';
  const { preferences, updatePreferences, updateSection, toggleMetricCard, setTimeRange, setVizMode } = useDashboardPreferences();
  const [pipeline, setPipeline] = useState<any>(null);
  const [summary, setSummary] = useState<any>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [connectorStatus, setConnectorStatus] = useState<any[]>([]);
  const [loading, setLoading] = useState({ pipeline: true, summary: true, findings: true });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [availablePipelines, setAvailablePipelines] = useState<Array<{ name: string; deal_count: number; total_value: number }>>([]);
  const [selectedPipeline, setSelectedPipeline] = useState<string>(() => {
    return localStorage.getItem(`pandora_selected_pipeline_${wsId}`) || 'all';
  });

  const [stageFilter, setStageFilter] = useState<string | null>(null);
  const [stageFilterDealIds, setStageFilterDealIds] = useState<string[]>([]);
  const [stageFilterLoading, setStageFilterLoading] = useState(false);

  const [expandedStage, setExpandedStage] = useState<string | null>(null);
  const [expandedStageDeals, setExpandedStageDeals] = useState<StageDeal[]>([]);
  const [expandedStageLoading, setExpandedStageLoading] = useState(false);

  const [priorPipeline, setPriorPipeline] = useState<any>(null);
  const [findingSeverityFilter, setFindingSeverityFilter] = useState<string>('all');
  const [findingSkillFilter, setFindingSkillFilter] = useState<string>('all');
  const [availableSkills, setAvailableSkills] = useState<Array<{ id: string; name: string }>>([]);

  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [refreshing, setRefreshing] = useState(false);
  const [, setTick] = useState(0);

  const [selectedStageData, setSelectedStageData] = useState<SelectedStage | null>(null);
  const [stageDealsLoading, setStageDealsLoading] = useState(false);
  const [askingAbout, setAskingAbout] = useState<'stage' | DealSummaryFull | null>(null);
  const [activeThread, setActiveThread] = useState<ThreadMessage[] | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [metricBreakdown, setMetricBreakdown] = useState<string | null>(null);
  const [activeMetric, setActiveMetric] = useState<string | null>(null);
  const [greetingData, setGreetingData] = useState<any>(null);

  useEffect(() => {
    const tickInterval = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(tickInterval);
  }, []);

  useEffect(() => {
    setPipeline(null);
    setSummary(null);
    setFindings([]);
    setErrors({});
    setLoading({ pipeline: true, summary: true, findings: true });
    const storedPipeline = localStorage.getItem(`pandora_selected_pipeline_${wsId}`) || 'all';
    setSelectedPipeline(storedPipeline);
  }, [wsId]);

  const fetchPipelines = useCallback(async (): Promise<string> => {
    try {
      const data = await api.get('/pipeline/pipelines');
      const useScopes = data.use_scopes || false;

      if (useScopes) {
        // Response contains scopes - use scope_id for filtering
        const scopes: Array<{ scope_id: string; name: string; deal_count: number }> = data.pipelines || [];
        // Map to the format expected by the dropdown
        const pipelineOptions = scopes.map(s => ({
          name: s.scope_id, // Use scope_id as the value
          display_name: s.name, // Use name for display
          deal_count: s.deal_count,
        }));
        setAvailablePipelines(pipelineOptions as any);

        const stored = localStorage.getItem(`pandora_selected_pipeline_${wsId}`) || 'all';
        if (stored !== 'all' && !scopes.some(s => s.scope_id === stored)) {
          localStorage.setItem(`pandora_selected_pipeline_${wsId}`, 'all');
          setSelectedPipeline('all');
          return 'all';
        }
        setSelectedPipeline(stored);
        return stored;
      } else {
        // Response contains pipeline names - use name for filtering
        const pipelines: Array<{ name: string }> = data.pipelines || [];
        setAvailablePipelines(pipelines.map(p => ({ ...p, deal_count: 0, total_value: 0 })));
        const stored = localStorage.getItem(`pandora_selected_pipeline_${wsId}`) || 'all';
        if (stored !== 'all' && !pipelines.some(p => p.name === stored)) {
          localStorage.setItem(`pandora_selected_pipeline_${wsId}`, 'all');
          setSelectedPipeline('all');
          return 'all';
        }
        setSelectedPipeline(stored);
        return stored;
      }
    } catch {
      return 'all';
    }
  }, [wsId]);

  const fetchData = useCallback(async (pipelineParam?: string, isRefresh?: boolean) => {
    const pFilter = pipelineParam ?? selectedPipeline;
    let pipelineQs = pFilter && pFilter !== 'default' ? `?scopeId=${encodeURIComponent(pFilter)}` : '';

    // Add time_range parameter from dashboard preferences
    const timeRangeParam = preferences?.default_time_range || 'this_week';
    pipelineQs = pipelineQs
      ? `${pipelineQs}&time_range=${timeRangeParam}`
      : `?time_range=${timeRangeParam}`;

    if (isRefresh) {
      setRefreshing(true);
    }

    const load = async (key: string, fetcher: () => Promise<any>, setter: (d: any) => void) => {
      try {
        const data = await fetcher();
        setter(data);
        setErrors(prev => { const n = { ...prev }; delete n[key]; return n; });
      } catch (err: any) {
        setErrors(prev => ({ ...prev, [key]: err.message }));
      } finally {
        if (!isRefresh) {
          setLoading(prev => ({ ...prev, [key]: false }));
        }
      }
    };

    const priorRangeMap: Record<string, string> = {
      this_week: 'last_week',
      this_month: 'last_month',
      this_quarter: 'last_quarter',
    };
    const priorRange = priorRangeMap[timeRangeParam];

    await Promise.all([
      load('pipeline', () => api.get(`/pipeline/snapshot${pipelineQs}`), setPipeline),
      load('summary', () => api.get('/findings/summary'), setSummary),
      load('findings', () => api.get('/findings?status=active&sort=severity&limit=15'), d => {
        const arr = Array.isArray(d) ? d : d.findings || [];
        setFindings(arr);
      }),
      api.get('/connectors/status').then(d => {
        setConnectorStatus(Array.isArray(d) ? d : d.connectors || []);
      }).catch(() => {}),
      api.get('/skills').then(d => {
        const skills = Array.isArray(d) ? d : d.skills || [];
        setAvailableSkills(skills.map((s: any) => ({ id: s.id || s.skill_id, name: s.name || s.display_name || s.id })));
      }).catch(() => {}),
      priorRange
        ? (async () => {
            const priorQs = pipelineQs.includes('?')
              ? pipelineQs.replace(`time_range=${timeRangeParam}`, `time_range=${priorRange}`)
              : `?time_range=${priorRange}`;
            try {
              const prior = await api.get(`/pipeline/snapshot${priorQs}`);
              setPriorPipeline(prior);
            } catch {
              setPriorPipeline(null);
            }
          })()
        : Promise.resolve(setPriorPipeline(null)),
    ]);

    setLastUpdated(new Date());
    setRefreshing(false);
  }, [selectedPipeline, preferences?.default_time_range]);

  const handlePipelineChange = useCallback((value: string) => {
    setSelectedPipeline(value);
    localStorage.setItem(`pandora_selected_pipeline_${wsId}`, value);
    setLoading(prev => ({ ...prev, pipeline: true }));
    fetchData(value);
  }, [fetchData, wsId]);

  useEffect(() => {
    if (!isAuthenticated || authLoading) return;
    // Validate the stored pipeline against this workspace's pipelines BEFORE
    // fetching data — prevents cross-workspace localStorage bleed.
    fetchPipelines().then(validPipeline => fetchData(validPipeline));
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchData(undefined, true);
      }
    }, 300000);
    return () => clearInterval(interval);
  }, [isAuthenticated, authLoading, fetchPipelines, fetchData, wsId, activeLens]);

  useEffect(() => {
    if (!wsId) return;
    api.get(`/briefing/greeting?localHour=${new Date().getHours()}`).then(setGreetingData).catch(() => {});
  }, [wsId]);

  const stageData: PipelineStage[] = pipeline?.by_stage || [];
  const totalPipeline = Number(pipeline?.total_pipeline) || 0;
  const weightedPipeline = Number(pipeline?.weighted_pipeline) || 0;
  const totalActive = summary?.total_active || 0;
  const openDealsCount = Number(pipeline?.total_open_deals ?? pipeline?.total_deals) || 0;
  const actCount = summary?.by_severity?.act || 0;
  const watchCount = summary?.by_severity?.watch || 0;
  const notableCount = summary?.by_severity?.notable || 0;
  const infoCount = summary?.by_severity?.info || 0;
  const winRate = pipeline?.win_rate?.trailing_90d;
  const coverage = pipeline?.coverage?.ratio;

  const byOwner = summary?.by_owner;
  const ownerRows = byOwner
    ? Object.entries(byOwner)
        .map(([owner, counts]: [string, any]) => ({
          owner,
          act: counts?.act || 0,
          watch: counts?.watch || 0,
          total: (counts?.act || 0) + (counts?.watch || 0),
        }))
        .filter(r => r.total > 0)
        .sort((a, b) => b.total - a.total)
        .slice(0, 8)
    : [];

  const handleSnoozeFinding = async (findingId: string, days: number) => {
    try {
      await api.post(`/findings/${findingId}/snooze`, { days });
      setFindings(prev => prev.filter(f => f.id !== findingId));
    } catch {}
  };

  const handleResolveFinding = async (findingId: string) => {
    try {
      await api.patch(`/findings/${findingId}/resolve`, { resolution_method: 'user_dismissed' });
      setFindings(prev => prev.filter(f => f.id !== findingId));
    } catch {}
  };

  const handleBarClick = useCallback(async (data: any) => {
    const d = data?.payload || data;
    const stageName = d?.stage || d?.stage_normalized;
    if (!stageName) return;

    // Keep existing stage filter behavior
    setStageFilter(d?.stage_normalized || stageName);
    setStageFilterLoading(true);

    // New: open drilldown panel
    const stageRow = stageData.find(s =>
      s.stage === stageName ||
      s.stage_normalized === stageName ||
      s.stage === d?.stage ||
      s.stage_normalized === d?.stage_normalized
    );
    setSelectedStageData(null);
    setStageDealsLoading(true);
    setAskingAbout(null);
    setActiveThread(null);

    try {
      const pFilter = selectedPipeline !== 'default' ? `&scopeId=${encodeURIComponent(selectedPipeline)}` : '';
      const result = await api.get(`/pipeline/snapshot?stage=${encodeURIComponent(stageName)}${pFilter}`);
      const dealsForStage = Array.isArray(result.deals) ? result.deals : [];
      setSelectedStageData({
        stage: stageName,
        stage_normalized: d?.stage_normalized || '',
        deal_count: stageRow?.deal_count || dealsForStage.length,
        total_value: stageRow?.total_value || 0,
        weighted_value: stageRow?.weighted_value || 0,
        deals: dealsForStage,
        deals_total: stageRow?.deal_count || dealsForStage.length,
      });

      // existing filter logic
      const dealIds = dealsForStage.map((deal: any) => deal.id);
      setStageFilterDealIds(dealIds);
    } catch {
      setStageFilterDealIds([]);
      if (stageRow) {
        setSelectedStageData({
          stage: stageName,
          stage_normalized: d?.stage_normalized || '',
          deal_count: stageRow.deal_count,
          total_value: stageRow.total_value,
          weighted_value: stageRow.weighted_value,
          deals: [],
          deals_total: stageRow.deal_count,
        });
      }
    } finally {
      setStageDealsLoading(false);
      setStageFilterLoading(false);
    }
  }, [stageData, selectedPipeline]);

  const clearStageFilter = useCallback(() => {
    setStageFilter(null);
    setStageFilterDealIds([]);
  }, []);

  const handleAskPandora = useCallback(async (prompt: string, scopeOverride?: any) => {
    const scope = scopeOverride || (selectedStageData ? {
      type: 'stage',
      stage: selectedStageData.stage,
    } : { type: 'workspace' });

    const newMsg: ThreadMessage = { role: 'user', content: prompt };
    const thinkingMsg: ThreadMessage = { role: 'assistant', content: '', isThinking: true };

    setActiveThread(prev => {
      const history = prev || [];
      return [...history, newMsg, thinkingMsg];
    });
    setThreadLoading(true);

    try {
      const conversationHistory = (activeThread || [])
        .filter(m => !m.isThinking)
        .map(m => ({ role: m.role, content: m.content }));

      const result = await api.post('/analyze', {
        question: prompt,
        scope,
        conversation_history: conversationHistory.length > 0 ? conversationHistory : undefined,
      });

      setActiveThread(prev => {
        if (!prev) return null;
        const withoutThinking = prev.filter(m => !m.isThinking);
        return [...withoutThinking, {
          role: 'assistant',
          content: result.answer || 'No response received.',
          sources: result.evidence_sources || (result.data_consulted ? ['pipeline data'] : []),
          tokens_used: result.tokens_used ?? undefined,
        }];
      });
    } catch (err: any) {
      setActiveThread(prev => {
        if (!prev) return null;
        const withoutThinking = prev.filter(m => !m.isThinking);
        return [...withoutThinking, {
          role: 'assistant',
          content: 'Analysis unavailable — try again.',
        }];
      });
    } finally {
      setThreadLoading(false);
    }
  }, [selectedStageData, activeThread]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (activeThread) { setActiveThread(null); return; }
        if (selectedStageData) { setSelectedStageData(null); setAskingAbout(null); }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [activeThread, selectedStageData]);

  const handleExpandStage = useCallback(async (stageName: string) => {
    if (expandedStage === stageName) {
      setExpandedStage(null);
      setExpandedStageDeals([]);
      return;
    }
    setExpandedStage(stageName);
    setExpandedStageLoading(true);
    try {
      const result = await api.get(`/deals?stage=${encodeURIComponent(stageName)}&limit=10`);
      const deals = Array.isArray(result) ? result : result.deals || [];
      setExpandedStageDeals(deals.map((deal: any) => ({
        id: deal.id,
        name: deal.name || deal.deal_name || 'Untitled Deal',
        amount: deal.amount,
        owner_name: deal.owner_name || deal.owner_email,
        days_in_stage: deal.days_in_stage,
        stage: deal.stage,
      })));
    } catch {
      setExpandedStageDeals([]);
    } finally {
      setExpandedStageLoading(false);
    }
  }, [expandedStage]);

  const handleViewAllFromPanel = useCallback((stageName: string) => {
    setExpandedStage(null);
    setExpandedStageDeals([]);
    handleBarClick({ stage: stageName, stage_normalized: stageName });
  }, [handleBarClick]);

  // Compute trend data from current vs prior period
  const computeTrend = useCallback((current: number | null | undefined, prior: number | null | undefined): {
    trend: number | undefined;
    trend_direction: 'up' | 'down' | 'flat';
  } => {
    if (!current || !prior || prior === 0 || !priorPipeline) return { trend: undefined, trend_direction: 'flat' };
    const delta = ((current - prior) / Math.abs(prior)) * 100;
    const capped = Math.max(-999, Math.min(999, Math.round(delta)));
    return {
      trend: Math.abs(capped),
      trend_direction: capped > 1 ? 'up' : capped < -1 ? 'down' : 'flat',
    };
  }, [priorPipeline]);

  const trendTotalPipeline = computeTrend(pipeline?.total_pipeline, priorPipeline?.total_pipeline);
  const trendWeighted = computeTrend(pipeline?.weighted_pipeline, priorPipeline?.weighted_pipeline);
  const trendCoverage = computeTrend(pipeline?.coverage?.ratio, priorPipeline?.coverage?.ratio);
  const trendWinRate = computeTrend(pipeline?.win_rate?.trailing_90d, priorPipeline?.win_rate?.trailing_90d);
  const trendOpenDeals = computeTrend(pipeline?.total_deals, priorPipeline?.total_deals);

  const stageFilteredFindings = stageFilter && stageFilterDealIds.length > 0
    ? findings.filter(f => f.deal_id && stageFilterDealIds.includes(f.deal_id))
    : stageFilter && !stageFilterLoading
    ? []
    : findings;

  const filteredFindings = stageFilteredFindings
    .filter(f => findingSeverityFilter === 'all' || f.severity === findingSeverityFilter)
    .filter(f => findingSkillFilter === 'all' || f.skill_id === findingSkillFilter);

  const updatedMinAgo = Math.floor((Date.now() - lastUpdated.getTime()) / 60000);
  const updatedText = updatedMinAgo < 1 ? 'Updated just now' : `Updated ${updatedMinAgo}m ago`;

  const expandedStageData = expandedStage ? stageData.find(s => s.stage === expandedStage || s.stage_normalized === expandedStage) : null;
  const expandedStageTotalValue = expandedStageDeals.reduce((sum, d) => sum + (d.amount || 0), 0);

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload as PipelineStage;
    const findingSummaryParts: string[] = [];
    if (d.findings?.act) findingSummaryParts.push(`${d.findings.act} act`);
    if (d.findings?.watch) findingSummaryParts.push(`${d.findings.watch} watch`);
    const findingSummary = findingSummaryParts.length > 0 ? findingSummaryParts.join(', ') : null;

    const handleAskClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      const scope = { type: 'stage' as const, stage: d.stage };
      handleAskPandora(`Tell me about ${d.stage} stage`, scope);
    };

    return (
      <div style={{
        background: colors.surfaceRaised,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: '10px 14px',
        fontSize: 12,
        color: colors.text,
        fontFamily: fonts.sans,
      }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>{d.stage}</div>
        <div style={{ color: colors.textSecondary }}>Deals: <span style={{ fontFamily: fonts.mono, color: colors.text }}>{d.deal_count}</span></div>
        <div style={{ color: colors.textSecondary }}>Total: <span style={{ fontFamily: fonts.mono, color: colors.text }}>{formatCurrency(anon.amount(d.total_value))}</span></div>
        <div style={{ color: colors.textSecondary }}>Weighted: <span style={{ fontFamily: fonts.mono, color: colors.text }}>{formatCurrency(anon.amount(d.weighted_value))}</span></div>
        {findingSummary && (
          <div style={{ marginTop: 4, fontSize: 11, color: colors.yellow }}>
            {findingSummary}
          </div>
        )}
        <button
          onClick={handleAskClick}
          style={{
            marginTop: 8,
            width: '100%',
            fontSize: 11,
            fontWeight: 600,
            color: colors.accent,
            background: colors.accentSoft,
            border: `1px solid ${colors.accent}`,
            borderRadius: 4,
            padding: '4px 8px',
            cursor: 'pointer',
            transition: 'all 0.15s',
            fontFamily: fonts.sans,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = colors.accent;
            e.currentTarget.style.color = '#fff';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = colors.accentSoft;
            e.currentTarget.style.color = colors.accent;
          }}
        >
          Ask Pandora →
        </button>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <QuotaBanner />
      <PushBanner />

      {greetingData && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: colors.surface, border: `1px solid ${colors.border}`,
          borderRadius: 8, padding: '8px 16px', gap: 12, flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: colors.text, whiteSpace: 'nowrap' }}>
              {greetingData.headline}
            </span>
            <span style={{ color: colors.border }}>·</span>
            <span style={{ fontSize: 12, color: colors.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {greetingData.state_summary}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {['Walk me through', 'Week ahead'].map(label => (
              <button
                key={label}
                onClick={() => handleAskPandora(label)}
                style={{
                  padding: '4px 10px', fontSize: 11, fontWeight: 500,
                  border: `1px solid ${colors.border}`, borderRadius: 6,
                  background: 'transparent', color: colors.textSecondary, cursor: 'pointer',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = colors.accent;
                  (e.currentTarget as HTMLButtonElement).style.color = colors.accent;
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = colors.border;
                  (e.currentTarget as HTMLButtonElement).style.color = colors.textSecondary;
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      <DashboardHeader
        timeRange={preferences?.default_time_range || 'this_week'}
        onTimeRangeChange={(range) => setTimeRange(range)}
        lastRefreshed={lastUpdated.toISOString()}
        onRefresh={() => fetchData(undefined, true)}
        loading={refreshing}
      />

      {/* Keep pipeline selector for backwards compatibility */}
      {availablePipelines.length > 1 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: -16 }}>
          <select
            value={selectedPipeline}
            onChange={e => handlePipelineChange(e.target.value)}
            style={{
              fontSize: 12,
              fontFamily: fonts.sans,
              fontWeight: 500,
              color: colors.text,
              background: colors.surfaceRaised,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              padding: '5px 10px',
              outline: 'none',
              cursor: 'pointer',
              minWidth: 140,
            }}
          >
            <option value="all">All Pipelines</option>
            {availablePipelines.map((p: any) => (
              <option key={p.name} value={p.name}>
                {p.display_name || p.name} {p.deal_count != null ? `(${p.deal_count})` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      <SectionErrorBoundary fallbackMessage="Failed to load metrics.">
        <CollapsibleSection
          title="Pipeline Metrics"
          defaultCollapsed={preferences?.sections_config?.metrics?.collapsed || false}
          onToggle={(collapsed) => updateSection('metrics', { collapsed })}
        >
          <MetricsRow
            metrics={{
              total_pipeline: {
                value: totalPipeline || 0,
                deal_count: pipeline?.total_deals || 0,
                trend: trendTotalPipeline.trend,
                trend_direction: trendTotalPipeline.trend_direction,
              },
              weighted_pipeline: {
                value: weightedPipeline || 0,
                trend: trendWeighted.trend,
                trend_direction: trendWeighted.trend_direction,
              },
              coverage_ratio: {
                value: coverage || 0,
                quota: pipeline?.coverage?.quota,
                trend: trendCoverage.trend,
                trend_direction: trendCoverage.trend_direction,
              },
              win_rate: {
                value: winRate || 0,
                period_days: 90,
                trend: trendWinRate.trend,
                trend_direction: trendWinRate.trend_direction,
              },
              open_deals: {
                value: openDealsCount || 0,
                trend: trendOpenDeals.trend,
                trend_direction: trendOpenDeals.trend_direction,
              },
            }}
            evidence={pipeline?.metric_evidence}
            visibleCards={preferences?.metric_cards || {
              total_pipeline: true,
              weighted_pipeline: true,
              coverage_ratio: true,
              win_rate: true,
              open_deals: true,
              monte_carlo_p50: false,
            }}
            onToggleCard={(cardId, visible) => toggleMetricCard(cardId, visible)}
            onShowData={(metricId) => setMetricBreakdown(metricId)}
            loading={authLoading || loading.pipeline || loading.summary}
            activeMetric={activeMetric}
            onMetricToggle={setActiveMetric}
          />
        </CollapsibleSection>
      </SectionErrorBoundary>

      <SectionErrorBoundary fallbackMessage="Failed to load alerts.">
        <CompactAlerts workspaceId={wsId} />
      </SectionErrorBoundary>

      {/* Two-column: Pipeline Chart + Actions/Signals */}
      <SectionErrorBoundary fallbackMessage="Failed to load pipeline chart.">
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : '1fr 340px',
          gap: 16,
          alignItems: 'start',
        }}>
          {/* Left: Pipeline by Stage */}
          <div style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 10,
            padding: 20,
          }}>
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>Pipeline by Stage</h3>
              <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
                {formatCurrency(anon.amount(totalPipeline))} total {'·'} {pipeline?.total_open_deals ?? stageData.reduce((sum, s) => sum + s.deal_count, 0)} deals across {stageData.length} stages
              </p>
            </div>
            {authLoading || loading.pipeline ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={40} />)}
              </div>
            ) : errors.pipeline ? (
              <ErrorInline message={errors.pipeline} onRetry={fetchData} />
            ) : stageData.length === 0 ? (
              <EmptyInline
                message="No pipeline data. Connect a CRM to get started."
                linkText="Go to Connectors"
                onLink={() => navigate('/connectors')}
              />
            ) : (
              <AnnotatedPipelineChart
                stages={stageData}
                findings={findings}
                totalPipeline={totalPipeline}
                onStageClick={(stageNorm, stageName) => handleBarClick({ stage: stageName, stage_normalized: stageNorm })}
                expandedStage={expandedStage}
                expandedStageDeals={expandedStageDeals}
                expandedStageLoading={expandedStageLoading}
                onExpandStage={handleExpandStage}
                onViewAll={handleViewAllFromPanel}
                anon={anon}
              />
            )}
          </div>

          {/* Right: Critical Findings + Skill Activity stacked */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <ActionsWidget
              summary={pipeline?.findings_summary}
              loading={loading.pipeline}
              workspaceId={wsId}
            />
            <SignalsWidget
              summary={pipeline?.skill_activity_summary}
              loading={loading.pipeline}
              workspaceId={wsId}
            />
          </div>
        </div>
      </SectionErrorBoundary>

      <SectionErrorBoundary fallbackMessage="Failed to load forecast panel.">
        <MonteCarloPanel wsId={wsId} activePipeline={selectedPipeline} />
      </SectionErrorBoundary>

      <SectionErrorBoundary fallbackMessage="Failed to load recent findings.">
        <CollapsibleSection
          title="Active Findings"
          defaultCollapsed={preferences?.sections_config?.findings?.collapsed || false}
          onToggle={(collapsed) => updateSection('findings', { collapsed })}
          badge={filteredFindings.length}
        >
          {/* Severity filter pills */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {(['all', 'act', 'watch', 'notable', 'info'] as const).map(sev => {
              const isActive = findingSeverityFilter === sev;
              const label = sev === 'all' ? 'All' : sev === 'act' ? 'Critical' : sev === 'watch' ? 'Warning' : sev === 'notable' ? 'Notable' : 'Info';
              const col = sev === 'all' ? colors.accent : severityColor(sev);
              return (
                <button
                  key={sev}
                  onClick={() => setFindingSeverityFilter(sev)}
                  style={{
                    padding: '3px 10px',
                    borderRadius: 12,
                    fontSize: 11,
                    fontWeight: 600,
                    fontFamily: fonts.sans,
                    cursor: 'pointer',
                    border: `1px solid ${isActive ? col : colors.border}`,
                    background: isActive ? `${col}22` : 'transparent',
                    color: isActive ? col : colors.textMuted,
                    transition: 'all 0.1s',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Skill filter pills */}
          {availableSkills.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              <button
                onClick={() => setFindingSkillFilter('all')}
                style={{
                  padding: '3px 10px',
                  borderRadius: 12,
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: fonts.sans,
                  cursor: 'pointer',
                  border: `1px solid ${findingSkillFilter === 'all' ? colors.accent : colors.border}`,
                  background: findingSkillFilter === 'all' ? colors.accentSoft : 'transparent',
                  color: findingSkillFilter === 'all' ? colors.accent : colors.textMuted,
                  transition: 'all 0.1s',
                }}
              >
                All Skills
              </button>
              {availableSkills.map(skill => {
                const isActive = findingSkillFilter === skill.id;
                return (
                  <button
                    key={skill.id}
                    onClick={() => setFindingSkillFilter(isActive ? 'all' : skill.id)}
                    style={{
                      padding: '3px 10px',
                      borderRadius: 12,
                      fontSize: 11,
                      fontWeight: 600,
                      fontFamily: fonts.sans,
                      cursor: 'pointer',
                      border: `1px solid ${isActive ? colors.accent : colors.border}`,
                      background: isActive ? colors.accentSoft : 'transparent',
                      color: isActive ? colors.accent : colors.textMuted,
                      transition: 'all 0.1s',
                    }}
                  >
                    {skill.name}
                  </button>
                );
              })}
            </div>
          )}

          {stageFilter && (
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: colors.accentSoft,
              border: `1px solid ${colors.accent}`,
              borderRadius: 16,
              padding: '4px 10px',
              marginBottom: 12,
              fontSize: 11,
              color: colors.accent,
              fontWeight: 500,
            }}>
              <span>Stage: {stageFilter}</span>
              <button
                onClick={clearStageFilter}
                style={{ background: 'none', border: 'none', color: colors.accent, cursor: 'pointer', padding: 0, fontSize: 13, lineHeight: 1, fontWeight: 600 }}
              >✕</button>
            </div>
          )}

          {authLoading || loading.findings ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={48} />)}
            </div>
          ) : errors.findings ? (
            <ErrorInline message={errors.findings} onRetry={fetchData} />
          ) : stageFilterLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 16 }}>
              <InlineSpinner />
              <p style={{ fontSize: 12, color: colors.textMuted, textAlign: 'center' }}>Loading filtered findings…</p>
            </div>
          ) : filteredFindings.length === 0 ? (
            <p style={{ fontSize: 12, color: colors.textMuted, textAlign: 'center', padding: 24 }}>
              {findingSeverityFilter !== 'all' || findingSkillFilter !== 'all'
                ? 'No findings match current filters'
                : stageFilter ? `No findings for stage "${stageFilter}"` : 'No active findings'}
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0, maxHeight: 400, overflow: 'auto' }}>
              {filteredFindings.map(f => (
                <FindingRow
                  key={f.id}
                  finding={f}
                  workspaceId={wsId}
                  onSnooze={handleSnoozeFinding}
                  onResolve={handleResolveFinding}
                  onNavigate={navigate}
                />
              ))}
            </div>
          )}
        </CollapsibleSection>
      </SectionErrorBoundary>

      <ConnectorStatusStrip connectors={connectorStatus} />

      {metricBreakdown && (
        <MetricBreakdownModal
          metric={metricBreakdown}
          scopeId={selectedPipeline}
          onClose={() => setMetricBreakdown(null)}
        />
      )}

      {/* Stage Drilldown overlay */}
      {selectedStageData && (
        <>
          <div
            onClick={() => { setSelectedStageData(null); setAskingAbout(null); }}
            style={{
              position: 'fixed', top: 0, left: 0, right: isMobile ? 0 : 680, bottom: 0,
              background: 'rgba(0,0,0,0.3)', zIndex: 99,
            }}
          />
          <StageDrillDownPanel
            stage={selectedStageData}
            loading={stageDealsLoading}
            askingAbout={askingAbout}
            isMobile={isMobile}
            onClose={() => { setSelectedStageData(null); setAskingAbout(null); }}
            onAskAboutStage={() => setAskingAbout(askingAbout === 'stage' ? null : 'stage')}
            onAskAboutDeal={(deal) => setAskingAbout(askingAbout === deal ? null : deal)}
            onAskPandora={handleAskPandora}
          />
        </>
      )}

      {/* Ask Pandora Drawer */}
      {activeThread && (
        <AskPandoraDrawer
          thread={activeThread}
          loading={threadLoading}
          onClose={() => { setActiveThread(null); }}
          onSend={(msg) => handleAskPandora(msg)}
        />
      )}

    </div>
  );
}

// Helper to decode unicode escape sequences in strings (e.g., "\u2640" -> "♀")
function decodeUnicodeEscapes(str: string): string {
  return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, code) =>
    String.fromCharCode(parseInt(code, 16))
  );
}

const FINDING_LABELS_MAP: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  stale_deal: { label: 'Stale', color: '#EF4444', bg: 'rgba(239,68,68,0.12)', icon: '\u23F0' },
  single_thread: { label: 'Single Thread', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)', icon: '\uD83D\uDC64' },
  close_date_risk: { label: 'Close Date Risk', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)', icon: '\uD83D\uDCC5' },
  missing_amount: { label: 'No Amount', color: '#5A6A80', bg: '#151D2E', icon: '\uD83D\uDCB0' },
};

function getPromptSuggestionsForStage(stage: SelectedStage) {
  const base = [
    { label: 'Deep dive', prompt: `What's the risk profile for deals in ${stage.stage}?` },
    { label: 'Velocity', prompt: `How long do deals typically stay in ${stage.stage}? Are any stuck?` },
    { label: 'Forecast impact', prompt: `What's the probability-weighted forecast from ${stage.stage} deals?` },
  ];
  if (stage.deals.some(d => d.findings.includes('stale_deal'))) {
    base.unshift({ label: 'Stale deals', prompt: `Which ${stage.stage} deals are stale and what should we do about them?` });
  }
  if (stage.deals.some(d => d.findings.includes('single_thread'))) {
    base.push({ label: 'Threading', prompt: `Which ${stage.stage} deals are single-threaded? Who else should we engage?` });
  }
  return base;
}

function getDealPromptsForDeal(deal: DealSummaryFull) {
  return [
    { label: 'Full dossier', prompt: `Give me everything you know about the ${deal.name} deal` },
    { label: 'Risk analysis', prompt: `What are the risks on ${deal.name}? Will it close this quarter?` },
    { label: 'Next steps', prompt: `What should the rep do next on ${deal.name}?` },
    { label: 'Call history', prompt: `What did we discuss in recent calls with ${deal.name}?` },
  ];
}

function fmtAmt(n: number) {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`;
  return `$${n}`;
}

function StageDrillDownPanel({
  stage, loading, askingAbout, isMobile, onClose, onAskAboutStage, onAskAboutDeal, onAskPandora
}: {
  stage: SelectedStage;
  loading: boolean;
  askingAbout: 'stage' | DealSummaryFull | null;
  isMobile: boolean;
  onClose: () => void;
  onAskAboutStage: () => void;
  onAskAboutDeal: (deal: DealSummaryFull) => void;
  onAskPandora: (prompt: string, scope?: any) => void;
}) {
  const { anon } = useDemoMode();
  const [sortBy, setSortBy] = useState<'amount' | 'days' | 'probability' | 'risk'>('amount');
  const panelRef = useRef<HTMLDivElement>(null);

  const sorted = [...stage.deals].sort((a, b) => {
    if (sortBy === 'amount') return b.amount - a.amount;
    if (sortBy === 'days') return b.days_in_stage - a.days_in_stage;
    if (sortBy === 'probability') return b.probability - a.probability;
    if (sortBy === 'risk') return b.findings.length - a.findings.length;
    return 0;
  });

  const riskCount = sorted.filter(d => d.findings.length > 0).length;
  const prompts = askingAbout === 'stage' ? getPromptSuggestionsForStage(stage)
    : askingAbout ? getDealPromptsForDeal(askingAbout as DealSummaryFull)
    : null;

  const avgDays = sorted.length > 0 ? Math.round(sorted.reduce((s, d) => s + (d.days_in_stage || 0), 0) / sorted.length) : 0;
  const avgProb = sorted.length > 0 ? Math.round(sorted.reduce((s, d) => s + Number(d.probability || 0), 0) / sorted.length * 100) : 0;

  return (
    <div
      ref={panelRef}
      style={{
        position: 'fixed', top: 0, right: 0, width: isMobile ? '100%' : 680, maxWidth: '100vw', height: '100vh',
        background: '#111827', borderLeft: '1px solid #1E293B',
        zIndex: 100, display: 'flex', flexDirection: 'column',
        boxShadow: '-12px 0 40px rgba(0,0,0,0.5)',
        fontFamily: "'IBM Plex Sans', -apple-system, sans-serif",
      }}
    >
      {/* Header */}
      <div style={{ padding: '20px 24px', borderBottom: '1px solid #1E293B', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
          <div>
            <div style={{ fontSize: 12, color: '#5A6A80', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              Pipeline Drilldown
            </div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#E2E8F0' }}>{anon.text(stage.stage)}</h2>
            <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
              {[
                { label: 'Deals', value: stage.deal_count, color: '#E2E8F0' },
                { label: 'Total', value: fmtAmt(stage.total_value), color: '#E2E8F0' },
                { label: 'Weighted', value: fmtAmt(stage.weighted_value), color: '#3B82F6' },
                { label: 'At Risk', value: riskCount, color: riskCount > 0 ? '#EF4444' : '#5A6A80' },
              ].map(m => (
                <div key={m.label}>
                  <div style={{ fontSize: 10, color: '#5A6A80', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{m.label}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace", color: m.color, marginTop: 2 }}>{m.value}</div>
                </div>
              ))}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#5A6A80', fontSize: 20, cursor: 'pointer', padding: 4 }}>&#x2715;</button>
        </div>

        {/* Sort + Ask Pandora */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['amount', 'days', 'probability', 'risk'] as const).map(s => (
              <button key={s} onClick={() => setSortBy(s)} style={{
                padding: '4px 10px', fontSize: 11, fontWeight: sortBy === s ? 600 : 400,
                fontFamily: "'IBM Plex Sans', sans-serif",
                border: `1px solid ${sortBy === s ? '#3B82F6' : '#1E293B'}`,
                borderRadius: 5,
                background: sortBy === s ? 'rgba(59,130,246,0.12)' : 'transparent',
                color: sortBy === s ? '#3B82F6' : '#8896AB',
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}>{s}</button>
            ))}
          </div>
          {stage.deals.length > 0 && (
            <button
              onClick={onAskAboutStage}
              style={{
                padding: '6px 14px', fontSize: 12, fontWeight: 500,
                background: askingAbout === 'stage' ? '#3B82F6' : 'rgba(59,130,246,0.12)',
                color: askingAbout === 'stage' ? '#fff' : '#3B82F6',
                border: 'none', borderRadius: 6, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.15s',
              }}
            >
              &#x1F4AC; Ask Pandora about {anon.text(stage.stage)}
            </button>
          )}
        </div>
      </div>

      {/* Prompt Suggestions */}
      {prompts && (
        <div style={{
          padding: '12px 24px', borderBottom: '1px solid #1E293B',
          background: 'rgba(59,130,246,0.04)', flexShrink: 0,
        }}>
          <div style={{ fontSize: 11, color: '#5A6A80', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {askingAbout === 'stage' ? `Questions about ${anon.text(stage.stage)}` : `Questions about ${anon.deal((askingAbout as DealSummaryFull).name)}`}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {prompts.map((p, i) => {
              const dealScope = askingAbout !== 'stage' && askingAbout
                ? { type: 'deal', entity_id: (askingAbout as DealSummaryFull).id }
                : { type: 'stage', stage: stage.stage };
              return (
                <button
                  key={i}
                  onClick={() => { onAskPandora(p.prompt, dealScope); }}
                  style={{
                    padding: '8px 14px', fontSize: 12,
                    background: '#151D2E', border: '1px solid #2a3650',
                    borderRadius: 8, color: '#E2E8F0', cursor: 'pointer',
                    transition: 'all 0.15s', textAlign: 'left', lineHeight: 1.4,
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#3B82F6'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(59,130,246,0.12)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#2a3650'; (e.currentTarget as HTMLButtonElement).style.background = '#151D2E'; }}
                >
                  <span style={{ color: '#3B82F6', fontWeight: 600, marginRight: 6 }}>{p.label}:</span>
                  <span style={{ color: '#8896AB' }}>{p.prompt}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Deal List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Column headers */}
        <div style={{
          display: 'grid', gridTemplateColumns: isMobile ? '1fr auto' : '1fr 120px 80px 80px 80px 36px',
          padding: '8px 16px', borderBottom: '1px solid #1E293B',
          position: 'sticky', top: 0, background: '#111827', zIndex: 2,
        }}>
          {([
            { label: 'Deal', sortKey: null },
            { label: 'Category', sortKey: null },
            { label: 'Amount', sortKey: 'amount' as const },
            { label: 'Days', sortKey: 'days' as const },
            { label: 'Prob', sortKey: 'probability' as const },
            { label: '', sortKey: null },
          ] as const).filter(h => isMobile ? (h.label === 'Deal' || h.label === 'Amount') : true).map(h => (
            <div
              key={h.label}
              onClick={() => h.sortKey && setSortBy(h.sortKey)}
              style={{
                fontSize: 10, fontWeight: 600,
                color: h.sortKey && sortBy === h.sortKey ? '#3B82F6' : '#5A6A80',
                textTransform: 'uppercase', letterSpacing: '0.05em',
                textAlign: (h.label === 'Amount' || h.label === 'Days' || h.label === 'Prob') ? 'right' : 'left',
                cursor: h.sortKey ? 'pointer' : 'default',
                transition: 'color 0.15s',
              }}
              onMouseEnter={(e) => h.sortKey && (e.currentTarget.style.color = '#3B82F6')}
              onMouseLeave={(e) => h.sortKey && !h.sortKey || sortBy !== h.sortKey && (e.currentTarget.style.color = '#5A6A80')}
            >{h.label}{h.sortKey && sortBy === h.sortKey ? ' \u2193' : ''}</div>
          ))}
        </div>

        {loading ? (
          <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[1,2,3,4].map(i => (
              <div key={i} style={{ height: 48, borderRadius: 6, background: 'rgba(255,255,255,0.04)', animation: 'pulse 1.5s ease infinite' }} />
            ))}
          </div>
        ) : sorted.length > 0 ? sorted.map((deal, i) => (
          <DrilldownDealRow
            key={deal.id}
            deal={deal}
            isLast={i === sorted.length - 1}
            isAsking={askingAbout === deal}
            isMobile={isMobile}
            onAsk={() => onAskAboutDeal(deal)}
          />
        )) : (
          <div style={{ padding: 40, textAlign: 'center', color: '#5A6A80' }}>
            <div style={{ fontSize: 14, marginBottom: 4 }}>No deal details loaded</div>
            <div style={{ fontSize: 12 }}>Deal-level data for this stage will appear after the next sync</div>
          </div>
        )}
      </div>

      {/* Bottom bar */}
      <div style={{
        padding: '12px 24px', borderTop: '1px solid #1E293B',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: '#151D2E', flexShrink: 0,
      }}>
        <div style={{ fontSize: 12, color: '#5A6A80' }}>
          Showing {sorted.length} of {stage.deals_total} deals
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <span style={{ fontSize: 12, fontFamily: 'IBM Plex Mono, monospace', color: '#8896AB' }}>
            Avg days: <span style={{ color: '#E2E8F0', fontWeight: 600 }}>{avgDays}</span>
          </span>
          <span style={{ fontSize: 12, fontFamily: 'IBM Plex Mono, monospace', color: '#8896AB' }}>
            Avg prob: <span style={{ color: '#E2E8F0', fontWeight: 600 }}>{avgProb}%</span>
          </span>
        </div>
      </div>

      <style>{`@keyframes pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }`}</style>
    </div>
  );
}

function DrilldownDealRow({ deal, isLast, isAsking, isMobile, onAsk }: {
  deal: DealSummaryFull;
  isLast: boolean;
  isAsking: boolean;
  isMobile: boolean;
  onAsk: () => void;
}) {
  const { anon } = useDemoMode();
  const navigate = useNavigate();
  const [hovered, setHovered] = useState(false);
  const daysColor = (deal.days_in_stage || 0) > 30 ? '#EF4444' : (deal.days_in_stage || 0) > 14 ? '#F59E0B' : '#8896AB';
  const prob = Math.round(Number(deal.probability || 0) * 100);
  const probColor = prob > 50 ? '#10B981' : prob > 30 ? '#3B82F6' : '#8896AB';
  const fcLabel = (deal.forecast_category || 'pipeline').replace('_', ' ');
  const fcColor = deal.forecast_category === 'commit' ? '#10B981' : deal.forecast_category === 'best_case' ? '#3B82F6' : '#5A6A80';
  const fcBg = deal.forecast_category === 'commit' ? 'rgba(16,185,129,0.12)' : deal.forecast_category === 'best_case' ? 'rgba(59,130,246,0.12)' : '#151D2E';

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'grid', gridTemplateColumns: isMobile ? '1fr auto' : '1fr 120px 80px 80px 80px 36px',
        alignItems: 'center', padding: '12px 16px',
        borderBottom: isLast ? 'none' : '1px solid #1E293B',
        background: hovered ? 'rgba(59,130,246,0.04)' : 'transparent',
        transition: 'background 0.1s',
        fontFamily: "'IBM Plex Sans', -apple-system, sans-serif",
      }}
    >
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span
            onClick={() => navigate(`/deals/${deal.id}`)}
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: '#E2E8F0',
              cursor: 'pointer',
              textDecoration: hovered ? 'underline' : 'none',
              transition: 'text-decoration 0.1s',
            }}
          >{anon.deal(deal.name)}</span>
          {deal.findings && deal.findings.map(f => {
            const fl = FINDING_LABELS_MAP[f];
            // Show mapped findings with full styling, unknown findings with default styling
            if (fl) {
              return (
                <span key={f} style={{
                  fontSize: 10, fontWeight: 600, fontFamily: 'IBM Plex Mono, monospace',
                  padding: '1px 6px', borderRadius: 3, color: fl.color, background: fl.bg,
                }}>{fl.icon} {fl.label}</span>
              );
            } else {
              // Fallback for unmapped findings - show them with default risk styling
              return (
                <span key={f} style={{
                  fontSize: 10, fontWeight: 600, fontFamily: 'IBM Plex Mono, monospace',
                  padding: '1px 6px', borderRadius: 3,
                  color: '#EF4444', background: 'rgba(239,68,68,0.12)',
                }} title={`Finding: ${f}`}>\u26A0 {decodeUnicodeEscapes(f.replace(/_/g, ' '))}</span>
              );
            }
          })}
        </div>
        <div style={{ fontSize: 11.5, color: '#5A6A80', marginTop: 2 }}>
          {deal.owner_name ? anon.person(deal.owner_name) : deal.owner_email ? anon.email(deal.owner_email) : '--'} &#xB7; Close {deal.close_date ? deal.close_date.split('T')[0] : '\u2014'}
        </div>
      </div>
      {!isMobile && (
        <div>
          <span style={{
            fontSize: 10, fontWeight: 600, fontFamily: 'IBM Plex Mono, monospace',
            padding: '2px 8px', borderRadius: 4, color: fcColor, background: fcBg,
            textTransform: 'uppercase', letterSpacing: '0.03em',
          }}>{fcLabel}</span>
        </div>
      )}
      <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'IBM Plex Mono, monospace', color: '#E2E8F0', textAlign: 'right' }}>
        {fmtAmt(anon.amount(deal.amount || 0))}
      </div>
      {!isMobile && (
        <div style={{ fontSize: 13, fontFamily: 'IBM Plex Mono, monospace', color: daysColor, textAlign: 'right' }}>
          {Math.round(deal.days_in_stage || 0)}d
        </div>
      )}
      {!isMobile && (
        <div style={{ textAlign: 'right' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 36, height: 36, borderRadius: 18,
            background: `conic-gradient(${probColor} ${prob * 3.6}deg, #1E293B 0deg)`,
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: 14, background: '#151D2E',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace', color: '#E2E8F0',
            }}>{prob}</div>
          </div>
        </div>
      )}
      {!isMobile && (
        <div style={{ textAlign: 'center' }}>
          <button
            onClick={(e) => { e.stopPropagation(); onAsk(); }}
            style={{
              width: 28, height: 28, borderRadius: 14,
              background: (hovered || isAsking) ? 'rgba(59,130,246,0.12)' : 'transparent',
              border: `1px solid ${(hovered || isAsking) ? '#3B82F6' : 'transparent'}`,
              color: (hovered || isAsking) ? '#3B82F6' : 'transparent',
              fontSize: 14, cursor: 'pointer', transition: 'all 0.15s',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            title="Ask Pandora about this deal"
          >&#x1F4AC;</button>
        </div>
      )}
    </div>
  );
}

function renderMarkdownLite(text: string) {
  const parts = text.split('\n').map((line, i) => {
    line = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    line = line.replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.08);padding:1px 5px;border-radius:3px;font-family:monospace;font-size:0.9em">$1</code>');
    const isBullet = /^[\-\*\u2022]\s/.test(line);
    const contentLine = isBullet ? line.replace(/^[\-\*\u2022]\s/, '') : line;
    return (
      <p key={i} style={{ margin: '0 0 6px', paddingLeft: isBullet ? 16 : 0, position: 'relative' }}>
        {isBullet && <span style={{ position: 'absolute', left: 0 }}>&bull;</span>}
        <span dangerouslySetInnerHTML={{ __html: contentLine }} />
      </p>
    );
  });
  return <>{parts}</>;
}

function AskPandoraDrawer({ thread, loading, onClose, onSend }: {
  thread: ThreadMessage[];
  loading: boolean;
  onClose: () => void;
  onSend: (msg: string) => void;
}) {
  const [input, setInput] = useState('');
  const threadRef = useRef<HTMLDivElement>(null);
  const lastMsgRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!threadRef.current) return;
    const lastMsg = thread[thread.length - 1];
    if (lastMsg?.isThinking) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    } else if (lastMsg?.role === 'assistant' && lastMsg.content) {
      setTimeout(() => {
        lastMsgRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 30);
    }
  }, [thread]);

  const handleSend = () => {
    const msg = input.trim();
    if (!msg || loading) return;
    setInput('');
    onSend(msg);
  };

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, height: 320,
      background: '#111827', borderTop: '1px solid #3B82F6',
      zIndex: 200, boxShadow: '0 -8px 30px rgba(0,0,0,0.5)',
      display: 'flex', flexDirection: 'column',
      fontFamily: "'IBM Plex Sans', -apple-system, sans-serif",
    }}>
      <div style={{ padding: '14px 24px', borderBottom: '1px solid #1E293B', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16 }}>&#x1F4AC;</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#E2E8F0' }}>Ask Pandora</span>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#5A6A80', fontSize: 18, cursor: 'pointer' }}>&#x2715;</button>
      </div>

      <div ref={threadRef} style={{ padding: '16px 24px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {thread.map((msg, i) => {
          const isLastAssistant = i === thread.length - 1 && msg.role === 'assistant' && !msg.isThinking;
          return (
            <div key={i} ref={isLastAssistant ? lastMsgRef : undefined} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                padding: '10px 16px',
                background: msg.role === 'user' ? 'rgba(59,130,246,0.12)' : '#151D2E',
                borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                maxWidth: '85%', fontSize: 13, color: msg.role === 'user' ? '#E2E8F0' : '#8896AB',
                lineHeight: 1.6,
                border: msg.role === 'assistant' ? '1px solid #1E293B' : 'none',
              }}>
                {msg.isThinking ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {[0,1,2].map(j => (
                        <div key={j} style={{
                          width: 6, height: 6, borderRadius: 3, background: '#3B82F6',
                          animation: `pandoraPulse 1.2s ease-in-out ${j * 0.2}s infinite`,
                          opacity: 0.4,
                        }} />
                      ))}
                    </div>
                    <span style={{ fontSize: 12, color: '#5A6A80' }}>Analyzing pipeline data...</span>
                  </div>
                ) : (
                  <>
                    {msg.role === 'assistant' ? renderMarkdownLite(msg.content) : msg.content}
                    {msg.sources && msg.sources.length > 0 && (
                      <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {msg.sources.map((s, si) => (
                          <span key={si} style={{
                            fontSize: 10, fontFamily: 'IBM Plex Mono, monospace',
                            padding: '2px 6px', borderRadius: 4,
                            background: 'rgba(255,255,255,0.06)', color: '#5A6A80',
                          }}>{s}</span>
                        ))}
                      </div>
                    )}
                    {msg.role === 'assistant' && msg.tokens_used && (
                      <div style={{ marginTop: 6, fontSize: 10, color: '#3B4A5C', fontFamily: 'IBM Plex Mono, monospace' }}>
                        {msg.tokens_used.toLocaleString()} tokens
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ padding: '10px 24px', borderTop: '1px solid #1E293B', display: 'flex', gap: 8 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder="Ask a follow-up..."
          style={{
            flex: 1, padding: '10px 14px', fontSize: 13,
            background: '#151D2E', border: '1px solid #1E293B', borderRadius: 8,
            color: '#E2E8F0', outline: 'none',
            fontFamily: "'IBM Plex Sans', sans-serif",
          }}
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          style={{
            padding: '10px 20px', fontSize: 13, fontWeight: 500,
            background: loading || !input.trim() ? 'rgba(59,130,246,0.3)' : '#3B82F6',
            color: '#fff', border: 'none', borderRadius: 8, cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >Send</button>
      </div>
      <style>{`@keyframes pandoraPulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }`}</style>
    </div>
  );
}


function InlineSpinner() {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 12,
        height: 12,
        border: `2px solid ${colors.border}`,
        borderTopColor: colors.accent,
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
      }}
    />
  );
}

function FindingAssumptionRow({ assumption, findingId, workspaceId }: {
  assumption: FindingAssumption;
  findingId: string;
  workspaceId: string;
}) {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const handleCorrect = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!workspaceId || assumption.correction_value === null) return;
    setStatus('saving');
    try {
      await api.post(`/workspaces/${workspaceId}/config/correct`, {
        config_path: assumption.config_path,
        new_value: assumption.correction_value,
        finding_id: findingId,
      });
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  };

  if (status === 'saved') {
    return (
      <div style={{ fontSize: 11, color: colors.accent, padding: '2px 0' }}>
        ✓ Updated — future analysis will reflect this.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '2px 0' }}>
      <span style={{ fontSize: 11, color: colors.textSecondary }}>· {assumption.label}</span>
      {assumption.correctable && assumption.correction_prompt && assumption.correction_value !== null && (
        <button
          onClick={handleCorrect}
          disabled={status === 'saving'}
          style={{
            fontSize: 11,
            color: status === 'error' ? '#ff8c82' : colors.accent,
            background: 'transparent',
            border: `1px solid ${status === 'error' ? '#ff8c82' : colors.border}`,
            borderRadius: 4,
            padding: '1px 6px',
            cursor: status === 'saving' ? 'not-allowed' : 'pointer',
            flexShrink: 0,
            opacity: status === 'saving' ? 0.5 : 1,
          }}
        >
          {status === 'saving' ? 'Saving...' : status === 'error' ? 'Failed. Try again.' : assumption.correction_prompt}
        </button>
      )}
    </div>
  );
}

function FindingRow({ finding, workspaceId, onSnooze, onResolve, onNavigate }: {
  finding: Finding;
  workspaceId: string;
  onSnooze: (id: string, days: number) => void;
  onResolve: (id: string) => void;
  onNavigate: (path: string) => void;
}) {
  const { anon } = useDemoMode();
  const [showSnooze, setShowSnooze] = useState(false);
  const [showAssumes, setShowAssumes] = useState(false);
  const snoozeRef = useRef<HTMLDivElement>(null);
  const f = finding;
  const hasAssumptions = Array.isArray(f.assumptions) && f.assumptions.length > 0;

  useEffect(() => {
    if (!showSnooze) return;
    const handler = (e: MouseEvent) => {
      if (snoozeRef.current && !snoozeRef.current.contains(e.target as Node)) {
        setShowSnooze(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSnooze]);

  return (
    <div
      style={{
        padding: '10px 0',
        borderBottom: `1px solid ${colors.border}`,
        cursor: f.deal_id ? 'pointer' : 'default',
        position: 'relative',
      }}
      className="finding-row"
      onClick={() => f.deal_id && onNavigate(`/deals/${f.deal_id}`)}
      onMouseEnter={e => {
        e.currentTarget.style.background = colors.surfaceHover;
        const btns = e.currentTarget.querySelector('.finding-actions') as HTMLElement;
        if (btns) btns.style.opacity = '1';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'transparent';
        const btns = e.currentTarget.querySelector('.finding-actions') as HTMLElement;
        if (btns) btns.style.opacity = '0';
        setShowSnooze(false);
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <SeverityDot severity={f.severity as any} size={7} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 13, color: colors.text, lineHeight: 1.4, marginBottom: 4 }}>
            {anon.text(f.message)}
          </p>
          <div style={{ display: 'flex', gap: 12, fontSize: 11, color: colors.textMuted, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 500 }}>{f.skill_name || f.skill_id}</span>
            {f.deal_name && <span style={{ color: colors.accent }}>{anon.deal(f.deal_name)}</span>}
            {f.account_name && <span>{anon.company(f.account_name)}</span>}
            {(f.owner_name || f.owner_email) && <span>{f.owner_name ? anon.person(f.owner_name) : anon.email(f.owner_email!)}</span>}
            <span>{formatTimeAgo(f.found_at)}</span>
            {hasAssumptions && (
              <button
                onClick={e => { e.stopPropagation(); setShowAssumes(a => !a); }}
                style={{
                  fontSize: 10, color: colors.textMuted, background: 'transparent',
                  border: `1px solid ${colors.border}`, borderRadius: 3,
                  padding: '1px 5px', cursor: 'pointer',
                }}
              >
                {showAssumes ? 'Hide assumes' : 'Show assumes'}
              </button>
            )}
          </div>
          {showAssumes && hasAssumptions && (
            <div
              style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${colors.border}` }}
              onClick={e => e.stopPropagation()}
            >
              <div style={{
                fontSize: 10, fontWeight: 700, color: colors.textMuted,
                letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 5,
              }}>
                ASSUMES
              </div>
              {f.assumptions!.map((a, i) => (
                <FindingAssumptionRow
                  key={i}
                  assumption={a}
                  findingId={f.id}
                  workspaceId={workspaceId}
                />
              ))}
            </div>
          )}
        </div>

        <div
          className="finding-actions"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            opacity: 0,
            transition: 'opacity 0.15s',
            flexShrink: 0,
          }}
          onClick={e => e.stopPropagation()}
        >
          <div ref={snoozeRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setShowSnooze(!showSnooze)}
              title="Snooze"
              style={{
                background: 'none',
                border: `1px solid ${colors.border}`,
                borderRadius: 4,
                padding: '3px 6px',
                cursor: 'pointer',
                fontSize: 11,
                color: colors.textSecondary,
                display: 'flex',
                alignItems: 'center',
                gap: 3,
              }}
            >
              💤
            </button>
            {showSnooze && (
              <div style={{
                position: 'absolute',
                right: 0,
                top: '100%',
                marginTop: 4,
                background: colors.surfaceRaised,
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                padding: 4,
                zIndex: 100,
                minWidth: 100,
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              }}>
                {[
                  { label: '1 day', days: 1 },
                  { label: '3 days', days: 3 },
                  { label: '1 week', days: 7 },
                  { label: '2 weeks', days: 14 },
                ].map(opt => (
                  <button
                    key={opt.days}
                    onClick={() => { onSnooze(f.id, opt.days); setShowSnooze(false); }}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '5px 8px',
                      fontSize: 11,
                      color: colors.text,
                      background: 'none',
                      border: 'none',
                      borderRadius: 4,
                      cursor: 'pointer',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => onResolve(f.id)}
            title="Resolve"
            style={{
              background: 'none',
              border: `1px solid ${colors.border}`,
              borderRadius: 4,
              padding: '3px 6px',
              cursor: 'pointer',
              fontSize: 11,
              color: colors.green,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            ✓
          </button>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, color, onClick }: { label: string; value: string; color?: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: 16,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 0.15s',
      }}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.borderColor = colors.accent; }}
      onMouseLeave={e => { if (onClick) e.currentTarget.style.borderColor = colors.border; }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {label}
        {onClick && <span style={{ fontSize: 10, color: colors.textMuted, opacity: 0.6 }}>Click to drill down</span>}
      </div>
      <div style={{
        fontSize: 24, fontWeight: 700, fontFamily: fonts.mono,
        color: color || colors.text, marginTop: 6,
      }}>
        {value}
      </div>
    </div>
  );
}

function MetricBreakdownModal({ metric, scopeId, onClose }: { metric: string; scopeId?: string; onClose: () => void }) {
  const { anon } = useDemoMode();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<string>('amount');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const navigate = useNavigate();

  const handleExportCSV = () => {
    if (!data?.deals?.length) return;

    const isWinRate = metric === 'win_rate';
    const headers = isWinRate
      ? ['Deal ID', 'Deal', 'Owner', 'Amount', 'Stage', 'Outcome', 'Close Date']
      : ['Deal ID', 'Deal', 'Owner', 'Amount', 'Probability', 'Weighted', 'Stage', 'Close Date'];

    const rows = data.deals.map((d: any) => {
      if (isWinRate) {
        return [
          d.id || '',
          d.name,
          d.owner || '',
          d.amount || 0,
          d.stage || '',
          d.outcome || '',
          d.close_date || '',
        ];
      }
      return [
        d.id || '',
        d.name,
        d.owner || '',
        d.amount || 0,
        d.probability || 0,
        d.weighted_amount || 0,
        d.stage || '',
        d.close_date || '',
      ];
    });

    const csvContent = [
      headers.join(','),
      ...(rows as any[][]).map(row => row.map((cell: any) => {
        const str = String(cell);
        // Escape quotes and wrap in quotes if contains comma
        return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
      }).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${metric}_deals_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  useEffect(() => {
    (async () => {
      try {
        const qs = new URLSearchParams({ metric });
        if (scopeId && scopeId !== 'all' && scopeId !== 'default') qs.set('scopeId', scopeId);
        const result = await api.get(`/pipeline/metric-breakdown?${qs}`);
        setData(result);
      } catch (err) {
        console.error('[MetricBreakdown]', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [metric, scopeId]);

  const metricLabels: Record<string, string> = {
    total_pipeline: 'Total Pipeline',
    weighted_pipeline: 'Weighted Pipeline',
    win_rate: 'Win Rate (90 days)',
    coverage: 'Coverage Ratio',
  };

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const sortedDeals = data?.deals ? [...data.deals].sort((a: any, b: any) => {
    let av = a[sortKey], bv = b[sortKey];
    if (typeof av === 'string') av = av.toLowerCase();
    if (typeof bv === 'string') bv = bv.toLowerCase();
    if (av == null) return 1;
    if (bv == null) return -1;
    return sortDir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
  }) : [];

  const isWinRate = metric === 'win_rate';

  const sortHeaderStyle = (field: string): React.CSSProperties => ({
    padding: '8px 12px', textAlign: 'left' as const, fontWeight: 600, fontSize: 11,
    textTransform: 'uppercase' as const, letterSpacing: '0.05em', cursor: 'pointer',
    color: sortKey === field ? colors.accent : '#94a3b8',
    background: 'rgba(30, 41, 59, 0.8)', borderBottom: '1px solid rgba(148, 163, 184, 0.15)',
    whiteSpace: 'nowrap' as const, userSelect: 'none' as const,
  });

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)' }} />
      <div style={{
        position: 'relative', background: colors.bg, border: `1px solid ${colors.border}`,
        borderRadius: 12, width: '90vw', maxWidth: 1000, maxHeight: '85vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
      }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${colors.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: colors.text }}>{metricLabels[metric] || metric}</div>
            {data?.formula && <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>{data.formula}</div>}
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button
              onClick={handleExportCSV}
              disabled={!data?.deals?.length}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: `1px solid ${colors.border}`,
                background: colors.surface,
                color: colors.accent,
                fontSize: 13,
                fontWeight: 500,
                cursor: data?.deals?.length ? 'pointer' : 'not-allowed',
                opacity: data?.deals?.length ? 1 : 0.5,
                fontFamily: fonts.body,
              }}
            >
              Export CSV
            </button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: colors.textMuted, cursor: 'pointer', fontSize: 20, padding: 4 }}>✕</button>
          </div>
        </div>

        {data?.summary && (
          <div style={{ padding: '12px 20px', borderBottom: `1px solid ${colors.border}`, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            {isWinRate ? (
              <>
                <div><span style={{ fontSize: 11, color: colors.textMuted, textTransform: 'uppercase' }}>Won</span><div style={{ fontSize: 20, fontWeight: 700, color: colors.green, fontFamily: fonts.mono }}>{data.summary.won}</div></div>
                <div><span style={{ fontSize: 11, color: colors.textMuted, textTransform: 'uppercase' }}>Lost</span><div style={{ fontSize: 20, fontWeight: 700, color: colors.red, fontFamily: fonts.mono }}>{data.summary.lost}</div></div>
                <div><span style={{ fontSize: 11, color: colors.textMuted, textTransform: 'uppercase' }}>Win Rate</span><div style={{ fontSize: 20, fontWeight: 700, color: colors.text, fontFamily: fonts.mono }}>{formatPercent(data.summary.rate)}</div></div>
              </>
            ) : (
              <>
                <div><span style={{ fontSize: 11, color: colors.textMuted, textTransform: 'uppercase' }}>Deals</span><div style={{ fontSize: 20, fontWeight: 700, color: colors.text, fontFamily: fonts.mono }}>{data.summary.deal_count}</div></div>
                <div><span style={{ fontSize: 11, color: colors.textMuted, textTransform: 'uppercase' }}>Total Pipeline</span><div style={{ fontSize: 20, fontWeight: 700, color: colors.text, fontFamily: fonts.mono }}>{formatCurrency(anon.amount(data.summary.total_pipeline))}</div></div>
                <div><span style={{ fontSize: 11, color: colors.textMuted, textTransform: 'uppercase' }}>Weighted</span><div style={{ fontSize: 20, fontWeight: 700, color: colors.accent, fontFamily: fonts.mono }}>{formatCurrency(anon.amount(data.summary.weighted_pipeline))}</div></div>
              </>
            )}
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: '0' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: colors.textMuted }}>Loading deal breakdown...</div>
          ) : !data?.deals?.length ? (
            <div style={{ padding: 40, textAlign: 'center', color: colors.textMuted }}>No deals found for this metric.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead style={{ position: 'sticky', top: 0 }}>
                <tr>
                  <th onClick={() => handleSort('name')} style={sortHeaderStyle('name')}>Deal {sortKey === 'name' ? (sortDir === 'desc' ? '↓' : '↑') : ''}</th>
                  <th onClick={() => handleSort('owner')} style={sortHeaderStyle('owner')}>Owner {sortKey === 'owner' ? (sortDir === 'desc' ? '↓' : '↑') : ''}</th>
                  <th onClick={() => handleSort('amount')} style={sortHeaderStyle('amount')}>Amount {sortKey === 'amount' ? (sortDir === 'desc' ? '↓' : '↑') : ''}</th>
                  {!isWinRate && <th onClick={() => handleSort('probability')} style={sortHeaderStyle('probability')}>Probability {sortKey === 'probability' ? (sortDir === 'desc' ? '↓' : '↑') : ''}</th>}
                  {!isWinRate && <th onClick={() => handleSort('weighted_amount')} style={sortHeaderStyle('weighted_amount')}>Weighted {sortKey === 'weighted_amount' ? (sortDir === 'desc' ? '↓' : '↑') : ''}</th>}
                  <th onClick={() => handleSort('stage')} style={sortHeaderStyle('stage')}>Stage {sortKey === 'stage' ? (sortDir === 'desc' ? '↓' : '↑') : ''}</th>
                  {isWinRate && <th onClick={() => handleSort('outcome')} style={sortHeaderStyle('outcome')}>Outcome {sortKey === 'outcome' ? (sortDir === 'desc' ? '↓' : '↑') : ''}</th>}
                  <th onClick={() => handleSort('close_date')} style={sortHeaderStyle('close_date')}>Close Date {sortKey === 'close_date' ? (sortDir === 'desc' ? '↓' : '↑') : ''}</th>
                </tr>
              </thead>
              <tbody>
                {sortedDeals.map((d: any, ri: number) => (
                  <tr
                    key={d.id}
                    onClick={() => navigate(`/deals/${d.id}`)}
                    style={{ background: ri % 2 === 0 ? 'transparent' : 'rgba(30, 41, 59, 0.3)', cursor: 'pointer' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(100, 136, 234, 0.08)')}
                    onMouseLeave={e => (e.currentTarget.style.background = ri % 2 === 0 ? 'transparent' : 'rgba(30, 41, 59, 0.3)')}
                  >
                    <td style={{ padding: '8px 12px', color: colors.accent, fontWeight: 500, maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{anon.deal(d.name)}</td>
                    <td style={{ padding: '8px 12px', color: colors.textMuted, whiteSpace: 'nowrap' }}>{anon.person(d.owner)}</td>
                    <td style={{ padding: '8px 12px', color: colors.text, fontFamily: fonts.mono, whiteSpace: 'nowrap' }}>{formatCurrency(anon.amount(d.amount))}</td>
                    {!isWinRate && <td style={{ padding: '8px 12px', color: colors.textMuted, fontFamily: fonts.mono }}>{d.probability > 1 ? d.probability.toFixed(0) : (d.probability * 100).toFixed(0)}%</td>}
                    {!isWinRate && <td style={{ padding: '8px 12px', color: colors.accent, fontFamily: fonts.mono, whiteSpace: 'nowrap' }}>{formatCurrency(anon.amount(d.weighted_amount))}</td>}
                    <td style={{ padding: '8px 12px', color: colors.textMuted, whiteSpace: 'nowrap' }}>{d.stage}</td>
                    {isWinRate && <td style={{ padding: '8px 12px' }}><span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: d.outcome === 'Won' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)', color: d.outcome === 'Won' ? colors.green : colors.red }}>{d.outcome}</span></td>}
                    <td style={{ padding: '8px 12px', color: colors.textMuted, whiteSpace: 'nowrap' }}>{d.close_date ? new Date(d.close_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function FindingBadge({ count, severity }: { count: number; severity: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <SeverityDot severity={severity as any} size={6} />
      <span style={{
        fontSize: 14, fontWeight: 600, fontFamily: fonts.mono,
        color: severityColor(severity),
      }}>
        {count}
      </span>
    </div>
  );
}

function ErrorInline({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div style={{ padding: 16, textAlign: 'center' }}>
      <p style={{ fontSize: 12, color: colors.red }}>{message}</p>
      <button onClick={onRetry} style={{
        fontSize: 12, color: colors.accent, background: 'none', border: 'none', cursor: 'pointer', marginTop: 8,
      }}>
        Retry
      </button>
    </div>
  );
}

function EmptyInline({ message, linkText, onLink }: { message: string; linkText: string; onLink: () => void }) {
  return (
    <div style={{ padding: 24, textAlign: 'center' }}>
      <p style={{ fontSize: 13, color: colors.textMuted }}>{message}</p>
      <button onClick={onLink} style={{
        fontSize: 12, color: colors.accent, background: 'none', border: 'none', cursor: 'pointer', marginTop: 8,
      }}>
        {linkText}
      </button>
    </div>
  );
}
