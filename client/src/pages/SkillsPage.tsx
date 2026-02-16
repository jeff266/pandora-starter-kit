import React, { useEffect, useState, useMemo } from 'react';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { formatTimeAgo, formatSchedule, severityColor } from '../lib/format';
import Skeleton from '../components/Skeleton';

interface SkillRun {
  runId: string;
  status: string;
  triggerType: string;
  duration_ms: number | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  findings_produced?: { act?: number; watch?: number; notable?: number; info?: number };
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningSkill, setRunningSkill] = useState<string | null>(null);
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const [runHistory, setRunHistory] = useState<Record<string, SkillRun[]>>({});
  const [loadingRuns, setLoadingRuns] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    api.get('/skills')
      .then(data => setSkills(Array.isArray(data) ? data : data.skills || []))
      .catch(() => setSkills([]))
      .finally(() => setLoading(false));
  }, []);

  const runSkill = async (skillId: string, skillName: string) => {
    setRunningSkill(skillId);
    try {
      const result = await api.post(`/skills/${skillId}/run`);
      const dur = result?.duration_ms ? `${(result.duration_ms / 1000).toFixed(1)}s` : '';
      setToast({ message: `${skillName} completed${dur ? ` in ${dur}` : ''}`, type: 'success' });
      setTimeout(() => setToast(null), 4000);
      const data = await api.get('/skills');
      setSkills(Array.isArray(data) ? data : data.skills || []);
      if (expandedSkill === skillId) {
        fetchRunHistory(skillId);
      }
    } catch (err: any) {
      setToast({ message: `${skillName} failed: ${err.message}`, type: 'error' });
      setTimeout(() => setToast(null), 5000);
    } finally {
      setRunningSkill(null);
    }
  };

  const fetchRunHistory = async (skillId: string) => {
    setLoadingRuns(skillId);
    try {
      const data = await api.get(`/skills/${skillId}/runs?limit=10`);
      const runs = Array.isArray(data) ? data : data.runs || [];
      setRunHistory(prev => ({ ...prev, [skillId]: runs }));
    } catch {
      setRunHistory(prev => ({ ...prev, [skillId]: [] }));
    } finally {
      setLoadingRuns(null);
    }
  };

  const toggleExpand = (skillId: string) => {
    if (expandedSkill === skillId) {
      setExpandedSkill(null);
    } else {
      setExpandedSkill(skillId);
      if (!runHistory[skillId]) {
        fetchRunHistory(skillId);
      }
    }
  };

  const categoryColors: Record<string, string> = {
    pipeline: colors.accent,
    deals: colors.orange,
    reporting: colors.purple,
    operations: colors.yellow,
    forecasting: colors.green,
    enrichment: '#a78bfa',
    scoring: '#f472b6',
    intelligence: '#06b6d4',
    config: colors.textMuted,
  };

  const grouped = useMemo(() => {
    const groups: Record<string, any[]> = {};
    skills.forEach(skill => {
      const cat = skill.category || 'other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(skill);
    });
    const order = ['pipeline', 'deals', 'reporting', 'operations', 'forecasting', 'enrichment', 'scoring', 'intelligence', 'config', 'other'];
    return order.filter(c => groups[c]).map(c => ({ category: c, skills: groups[c] }));
  }, [skills]);

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Skeleton height={40} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={120} />)}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <style>{`@keyframes pandora-spin { to { transform: rotate(360deg); } }`}</style>
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

      <div style={{
        background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: 16,
      }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: colors.text, margin: 0 }}>Skills</h2>
        <p style={{ fontSize: 12, color: colors.textMuted, margin: '4px 0 0' }}>
          {skills.length} registered skills across {grouped.length} categories
        </p>
      </div>

      {grouped.map(group => {
        const catColor = categoryColors[group.category] || colors.textMuted;

        return (
          <div key={group.category}>
            <div style={{
              fontSize: 10, fontWeight: 700, color: catColor,
              textTransform: 'uppercase', letterSpacing: '0.08em',
              marginBottom: 8, padding: '0 4px',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ width: 8, height: 2, background: catColor, borderRadius: 1 }} />
              {group.category} ({group.skills.length})
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {group.skills.map((skill: any) => {
                const isExpanded = expandedSkill === skill.id;
                const runs = runHistory[skill.id] || [];
                const isRunning = runningSkill === skill.id;

                return (
                  <div key={skill.id} style={{
                    background: colors.surface,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 10,
                    overflow: 'hidden',
                    gridColumn: isExpanded ? '1 / -1' : undefined,
                  }}>
                    {/* Skill Card */}
                    <div style={{ padding: 16 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                        <div style={{ flex: 1 }}>
                          <span style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>
                            {skill.name || skill.id}
                          </span>
                          {skill.description && (
                            <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 4, lineHeight: 1.4 }}>
                              {skill.description.slice(0, 100)}{skill.description.length > 100 ? '...' : ''}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={e => { e.stopPropagation(); runSkill(skill.id, skill.name || skill.id); }}
                          disabled={isRunning}
                          style={{
                            fontSize: 11, fontWeight: 600, padding: '5px 14px', borderRadius: 6,
                            background: isRunning ? colors.surfaceHover : colors.accent,
                            color: '#fff', opacity: isRunning ? 0.6 : 1,
                            border: 'none', cursor: isRunning ? 'not-allowed' : 'pointer',
                            flexShrink: 0, marginLeft: 12,
                            display: 'flex', alignItems: 'center', gap: 6,
                          }}
                        >
                          {isRunning && (
                            <span style={{
                              width: 12, height: 12, border: '2px solid rgba(255,255,255,0.3)',
                              borderTopColor: '#fff', borderRadius: '50%',
                              display: 'inline-block',
                              animation: 'pandora-spin 0.8s linear infinite',
                            }} />
                          )}
                          {isRunning ? 'Running...' : 'Run Now \u25B6'}
                        </button>
                      </div>

                      <div style={{ display: 'flex', gap: 16, fontSize: 11, color: colors.textMuted, flexWrap: 'wrap' }}>
                        <span>Schedule: {formatSchedule(skill.schedule)}</span>
                        {skill.lastRunAt && (
                          <span>
                            Last run: {formatTimeAgo(skill.lastRunAt)}
                            {skill.lastRunDuration != null && ` · ${(skill.lastRunDuration / 1000).toFixed(1)}s`}
                            {' · '}
                            <span style={{ color: skill.lastRunStatus === 'failed' ? colors.red : colors.green }}>
                              {skill.lastRunStatus === 'completed' ? '✅' : skill.lastRunStatus === 'failed' ? '❌' : '⏳'} {skill.lastRunStatus || 'unknown'}
                            </span>
                          </span>
                        )}
                        {!skill.lastRunAt && <span>Never run</span>}
                      </div>

                      {/* Findings produced from last run */}
                      {skill.lastRunFindings && (
                        <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
                          <span style={{ fontSize: 10, color: colors.textMuted }}>Findings:</span>
                          {['act', 'watch', 'notable'].map(sev => {
                            const count = skill.lastRunFindings?.[sev] || 0;
                            if (count === 0) return null;
                            return (
                              <span key={sev} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: severityColor(sev), display: 'inline-block' }} />
                                <span style={{ fontSize: 10, fontFamily: fonts.mono, color: severityColor(sev) }}>{count}</span>
                              </span>
                            );
                          })}
                        </div>
                      )}

                      <button
                        onClick={() => toggleExpand(skill.id)}
                        style={{
                          fontSize: 11, color: colors.accent, background: 'none', border: 'none',
                          cursor: 'pointer', marginTop: 8, padding: 0,
                        }}
                      >
                        {isExpanded ? '\u25BE' : '\u25B8'} Run History
                      </button>
                    </div>

                    {/* Expanded Run History */}
                    {isExpanded && (
                      <div style={{
                        borderTop: `1px solid ${colors.border}`,
                        padding: '12px 16px',
                        background: colors.surfaceRaised,
                      }}>
                        {loadingRuns === skill.id ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {Array.from({ length: 3 }).map((_, j) => <Skeleton key={j} height={28} />)}
                          </div>
                        ) : runs.length === 0 ? (
                          <p style={{ fontSize: 12, color: colors.textMuted, padding: '8px 0' }}>
                            No runs recorded yet
                          </p>
                        ) : (
                          <div>
                            <div style={{
                              display: 'grid',
                              gridTemplateColumns: '1fr 1.2fr 80px 80px 1fr',
                              gap: 8, padding: '6px 0',
                              fontSize: 10, fontWeight: 600, color: colors.textDim,
                              textTransform: 'uppercase', letterSpacing: '0.04em',
                              borderBottom: `1px solid ${colors.border}`,
                            }}>
                              <span>Run ID</span>
                              <span>Started</span>
                              <span>Duration</span>
                              <span>Status</span>
                              <span>Trigger</span>
                            </div>
                            {runs.map((run) => (
                              <div key={run.runId} style={{
                                display: 'grid',
                                gridTemplateColumns: '1fr 1.2fr 80px 80px 1fr',
                                gap: 8, padding: '6px 0', fontSize: 12,
                                borderBottom: `1px solid ${colors.border}`,
                                alignItems: 'center',
                              }}>
                                <span style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {run.runId?.slice(0, 8) || '--'}
                                </span>
                                <span style={{ color: colors.textMuted }}>
                                  {run.startedAt ? formatTimeAgo(run.startedAt) : run.createdAt ? formatTimeAgo(run.createdAt) : '--'}
                                </span>
                                <span style={{ fontFamily: fonts.mono, color: colors.textMuted }}>
                                  {run.duration_ms != null ? `${(run.duration_ms / 1000).toFixed(1)}s` : '--'}
                                </span>
                                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <span style={{
                                    width: 6, height: 6, borderRadius: '50%',
                                    background: run.status === 'completed' ? colors.green : run.status === 'failed' ? colors.red : colors.yellow,
                                  }} />
                                  <span style={{ fontSize: 11, color: run.status === 'failed' ? colors.red : colors.textMuted, textTransform: 'capitalize' }}>
                                    {run.status || '--'}
                                  </span>
                                </span>
                                <span style={{ fontSize: 11, color: colors.textMuted, textTransform: 'capitalize' }}>
                                  {run.triggerType || '--'}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {skills.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <p style={{ fontSize: 14, color: colors.textMuted }}>No skills registered</p>
        </div>
      )}
    </div>
  );
}
