import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
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
  const wsId = currentWorkspace?.id || '';
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

  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [refreshing, setRefreshing] = useState(false);
  const [, setTick] = useState(0);

  const [selectedStageData, setSelectedStageData] = useState<SelectedStage | null>(null);
  const [stageDealsLoading, setStageDealsLoading] = useState(false);
  const [askingAbout, setAskingAbout] = useState<'stage' | DealSummaryFull | null>(null);
  const [activeThread, setActiveThread] = useState<ThreadMessage[] | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);

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
        setAvailablePipelines(pipelines);
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
    const pipelineQs = pFilter && pFilter !== 'default' ? `?scopeId=${encodeURIComponent(pFilter)}` : '';

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
    ]);

    setLastUpdated(new Date());
    setRefreshing(false);
  }, [selectedPipeline]);

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
  }, [isAuthenticated, authLoading, fetchPipelines, fetchData, wsId]);

  const stageData: PipelineStage[] = pipeline?.by_stage || [];
  const totalPipeline = Number(pipeline?.total_pipeline) || 0;
  const weightedPipeline = Number(pipeline?.weighted_pipeline) || 0;
  const totalActive = summary?.total_active || 0;
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

  const filteredFindings = stageFilter && stageFilterDealIds.length > 0
    ? findings.filter(f => f.deal_id && stageFilterDealIds.includes(f.deal_id))
    : stageFilter && !stageFilterLoading
    ? []
    : findings;

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

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: colors.textMuted }}>{updatedText}</span>
          {refreshing && <InlineSpinner />}
        </div>
        {availablePipelines.length > 1 && (
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
        )}
      </div>

      <SectionErrorBoundary fallbackMessage="Failed to load metrics.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
          {authLoading || loading.pipeline || loading.summary ? (
            Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} height={100} />)
          ) : (
            <>
              <MetricCard label="Total Pipeline" value={formatCurrency(anon.amount(totalPipeline))} />
              <MetricCard label="Weighted Pipeline" value={formatCurrency(anon.amount(weightedPipeline))} />
              <MetricCard
                label="Coverage Ratio"
                value={coverage != null ? `${Number(coverage).toFixed(1)}x` : '--'}
              />
              <MetricCard
                label="Win Rate (90d)"
                value={winRate != null ? formatPercent(Number(winRate)) : '--'}
              />
              <div
                onClick={() => navigate('/insights')}
                style={{
                  background: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 10,
                  padding: 16,
                  cursor: 'pointer',
                  transition: 'border-color 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = colors.accent)}
                onMouseLeave={e => (e.currentTarget.style.borderColor = colors.border)}
              >
                <div style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Open Findings
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <FindingBadge count={actCount} severity="act" />
                  <FindingBadge count={watchCount} severity="watch" />
                  <FindingBadge count={notableCount} severity="notable" />
                  <FindingBadge count={infoCount} severity="info" />
                </div>
              </div>
            </>
          )}
        </div>
      </SectionErrorBoundary>

      <SectionErrorBoundary fallbackMessage="Failed to load forecast panel.">
        <MonteCarloPanel wsId={wsId} activePipeline={selectedPipeline} />
      </SectionErrorBoundary>

      <SectionErrorBoundary fallbackMessage="Failed to load pipeline chart.">
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          padding: 20,
        }}>
          <div style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>Pipeline by Stage</h3>
            <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
              {formatCurrency(anon.amount(totalPipeline))} total {'·'} {stageData.reduce((sum, s) => sum + s.deal_count, 0)} deals across {stageData.length} stages
            </p>
          </div>
          {authLoading || loading.pipeline ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={36} />)}
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
            <>
              <ResponsiveContainer width="100%" height={Math.max(stageData.length * 50, 200)}>
                <BarChart
                  layout="vertical"
                  data={stageData}
                  margin={{ top: 0, right: 20, bottom: 0, left: 0 }}
                >
                  <XAxis
                    type="number"
                    hide
                  />
                  <YAxis
                    type="category"
                    dataKey="stage"
                    width={140}
                    tick={{ fontSize: 12, fill: colors.text, fontFamily: fonts.sans }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: colors.surfaceHover }} />
                  <Bar
                    dataKey="total_value"
                    fill={colors.accent}
                    radius={[0, 4, 4, 0]}
                    cursor="pointer"
                    onClick={(data: any) => handleBarClick(data)}
                  >
                    {stageData.map((entry, idx) => (
                      <Cell
                        key={idx}
                        fill={selectedStageData?.stage === entry.stage ? '#60a5fa' : colors.accent}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>

              {stageData.some(s => (s.findings?.act || 0) > 0 || (s.findings?.watch || 0) > 0) && (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {stageData.filter(s => (s.findings?.act || 0) > 0 || (s.findings?.watch || 0) > 0).map((stage, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        paddingLeft: 4,
                        cursor: 'pointer',
                        padding: '4px 4px',
                        borderRadius: 4,
                        transition: 'background 0.12s',
                        justifyContent: 'space-between',
                      }}
                      onClick={() => handleExpandStage(stage.stage_normalized || stage.stage)}
                      onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <span style={{ fontSize: 11, fontWeight: 500, color: colors.textSecondary, minWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {stage.stage}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {(stage.findings?.act || 0) > 0 && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: severityColor('act'), display: 'inline-block' }} />
                            <span style={{ fontSize: 10, fontFamily: fonts.mono, color: severityColor('act') }}>{stage.findings!.act}</span>
                          </span>
                        )}
                        {(stage.findings?.watch || 0) > 0 && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: severityColor('watch'), display: 'inline-block' }} />
                            <span style={{ fontSize: 10, fontFamily: fonts.mono, color: severityColor('watch') }}>{stage.findings!.watch}</span>
                          </span>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleBarClick({ stage: stage.stage, stage_normalized: stage.stage_normalized });
                            setTimeout(() => {
                              handleAskPandora(`What's the risk profile for deals in ${stage.stage}?`, { type: 'stage', stage: stage.stage });
                            }, 100);
                          }}
                          style={{
                            marginLeft: 4,
                            padding: '2px 8px',
                            fontSize: 10,
                            background: 'none',
                            border: `1px solid ${colors.border}`,
                            borderRadius: 4,
                            color: colors.accent,
                            cursor: 'pointer',
                            flexShrink: 0,
                          }}
                          title={`Ask Pandora about ${stage.stage}`}
                        >
                          Ask
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {expandedStage && (
                <div style={{
                  marginTop: 12,
                  background: colors.surfaceRaised,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 8,
                  padding: 16,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>
                      {expandedStage} — {expandedStageDeals.length} deal{expandedStageDeals.length !== 1 ? 's' : ''} ({formatCurrency(anon.amount(expandedStageTotalValue))})
                    </div>
                  </div>
                  {expandedStageLoading ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={28} />)}
                    </div>
                  ) : expandedStageDeals.length === 0 ? (
                    <p style={{ fontSize: 12, color: colors.textMuted }}>No deals found in this stage.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                      {expandedStageDeals.map(deal => (
                        <div
                          key={deal.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            padding: '6px 4px',
                            borderBottom: `1px solid ${colors.border}`,
                            cursor: 'pointer',
                            borderRadius: 4,
                            transition: 'background 0.12s',
                          }}
                          onClick={() => navigate(`/deals/${deal.id}`)}
                          onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >
                          <span style={{ fontSize: 12, fontWeight: 500, color: colors.accent, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {anon.deal(deal.name)}
                          </span>
                          {deal.amount != null && (
                            <span style={{ fontSize: 11, fontFamily: fonts.mono, color: colors.text, flexShrink: 0 }}>
                              {formatCurrency(anon.amount(deal.amount))}
                            </span>
                          )}
                          {deal.owner_name && (
                            <span style={{ fontSize: 11, color: colors.textSecondary, flexShrink: 0 }}>
                              {anon.person(deal.owner_name)}
                            </span>
                          )}
                          {deal.days_in_stage != null && (
                            <span style={{ fontSize: 10, fontFamily: fonts.mono, color: colors.textMuted, flexShrink: 0 }}>
                              {deal.days_in_stage}d in stage
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                    <button
                      onClick={() => handleViewAllFromPanel(expandedStage)}
                      style={{ fontSize: 11, color: colors.accent, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}
                    >
                      View All →
                    </button>
                    <button
                      onClick={() => { setExpandedStage(null); setExpandedStageDeals([]); }}
                      style={{ fontSize: 11, color: colors.textMuted, background: 'none', border: 'none', cursor: 'pointer' }}
                    >
                      Close ✕
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </SectionErrorBoundary>

      {/* Stage Drilldown overlay */}
      {selectedStageData && (
        <>
          <div
            onClick={() => { setSelectedStageData(null); setAskingAbout(null); }}
            style={{
              position: 'fixed', top: 0, left: 0, right: 680, bottom: 0,
              background: 'rgba(0,0,0,0.3)', zIndex: 99,
            }}
          />
          <StageDrillDownPanel
            stage={selectedStageData}
            loading={stageDealsLoading}
            askingAbout={askingAbout}
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

      <SectionErrorBoundary fallbackMessage="Failed to load findings by rep.">
        {ownerRows.length > 0 && (
          <div style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 10,
            padding: 20,
          }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 12 }}>Findings by Rep</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {ownerRows.map((row, i) => (
                <div
                  key={i}
                  onClick={() => navigate(`/deals?owner=${encodeURIComponent(row.owner)}`)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '8px 8px',
                    borderBottom: `1px solid ${colors.border}`,
                    cursor: 'pointer',
                    borderRadius: 4,
                    transition: 'background 0.12s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ fontSize: 12, fontWeight: 500, color: colors.text, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {anon.person(row.owner)}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {row.act > 0 && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: severityColor('act'), display: 'inline-block' }} />
                        <span style={{ fontSize: 11, fontFamily: fonts.mono, color: severityColor('act') }}>{row.act}</span>
                      </span>
                    )}
                    {row.watch > 0 && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: severityColor('watch'), display: 'inline-block' }} />
                        <span style={{ fontSize: 11, fontFamily: fonts.mono, color: severityColor('watch') }}>{row.watch}</span>
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: 11, fontFamily: fonts.mono, color: colors.textMuted, minWidth: 50, textAlign: 'right' }}>
                    {row.total} total
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </SectionErrorBoundary>

      <SectionErrorBoundary fallbackMessage="Failed to load findings feed.">
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          padding: 20,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>Active Findings</h3>
              <span style={{
                fontSize: 10, fontWeight: 600,
                background: totalActive > 0 ? 'rgba(239,68,68,0.1)' : colors.accentSoft,
                color: totalActive > 0 ? colors.red : colors.accent,
                padding: '2px 6px', borderRadius: 8, fontFamily: fonts.mono,
              }}>
                {totalActive}
              </span>
            </div>
            <button
              onClick={() => navigate('/insights')}
              style={{ fontSize: 11, color: colors.accent, background: 'none', border: 'none', cursor: 'pointer' }}
            >
              View all →
            </button>
          </div>

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
              <span>Filtered by: {stageFilter}</span>
              <button
                onClick={clearStageFilter}
                style={{
                  background: 'none',
                  border: 'none',
                  color: colors.accent,
                  cursor: 'pointer',
                  padding: 0,
                  fontSize: 13,
                  lineHeight: 1,
                  fontWeight: 600,
                }}
              >
                ✕
              </button>
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
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0, maxHeight: 400, overflow: 'auto' }}>
              {filteredFindings.length === 0 ? (
                <p style={{ fontSize: 12, color: colors.textMuted, textAlign: 'center', padding: 24 }}>
                  {stageFilter ? `No findings for stage "${stageFilter}"` : 'No active findings'}
                </p>
              ) : (
                filteredFindings.map(f => (
                  <FindingRow
                    key={f.id}
                    finding={f}
                    onSnooze={handleSnoozeFinding}
                    onResolve={handleResolveFinding}
                    onNavigate={navigate}
                  />
                ))
              )}
            </div>
          )}
        </div>
      </SectionErrorBoundary>

      <SectionErrorBoundary fallbackMessage="Failed to load connector status.">
        {connectorStatus.length > 0 && (
          <div style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 10,
            padding: '14px 20px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>Connected Sources</h3>
              <button
                onClick={() => navigate('/connectors/health')}
                style={{ fontSize: 11, color: colors.accent, background: 'none', border: 'none', cursor: 'pointer' }}
              >
                View health →
              </button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
              {connectorStatus.map((c: any, i: number) => {
                const dotColor = c.health === 'healthy' ? colors.green : c.health === 'warning' ? colors.yellow : colors.red;
                return (
                  <div
                    key={i}
                    onClick={() => navigate('/connectors/health')}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      cursor: 'pointer',
                      padding: '4px 10px',
                      borderRadius: 6,
                      border: `1px solid ${colors.border}`,
                      transition: 'border-color 0.12s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = colors.borderLight)}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = colors.border)}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, display: 'inline-block', flexShrink: 0 }} />
                    <span style={{ fontSize: 12, fontWeight: 500, color: colors.text }}>{c.name || c.connector_name}</span>
                    {c.last_sync_at && (
                      <span style={{ fontSize: 10, color: colors.textMuted }}>{formatTimeAgo(c.last_sync_at)}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </SectionErrorBoundary>
    </div>
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
  stage, loading, askingAbout, onClose, onAskAboutStage, onAskAboutDeal, onAskPandora
}: {
  stage: SelectedStage;
  loading: boolean;
  askingAbout: 'stage' | DealSummaryFull | null;
  onClose: () => void;
  onAskAboutStage: () => void;
  onAskAboutDeal: (deal: DealSummaryFull) => void;
  onAskPandora: (prompt: string, scope?: any) => void;
}) {
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
        position: 'fixed', top: 0, right: 0, width: 680, height: '100vh',
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
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#E2E8F0' }}>{stage.stage}</h2>
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
              &#x1F4AC; Ask Pandora about {stage.stage}
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
            {askingAbout === 'stage' ? `Questions about ${stage.stage}` : `Questions about ${(askingAbout as DealSummaryFull).name}`}
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
          display: 'grid', gridTemplateColumns: '1fr 120px 80px 80px 80px 36px',
          padding: '8px 16px', borderBottom: '1px solid #1E293B',
          position: 'sticky', top: 0, background: '#111827', zIndex: 2,
        }}>
          {['Deal', 'Category', 'Amount', 'Days', 'Prob', ''].map(h => (
            <div key={h} style={{
              fontSize: 10, fontWeight: 600, color: '#5A6A80',
              textTransform: 'uppercase', letterSpacing: '0.05em',
              textAlign: (h === 'Amount' || h === 'Days' || h === 'Prob') ? 'right' : 'left',
            }}>{h}</div>
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

function DrilldownDealRow({ deal, isLast, isAsking, onAsk }: {
  deal: DealSummaryFull;
  isLast: boolean;
  isAsking: boolean;
  onAsk: () => void;
}) {
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
        display: 'grid', gridTemplateColumns: '1fr 120px 80px 80px 80px 36px',
        alignItems: 'center', padding: '12px 16px',
        borderBottom: isLast ? 'none' : '1px solid #1E293B',
        background: hovered ? 'rgba(59,130,246,0.04)' : 'transparent',
        transition: 'background 0.1s',
        fontFamily: "'IBM Plex Sans', -apple-system, sans-serif",
      }}
    >
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: '#E2E8F0' }}>{deal.name}</span>
          {deal.findings.map(f => {
            const fl = FINDING_LABELS_MAP[f];
            return fl ? (
              <span key={f} style={{
                fontSize: 10, fontWeight: 600, fontFamily: 'IBM Plex Mono, monospace',
                padding: '1px 6px', borderRadius: 3, color: fl.color, background: fl.bg,
              }}>{fl.icon} {fl.label}</span>
            ) : null;
          })}
        </div>
        <div style={{ fontSize: 11.5, color: '#5A6A80', marginTop: 2 }}>
          {deal.owner_name || deal.owner_email} &#xB7; Close {deal.close_date ? deal.close_date.split('T')[0] : '\u2014'}
        </div>
      </div>
      <div>
        <span style={{
          fontSize: 10, fontWeight: 600, fontFamily: 'IBM Plex Mono, monospace',
          padding: '2px 8px', borderRadius: 4, color: fcColor, background: fcBg,
          textTransform: 'uppercase', letterSpacing: '0.03em',
        }}>{fcLabel}</span>
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'IBM Plex Mono, monospace', color: '#E2E8F0', textAlign: 'right' }}>
        {fmtAmt(deal.amount || 0)}
      </div>
      <div style={{ fontSize: 13, fontFamily: 'IBM Plex Mono, monospace', color: daysColor, textAlign: 'right' }}>
        {Math.round(deal.days_in_stage || 0)}d
      </div>
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

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
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
        {thread.map((msg, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
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
                </>
              )}
            </div>
          </div>
        ))}
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

function FindingRow({ finding, onSnooze, onResolve, onNavigate }: {
  finding: Finding;
  onSnooze: (id: string, days: number) => void;
  onResolve: (id: string) => void;
  onNavigate: (path: string) => void;
}) {
  const { anon } = useDemoMode();
  const [showSnooze, setShowSnooze] = useState(false);
  const snoozeRef = useRef<HTMLDivElement>(null);
  const f = finding;

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
          </div>
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

function MetricCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 10,
      padding: 16,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
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
