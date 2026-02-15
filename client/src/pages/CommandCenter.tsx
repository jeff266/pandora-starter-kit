import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { formatCurrency, formatNumber, formatPercent, formatTimeAgo, severityColor } from '../lib/format';
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

export default function CommandCenter() {
  const navigate = useNavigate();
  const [pipeline, setPipeline] = useState<any>(null);
  const [summary, setSummary] = useState<any>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState({ pipeline: true, summary: true, findings: true });
  const [errors, setErrors] = useState<Record<string, string>>({});

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
    load('findings', () => api.get('/findings?status=active&sort=severity&limit=15'), d => {
      const arr = Array.isArray(d) ? d : d.findings || [];
      setFindings(arr);
    });
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 300000);
    return () => clearInterval(interval);
  }, [fetchData]);

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

  const maxStageValue = Math.max(...stageData.map(s => s.total_value), 1);

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

      {/* Pipeline by Stage — Horizontal CSS Bar Chart */}
      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: 20,
      }}>
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>Pipeline by Stage</h3>
          <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
            {formatCurrency(totalPipeline)} total \u00B7 {stageData.reduce((sum, s) => sum + s.deal_count, 0)} deals across {stageData.length} stages
          </p>
        </div>
        {loading.pipeline ? (
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {stageData.map((stage, idx) => {
              const pct = Math.max((stage.total_value / maxStageValue) * 100, 2);
              const findingAct = stage.findings?.act || 0;
              const findingWatch = stage.findings?.watch || 0;

              return (
                <div
                  key={idx}
                  onClick={() => navigate(`/deals?stage=${encodeURIComponent(stage.stage)}`)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '120px 1fr auto',
                    alignItems: 'center',
                    gap: 12,
                    padding: '6px 8px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    transition: 'background 0.12s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ fontSize: 12, fontWeight: 500, color: colors.text, textTransform: 'capitalize', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {stage.stage?.replace(/_/g, ' ') || 'Unknown'}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <div style={{ flex: 1, height: 20, background: colors.surfaceRaised, borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{
                        width: `${pct}%`,
                        height: '100%',
                        background: `linear-gradient(90deg, ${colors.accent}, ${colors.accent}cc)`,
                        borderRadius: 4,
                        transition: 'width 0.5s ease',
                      }} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
                    <span style={{ fontSize: 12, fontFamily: fonts.mono, fontWeight: 600, color: colors.text, minWidth: 60, textAlign: 'right' }}>
                      {formatCurrency(stage.total_value)}
                    </span>
                    <span style={{ fontSize: 11, color: colors.textMuted, minWidth: 55 }}>
                      ({stage.deal_count} deal{stage.deal_count !== 1 ? 's' : ''})
                    </span>
                    {(findingAct > 0 || findingWatch > 0) && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 4 }}>
                        {findingAct > 0 && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: severityColor('act'), display: 'inline-block' }} />
                            <span style={{ fontSize: 10, fontFamily: fonts.mono, color: severityColor('act') }}>{findingAct}</span>
                          </span>
                        )}
                        {findingWatch > 0 && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: severityColor('watch'), display: 'inline-block' }} />
                            <span style={{ fontSize: 10, fontFamily: fonts.mono, color: severityColor('watch') }}>{findingWatch}</span>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Findings by Rep */}
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
                  {row.owner}
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

      {/* Active Findings Feed */}
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
            View all \u2192
          </button>
        </div>

        {loading.findings ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={48} />)}
          </div>
        ) : errors.findings ? (
          <ErrorInline message={errors.findings} onRetry={fetchData} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, maxHeight: 400, overflow: 'auto' }}>
            {findings.length === 0 ? (
              <p style={{ fontSize: 12, color: colors.textMuted, textAlign: 'center', padding: 24 }}>
                No active findings
              </p>
            ) : (
              findings.map(f => (
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
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <SeverityDot severity={f.severity as any} size={7} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, color: colors.text, lineHeight: 1.4, marginBottom: 4 }}>
                        {f.message}
                      </p>
                      <div style={{ display: 'flex', gap: 12, fontSize: 11, color: colors.textMuted, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 500 }}>{f.skill_name || f.skill_id}</span>
                        {f.deal_name && <span style={{ color: colors.accent }}>{f.deal_name}</span>}
                        {f.account_name && <span>{f.account_name}</span>}
                        {(f.owner_name || f.owner_email) && <span>{f.owner_name || f.owner_email}</span>}
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
