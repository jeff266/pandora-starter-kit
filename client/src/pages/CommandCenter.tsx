import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { formatCurrency, formatNumber, formatPercent, formatTimeAgo, severityColor, severityBg } from '../lib/format';
import Skeleton, { SkeletonCard } from '../components/Skeleton';
import { SeverityDot } from '../components/shared';

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

interface AnnotatedFinding {
  finding_id: string;
  severity: 'act' | 'watch' | 'notable' | 'info';
  message: string;
  deal_id: string;
  deal_name: string;
  skill_id: string;
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
    top_findings?: AnnotatedFinding[];
  };
  annotated_findings?: AnnotatedFinding[];
}

export default function CommandCenter() {
  const navigate = useNavigate();
  const [pipeline, setPipeline] = useState<any>(null);
  const [summary, setSummary] = useState<any>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [allFindings, setAllFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState({ pipeline: true, summary: true, findings: true });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [repFilter, setRepFilter] = useState<string>('all');
  const [skillFilter, setSkillFilter] = useState<string>('all');
  const [expandedStage, setExpandedStage] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    const load = async (key: string, fetcher: () => Promise<any>, setter: (d: any) => void) => {
      try {
        const data = await fetcher();
        setter(data);
        setErrors(prev => { const n = { ...prev }; delete n[key]; return n; });
      } catch (err: any) {
        setErrors(prev => ({ ...prev, [key]: err.message }));
      } finally {
        setLoading(prev => ({ ...prev, [key]: false }));
      }
    };

    load('pipeline', () => api.get('/pipeline/snapshot'), setPipeline);
    load('summary', () => api.get('/findings/summary'), setSummary);
    load('findings', () => api.get('/findings?status=active&sort=severity&limit=20'), d => {
      const findingsArray = Array.isArray(d) ? d : d.findings || [];
      setAllFindings(findingsArray);
      setFindings(findingsArray);
    });
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 300000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Apply filters
  useEffect(() => {
    let filtered = [...allFindings];
    if (severityFilter !== 'all') {
      filtered = filtered.filter(f => f.severity === severityFilter);
    }
    if (repFilter !== 'all') {
      filtered = filtered.filter(f => f.owner_email === repFilter || f.owner_name === repFilter);
    }
    if (skillFilter !== 'all') {
      filtered = filtered.filter(f => f.skill_id === skillFilter);
    }
    setFindings(filtered);
  }, [severityFilter, repFilter, skillFilter, allFindings]);

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

  // Extract unique reps and skills for filter dropdowns
  const uniqueReps = Array.from(new Set(allFindings.map(f => f.owner_email || f.owner_name).filter(Boolean)));
  const uniqueSkills = Array.from(new Set(allFindings.map(f => f.skill_id).filter(Boolean)));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Headline Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
        {loading.pipeline || loading.summary ? (
          Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} height={100} />)
        ) : (
          <>
            <MetricCard label="Total Pipeline" value={formatCurrency(totalPipeline)} />
            <MetricCard label="Weighted Pipeline" value={formatCurrency(weightedPipeline)} />
            <MetricCard
              label="Coverage Ratio"
              value={coverage != null ? `${Number(coverage).toFixed(1)}x` : '--'}
            />
            <MetricCard
              label="Win Rate (90d)"
              value={winRate != null ? formatPercent(Number(winRate)) : '--'}
            />
            <div style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 10,
              padding: 16,
            }}>
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

      {/* Annotated Pipeline Chart */}
      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: 20,
      }}>
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>Pipeline by Stage</h3>
          <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
            {formatCurrency(totalPipeline)} total • {stageData.reduce((sum, s) => sum + s.deal_count, 0)} deals across {stageData.length} stages
          </p>
        </div>
        {loading.pipeline ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={32} />)}
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
          <div>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={stageData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={colors.border} />
                <XAxis
                  dataKey="stage"
                  angle={-45}
                  textAnchor="end"
                  height={80}
                  tick={{ fill: colors.textSecondary, fontSize: 11 }}
                  tickFormatter={(value) => value?.replace(/_/g, ' ') || ''}
                />
                <YAxis
                  tick={{ fill: colors.textSecondary, fontSize: 11 }}
                  tickFormatter={(value) => formatCurrency(value).replace('.00', '')}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.[0]) return null;
                    const data = payload[0].payload as PipelineStage;
                    return (
                      <div style={{
                        background: colors.surface,
                        border: `1px solid ${colors.border}`,
                        borderRadius: 6,
                        padding: 12,
                      }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: colors.text, marginBottom: 6 }}>
                          {data.stage?.replace(/_/g, ' ') || 'Unknown'}
                        </div>
                        <div style={{ fontSize: 11, color: colors.textSecondary, display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <div>{formatCurrency(data.total_value)} total</div>
                          <div>{formatCurrency(data.weighted_value)} weighted</div>
                          <div>{data.deal_count} deals</div>
                          {data.findings && (
                            <div style={{ marginTop: 4, display: 'flex', gap: 6 }}>
                              {data.findings.act > 0 && <span style={{ color: colors.red }}>{data.findings.act} act</span>}
                              {data.findings.watch > 0 && <span style={{ color: colors.yellow }}>{data.findings.watch} watch</span>}
                              {data.findings.notable > 0 && <span style={{ color: colors.purple }}>{data.findings.notable} notable</span>}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="total_value" radius={[6, 6, 0, 0]}>
                  {stageData.map((stage, index) => (
                    <Cell key={`cell-${index}`} fill={colors.accent} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            {/* Annotated Findings per Stage */}
            <div style={{ marginTop: 20 }}>
              {stageData.map((stage, idx) => {
                const topFindings = stage.findings?.top_findings || stage.annotated_findings || [];
                const hasFindings = topFindings.length > 0;
                if (!hasFindings) return null;

                const isExpanded = expandedStage === stage.stage;
                const highestSeverity = topFindings.reduce((max: string, f: any) => {
                  const severities: Record<string, number> = { act: 4, watch: 3, notable: 2, info: 1 };
                  return (severities[f.severity] || 0) > (severities[max] || 0) ? f.severity : max;
                }, 'info');

                return (
                  <div key={idx} style={{ marginBottom: 12 }}>
                    <div
                      onClick={() => setExpandedStage(isExpanded ? null : stage.stage)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 12px',
                        background: colors.surfaceRaised,
                        borderRadius: 6,
                        cursor: 'pointer',
                        border: `1px solid ${colors.border}`,
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
                      onMouseLeave={e => (e.currentTarget.style.background = colors.surfaceRaised)}
                    >
                      <SeverityDot severity={highestSeverity as any} size={7} />
                      <span style={{ fontSize: 12, fontWeight: 500, color: colors.text, textTransform: 'capitalize' }}>
                        {stage.stage?.replace(/_/g, ' ')}
                      </span>
                      <span style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.mono }}>
                        {topFindings.length} finding{topFindings.length !== 1 ? 's' : ''}
                      </span>
                      <span style={{ marginLeft: 'auto', fontSize: 10, color: colors.textMuted }}>
                        {isExpanded ? '▼' : '▶'}
                      </span>
                    </div>

                    {isExpanded && (
                      <div style={{ marginTop: 8, marginLeft: 24, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {topFindings.map((finding: any, fidx: number) => (
                          <div
                            key={fidx}
                            onClick={() => finding.deal_id && navigate(`/deals/${finding.deal_id}`)}
                            style={{
                              padding: '8px 12px',
                              background: colors.surface,
                              borderRadius: 6,
                              border: `1px solid ${colors.border}`,
                              cursor: finding.deal_id ? 'pointer' : 'default',
                            }}
                            onMouseEnter={e => finding.deal_id && (e.currentTarget.style.background = colors.surfaceHover)}
                            onMouseLeave={e => finding.deal_id && (e.currentTarget.style.background = colors.surface)}
                          >
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                              <SeverityDot severity={finding.severity} size={6} />
                              <div style={{ flex: 1 }}>
                                <p style={{ fontSize: 12, color: colors.text, lineHeight: 1.4 }}>
                                  {finding.message}
                                </p>
                                <div style={{ display: 'flex', gap: 10, marginTop: 4, fontSize: 10, color: colors.textMuted }}>
                                  <span>{finding.skill_id}</span>
                                  {finding.deal_name && (
                                    <span style={{ color: colors.accent, fontWeight: 500 }}>{finding.deal_name}</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Findings Feed */}
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
              fontSize: 10,
              fontWeight: 600,
              background: totalActive > 0 ? severityBg('act') : colors.accentSoft,
              color: totalActive > 0 ? colors.red : colors.accent,
              padding: '2px 6px',
              borderRadius: 8,
              fontFamily: fonts.mono,
            }}>
              {totalActive}
            </span>
          </div>
        </div>

        {/* Filter Controls */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Severity Filter */}
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: colors.textMuted, marginRight: 4 }}>Severity:</span>
            {['all', 'act', 'watch', 'notable', 'info'].map(sev => (
              <button
                key={sev}
                onClick={() => setSeverityFilter(sev)}
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  padding: '4px 10px',
                  borderRadius: 4,
                  background: severityFilter === sev ? colors.surfaceActive : 'transparent',
                  color: severityFilter === sev ? colors.text : colors.textMuted,
                  border: 'none',
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                }}
              >
                {sev}
              </button>
            ))}
          </div>

          {/* Rep Filter */}
          {uniqueReps.length > 0 && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: colors.textMuted }}>Rep:</span>
              <select
                value={repFilter}
                onChange={(e) => setRepFilter(e.target.value)}
                style={{
                  fontSize: 11,
                  padding: '4px 8px',
                  borderRadius: 4,
                  background: colors.surfaceRaised,
                  color: colors.text,
                  border: `1px solid ${colors.border}`,
                }}
              >
                <option value="all">All</option>
                {uniqueReps.map((rep) => (
                  <option key={rep} value={rep}>{rep}</option>
                ))}
              </select>
            </div>
          )}

          {/* Skill Filter */}
          {uniqueSkills.length > 0 && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: colors.textMuted }}>Skill:</span>
              <select
                value={skillFilter}
                onChange={(e) => setSkillFilter(e.target.value)}
                style={{
                  fontSize: 11,
                  padding: '4px 8px',
                  borderRadius: 4,
                  background: colors.surfaceRaised,
                  color: colors.text,
                  border: `1px solid ${colors.border}`,
                }}
              >
                <option value="all">All</option>
                {uniqueSkills.map((skill) => (
                  <option key={skill} value={skill}>{skill}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {loading.findings ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={48} />)}
          </div>
        ) : errors.findings ? (
          <ErrorInline message={errors.findings} onRetry={fetchData} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, maxHeight: 500, overflow: 'auto' }}>
            {findings.length === 0 ? (
              <p style={{ fontSize: 12, color: colors.textMuted, textAlign: 'center', padding: 24 }}>
                No findings match the current filters
              </p>
            ) : (
              findings.map(f => (
                <div
                  key={f.id}
                  style={{
                    padding: '12px 0',
                    borderBottom: `1px solid ${colors.border}`,
                    cursor: f.deal_id ? 'pointer' : 'default',
                  }}
                  onClick={() => f.deal_id && navigate(`/deals/${f.deal_id}`)}
                  onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <SeverityDot severity={f.severity as any} size={7} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, color: colors.text, lineHeight: 1.4, marginBottom: 6 }}>
                        {f.message}
                      </p>
                      <div style={{ display: 'flex', gap: 12, fontSize: 11, color: colors.textMuted, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 500 }}>{f.skill_name || f.skill_id}</span>
                        {f.deal_name && (
                          <span style={{ color: colors.accent }}>{f.deal_name}</span>
                        )}
                        {f.account_name && (
                          <span>{f.account_name}</span>
                        )}
                        {(f.owner_name || f.owner_email) && (
                          <span>{f.owner_name || f.owner_email}</span>
                        )}
                        <span>{formatTimeAgo(f.found_at)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
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
        fontSize: 24,
        fontWeight: 700,
        fontFamily: fonts.mono,
        color: color || colors.text,
        marginTop: 6,
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
        fontSize: 14,
        fontWeight: 600,
        fontFamily: fonts.mono,
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
