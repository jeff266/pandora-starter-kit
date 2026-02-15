import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { formatTimeAgo, formatSchedule } from '../lib/format';
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

  const runSkill = async (skillId: string) => {
    setRunningSkill(skillId);
    try {
      await api.post(`/skills/${skillId}/run`);
      setToast({ message: `${skillId} started successfully`, type: 'success' });
      setTimeout(() => setToast(null), 3000);
      const data = await api.get('/skills');
      setSkills(Array.isArray(data) ? data : data.skills || []);
      if (expandedSkill === skillId) {
        fetchRunHistory(skillId);
      }
    } catch (err: any) {
      setToast({ message: `Failed to run ${skillId}: ${err.message}`, type: 'error' });
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

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} height={56} />)}
      </div>
    );
  }

  return (
    <div>
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {skills.map((skill, i) => {
          const isExpanded = expandedSkill === skill.id;
          const runs = runHistory[skill.id] || [];
          const catColor = categoryColors[skill.category] || colors.textMuted;

          return (
            <div key={skill.id || i} style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 10,
              overflow: 'hidden',
            }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 1fr 1fr 1fr 100px',
                  padding: '14px 16px',
                  alignItems: 'center',
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                onClick={() => toggleExpand(skill.id)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    fontSize: 10, color: colors.textMuted,
                    transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                    transition: 'transform 0.15s',
                    display: 'inline-block',
                  }}>&#9654;</span>
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>
                      {skill.name || skill.id}
                    </span>
                    {skill.description && (
                      <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
                        {skill.description}
                      </p>
                    )}
                  </div>
                </div>
                <span style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: 4,
                  background: `${catColor}15`,
                  color: catColor,
                  justifySelf: 'start',
                  textTransform: 'capitalize',
                }}>
                  {skill.category || '--'}
                </span>
                <span style={{ fontSize: 12, color: colors.textMuted }}>
                  {formatSchedule(skill.schedule)}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {skill.lastRunAt ? (
                    <>
                      <span style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: skill.lastRunStatus === 'failed' ? colors.red : colors.green,
                      }} />
                      <span style={{ fontSize: 12, color: colors.textMuted }}>
                        {formatTimeAgo(skill.lastRunAt)}
                      </span>
                    </>
                  ) : (
                    <span style={{ fontSize: 12, color: colors.textDim }}>Never</span>
                  )}
                </div>
                <button
                  onClick={e => { e.stopPropagation(); runSkill(skill.id); }}
                  disabled={runningSkill === skill.id}
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '5px 12px',
                    borderRadius: 6,
                    background: runningSkill === skill.id ? colors.surfaceHover : colors.accent,
                    color: '#fff',
                    opacity: runningSkill === skill.id ? 0.6 : 1,
                    justifySelf: 'end',
                    border: 'none',
                    cursor: runningSkill === skill.id ? 'not-allowed' : 'pointer',
                  }}
                >
                  {runningSkill === skill.id ? 'Running...' : 'Run Now'}
                </button>
              </div>

              {isExpanded && (
                <div style={{
                  borderTop: `1px solid ${colors.border}`,
                  padding: '12px 16px',
                  background: colors.surfaceRaised,
                }}>
                  <div style={{
                    fontSize: 11, fontWeight: 600, color: colors.textDim,
                    textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8,
                  }}>
                    Run History
                  </div>
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
                        gridTemplateColumns: '1fr 1fr 80px 80px 1fr',
                        gap: 8,
                        padding: '6px 0',
                        fontSize: 10,
                        fontWeight: 600,
                        color: colors.textDim,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
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
                          gridTemplateColumns: '1fr 1fr 80px 80px 1fr',
                          gap: 8,
                          padding: '6px 0',
                          fontSize: 12,
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
                          <span style={{
                            display: 'flex', alignItems: 'center', gap: 4,
                          }}>
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

      {skills.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60 }}>
          <p style={{ fontSize: 14, color: colors.textMuted }}>No skills registered</p>
        </div>
      )}
    </div>
  );
}
