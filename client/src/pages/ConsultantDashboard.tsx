import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { colors, fonts } from '../styles/theme';
import { formatCurrency } from '../lib/format';
import { SkeletonCard } from '../components/Skeleton';
import { useWorkspace, WorkspaceInfo } from '../context/WorkspaceContext';
import { useDemoMode } from '../contexts/DemoModeContext';

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

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  useEffect(() => {
    refreshTimerRef.current = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchDashboard(true);
      }
    }, 5 * 60 * 1000);
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [fetchDashboard]);

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

      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
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
