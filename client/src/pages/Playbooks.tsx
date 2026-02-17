import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import Skeleton from '../components/Skeleton';
import SectionErrorBoundary from '../components/SectionErrorBoundary';
import { useDemoMode } from '../contexts/DemoModeContext';

interface PlaybookStats {
  totalRuns: number;
  totalFindings: number;
  totalActions: number;
}

interface PlaybookLastRun {
  runId: string;
  skillId: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
}

interface Playbook {
  id: string;
  name: string;
  description: string;
  schedule: string;
  cronExpression: string;
  skills: string[];
  agents: string[];
  status: 'active';
  lastRun: PlaybookLastRun | null;
  nextRun: string | null;
  stats: PlaybookStats;
}

interface SkillRun {
  run_id: string;
  skill_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  trigger_type: string;
  token_usage: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number } | null;
}

interface Finding {
  id: string;
  title: string;
  severity: string;
  source_skill: string;
  created_at: string;
}

interface PlaybookDetail {
  playbook: Playbook;
  skillRuns: Record<string, SkillRun[]>;
  recentFindings: Finding[];
  recentActions: any[];
  stats: PlaybookStats;
}

function formatDuration(ms: number | null): string {
  if (!ms) return '--';
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m ${secs}s`;
}

function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  return `${(count / 1000).toFixed(1)}K`;
}

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function formatDateTime(date: string): string {
  return new Date(date).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

const sevColors: Record<string, string> = {
  critical: '#ef4444',
  warning: '#f59e0b',
  notable: '#6c5ce7',
  info: '#3b82f6',
};

const statusDot: Record<string, { color: string; label: string }> = {
  completed: { color: colors.green, label: 'Healthy' },
  running: { color: colors.accent, label: 'Running' },
  failed: { color: colors.red, label: 'Failed' },
  partial: { color: colors.yellow, label: 'Partial' },
};

export default function Playbooks() {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PlaybookDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const fetchPlaybooks = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.get('/playbooks');
      setPlaybooks(data.playbooks || []);
    } catch (err) {
      console.error('Failed to fetch playbooks:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPlaybooks(); }, [fetchPlaybooks]);

  async function loadDetail(playbookId: string) {
    setSelectedId(playbookId);
    setDetailLoading(true);
    try {
      const data = await api.get(`/playbooks/${playbookId}`);
      setDetail(data);
    } catch (err) {
      console.error('Failed to load playbook detail:', err);
      showToast('Failed to load details', 'error');
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleRunNow(playbookId: string, e?: React.MouseEvent) {
    e?.stopPropagation();
    setRunningId(playbookId);
    try {
      const result = await api.post(`/playbooks/${playbookId}/run`);
      const succeeded = result.results?.filter((r: any) => r.success).length || 0;
      const total = result.results?.length || 0;
      showToast(`Playbook complete: ${succeeded}/${total} skills succeeded`, succeeded === total ? 'success' : 'error');
      await fetchPlaybooks();
      if (selectedId === playbookId) loadDetail(playbookId);
    } catch (err: any) {
      showToast(err.message || 'Run failed', 'error');
    } finally {
      setRunningId(null);
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Skeleton width={200} height={28} borderRadius={6} />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} height={180} borderRadius={10} />
        ))}
      </div>
    );
  }

  if (selectedId && detail) {
    return (
      <SectionErrorBoundary fallbackMessage="Unable to load playbook details.">
      <PlaybookDetailView
        detail={detail}
        detailLoading={detailLoading}
        runningId={runningId}
        onBack={() => { setSelectedId(null); setDetail(null); }}
        onRunNow={handleRunNow}
        toast={toast}
      />
      </SectionErrorBoundary>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {toast && (
        <div style={{
          position: 'fixed', top: 16, right: 16, zIndex: 1000,
          padding: '10px 16px', borderRadius: 8,
          background: toast.type === 'success' ? colors.greenSoft : colors.redSoft,
          border: `1px solid ${toast.type === 'success' ? colors.green : colors.red}`,
          color: toast.type === 'success' ? colors.green : colors.red,
          fontSize: 12, fontWeight: 500,
        }}>
          {toast.message}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: colors.text, margin: 0 }}>Playbooks</h1>
          <p style={{ fontSize: 13, color: colors.textMuted, marginTop: 4 }}>
            Automated skill sequences for your revenue cadence
          </p>
        </div>
      </div>

      <SectionErrorBoundary fallbackMessage="Unable to load playbook list.">
      {playbooks.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: 60,
          background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10,
        }}>
          <p style={{ fontSize: 32, marginBottom: 12 }}>&#x25B6;</p>
          <p style={{ fontSize: 15, color: colors.textSecondary }}>No playbooks configured</p>
          <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 6 }}>
            Playbooks are derived from scheduled skill groups. Configure skill schedules to see them here.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {playbooks.map(pb => (
            <PlaybookCard
              key={pb.id}
              playbook={pb}
              isRunning={runningId === pb.id}
              onClick={() => loadDetail(pb.id)}
              onRunNow={(e) => handleRunNow(pb.id, e)}
            />
          ))}
        </div>
      )}
      </SectionErrorBoundary>
    </div>
  );
}

function PlaybookCard({ playbook, isRunning, onClick, onRunNow }: {
  playbook: Playbook;
  isRunning: boolean;
  onClick: () => void;
  onRunNow: (e: React.MouseEvent) => void;
}) {
  const lastStatus = playbook.lastRun?.status || 'completed';
  const dot = statusDot[lastStatus] || statusDot.completed;

  return (
    <div
      onClick={onClick}
      style={{
        background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10,
        padding: 20, cursor: 'pointer', transition: 'border-color 0.15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = colors.borderLight)}
      onMouseLeave={e => (e.currentTarget.style.borderColor = colors.border)}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: colors.text, margin: 0 }}>
              {playbook.name}
            </h3>
            <span style={{
              width: 8, height: 8, borderRadius: '50%', background: dot.color,
              boxShadow: `0 0 6px ${dot.color}40`,
            }} />
            <span style={{ fontSize: 10, color: dot.color, fontWeight: 600 }}>{dot.label}</span>
          </div>
          <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>
            {playbook.description}
          </p>
        </div>
        {playbook.skills.length > 0 ? (
          <button
            onClick={onRunNow}
            disabled={isRunning}
            style={{
              padding: '6px 14px', borderRadius: 6,
              background: isRunning ? colors.surfaceHover : colors.accent,
              color: isRunning ? colors.textMuted : '#fff',
              fontSize: 12, fontWeight: 600, cursor: isRunning ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap', flexShrink: 0,
            }}
          >
            {isRunning ? 'Running...' : 'Run Now'}
          </button>
        ) : (
          <span style={{
            padding: '6px 14px', borderRadius: 6,
            background: colors.surfaceRaised, color: colors.textDim,
            fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap',
          }}>
            Agent-only
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: colors.textDim, fontWeight: 600 }}>Skills:</span>
        {playbook.skills.slice(0, 3).map((s, i) => (
          <React.Fragment key={s}>
            {i > 0 && <span style={{ fontSize: 10, color: colors.textDim }}>&#x2192;</span>}
            <span style={{
              fontSize: 11, color: colors.textSecondary, padding: '2px 8px',
              background: colors.surfaceRaised, borderRadius: 4,
            }}>
              {s.replace(/-/g, ' ')}
            </span>
          </React.Fragment>
        ))}
        {playbook.skills.length > 3 && (
          <span style={{ fontSize: 11, color: colors.textMuted }}>
            +{playbook.skills.length - 3} more
          </span>
        )}
        {playbook.agents.length > 0 && (
          <>
            <span style={{ fontSize: 10, color: colors.textDim, marginLeft: 4 }}>|</span>
            <span style={{ fontSize: 11, color: colors.purple }}>
              {playbook.agents.length} agent{playbook.agents.length > 1 ? 's' : ''}
            </span>
          </>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <span style={{
          fontSize: 11, color: colors.textMuted, padding: '2px 8px',
          background: colors.surfaceRaised, borderRadius: 4,
        }}>
          {playbook.schedule}
        </span>
      </div>

      {playbook.lastRun && (
        <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 8 }}>
          Last run: {formatDateTime(playbook.lastRun.startedAt)}
          {playbook.lastRun.status === 'completed' && <span style={{ color: colors.green }}> &#x2713;</span>}
          {playbook.lastRun.status === 'failed' && <span style={{ color: colors.red }}> &#x2717;</span>}
          {playbook.lastRun.durationMs && (
            <span style={{ color: colors.textDim }}> &middot; {formatDuration(playbook.lastRun.durationMs)}</span>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, fontSize: 11 }}>
        <span style={{ color: colors.textMuted }}>
          <strong style={{ color: colors.text, fontFamily: fonts.mono }}>{playbook.stats.totalRuns}</strong> runs
        </span>
        <span style={{ color: colors.textMuted }}>
          <strong style={{ color: colors.text, fontFamily: fonts.mono }}>{playbook.stats.totalFindings}</strong> findings
        </span>
        <span style={{ color: colors.textMuted }}>
          <strong style={{ color: colors.text, fontFamily: fonts.mono }}>{playbook.stats.totalActions}</strong> actions
        </span>
      </div>
    </div>
  );
}

function PlaybookDetailView({ detail, detailLoading, runningId, onBack, onRunNow, toast }: {
  detail: PlaybookDetail;
  detailLoading: boolean;
  runningId: string | null;
  onBack: () => void;
  onRunNow: (id: string) => void;
  toast: { message: string; type: 'success' | 'error' } | null;
}) {
  const { anon } = useDemoMode();
  const pb = detail.playbook;
  const lastStatus = pb.lastRun?.status || 'completed';
  const dot = statusDot[lastStatus] || statusDot.completed;

  const allRuns: SkillRun[] = [];
  for (const skillId of Object.keys(detail.skillRuns)) {
    allRuns.push(...detail.skillRuns[skillId]);
  }
  allRuns.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {toast && (
        <div style={{
          position: 'fixed', top: 16, right: 16, zIndex: 1000,
          padding: '10px 16px', borderRadius: 8,
          background: toast.type === 'success' ? colors.greenSoft : colors.redSoft,
          border: `1px solid ${toast.type === 'success' ? colors.green : colors.red}`,
          color: toast.type === 'success' ? colors.green : colors.red,
          fontSize: 12, fontWeight: 500,
        }}>
          {toast.message}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
        <span style={{ color: colors.accent, cursor: 'pointer' }} onClick={onBack}>Playbooks</span>
        <span style={{ color: colors.textDim }}>&gt;</span>
        <span style={{ color: colors.textSecondary }}>{pb.name}</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: colors.text, margin: 0 }}>{pb.name}</h1>
            <span style={{
              width: 8, height: 8, borderRadius: '50%', background: dot.color,
              boxShadow: `0 0 6px ${dot.color}40`,
            }} />
          </div>
          <p style={{ fontSize: 13, color: colors.textMuted, marginTop: 4 }}>{pb.schedule}</p>
        </div>
        {pb.skills.length > 0 ? (
          <button
            onClick={() => onRunNow(pb.id)}
            disabled={runningId === pb.id}
            style={{
              padding: '8px 18px', borderRadius: 8,
              background: runningId === pb.id ? colors.surfaceHover : colors.accent,
              color: runningId === pb.id ? colors.textMuted : '#fff',
              fontSize: 13, fontWeight: 600, cursor: runningId === pb.id ? 'not-allowed' : 'pointer',
            }}
          >
            {runningId === pb.id ? 'Running...' : 'Run Now'}
          </button>
        ) : (
          <span style={{
            padding: '8px 18px', borderRadius: 8,
            background: colors.surfaceRaised, color: colors.textDim,
            fontSize: 12, fontWeight: 500,
          }}>
            Agent-only — runs automatically on schedule
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <StatCard label="Total Runs" value={detail.stats.totalRuns} />
        <StatCard label="Findings" value={detail.stats.totalFindings} />
        <StatCard label="Actions" value={detail.stats.totalActions} />
        <StatCard label="Skills" value={pb.skills.length + pb.agents.length} />
      </div>

      <div style={{
        background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: 20,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 600, color: colors.textDim, marginBottom: 16,
          textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          Skill Pipeline
        </div>
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4 }}>
          {pb.skills.map((skillId, i) => {
            const runs = detail.skillRuns[skillId] || [];
            const lastRun = runs[0];
            const tokens = lastRun?.token_usage?.total_tokens || 0;
            const tierLabel = i === 0 ? 'COMPUTE' : i === pb.skills.length - 1 ? 'SYNTHESIZE' : 'CLASSIFY';
            const tierColor = i === 0 ? colors.green : i === pb.skills.length - 1 ? colors.accent : colors.purple;

            return (
              <React.Fragment key={skillId}>
                {i > 0 && (
                  <div style={{
                    display: 'flex', alignItems: 'center', color: colors.textDim, fontSize: 16,
                    flexShrink: 0,
                  }}>
                    &#x2192;
                  </div>
                )}
                <div style={{
                  background: colors.surfaceRaised, border: `1px solid ${colors.border}`,
                  borderRadius: 8, padding: 14, minWidth: 160, flex: '1 0 auto',
                  borderTop: `2px solid ${tierColor}`,
                }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: colors.text, marginBottom: 6 }}>
                    {skillId.replace(/-/g, ' ')}
                  </div>
                  <div style={{
                    fontSize: 9, fontWeight: 700, color: tierColor, letterSpacing: '0.08em',
                    textTransform: 'uppercase', marginBottom: 8,
                  }}>
                    {tierLabel}
                  </div>
                  {lastRun ? (
                    <div style={{ fontSize: 11, color: colors.textMuted, display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span>{formatDuration(lastRun.duration_ms)}</span>
                      {tokens > 0 && <span>{formatTokens(tokens)} tokens</span>}
                      <span style={{
                        color: lastRun.status === 'completed' ? colors.green
                          : lastRun.status === 'failed' ? colors.red : colors.yellow,
                      }}>
                        {lastRun.status === 'completed' ? '\u2713 completed' : lastRun.status}
                      </span>
                    </div>
                  ) : (
                    <span style={{ fontSize: 11, color: colors.textDim }}>No runs yet</span>
                  )}
                </div>
              </React.Fragment>
            );
          })}
        </div>

        {pb.agents.length > 0 && (
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${colors.border}` }}>
            <div style={{
              fontSize: 10, fontWeight: 600, color: colors.textDim, marginBottom: 8,
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>
              Agents
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {pb.agents.map(agentId => (
                <span key={agentId} style={{
                  fontSize: 11, color: colors.purple, padding: '3px 10px',
                  background: 'rgba(167,139,250,0.1)', borderRadius: 4,
                }}>
                  {agentId.replace(/-/g, ' ')}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {detail.recentFindings.length > 0 && (
        <div style={{
          background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: 20,
        }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: colors.textDim, marginBottom: 12,
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            Recent Findings ({detail.recentFindings.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {detail.recentFindings.map(f => {
              const sc = sevColors[f.severity] || colors.textMuted;
              return (
                <div key={f.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                  background: colors.surfaceRaised, borderRadius: 6,
                  borderLeft: `3px solid ${sc}`,
                }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%', background: sc, flexShrink: 0,
                  }} />
                  <span style={{ fontSize: 12, color: colors.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {anon.text(f.title)}
                  </span>
                  <span style={{ fontSize: 10, color: colors.textDim, flexShrink: 0 }}>
                    {f.source_skill.replace(/-/g, ' ')}
                  </span>
                  <span style={{ fontSize: 10, color: colors.textDim, flexShrink: 0 }}>
                    {timeAgo(f.created_at)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{
        background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10,
        overflow: 'hidden',
      }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${colors.border}` }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: colors.textDim,
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            Run History
          </div>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: '0.5fr 1.5fr 1fr 0.8fr 0.6fr 0.6fr',
          padding: '8px 20px', borderBottom: `1px solid ${colors.border}`,
          fontSize: 10, fontWeight: 600, color: colors.textDim,
          textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          <span>#</span>
          <span>Started</span>
          <span>Skill</span>
          <span>Duration</span>
          <span>Status</span>
          <span style={{ textAlign: 'right' }}>Tokens</span>
        </div>

        {allRuns.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: colors.textMuted, fontSize: 12 }}>
            No runs recorded yet
          </div>
        ) : (
          allRuns.slice(0, 30).map((run, i) => {
            const isCompleted = run.status === 'completed';
            const isFailed = run.status === 'failed';
            const tokens = run.token_usage?.total_tokens || 0;

            return (
              <div key={run.run_id + i} style={{
                display: 'grid',
                gridTemplateColumns: '0.5fr 1.5fr 1fr 0.8fr 0.6fr 0.6fr',
                padding: '8px 20px', borderBottom: `1px solid ${colors.border}`,
                fontSize: 12, alignItems: 'center',
              }}>
                <span style={{ color: colors.textDim, fontFamily: fonts.mono }}>
                  {allRuns.length - i}
                </span>
                <span style={{ color: colors.textMuted }}>
                  {formatDateTime(run.started_at)}
                </span>
                <span style={{ color: colors.textSecondary }}>
                  {run.skill_id.replace(/-/g, ' ')}
                </span>
                <span style={{ color: colors.textMuted, fontFamily: fonts.mono }}>
                  {formatDuration(run.duration_ms)}
                </span>
                <span style={{
                  fontSize: 10, fontWeight: 600,
                  color: isCompleted ? colors.green : isFailed ? colors.red : colors.yellow,
                }}>
                  {isCompleted ? '\u2713' : isFailed ? '\u2717' : '\u25CF'} {run.status}
                </span>
                <span style={{
                  color: colors.textDim, fontFamily: fonts.mono, textAlign: 'right',
                }}>
                  {tokens > 0 ? formatTokens(tokens) : '--'}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div style={{
      background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: 16,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: colors.textDim, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, fontFamily: fonts.mono, color: colors.text, marginTop: 4 }}>
        {value}
      </div>
    </div>
  );
}
