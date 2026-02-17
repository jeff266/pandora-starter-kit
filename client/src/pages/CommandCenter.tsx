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

export default function CommandCenter() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading } = useWorkspace();
  const { anon } = useDemoMode();
  const [pipeline, setPipeline] = useState<any>(null);
  const [summary, setSummary] = useState<any>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [connectorStatus, setConnectorStatus] = useState<any[]>([]);
  const [loading, setLoading] = useState({ pipeline: true, summary: true, findings: true });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [availablePipelines, setAvailablePipelines] = useState<Array<{ name: string; deal_count: number; total_value: number }>>([]);
  const [selectedPipeline, setSelectedPipeline] = useState<string>(() => {
    return localStorage.getItem('pandora_selected_pipeline') || 'all';
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

  useEffect(() => {
    const tickInterval = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(tickInterval);
  }, []);

  const fetchPipelines = useCallback(async () => {
    try {
      const data = await api.get('/pipeline/pipelines');
      setAvailablePipelines(data.pipelines || []);
    } catch {}
  }, []);

  const fetchData = useCallback(async (pipelineParam?: string, isRefresh?: boolean) => {
    const pFilter = pipelineParam ?? selectedPipeline;
    const pipelineQs = pFilter && pFilter !== 'all' ? `?pipeline=${encodeURIComponent(pFilter)}` : '';

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
    localStorage.setItem('pandora_selected_pipeline', value);
    setLoading(prev => ({ ...prev, pipeline: true }));
    fetchData(value);
  }, [fetchData]);

  useEffect(() => {
    if (!isAuthenticated || authLoading) return;
    fetchPipelines();
    fetchData();
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchData(undefined, true);
      }
    }, 300000);
    return () => clearInterval(interval);
  }, [isAuthenticated, authLoading, fetchPipelines, fetchData]);

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
    const stageName = d?.stage_normalized || d?.stage;
    if (!stageName) return;
    setStageFilter(stageName);
    setStageFilterLoading(true);
    try {
      const result = await api.get(`/deals?stage=${encodeURIComponent(stageName)}&limit=50`);
      const deals = Array.isArray(result) ? result : result.deals || [];
      setStageFilterDealIds(deals.map((deal: any) => deal.id));
    } catch {
      setStageFilterDealIds([]);
    } finally {
      setStageFilterLoading(false);
    }
  }, []);

  const clearStageFilter = useCallback(() => {
    setStageFilter(null);
    setStageFilterDealIds([]);
  }, []);

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
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <QuotaBanner />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: colors.textMuted }}>{updatedText}</span>
          {refreshing && <InlineSpinner />}
        </div>
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

      <SectionErrorBoundary fallbackMessage="Failed to load pipeline chart.">
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          padding: 20,
        }}>
          <div style={{ marginBottom: 16, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>Pipeline by Stage</h3>
              <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
                {formatCurrency(anon.amount(totalPipeline))} total {'·'} {stageData.reduce((sum, s) => sum + s.deal_count, 0)} deals across {stageData.length} stages
              </p>
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
                {availablePipelines.map(p => (
                  <option key={p.name} value={p.name}>
                    {p.name} ({p.deal_count})
                  </option>
                ))}
              </select>
            )}
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
                    {stageData.map((_, idx) => (
                      <Cell key={idx} fill={colors.accent} />
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
