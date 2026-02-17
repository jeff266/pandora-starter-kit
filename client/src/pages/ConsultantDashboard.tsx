import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { colors, fonts } from '../styles/theme';
import { formatCurrency } from '../lib/format';
import { SkeletonCard } from '../components/Skeleton';
import { useWorkspace, WorkspaceInfo } from '../context/WorkspaceContext';
import { useDemoMode } from '../contexts/DemoModeContext';
import Toast from '../components/Toast';

interface WorkspacePipeline {
  total_value: number;
  deal_count: number;
  weighted_value: number;
  avg_age_days: number;
}

interface WorkspaceFindings {
  critical: number;
  warning: number;
  info: number;
  total: number;
}

interface WorkspaceActions {
  open: number;
  critical_open: number;
  resolved_this_week: number;
  pipeline_at_risk: number;
}

interface WorkspaceConnectors {
  count: number;
  any_errors: boolean;
  last_sync: string | null;
}

interface ConsultantWorkspace {
  id: string;
  name: string;
  crm_type: 'hubspot' | 'salesforce' | null;
  conversation_source: 'gong' | 'fireflies' | null;
  pipeline: WorkspacePipeline;
  findings: WorkspaceFindings;
  actions: WorkspaceActions;
  connectors: WorkspaceConnectors;
  last_skill_run: string | null;
  skills_active: number;
}

interface ConsultantTotals {
  total_pipeline: number;
  total_deals: number;
  total_critical_findings: number;
  total_open_actions: number;
  total_pipeline_at_risk: number;
  workspaces_with_errors: number;
}

interface DashboardData {
  workspaces: ConsultantWorkspace[];
  totals: ConsultantTotals;
}

interface UnassignedCall {
  id: string;
  conversation_id: string;
  title: string | null;
  call_date: string | null;
  duration_minutes: number | null;
  participant_count: number;
  has_emails: boolean;
  transcript_preview: string | null;
  candidate_workspaces: Array<{ workspace_id: string; workspace_name: string; confidence: number; method: string }>;
}

interface CallStats {
  total_calls: number;
  assigned: number;
  unassigned: number;
  skipped: number;
  by_method: { email_match: number; calendar_match: number; transcript_scan: number; manual: number };
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function getDateString(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

function getStatusDot(ws: ConsultantWorkspace): { color: string; label: string } {
  if (!ws.crm_type && ws.connectors.count === 0) {
    return { color: colors.textMuted, label: 'Not connected' };
  }
  if (ws.findings.critical > 0 || ws.actions.critical_open > 0) {
    return { color: colors.red, label: 'Needs attention' };
  }
  if (ws.findings.warning > 0) {
    return { color: colors.yellow, label: 'Warnings' };
  }
  return { color: colors.green, label: 'Healthy' };
}

function freshnessColor(dateStr: string | null, thresholdHoursGreen: number, thresholdHoursYellow: number): string {
  if (!dateStr) return colors.textMuted;
  const hoursAgo = (Date.now() - new Date(dateStr).getTime()) / 3600000;
  if (hoursAgo < thresholdHoursGreen) return colors.green;
  if (hoursAgo < thresholdHoursYellow) return colors.yellow;
  return colors.red;
}

function timeAgoShort(dateStr: string | null): string {
  if (!dateStr) return 'never';
  const ms = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatCallDate(dateStr: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function getWhyNotMatched(call: UnassignedCall): string {
  if (call.participant_count === 0 || (call.participant_count === 1 && !call.has_emails)) {
    return 'Solo recording';
  }
  if (!call.has_emails && call.participant_count > 0) {
    return 'No participant emails';
  }
  if (call.has_emails && call.candidate_workspaces.length === 0) {
    return `${call.participant_count} participants (no email match)`;
  }
  if (call.candidate_workspaces.length >= 2) {
    return `Matched ${call.candidate_workspaces.length} workspaces`;
  }
  return 'Unmatched';
}

export default function ConsultantDashboard() {
  const navigate = useNavigate();
  const { token, user, selectWorkspace, workspaces: ctxWorkspaces } = useWorkspace();
  const { anon } = useDemoMode();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [, setTick] = useState(0);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [unassigned, setUnassigned] = useState<UnassignedCall[]>([]);
  const [stats, setStats] = useState<CallStats | null>(null);
  const [statsExpanded, setStatsExpanded] = useState(false);
  const [selectedWorkspaces, setSelectedWorkspaces] = useState<Record<string, string>>({});
  const [assigningIds, setAssigningIds] = useState<Set<string>>(new Set());
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [skipPopoverId, setSkipPopoverId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [allCaughtUp, setAllCaughtUp] = useState(false);

  const fetchDashboard = useCallback(async (isRefresh = false) => {
    if (!token) return;
    try {
      if (!isRefresh) setLoading(true);
      const res = await fetch('/api/consultant/dashboard', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
      setLastUpdated(new Date());
    } catch (err: any) {
      if (!isRefresh) setError(err.message || 'Failed to load dashboard');
    } finally {
      if (!isRefresh) setLoading(false);
    }
  }, [token]);

  const fetchUnassigned = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/consultant/calls/unassigned', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) return;
      const json = await res.json();
      const calls = json.calls || [];
      setUnassigned(calls);
      const preselected: Record<string, string> = {};
      for (const call of calls) {
        if (call.candidate_workspaces?.length > 0) {
          preselected[call.id] = call.candidate_workspaces[0].workspace_id;
        }
      }
      setSelectedWorkspaces(prev => ({ ...prev, ...preselected }));
    } catch {}
  }, [token]);

  const fetchStats = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/consultant/calls/stats', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) return;
      const json = await res.json();
      setStats(json);
    } catch {}
  }, [token]);

  useEffect(() => {
    fetchDashboard();
    fetchUnassigned();
    fetchStats();
  }, [fetchDashboard, fetchUnassigned, fetchStats]);

  useEffect(() => {
    refreshTimerRef.current = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchDashboard(true);
        fetchUnassigned();
        fetchStats();
      }
    }, 5 * 60 * 1000);
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [fetchDashboard, fetchUnassigned, fetchStats]);

  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  const handleWorkspaceClick = (ws: ConsultantWorkspace) => {
    const ctxWs = ctxWorkspaces.find(w => w.id === ws.id);
    const mapped: WorkspaceInfo = ctxWs || {
      id: ws.id,
      name: ws.name,
      slug: ws.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      role: 'member' as const,
      connector_count: ws.connectors.count,
      deal_count: ws.pipeline.deal_count,
      last_sync: ws.connectors.last_sync,
    };
    selectWorkspace(mapped);
    navigate('/');
  };

  const handleAssign = async (call: UnassignedCall) => {
    const wsId = selectedWorkspaces[call.id];
    if (!wsId || !token) return;

    const wsName = data?.workspaces.find(w => w.id === wsId)?.name || 'workspace';

    setAssigningIds(prev => new Set(prev).add(call.id));
    setRemovingIds(prev => new Set(prev).add(call.id));

    const prevUnassigned = [...unassigned];
    setTimeout(() => {
      setUnassigned(prev => {
        const next = prev.filter(c => c.id !== call.id);
        if (next.length === 0) {
          setAllCaughtUp(true);
          setTimeout(() => setAllCaughtUp(false), 3000);
        }
        return next;
      });
    }, 300);

    try {
      const res = await fetch(`/api/consultant/calls/${call.conversation_id}/assign`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: wsId }),
      });
      if (!res.ok) throw new Error('Failed');
      setToast({ message: `Assigned to ${anon.workspace(wsName)}`, type: 'success' });
      fetchStats();
    } catch {
      setUnassigned(prevUnassigned);
      setToast({ message: 'Failed to assign call', type: 'error' });
    } finally {
      setAssigningIds(prev => { const s = new Set(prev); s.delete(call.id); return s; });
      setRemovingIds(prev => { const s = new Set(prev); s.delete(call.id); return s; });
    }
  };

  const handleSkip = async (call: UnassignedCall, reason: string) => {
    if (!token) return;
    setSkipPopoverId(null);
    setRemovingIds(prev => new Set(prev).add(call.id));

    const prevUnassigned = [...unassigned];
    setTimeout(() => {
      setUnassigned(prev => {
        const next = prev.filter(c => c.id !== call.id);
        if (next.length === 0) {
          setAllCaughtUp(true);
          setTimeout(() => setAllCaughtUp(false), 3000);
        }
        return next;
      });
    }, 300);

    try {
      const res = await fetch(`/api/consultant/calls/${call.conversation_id}/skip`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) throw new Error('Failed');
      setToast({ message: 'Skipped', type: 'info' });
      fetchStats();
    } catch {
      setUnassigned(prevUnassigned);
      setToast({ message: 'Failed to skip call', type: 'error' });
    } finally {
      setRemovingIds(prev => { const s = new Set(prev); s.delete(call.id); return s; });
    }
  };

  const updatedMinAgo = Math.floor((Date.now() - lastUpdated.getTime()) / 60000);
  const updatedText = updatedMinAgo < 1 ? 'Updated just now' : `Updated ${updatedMinAgo}m ago`;

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, fontFamily: fonts.sans }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ height: 28, width: 300, background: colors.surfaceRaised, borderRadius: 6, animation: 'skeleton-pulse 1.5s ease-in-out infinite' }} />
          <div style={{ height: 14, width: 200, background: colors.surfaceRaised, borderRadius: 4, animation: 'skeleton-pulse 1.5s ease-in-out infinite' }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} height={90} />)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} height={180} />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ fontFamily: fonts.sans, padding: 40, textAlign: 'center' }}>
        <p style={{ color: colors.red, fontSize: 14, marginBottom: 12 }}>{error}</p>
        <button
          onClick={() => fetchDashboard()}
          style={{
            background: colors.accent, color: '#fff', border: 'none', borderRadius: 6,
            padding: '8px 20px', cursor: 'pointer', fontSize: 13, fontFamily: fonts.sans,
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const { workspaces, totals } = data;
  const hasConnectors = workspaces.some(w => w.connectors.count > 0);
  const autoAssigned = stats ? stats.assigned - (stats.by_method?.manual || 0) : 0;
  const autoPercent = stats && stats.total_calls > 0 ? Math.round((autoAssigned / stats.total_calls) * 100) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, fontFamily: fonts.sans }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, color: colors.text, margin: 0 }}>
            {getGreeting()}, {user?.name?.split(' ')[0] || 'there'}
          </h1>
          <p style={{ fontSize: 13, color: colors.textSecondary, marginTop: 4 }}>{getDateString()}</p>
        </div>
        <span style={{ fontSize: 11, color: colors.textMuted, marginTop: 6 }}>{updatedText}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
        <TotalCard label="Total Pipeline" value={formatCurrency(anon.amount(totals.total_pipeline))} />
        <TotalCard label="Total Deals" value={String(totals.total_deals)} />
        <TotalCard label="Critical Findings" value={String(totals.total_critical_findings)} valueColor={totals.total_critical_findings > 0 ? colors.red : colors.text} />
        <TotalCard label="Open Actions" value={String(totals.total_open_actions)} valueColor={totals.total_open_actions > 0 ? colors.yellow : colors.text} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
        {workspaces.map((ws, idx) => {
          const dot = getStatusDot(ws);
          const isNotConnected = !ws.crm_type && ws.connectors.count === 0;
          const noSkillRuns = !ws.last_skill_run && !isNotConnected;

          return (
            <div
              key={ws.id}
              onClick={() => handleWorkspaceClick(ws)}
              style={{
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: 10,
                padding: 20,
                cursor: 'pointer',
                transition: 'border-color 0.15s, transform 0.15s',
                animation: `fadeUp 0.3s ease-out ${idx * 50}ms both`,
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = colors.accent;
                e.currentTarget.style.transform = 'translateY(-1px)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = colors.border;
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%', background: dot.color,
                  flexShrink: 0, boxShadow: dot.color !== colors.textMuted ? `0 0 6px ${dot.color}40` : 'none',
                }} />
                <span style={{ fontSize: 15, fontWeight: 600, color: colors.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {anon.workspace(ws.name)}
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {ws.crm_type && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
                      padding: '2px 7px', borderRadius: 4,
                      background: ws.crm_type === 'hubspot' ? 'rgba(255,122,69,0.12)' : 'rgba(0,176,240,0.12)',
                      color: ws.crm_type === 'hubspot' ? '#ff7a45' : '#00b0f0',
                    }}>
                      {ws.crm_type}
                    </span>
                  )}
                  {ws.conversation_source && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em',
                      padding: '2px 7px', borderRadius: 4,
                      background: colors.purpleSoft, color: colors.purple,
                    }}>
                      {ws.conversation_source}
                    </span>
                  )}
                </div>
              </div>

              {isNotConnected ? (
                <p style={{ fontSize: 12, color: colors.textMuted, margin: 0 }}>No connectors configured. Click to set up.</p>
              ) : noSkillRuns ? (
                <>
                  <div style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 6 }}>
                    <span style={{ fontFamily: fonts.mono, color: colors.text, fontWeight: 500 }}>{ws.pipeline.deal_count}</span> deals · <span style={{ fontFamily: fonts.mono, color: colors.text, fontWeight: 500 }}>{formatCurrency(anon.amount(ws.pipeline.total_value))}</span> pipeline
                  </div>
                  <p style={{ fontSize: 11, color: colors.yellow, margin: 0 }}>No skill runs yet — click to run analysis</p>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 8 }}>
                    <span style={{ fontFamily: fonts.mono, color: colors.text, fontWeight: 500 }}>{ws.pipeline.deal_count}</span> deals · <span style={{ fontFamily: fonts.mono, color: colors.text, fontWeight: 500 }}>{formatCurrency(anon.amount(ws.pipeline.total_value))}</span> pipeline · <span style={{ fontFamily: fonts.mono, color: colors.text, fontWeight: 500 }}>{formatCurrency(anon.amount(ws.pipeline.weighted_value))}</span> weighted
                  </div>

                  <div style={{ display: 'flex', gap: 12, fontSize: 11, marginBottom: 8, flexWrap: 'wrap' }}>
                    {ws.findings.critical > 0 && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: colors.red, display: 'inline-block' }} />
                        <span style={{ color: colors.red, fontFamily: fonts.mono }}>{ws.findings.critical}</span>
                        <span style={{ color: colors.textMuted }}>critical</span>
                      </span>
                    )}
                    {ws.findings.warning > 0 && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: colors.yellow, display: 'inline-block' }} />
                        <span style={{ color: colors.yellow, fontFamily: fonts.mono }}>{ws.findings.warning}</span>
                        <span style={{ color: colors.textMuted }}>warnings</span>
                      </span>
                    )}
                    {ws.actions.open > 0 && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ color: colors.textSecondary, fontFamily: fonts.mono }}>{ws.actions.open}</span>
                        <span style={{ color: colors.textMuted }}>open actions</span>
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: 16, fontSize: 10, color: colors.textMuted }}>
                    <span>
                      Sync: <span style={{ color: freshnessColor(ws.connectors.last_sync, 6, 24), fontFamily: fonts.mono }}>
                        {timeAgoShort(ws.connectors.last_sync)}
                      </span>
                    </span>
                    <span>
                      Analysis: <span style={{ color: freshnessColor(ws.last_skill_run, 12, 24), fontFamily: fonts.mono }}>
                        {timeAgoShort(ws.last_skill_run)}
                      </span>
                    </span>
                    {ws.skills_active > 0 && (
                      <span>{ws.skills_active} skill{ws.skills_active !== 1 ? 's' : ''} active</span>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {stats && stats.total_calls > 0 && hasConnectors && (
        <div
          style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 10,
            padding: '12px 16px',
            animation: 'fadeUp 0.3s ease-out both',
          }}
        >
          <div
            onClick={() => setStatsExpanded(!statsExpanded)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
          >
            <span style={{ fontSize: 12, color: colors.textMuted }}>{statsExpanded ? '\u25BC' : '\u25B6'}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: colors.textSecondary }}>Call Distribution</span>
            <span style={{ fontSize: 12, color: colors.textMuted, flex: 1 }}>
              {' '}{autoAssigned} auto-assigned ({autoPercent}%)
            </span>
          </div>
          {statsExpanded && (
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10, fontSize: 11, color: colors.textSecondary }}>
              <span><span style={{ fontFamily: fonts.mono, color: colors.text, fontWeight: 500 }}>{stats.by_method.email_match}</span> email</span>
              <span><span style={{ fontFamily: fonts.mono, color: colors.text, fontWeight: 500 }}>{stats.by_method.calendar_match}</span> calendar</span>
              <span><span style={{ fontFamily: fonts.mono, color: colors.text, fontWeight: 500 }}>{stats.by_method.transcript_scan}</span> transcript</span>
              <span><span style={{ fontFamily: fonts.mono, color: colors.text, fontWeight: 500 }}>{stats.by_method.manual}</span> manual</span>
              <span><span style={{ fontFamily: fonts.mono, color: colors.text, fontWeight: 500 }}>{stats.skipped}</span> skipped</span>
            </div>
          )}
        </div>
      )}

      {(unassigned.length > 0 || allCaughtUp) && (
        <div style={{ animation: 'fadeUp 0.3s ease-out both' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 16 }}>{'\uD83D\uDCDE'}</span>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: colors.text, margin: 0 }}>
              Unassigned Calls{' '}
              <span style={{ fontFamily: fonts.mono, fontWeight: 400, color: colors.textMuted }}>({unassigned.length})</span>
            </h2>
          </div>

          {allCaughtUp && unassigned.length === 0 ? (
            <div style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 10,
              padding: '24px 20px',
              textAlign: 'center',
              color: colors.green,
              fontSize: 14,
              fontWeight: 500,
            }}>
              {'\u2713'} All caught up!
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
              {unassigned.map((call, idx) => {
                const isRemoving = removingIds.has(call.id);
                const isAssigning = assigningIds.has(call.id);
                const suggestion = call.candidate_workspaces?.[0];
                const whyNot = getWhyNotMatched(call);
                const preview = call.transcript_preview
                  ? (call.transcript_preview.length > 120 ? call.transcript_preview.substring(0, 120) + '...' : call.transcript_preview)
                  : null;

                return (
                  <div
                    key={call.id}
                    style={{
                      background: colors.surface,
                      border: `1px solid ${colors.border}`,
                      borderRadius: 10,
                      padding: 16,
                      transition: 'opacity 0.3s, transform 0.3s',
                      opacity: isRemoving ? 0 : 1,
                      transform: isRemoving ? 'translateY(-8px)' : 'translateY(0)',
                      animation: `fadeUp 0.3s ease-out ${idx * 40}ms both`,
                    }}
                  >
                    <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {anon.text(call.title || 'Untitled Call')}
                    </div>

                    <div style={{ display: 'flex', gap: 10, fontSize: 11, color: colors.textMuted, marginBottom: 6 }}>
                      {call.call_date && <span>{formatCallDate(call.call_date)}</span>}
                      {call.duration_minutes != null && <span style={{ fontFamily: fonts.mono }}>{call.duration_minutes} min</span>}
                    </div>

                    <div style={{
                      fontSize: 11, color: colors.yellow, marginBottom: 6,
                      display: 'flex', alignItems: 'center', gap: 4,
                    }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: colors.yellow, display: 'inline-block', flexShrink: 0 }} />
                      {whyNot}
                    </div>

                    {preview && (
                      <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 8, lineHeight: 1.4, fontStyle: 'italic' }}>
                        {anon.text(preview)}
                      </div>
                    )}

                    {suggestion && (
                      <div style={{ fontSize: 11, color: colors.accent, marginBottom: 8 }}>
                        Suggested: {anon.workspace(suggestion.workspace_name)}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <select
                        value={selectedWorkspaces[call.id] || ''}
                        onChange={e => setSelectedWorkspaces(prev => ({ ...prev, [call.id]: e.target.value }))}
                        style={{
                          flex: 1,
                          background: colors.surfaceRaised,
                          border: `1px solid ${colors.border}`,
                          borderRadius: 6,
                          padding: '5px 8px',
                          fontSize: 12,
                          color: colors.text,
                          fontFamily: fonts.sans,
                          outline: 'none',
                          cursor: 'pointer',
                        }}
                      >
                        <option value="">Select workspace...</option>
                        {workspaces.map(ws => (
                          <option key={ws.id} value={ws.id}>{anon.workspace(ws.name)}</option>
                        ))}
                      </select>

                      <button
                        onClick={() => handleAssign(call)}
                        disabled={!selectedWorkspaces[call.id] || isAssigning}
                        style={{
                          background: selectedWorkspaces[call.id] ? colors.accent : colors.surfaceHover,
                          color: selectedWorkspaces[call.id] ? '#fff' : colors.textMuted,
                          border: 'none',
                          borderRadius: 6,
                          padding: '5px 14px',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: selectedWorkspaces[call.id] ? 'pointer' : 'default',
                          fontFamily: fonts.sans,
                          opacity: isAssigning ? 0.7 : 1,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {isAssigning ? '\u23F3' : 'Assign'}
                      </button>

                      <div style={{ position: 'relative' }}>
                        <button
                          onClick={() => setSkipPopoverId(skipPopoverId === call.id ? null : call.id)}
                          style={{
                            background: 'transparent',
                            border: `1px solid ${colors.border}`,
                            borderRadius: 6,
                            padding: '5px 10px',
                            fontSize: 12,
                            color: colors.textSecondary,
                            cursor: 'pointer',
                            fontFamily: fonts.sans,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          Skip
                        </button>

                        {skipPopoverId === call.id && (
                          <div style={{
                            position: 'absolute',
                            bottom: '100%',
                            right: 0,
                            marginBottom: 4,
                            background: colors.surface,
                            border: `1px solid ${colors.border}`,
                            borderRadius: 8,
                            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                            overflow: 'hidden',
                            zIndex: 50,
                            minWidth: 160,
                          }}>
                            <div
                              onClick={() => handleSkip(call, 'internal')}
                              style={{ padding: '8px 12px', fontSize: 12, color: colors.text, cursor: 'pointer' }}
                              onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
                              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                            >
                              Internal meeting
                            </div>
                            <div
                              onClick={() => handleSkip(call, 'personal')}
                              style={{ padding: '8px 12px', fontSize: 12, color: colors.text, cursor: 'pointer', borderTop: `1px solid ${colors.border}` }}
                              onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
                              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                            >
                              Personal / irrelevant
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

function TotalCard({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
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
      <div style={{ fontSize: 22, fontWeight: 600, color: valueColor || colors.text, fontFamily: fonts.mono, marginTop: 6 }}>
        {value}
      </div>
    </div>
  );
}
