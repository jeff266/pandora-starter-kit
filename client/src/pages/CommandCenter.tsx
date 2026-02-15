import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { formatCurrency, formatNumber, formatPercent, formatTimeAgo, severityColor, severityBg } from '../lib/format';
import Skeleton, { SkeletonCard } from '../components/Skeleton';

interface Finding {
  id: string;
  severity: string;
  message: string;
  skill_id: string;
  deal_id?: string;
  deal_name?: string;
  owner_email?: string;
  found_at: string;
  status: string;
}

interface PipelineStage {
  stage: string;
  deal_count: number;
  total_value: number;
  weighted_value: number;
  findings: {
    act: number;
    watch: number;
    notable: number;
    top_findings: Array<{ severity: string; message: string; deal_id: string }>;
  };
}

export default function CommandCenter() {
  const navigate = useNavigate();
  const [pipeline, setPipeline] = useState<any>(null);
  const [summary, setSummary] = useState<any>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [connectors, setConnectors] = useState<any[]>([]);
  const [loading, setLoading] = useState({ pipeline: true, summary: true, findings: true, connectors: true });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [stageFilter, setStageFilter] = useState<string>('');

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
    load('findings', () => api.get('/findings?status=active&sort=severity&limit=30'), d => setFindings(d.findings || d));
    load('connectors', () => api.get('/connectors'), d => setConnectors(Array.isArray(d) ? d : d.connectors || []));
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 300000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const stageData: PipelineStage[] = pipeline?.by_stage || [];
  const totalPipeline = Number(pipeline?.total_pipeline) || stageData.reduce((s: number, d: PipelineStage) => s + (Number(d.total_value) || 0), 0);
  const weightedPipeline = Number(pipeline?.weighted_pipeline) || stageData.reduce((s: number, d: PipelineStage) => s + (Number(d.weighted_value) || 0), 0);
  const totalActive = summary?.total_active || 0;
  const actCount = summary?.by_severity?.act || 0;
  const winRate = pipeline?.win_rate?.trailing_90d;
  const coverage = pipeline?.coverage?.ratio;

  const filteredFindings = findings.filter(f => {
    if (severityFilter !== 'all' && f.severity !== severityFilter) return false;
    if (stageFilter) return false;
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Headline Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
        {loading.pipeline || loading.summary ? (
          Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} height={100} />)
        ) : (
          <>
            <MetricCard label="Total Pipeline" value={formatCurrency(totalPipeline)} />
            <MetricCard label="Weighted Pipeline" value={formatCurrency(weightedPipeline)} />
            <MetricCard
              label="Coverage"
              value={coverage != null ? `${Number(coverage).toFixed(1)}x` : '--'}
            />
            <MetricCard
              label="Active Findings"
              value={formatNumber(totalActive)}
              color={actCount > 5 ? colors.red : actCount > 0 ? colors.yellow : colors.green}
            />
            <MetricCard
              label="Win Rate (90d)"
              value={winRate != null ? formatPercent(Number(winRate)) : '--'}
            />
          </>
        )}
      </div>

      {/* Pipeline Chart + Findings Feed */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minHeight: 0 }}>
        {/* Pipeline Chart */}
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          padding: 20,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>Pipeline by Stage</h3>
              <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
                {formatCurrency(totalPipeline)} total across {stageData.length} stages
              </p>
            </div>
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
              {stageData.map((stage, i) => {
                const maxVal = Math.max(...stageData.map(s => Number(s.total_value) || 0));
                const pct = maxVal > 0 ? ((Number(stage.total_value) || 0) / maxVal) * 100 : 0;
                return (
                  <div key={i} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '6px 0',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span style={{
                      width: 100,
                      fontSize: 12,
                      color: colors.textSecondary,
                      flexShrink: 0,
                      textTransform: 'capitalize',
                    }}>
                      {stage.stage?.replace(/_/g, ' ') || 'Unknown'}
                    </span>
                    <div style={{ flex: 1, position: 'relative', height: 22, background: colors.surfaceRaised, borderRadius: 4 }}>
                      <div style={{
                        width: `${Math.max(pct, 4)}%`,
                        height: '100%',
                        background: `linear-gradient(90deg, ${colors.accent}, rgba(59,130,246,0.6))`,
                        borderRadius: 4,
                      }} />
                    </div>
                    <span style={{
                      width: 70,
                      fontSize: 12,
                      fontFamily: fonts.mono,
                      color: colors.text,
                      textAlign: 'right',
                      flexShrink: 0,
                    }}>
                      {formatCurrency(Number(stage.total_value) || 0)}
                    </span>
                    <span style={{
                      width: 24,
                      fontSize: 11,
                      fontFamily: fonts.mono,
                      color: colors.textMuted,
                      textAlign: 'center',
                      flexShrink: 0,
                    }}>
                      {stage.deal_count}
                    </span>
                    <div style={{ width: 50, display: 'flex', gap: 4, flexShrink: 0 }}>
                      {stage.findings?.act > 0 && (
                        <span style={{
                          fontSize: 9,
                          fontWeight: 600,
                          background: severityBg('act'),
                          color: colors.red,
                          padding: '1px 5px',
                          borderRadius: 6,
                          fontFamily: fonts.mono,
                        }}>
                          {stage.findings.act}
                        </span>
                      )}
                      {stage.findings?.watch > 0 && (
                        <span style={{
                          fontSize: 9,
                          fontWeight: 600,
                          background: severityBg('watch'),
                          color: colors.yellow,
                          padding: '1px 5px',
                          borderRadius: 6,
                          fontFamily: fonts.mono,
                        }}>
                          {stage.findings.watch}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Findings Feed */}
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          maxHeight: 500,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>Active Findings</h3>
              <span style={{
                fontSize: 10,
                fontWeight: 600,
                background: actCount > 0 ? severityBg('act') : colors.accentSoft,
                color: actCount > 0 ? colors.red : colors.accent,
                padding: '1px 6px',
                borderRadius: 8,
                fontFamily: fonts.mono,
              }}>
                {totalActive}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {['all', 'act', 'watch', 'notable'].map(sev => (
                <button
                  key={sev}
                  onClick={() => setSeverityFilter(sev)}
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    padding: '3px 8px',
                    borderRadius: 4,
                    background: severityFilter === sev ? colors.surfaceActive : 'transparent',
                    color: severityFilter === sev ? colors.text : colors.textMuted,
                    textTransform: 'capitalize',
                  }}
                >
                  {sev}
                </button>
              ))}
            </div>
          </div>

          {loading.findings ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={48} />)}
            </div>
          ) : errors.findings ? (
            <ErrorInline message={errors.findings} onRetry={fetchData} />
          ) : (
            <div style={{ overflow: 'auto', flex: 1 }}>
              {filteredFindings.length === 0 ? (
                <p style={{ fontSize: 12, color: colors.textMuted, textAlign: 'center', padding: 24 }}>
                  No active findings
                </p>
              ) : (
                filteredFindings.map(f => (
                  <div
                    key={f.id}
                    style={{
                      padding: '10px 0',
                      borderBottom: `1px solid ${colors.border}`,
                      cursor: f.deal_id ? 'pointer' : 'default',
                    }}
                    onClick={() => f.deal_id && navigate(`/deals/${f.deal_id}`)}
                    onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <span style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background: severityColor(f.severity),
                        boxShadow: `0 0 6px ${severityColor(f.severity)}40`,
                        marginTop: 5,
                        flexShrink: 0,
                      }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13, color: colors.text, lineHeight: 1.4 }}>
                          {f.message}
                        </p>
                        <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 11, color: colors.textMuted }}>
                          <span>{f.skill_id}</span>
                          {f.deal_name && (
                            <span style={{ color: colors.accent }}>{f.deal_name}</span>
                          )}
                          {f.owner_email && <span>{f.owner_email}</span>}
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

      {/* Connector Status Strip */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 12,
      }}>
        {loading.connectors ? (
          Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} height={60} />)
        ) : connectors.length > 0 ? (
          connectors.map((c, i) => {
            const lastSync = c.last_sync_at || c.last_sync;
            const syncAge = lastSync ? (Date.now() - new Date(lastSync).getTime()) / 3600000 : 999;
            const statusColor = syncAge < 24 ? colors.green : syncAge < 168 ? colors.yellow : colors.red;
            return (
              <div
                key={i}
                style={{
                  background: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 10,
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  cursor: 'pointer',
                }}
                onClick={() => navigate('/connectors')}
                onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
                onMouseLeave={e => (e.currentTarget.style.background = colors.surface)}
              >
                <span style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: statusColor,
                  boxShadow: `0 0 6px ${statusColor}40`,
                  flexShrink: 0,
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: colors.text, textTransform: 'capitalize' }}>
                    {c.source_type || c.name || 'Unknown'}
                  </div>
                  <div style={{ fontSize: 11, color: colors.textMuted }}>
                    {lastSync ? formatTimeAgo(lastSync) : 'Never synced'}
                  </div>
                </div>
              </div>
            );
          })
        ) : null}
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

function ErrorInline({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div style={{ padding: 16, textAlign: 'center' }}>
      <p style={{ fontSize: 12, color: colors.red }}>{message}</p>
      <button onClick={onRetry} style={{
        fontSize: 12, color: colors.accent, background: 'none', marginTop: 8,
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
        fontSize: 12, color: colors.accent, background: 'none', marginTop: 8,
      }}>
        {linkText}
      </button>
    </div>
  );
}
