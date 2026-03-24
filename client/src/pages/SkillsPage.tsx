import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { formatTimeAgo, formatSchedule } from '../lib/format';
import Skeleton from '../components/Skeleton';
import IntelligenceNav from '../components/IntelligenceNav';
import SlackSetupNudge from '../components/SlackSetupNudge';
import { usePermissions } from '../hooks/usePermissions';

interface SkillStats {
  runs30d: number;
  avgDurationMs: number;
  avgTokens: number;
  successRate: number;
  findingsCount: number;
}

interface Skill {
  id: string;
  name: string;
  category: string;
  description?: string;
  schedule?: { cron?: string; enabled?: boolean };
  lastRunAt: string | null;
  lastRunStatus: string | null;
  status: 'healthy' | 'warning' | 'stale';
  stats: SkillStats;
  isCustom?: boolean;
}

interface DashboardSummary {
  totalSkills: number;
  activeSkills: number;
  staleSkills: number;
  totalRuns30d: number;
  totalFindings: number;
}

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

interface SkillConfigHistory {
  id: string;
  change_description: string;
  change_payload: { skill_id: string; cron: string | null; enabled: boolean };
  supersedes_snapshot: { cron: string | null; enabled: boolean } | null;
  deployed_at: string;
  deployed_by: string;
  status: 'deployed' | 'rolled_back';
}

const cronLabel = (cron: string | null): string => {
  if (!cron) return 'Not set';
  if (cron === '0 8 * * 1') return 'Weekly (Mon 8am)';
  if (cron === '0 8 * * *') return 'Daily (8am)';
  if (cron === '0 8 1 * *') return 'Monthly (1st, 8am)';
  return cron;
};

const describeChange = (
  payload: { cron: string | null; enabled: boolean },
  previous: { cron: string | null; enabled: boolean } | null
): string[] => {
  if (!previous) {
    return [`Schedule created: ${cronLabel(payload.cron)}, ${payload.enabled ? 'enabled' : 'disabled'}`];
  }
  const lines: string[] = [];
  if (previous.enabled !== payload.enabled) {
    lines.push(`Schedule: ${previous.enabled ? 'enabled' : 'disabled'} → ${payload.enabled ? 'enabled' : 'disabled'}`);
  }
  if (previous.cron !== payload.cron) {
    lines.push(`Cadence: ${cronLabel(previous.cron)} → ${cronLabel(payload.cron)}`);
  }
  return lines;
};

const STATUS_DOT: Record<string, string> = {
  healthy: colors.green,
  warning: colors.yellow,
  stale: colors.textDim,
};

const CATEGORY_COLORS: Record<string, string> = {
  pipeline: colors.accent,
  deals: colors.orange,
  reporting: colors.purple,
  operations: colors.yellow,
  forecasting: colors.green,
  enrichment: '#a78bfa',
  scoring: '#f472b6',
  intelligence: '#06b6d4',
  calls: '#e879f9',
  config: colors.textMuted,
};

function StatusDot({ status }: { status: string }) {
  return (
    <span style={{
      display: 'inline-block',
      width: 8, height: 8,
      borderRadius: '50%',
      background: STATUS_DOT[status] || colors.textDim,
      flexShrink: 0,
    }} />
  );
}

function CategoryBadge({ category }: { category: string }) {
  const color = CATEGORY_COLORS[category] || colors.textMuted;
  return (
    <span style={{
      fontSize: 9, fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: '0.06em',
      color, border: `1px solid ${color}22`,
      background: `${color}11`,
      padding: '1px 5px', borderRadius: 4,
    }}>
      {category}
    </span>
  );
}

function MetricCard({ label, value, sub, color: c }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{
      background: colors.surface, border: `1px solid ${colors.border}`,
      borderRadius: 10, padding: '14px 16px', flex: 1, minWidth: 0,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: c || colors.text, marginTop: 4, fontFamily: fonts.mono }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

const SCHEDULE_PRESETS = [
  { label: 'System default', value: '__default__' },
  { label: 'On demand only', value: '__ondemand__' },
  { label: 'Monday 8 AM UTC', value: '0 8 * * 1' },
  { label: 'Wednesday 8 AM UTC', value: '0 8 * * 3' },
  { label: 'Friday 4 PM UTC', value: '0 16 * * 5' },
  { label: 'Daily 8 AM UTC', value: '0 8 * * *' },
  { label: 'Custom…', value: '__custom__' },
];

export default function SkillsPage() {
  const { canRunSkills, hasPermission } = usePermissions();
  const canConfigureSkills = hasPermission('skills.configure');
  const navigate = useNavigate();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [runHistory, setRunHistory] = useState<SkillRun[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [configHistory, setConfigHistory] = useState<SkillConfigHistory[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [runningSkills, setRunningSkills] = useState<Set<string>>(new Set());
  const [queuedSkills, setQueuedSkills] = useState<string[]>([]);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [usedFallback, setUsedFallback] = useState(false);
  const [scheduleEditing, setScheduleEditing] = useState(false);
  const [schedulePreset, setSchedulePreset] = useState<string>('__default__');
  const [scheduleCustomCron, setScheduleCustomCron] = useState('');
  const [savingSchedule, setSavingSchedule] = useState(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/skills/dashboard');
      if (data?.skills && Array.isArray(data.skills)) {
        setSkills(data.skills);
        setSummary(data.summary || null);
        setUsedFallback(false);
      } else {
        throw new Error('Invalid dashboard response');
      }
    } catch {
      try {
        const fallback = await api.get('/skills');
        const raw = Array.isArray(fallback) ? fallback : (fallback?.skills || []);
        setSkills(raw.map((s: any) => ({
          ...s,
          status: s.lastRunAt ? 'healthy' : 'stale',
          stats: { runs30d: 0, avgDurationMs: 0, avgTokens: 0, successRate: 0, findingsCount: 0 },
        })));
        setSummary(null);
        setUsedFallback(true);
      } catch {
        setSkills([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    api.get('/governance/summary')
      .then(s => setPendingCount(s?.pending_approval ?? 0))
      .catch(() => {});
    loadDashboard();
  }, [loadDashboard]);

  const quietRefreshSkill = useCallback(async (skillId: string) => {
    try {
      const [runsData, dashData] = await Promise.all([
        api.get(`/skills/${skillId}/runs?limit=10`).catch(() => null),
        api.get('/skills/dashboard').catch(() => null),
      ]);
      if (runsData) {
        const runs = Array.isArray(runsData) ? runsData : (runsData?.runs || []);
        setRunHistory(runs);
      }
      if (dashData?.skills) {
        setSkills(dashData.skills);
        setSummary(dashData.summary || null);
        const updated = dashData.skills.find((s: Skill) => s.id === skillId);
        if (updated) setSelectedSkill(updated);
      }
    } catch {
    }
  }, []);

  useEffect(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (drawerOpen && selectedSkill?.id) {
      const skillId = selectedSkill.id;
      pollIntervalRef.current = setInterval(() => {
        quietRefreshSkill(skillId);
      }, 15000);
    }
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [drawerOpen, selectedSkill?.id, quietRefreshSkill]);

  const fetchRunHistory = async (skillId: string) => {
    setLoadingRuns(true);
    try {
      const data = await api.get(`/skills/${skillId}/runs?limit=10`);
      const runs = Array.isArray(data) ? data : (data?.runs || []);
      setRunHistory(runs);
    } catch {
      setRunHistory([]);
    } finally {
      setLoadingRuns(false);
    }
  };

  const fetchConfigHistory = async (skillId: string) => {
    setLoadingHistory(true);
    try {
      const data = await api.get(`/skills/${skillId}/history`);
      setConfigHistory(data?.history || []);
    } catch {
      setConfigHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  const saveSchedule = async () => {
    if (!selectedSkill) return;
    setSavingSchedule(true);
    try {
      const cronExpr = schedulePreset === '__custom__' ? scheduleCustomCron.trim() : schedulePreset;
      if (cronExpr === '__default__') {
        await api.patch(`/skills/${selectedSkill.id}/schedule`, { cron: null, enabled: true });
      } else if (cronExpr === '__ondemand__') {
        await api.patch(`/skills/${selectedSkill.id}/schedule`, { cron: null, enabled: false });
      } else {
        await api.patch(`/skills/${selectedSkill.id}/schedule`, { cron: cronExpr, enabled: false });
      }
      showToast('Schedule updated', 'success');
      setScheduleEditing(false);
      fetchConfigHistory(selectedSkill.id);
      loadDashboard();
    } catch (err: any) {
      showToast(`Failed to save schedule: ${err.message}`, 'error');
    } finally {
      setSavingSchedule(false);
    }
  };

  const openDrawer = (skill: Skill) => {
    setSelectedSkill(skill);
    setDrawerOpen(true);
    setScheduleEditing(false);
    setSchedulePreset('__default__');
    setScheduleCustomCron('');
    fetchRunHistory(skill.id);
    fetchConfigHistory(skill.id);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setSelectedSkill(null);
    setRunHistory([]);
    setConfigHistory([]);
    setScheduleEditing(false);
  };

  const runSkill = async (skillId: string, skillName: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (runningSkills.has(skillId)) return;

    if (runningSkills.size > 0) {
      if (!queuedSkills.includes(skillId)) {
        setQueuedSkills(prev => [...prev, skillId]);
        showToast(`${skillName} queued — will run when current skill finishes`, 'success');
      }
      return;
    }

    setRunningSkills(prev => new Set(prev).add(skillId));
    try {
      const result = await api.post(`/skills/${skillId}/run`);
      const dur = result?.duration_ms ? ` in ${(result.duration_ms / 1000).toFixed(1)}s` : '';
      showToast(`${skillName} completed${dur}`, 'success');
      loadDashboard();
      if (selectedSkill?.id === skillId) fetchRunHistory(skillId);
    } catch (err: any) {
      showToast(`${skillName} failed: ${err.message}`, 'error');
    } finally {
      setRunningSkills(prev => {
        const next = new Set(prev);
        next.delete(skillId);
        return next;
      });
      setQueuedSkills(prev => {
        if (prev.length === 0) return prev;
        const [nextId, ...rest] = prev;
        const nextSkill = skills.find(s => s.id === nextId);
        if (nextSkill) {
          setTimeout(() => runSkill(nextId, nextSkill.name), 0);
        }
        return rest;
      });
    }
  };

  const handleRevert = async (governanceId: string, skillId: string) => {
    try {
      await api.post(`/governance/${governanceId}/rollback`, { reason: 'Reverted via Skills UI' });
      fetchConfigHistory(skillId);
      loadDashboard();
      showToast('Schedule reverted successfully', 'success');
    } catch {
      showToast('Failed to revert — please try again', 'error');
    }
  };

  const categories = useMemo(() => {
    const cats = new Set(skills.map(s => s.category).filter(Boolean));
    return Array.from(cats).sort();
  }, [skills]);

  const filtered = useMemo(() => {
    if (categoryFilter === 'all') return skills;
    return skills.filter(s => s.category === categoryFilter);
  }, [skills, categoryFilter]);

  const avgSuccessRate = useMemo(() => {
    if (!skills.length) return 0;
    const total = skills.reduce((sum, s) => sum + (s.stats?.successRate || 0), 0);
    return Math.round(total / skills.length);
  }, [skills]);

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Skeleton height={40} />
        <div style={{ display: 'flex', gap: 12 }}>
          {[1, 2, 3, 4].map(i => <Skeleton key={i} height={80} style={{ flex: 1 }} />)}
        </div>
        <Skeleton height={320} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, position: 'relative' }}>
      <style>{`
        @keyframes pandora-spin { to { transform: rotate(360deg); } }
        .skill-row:hover { background: ${colors.surfaceHover} !important; cursor: pointer; }
      `}</style>

      <IntelligenceNav activeTab="skills" pendingCount={pendingCount} />

      {toast && (
        <div style={{
          position: 'fixed', top: 16, right: 16, zIndex: 1100,
          padding: '10px 16px', borderRadius: 8,
          background: toast.type === 'success' ? colors.greenSoft : colors.redSoft,
          border: `1px solid ${toast.type === 'success' ? colors.green : colors.red}`,
          color: toast.type === 'success' ? colors.green : colors.red,
          fontSize: 12, fontWeight: 500,
        }}>
          {toast.message}
        </div>
      )}

      <SlackSetupNudge variant="skills" layout="card" />

      {/* Metrics Row */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <MetricCard
          label="Active Skills"
          value={summary ? summary.activeSkills.toString() : skills.filter(s => s.status === 'healthy').length.toString()}
          sub={`of ${summary?.totalSkills ?? skills.length} total`}
          color={colors.green}
        />
        <MetricCard
          label="Runs (30d)"
          value={summary ? summary.totalRuns30d.toString() : '—'}
          color={colors.accent}
        />
        <MetricCard
          label="Open Findings"
          value={summary ? summary.totalFindings.toString() : '—'}
          color={summary && summary.totalFindings > 0 ? colors.orange : colors.text}
        />
        <MetricCard
          label="Avg Success Rate"
          value={usedFallback ? '—' : `${avgSuccessRate}%`}
          color={avgSuccessRate >= 90 ? colors.green : avgSuccessRate >= 70 ? colors.yellow : colors.red}
        />
        <button
          onClick={() => navigate('/skills/new')}
          style={{
            alignSelf: 'flex-start',
            marginTop: 4,
            fontSize: 12, fontWeight: 600, padding: '8px 14px',
            borderRadius: 8, background: '#2DD4BF22',
            color: '#2DD4BF', border: '1px solid #2DD4BF44',
            cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >+ New Skill</button>
      </div>

      {/* Category Filter Pills */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['all', ...categories] as string[]).map(cat => {
          const isActive = categoryFilter === cat;
          const catColor = cat === 'all' ? colors.accent : (CATEGORY_COLORS[cat] || colors.textMuted);
          return (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              style={{
                fontSize: 11, fontWeight: 600, padding: '5px 12px',
                borderRadius: 20,
                background: isActive ? catColor : 'transparent',
                color: isActive ? '#fff' : colors.textMuted,
                border: `1px solid ${isActive ? catColor : colors.border}`,
                cursor: 'pointer', textTransform: 'capitalize',
              }}
            >
              {cat === 'all' ? `All (${skills.length})` : `${cat} (${skills.filter(s => s.category === cat).length})`}
            </button>
          );
        })}
      </div>

      {/* Skills Table */}
      <div style={{
        background: colors.surface, border: `1px solid ${colors.border}`,
        borderRadius: 10, overflow: 'hidden',
      }}>
        {/* Table Header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '28px 1fr 130px 70px 90px 70px 100px',
          gap: 8, padding: '10px 16px',
          fontSize: 10, fontWeight: 700, color: colors.textDim,
          textTransform: 'uppercase', letterSpacing: '0.05em',
          borderBottom: `1px solid ${colors.border}`,
          background: colors.surfaceRaised,
        }}>
          <span></span>
          <span>Skill</span>
          <span>Last Run</span>
          <span>Runs/30d</span>
          <span>Avg Duration</span>
          <span>Findings</span>
          <span></span>
        </div>

        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 16px', color: colors.textMuted, fontSize: 13 }}>
            No skills found
          </div>
        ) : (
          filtered.map((skill, i) => {
            const isRunning = runningSkills.has(skill.id);
            const isQueued = queuedSkills.includes(skill.id);
            const isLast = i === filtered.length - 1;
            return (
              <div
                key={skill.id}
                className="skill-row"
                onClick={() => openDrawer(skill)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '28px 1fr 130px 70px 90px 70px 100px',
                  gap: 8, padding: '11px 16px',
                  alignItems: 'center',
                  borderBottom: isLast ? 'none' : `1px solid ${colors.border}`,
                  background: selectedSkill?.id === skill.id ? colors.surfaceHover : 'transparent',
                  transition: 'background 0.1s',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <StatusDot status={skill.status} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {skill.name || skill.id}
                    </span>
                    <CategoryBadge category={skill.category} />
                    {skill.isCustom && (
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
                        background: '#2DD4BF22', color: '#2DD4BF', border: '1px solid #2DD4BF44',
                        letterSpacing: '0.06em', textTransform: 'uppercase',
                      }}>Custom</span>
                    )}
                    {skill.isCustom && (
                      <button
                        onClick={e => { e.stopPropagation(); navigate(`/skills/custom/${skill.id}/edit`); }}
                        title="Edit skill"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.textMuted, padding: '0 2px', fontSize: 12, lineHeight: 1 }}
                      >✏</button>
                    )}
                  </div>
                  {skill.description && (
                    <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {skill.description}
                    </div>
                  )}
                  {skill.id === 'strategy-insights' && skill.lastRunStatus === 'skipped_insufficient_data' && canRunSkills && (
                    <div
                      onClick={e => e.stopPropagation()}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5, padding: '5px 8px', borderRadius: 6, background: '#78350F22', border: '1px solid #78350F44', flexWrap: 'wrap' }}
                    >
                      <span style={{ fontSize: 11, color: '#F59E0B' }}>Waiting for fresh inputs — run Pipeline Hygiene and Forecast Rollup first</span>
                      <button
                        onClick={e => { e.stopPropagation(); runSkill('pipeline-hygiene', 'Pipeline Hygiene', e); }}
                        style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: '1px solid #F59E0B44', background: '#78350F33', color: '#F59E0B', cursor: 'pointer', fontWeight: 500 }}
                      >Run now</button>
                      <button
                        onClick={e => { e.stopPropagation(); runSkill('forecast-rollup', 'Forecast Rollup', e); }}
                        style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: '1px solid #F59E0B44', background: '#78350F33', color: '#F59E0B', cursor: 'pointer', fontWeight: 500 }}
                      >Run now</button>
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 12, color: colors.textMuted }}>
                  {skill.lastRunAt ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: skill.lastRunStatus === 'completed' ? colors.green : skill.lastRunStatus === 'failed' ? colors.red : colors.yellow, flexShrink: 0 }} />
                      {formatTimeAgo(skill.lastRunAt)}
                    </span>
                  ) : (
                    <span style={{ color: colors.textDim }}>Never</span>
                  )}
                </div>
                <div style={{ fontSize: 12, fontFamily: fonts.mono, color: skill.stats?.runs30d > 0 ? colors.text : colors.textDim }}>
                  {skill.stats?.runs30d ?? '—'}
                </div>
                <div style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.textMuted }}>
                  {skill.stats?.avgDurationMs ? `${(skill.stats.avgDurationMs / 1000).toFixed(1)}s` : '—'}
                </div>
                <div style={{ fontSize: 12, fontFamily: fonts.mono, color: (skill.stats?.findingsCount || 0) > 0 ? colors.orange : colors.textDim }}>
                  {skill.stats?.findingsCount ?? 0}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                  {skill.isCustom && (
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        if (window.confirm(`Delete "${skill.name}"? This cannot be undone.`)) {
                          api.delete(`/skills/custom/${skill.id}`)
                            .then(() => { showToast('Skill deleted', 'success'); loadDashboard(); })
                            .catch(() => showToast('Failed to delete skill', 'error'));
                        }
                      }}
                      title="Delete skill"
                      style={{
                        fontSize: 11, fontWeight: 600, padding: '4px 8px',
                        borderRadius: 6, background: 'transparent',
                        color: colors.textMuted,
                        border: `1px solid ${colors.border}`,
                        cursor: 'pointer',
                      }}
                    >Delete</button>
                  )}
                  {canRunSkills && (
                    <button
                      onClick={e => runSkill(skill.id, skill.name, e)}
                      disabled={isRunning || isQueued}
                      style={{
                        fontSize: 11, fontWeight: 600, padding: '4px 10px',
                        borderRadius: 6,
                      background: isRunning ? colors.surfaceHover : isQueued ? colors.surfaceRaised : colors.accent,
                      color: isQueued ? colors.yellow : '#fff',
                      opacity: isRunning ? 0.6 : 1,
                      border: isQueued ? `1px solid ${colors.yellow}` : 'none',
                      cursor: isRunning || isQueued ? 'not-allowed' : 'pointer',
                      display: 'flex', alignItems: 'center', gap: 5,
                    }}
                  >
                    {isRunning && (
                      <span style={{
                        width: 10, height: 10,
                        border: '2px solid rgba(255,255,255,0.3)',
                        borderTopColor: '#fff', borderRadius: '50%',
                        display: 'inline-block',
                        animation: 'pandora-spin 0.8s linear infinite',
                      }} />
                    )}
                    {isRunning ? 'Running' : isQueued ? 'Queued' : 'Run ▶'}
                  </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Detail Drawer */}
      {drawerOpen && selectedSkill && (
        <>
          <div
            onClick={closeDrawer}
            style={{
              position: 'fixed', inset: 0, zIndex: 40,
              background: 'rgba(0,0,0,0.45)',
            }}
          />
          <div style={{
            position: 'fixed', top: 0, right: 0, bottom: 0,
            width: 480, zIndex: 50,
            background: colors.bg,
            borderLeft: `1px solid ${colors.border}`,
            display: 'flex', flexDirection: 'column',
            overflow: 'hidden',
          }}>
            {/* Drawer Header */}
            <div style={{
              padding: '16px 20px',
              borderBottom: `1px solid ${colors.border}`,
              display: 'flex', alignItems: 'center', gap: 10,
              flexShrink: 0,
            }}>
              <StatusDot status={selectedSkill.status} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: colors.text }}>
                    {selectedSkill.name || selectedSkill.id}
                  </span>
                  <CategoryBadge category={selectedSkill.category} />
                </div>
                {selectedSkill.description && (
                  <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                    {selectedSkill.description}
                  </div>
                )}
              </div>
              <button
                onClick={closeDrawer}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: colors.textMuted, fontSize: 18, padding: 4, lineHeight: 1 }}
              >
                ×
              </button>
            </div>

            {/* Drawer Content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>

              {/* Metric Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {[
                  { label: 'Success Rate', value: usedFallback ? '—' : `${selectedSkill.stats.successRate}%`, color: selectedSkill.stats.successRate >= 90 ? colors.green : selectedSkill.stats.successRate >= 70 ? colors.yellow : colors.red },
                  { label: 'Avg Tokens', value: selectedSkill.stats.avgTokens ? selectedSkill.stats.avgTokens.toLocaleString() : '—', color: colors.text },
                  { label: 'Runs (30d)', value: selectedSkill.stats.runs30d.toString(), color: colors.accent },
                  { label: 'Open Findings', value: selectedSkill.stats.findingsCount.toString(), color: selectedSkill.stats.findingsCount > 0 ? colors.orange : colors.text },
                ].map(m => (
                  <div key={m.label} style={{
                    background: colors.surface, border: `1px solid ${colors.border}`,
                    borderRadius: 8, padding: '12px 14px',
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {m.label}
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: m.color, marginTop: 4, fontFamily: fonts.mono }}>
                      {m.value}
                    </div>
                  </div>
                ))}
              </div>

              {/* Schedule + Run Now */}
              <div style={{
                background: colors.surface, border: `1px solid ${colors.border}`,
                borderRadius: 8, padding: '12px 14px',
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Schedule
                      </span>
                      {canConfigureSkills && !scheduleEditing && (
                        <button
                          onClick={() => {
                            const curCron = selectedSkill.schedule?.cron ?? null;
                            const match = SCHEDULE_PRESETS.find(p => p.value === curCron);
                            setSchedulePreset(match ? curCron! : curCron ? '__custom__' : '__default__');
                            setScheduleCustomCron(curCron && !match ? curCron : '');
                            setScheduleEditing(true);
                          }}
                          style={{
                            fontSize: 10, fontWeight: 600, padding: '1px 7px',
                            borderRadius: 4, background: 'transparent',
                            border: `1px solid ${colors.border}`, color: colors.textMuted,
                            cursor: 'pointer', lineHeight: 1.6,
                          }}
                        >Edit</button>
                      )}
                    </div>
                    {scheduleEditing ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                        <select
                          value={schedulePreset}
                          onChange={e => setSchedulePreset(e.target.value)}
                          style={{
                            fontSize: 12, padding: '6px 8px', borderRadius: 6,
                            border: `1px solid ${colors.border}`,
                            background: colors.surfaceRaised, color: colors.text,
                            cursor: 'pointer', width: '100%',
                          }}
                        >
                          {SCHEDULE_PRESETS.map(p => (
                            <option key={p.value} value={p.value}>{p.label}</option>
                          ))}
                        </select>
                        {schedulePreset === '__custom__' && (
                          <input
                            type="text"
                            placeholder="e.g. 0 9 * * 2 (Tue 9 AM UTC)"
                            value={scheduleCustomCron}
                            onChange={e => setScheduleCustomCron(e.target.value)}
                            style={{
                              fontSize: 12, padding: '6px 8px', borderRadius: 6,
                              border: `1px solid ${colors.border}`,
                              background: colors.surfaceRaised, color: colors.text,
                              fontFamily: fonts.mono, width: '100%', boxSizing: 'border-box',
                            }}
                          />
                        )}
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            onClick={saveSchedule}
                            disabled={savingSchedule || (schedulePreset === '__custom__' && !scheduleCustomCron.trim())}
                            style={{
                              fontSize: 12, fontWeight: 600, padding: '5px 12px',
                              borderRadius: 6, background: colors.accent, color: '#fff',
                              border: 'none', cursor: savingSchedule ? 'not-allowed' : 'pointer',
                              opacity: savingSchedule ? 0.6 : 1,
                            }}
                          >
                            {savingSchedule ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            onClick={() => setScheduleEditing(false)}
                            style={{
                              fontSize: 12, padding: '5px 10px',
                              borderRadius: 6, background: 'transparent',
                              border: `1px solid ${colors.border}`, color: colors.textMuted,
                              cursor: 'pointer',
                            }}
                          >Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div style={{ fontSize: 12, color: colors.text }}>
                          {formatSchedule(selectedSkill.schedule)}
                        </div>
                        {selectedSkill.lastRunAt && (
                          <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                            Last run {formatTimeAgo(selectedSkill.lastRunAt)}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  {canRunSkills && !scheduleEditing && (
                    <button
                      onClick={e => runSkill(selectedSkill.id, selectedSkill.name, e)}
                      disabled={runningSkills.has(selectedSkill.id)}
                      style={{
                        fontSize: 12, fontWeight: 600, padding: '8px 16px',
                        borderRadius: 8, background: colors.accent, color: '#fff',
                        border: 'none', cursor: 'pointer', flexShrink: 0,
                        opacity: runningSkills.has(selectedSkill.id) ? 0.6 : 1,
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}
                    >
                      {runningSkills.has(selectedSkill.id) && (
                        <span style={{
                          width: 12, height: 12,
                          border: '2px solid rgba(255,255,255,0.3)',
                          borderTopColor: '#fff', borderRadius: '50%',
                          display: 'inline-block',
                          animation: 'pandora-spin 0.8s linear infinite',
                        }} />
                      )}
                      {runningSkills.has(selectedSkill.id) ? 'Running...' : 'Run Now ▶'}
                    </button>
                  )}
                </div>
              </div>

              {/* Governance Callout */}
              {pendingCount > 0 && (
                <div
                  onClick={() => navigate('/governance')}
                  style={{
                    background: `${colors.orange}11`,
                    border: `1px solid ${colors.orange}44`,
                    borderRadius: 8, padding: '10px 14px',
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}
                >
                  <div style={{ fontSize: 12, color: colors.orange, fontWeight: 500 }}>
                    ⚠ {pendingCount} governance proposal{pendingCount > 1 ? 's' : ''} pending review
                  </div>
                  <span style={{ fontSize: 11, color: colors.orange }}>Review in Governance →</span>
                </div>
              )}

              {/* Run History */}
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: colors.textSecondary, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Run History (last 10)
                </div>
                {loadingRuns ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {[1, 2, 3].map(i => (
                      <div key={i} style={{ height: 32, background: colors.surface, borderRadius: 4, animation: 'none', opacity: 0.6 }} />
                    ))}
                  </div>
                ) : runHistory.length === 0 ? (
                  <div style={{ fontSize: 12, color: colors.textMuted, padding: '16px 0' }}>
                    No runs recorded yet
                  </div>
                ) : (
                  <div style={{
                    background: colors.surface, border: `1px solid ${colors.border}`,
                    borderRadius: 8, overflow: 'hidden',
                  }}>
                    <div style={{
                      display: 'grid', gridTemplateColumns: '1fr 1.2fr 70px 70px',
                      gap: 8, padding: '8px 12px',
                      fontSize: 10, fontWeight: 700, color: colors.textDim,
                      textTransform: 'uppercase', letterSpacing: '0.04em',
                      borderBottom: `1px solid ${colors.border}`,
                      background: colors.surfaceRaised,
                    }}>
                      <span>Run</span>
                      <span>Started</span>
                      <span>Duration</span>
                      <span>Status</span>
                    </div>
                    {runHistory.map((run, i) => (
                      <div key={run.runId || i} style={{
                        display: 'grid', gridTemplateColumns: '1fr 1.2fr 70px 70px',
                        gap: 8, padding: '8px 12px', fontSize: 12,
                        borderBottom: i < runHistory.length - 1 ? `1px solid ${colors.border}` : 'none',
                        alignItems: 'center',
                      }}>
                        <span style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.textMuted }}>
                          {(run.runId || '').slice(0, 8) || '—'}
                        </span>
                        <span style={{ color: colors.textMuted }}>
                          {run.startedAt ? formatTimeAgo(run.startedAt) : run.createdAt ? formatTimeAgo(run.createdAt) : '—'}
                        </span>
                        <span style={{ fontFamily: fonts.mono, color: colors.textMuted }}>
                          {run.duration_ms != null ? `${(run.duration_ms / 1000).toFixed(1)}s` : '—'}
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{
                            width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                            background: run.status === 'completed' ? colors.green : run.status === 'failed' ? colors.red : colors.yellow,
                          }} />
                          <span style={{ fontSize: 11, color: run.status === 'failed' ? colors.red : colors.textMuted, textTransform: 'capitalize' }}>
                            {run.status || '—'}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Configuration History */}
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: colors.textSecondary, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Configuration History
                </div>
                {loadingHistory ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {[1, 2].map(i => (
                      <div key={i} style={{ height: 52, background: colors.surface, borderRadius: 6, opacity: 0.6 }} />
                    ))}
                  </div>
                ) : configHistory.length === 0 ? (
                  <div style={{ fontSize: 12, color: colors.textMuted, padding: '16px 0' }}>
                    No configuration changes recorded yet.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {configHistory.map(entry => {
                      const lines = describeChange(entry.change_payload, entry.supersedes_snapshot);
                      const isRolledBack = entry.status === 'rolled_back';
                      return (
                        <div key={entry.id} style={{
                          background: colors.surface,
                          border: `1px solid ${isRolledBack ? colors.border : colors.border}`,
                          borderRadius: 8, padding: '10px 12px',
                          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10,
                          opacity: isRolledBack ? 0.65 : 1,
                        }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {lines.map((line, i) => (
                              <div key={i} style={{ fontSize: 12, color: colors.text, lineHeight: 1.5 }}>
                                {line}
                              </div>
                            ))}
                            <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 4, display: 'flex', gap: 8, alignItems: 'center' }}>
                              <span title={entry.deployed_at}>
                                {formatTimeAgo(entry.deployed_at)}
                              </span>
                              <span style={{ color: colors.border }}>·</span>
                              <span>{entry.deployed_by}</span>
                              {isRolledBack && (
                                <>
                                  <span style={{ color: colors.border }}>·</span>
                                  <span style={{ color: colors.textDim, fontStyle: 'italic' }}>reverted</span>
                                </>
                              )}
                            </div>
                          </div>
                          <button
                            disabled={isRolledBack}
                            onClick={() => handleRevert(entry.id, selectedSkill!.id)}
                            style={{
                              fontSize: 11, fontWeight: 600, padding: '4px 10px',
                              borderRadius: 6, flexShrink: 0,
                              border: `1px solid ${isRolledBack ? colors.border : colors.accent}`,
                              background: 'transparent',
                              color: isRolledBack ? colors.textDim : colors.accent,
                              cursor: isRolledBack ? 'default' : 'pointer',
                              opacity: isRolledBack ? 0.5 : 1,
                            }}
                          >
                            Revert
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
