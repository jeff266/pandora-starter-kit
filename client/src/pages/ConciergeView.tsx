import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getAuthToken } from '../lib/api';
import { useWorkspace } from '../context/WorkspaceContext';
import { usePandoraRole, type PandoraRole } from '../context/PandoraRoleContext';
import BriefCard from '../components/BriefCard';
import MathModal from '../components/MathModal';
import AskBar, { type ChipId } from '../components/AskBar';
import { type ConciergeContext, formatConciergeContextPreamble } from '../types/concierge-context';
import { colors as themeColors } from '../styles/theme';

const S = {
  bg: themeColors.bg,
  surface: themeColors.surface,
  surface2: themeColors.surfaceRaised,
  border: themeColors.border,
  border2: themeColors.borderLight,
  text: themeColors.text,
  textSub: themeColors.textSecondary,
  textMuted: themeColors.textMuted,
  textDim: themeColors.textDim,
  teal: '#1D9E75',
  blue: '#378ADD',
  yellow: '#eab308',
  red: '#ef4444',
  purple: '#a78bfa',
  font: "'IBM Plex Sans', -apple-system, sans-serif",
};

type QuarterPhase = 'early' | 'mid' | 'late' | 'final_week';
type QuarterTab = 'early' | 'mid' | 'late' | 'end';
type SubTab = 'strategic' | 'tactical' | 'deals' | 'pipeline';

interface TemporalContext {
  quarterPhase: QuarterPhase;
  quarterLabel: string;
  weekNumber?: number;
  totalWeeks?: number;
  urgencyLabel?: string;
  [key: string]: unknown;
}

interface TopFinding {
  severity: string;
  message: string;
  skillName?: string;
  dealName?: string;
  age?: number | string;
  mathKey?: string;
}

interface SkillRunLog {
  skillName: string;
  status: 'success' | 'partial' | 'failed';
  findingCount?: number;
  ranAt?: string;
}

interface OvernightSummary {
  skillsRun: number;
  findingsSurfaced: number;
  autonomousActionsCompleted: number;
  pendingApprovalCount: number;
  recentActions: Array<{ title: string; actionType: string; executedAt: string }>;
  lastRunAt: string | null;
}

interface OpeningBriefData {
  temporal: TemporalContext;
  user: { name: string; email: string; pandoraRole: string; workspaceRole: string };
  workspace: { name: string; salesMotion: string };
  targets: {
    headline?: { amount: number; label: string; type: string } | null;
    pctAttained?: number | null;
    gap?: number | string | null;
    closedWonValue?: number;
    periodStart?: string | null;
    periodEnd?: string | null;
    coverageRatio?: number | null;
    hasTarget?: boolean;
  };
  pipeline: {
    totalValue?: number;
    dealCount?: number;
    weightedValue?: number;
    coverageRatio?: number | null;
    pipelineLabel?: string | null;
    closingThisWeek?: { count: number; value: number; dealNames?: string[] } | number | null;
    closingThisMonth?: { count: number; value: number } | number | null;
    newThisWeek?: { count: number; value: number } | number | null;
  };
  findings: {
    critical?: number;
    warning?: number;
    topFindings: TopFinding[];
    lastSkillRunAt?: string | null;
    skillRuns?: SkillRunLog[];
  };
  bigDealsAtRisk?: Array<{
    id: string;
    name: string;
    amount: number;
    stage: string;
    rfmGrade: string;
    rfmLabel: string;
    daysSinceActivity: number;
    ownerEmail: string;
  }>;
  movement?: {
    dealsAdvanced?: number;
    dealsClosed?: number;
    closedWonValue?: number;
    closedLostValue?: number;
    newFindings?: number;
  };
  conversations?: { recentCallCount?: number; unlinkedCalls?: number } | null;
  movementAnchorLabel?: string;
  situationLine?: string;
  suggestedQuestion?: string;
  [key: string]: unknown;
}

const QUARTER_TABS: { key: QuarterTab; label: string; phase: QuarterPhase }[] = [
  { key: 'early', label: 'W1–3 · Now',       phase: 'early' },
  { key: 'mid',   label: 'W5–9 · Execution', phase: 'mid' },
  { key: 'late',  label: 'W10–11 · Push',    phase: 'late' },
  { key: 'end',   label: 'W12–13 · Close',   phase: 'final_week' },
];

function phaseToTab(phase?: QuarterPhase): QuarterTab {
  if (!phase) return 'early';
  const map: Record<QuarterPhase, QuarterTab> = { early: 'early', mid: 'mid', late: 'late', final_week: 'end' };
  return map[phase] ?? 'early';
}

function tabPhaseOrder(tab: QuarterTab): number {
  return { early: 0, mid: 1, late: 2, end: 3 }[tab] ?? 0;
}

function getSubTabs(role: PandoraRole): SubTab[] {
  if (role === 'ae') return ['deals', 'pipeline'];
  return ['strategic', 'tactical'];
}

function healthColor(pct?: number): string {
  if (pct === undefined || pct === null) return S.teal;
  if (pct < 80) return S.red;
  if (pct < 95) return S.yellow;
  return S.teal;
}

function fmtCurrency(val?: number): string {
  if (val === undefined || val === null) return '—';
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
  return `$${val}`;
}

function fmtPct(val?: number): string {
  if (val === undefined || val === null) return '—';
  return `${Math.round(val)}%`;
}

function severityToCategory(severity: string): 'risk' | 'opportunity' | 'watch' | 'hygiene' | 'action' {
  const s = (severity || '').toLowerCase();
  if (s === 'critical' || s === 'high') return 'risk';
  if (s === 'opportunity') return 'opportunity';
  if (s === 'warning' || s === 'medium') return 'watch';
  if (s === 'hygiene') return 'hygiene';
  if (s === 'action') return 'action';
  return 'watch';
}

function SkeletonCard() {
  return (
    <div style={{
      background: S.surface, borderRadius: 10, padding: '16px',
      border: `0.5px solid ${S.border}`, animation: 'skeleton-pulse 1.5s ease-in-out infinite',
    }}>
      <div style={{ height: 10, width: '40%', background: S.border2, borderRadius: 4, marginBottom: 10 }} />
      <div style={{ height: 13, width: '80%', background: S.border2, borderRadius: 4, marginBottom: 8 }} />
      <div style={{ height: 11, width: '60%', background: S.border2, borderRadius: 4 }} />
    </div>
  );
}

function StatusDot({ status }: { status: 'success' | 'partial' | 'failed' }) {
  const color = status === 'success' ? S.teal : status === 'partial' ? S.yellow : S.red;
  return <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: color, marginRight: 6, flexShrink: 0 }} />;
}

function fmtTs(ts?: string | null): string {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

function toTitleCaseSkillName(s: string): string {
  return s.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function cleanFindingMessage(msg: string): string {
  return msg.replace(/\s+[—–]\s+[a-z][a-z0-9_]*$/, '').trim();
}

function formatActionType(actionType: string): string {
  return actionType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function deriveSituationLine(brief: OpeningBriefData): string {
  const parts: string[] = [];
  const temporal = brief.temporal as any;

  const week = temporal?.weekOfQuarter;
  const quarter = temporal?.fiscalQuarter;
  const urgency = temporal?.urgencyLabel;
  if (urgency) {
    parts.push(urgency.endsWith('.') ? urgency : `${urgency}.`);
  } else if (week && quarter) {
    parts.push(`Week ${week} of ${quarter}.`);
  }

  const hasTarget = brief.targets?.hasTarget !== false;
  const pct = brief.targets?.pctAttained;
  const headline = brief.targets?.headline;
  const coverage = brief.pipeline?.coverageRatio;

  if (hasTarget && pct != null && pct >= 0 && pct <= 200) {
    parts.push(`Attainment is at ${pct}% against a ${fmtCurrency(headline?.amount)} target.`);
  } else if (hasTarget && pct != null && pct > 200) {
    if (coverage != null) {
      parts.push(`Pipeline coverage is ${coverage.toFixed(1)}× against a ${fmtCurrency(headline?.amount)} target.`);
    }
  } else if (!hasTarget && coverage != null) {
    parts.push(`Pipeline coverage is ${coverage.toFixed(1)}×.`);
  }

  const critical = brief.findings?.critical ?? 0;
  const warning = brief.findings?.warning ?? 0;
  if (critical > 0) {
    parts.push(`${critical} deal${critical === 1 ? '' : 's'} flagged as critical risk this week.`);
  } else if (warning > 0) {
    parts.push(`${warning} deal${warning === 1 ? '' : 's'} showing warning signals.`);
  }

  return parts.join(' ');
}

export default function ConciergeView() {
  const { currentWorkspace } = useWorkspace();
  const { pandoraRole, setPandoraRole } = usePandoraRole();

  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [brief, setBrief] = useState<OpeningBriefData | null>(null);
  const [overnight, setOvernight] = useState<OvernightSummary | null>(null);
  const [overnightExpanded, setOvernightExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeMathKey, setActiveMathKey] = useState<string | null>(null);
  const [activeQuarterTab, setActiveQuarterTab] = useState<QuarterTab>('early');
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('strategic');
  const [isProjection, setIsProjection] = useState(false);

  const skeletonTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [sessionId] = useState(() => crypto.randomUUID());
  const pageLoadTime = useRef(Date.now());

  const trackInteraction = useCallback((payload: Record<string, unknown>) => {
    if (!currentWorkspace?.id) return;
    void api.post('/briefing/interaction', { sessionId, ...payload }).catch(() => {});
  }, [currentWorkspace?.id, sessionId]);

  useEffect(() => {
    const handleUnload = () => {
      if (!currentWorkspace?.id) return;
      const timeOnBriefSeconds = Math.round((Date.now() - pageLoadTime.current) / 1000);
      fetch(`/api/workspaces/${currentWorkspace.id}/briefing/interaction`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAuthToken()}`,
        },
        body: JSON.stringify({ sessionId, timeOnBriefSeconds }),
        keepalive: true,
      });
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [currentWorkspace?.id, sessionId]);

  const fetchBrief = useCallback(async (silent = false) => {
    if (!currentWorkspace?.id) return;
    if (!silent) setLoading(true);

    try {
      const raw = await api.get(`/briefing/concierge?sessionId=${sessionId}`) as any;
      // Server returns { brief: OpeningBriefData, temporal: TemporalContext, ... }
      // Merge fresh temporal over the brief object so all fields are at the top level.
      const data: OpeningBriefData = {
        ...(raw.brief ?? raw),
        temporal: raw.temporal ?? raw.brief?.temporal,
      };
      console.log('[ConciergeView] brief data:', data);
      setBrief(data);
      setOvernight(raw.overnightSummary ?? null);
      setError(null);

      const role = (data?.user?.pandoraRole ?? null) as PandoraRole;
      if (role) {
        setPandoraRole(role);
        try { localStorage.setItem('pandora_role', role); } catch {}
      }

      const tab = phaseToTab(data?.temporal?.quarterPhase);
      setActiveQuarterTab(tab);

      const subTabs = getSubTabs(role);
      setActiveSubTab(subTabs[0]);
    } catch (e: unknown) {
      if (!silent) setError('Could not load your brief. Please refresh.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [currentWorkspace?.id, setPandoraRole, sessionId]);

  useEffect(() => {
    fetchBrief();
    pollRef.current = setInterval(() => fetchBrief(true), 5 * 60 * 1000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (skeletonTimer.current) clearTimeout(skeletonTimer.current);
    };
  }, [fetchBrief]);

  useEffect(() => {
    if (brief?.temporal?.quarterPhase) {
      setActiveQuarterTab(phaseToTab(brief.temporal.quarterPhase));
    }
  }, [brief?.temporal?.quarterPhase]);

  const openMathModal = useCallback((key: string) => {
    setActiveMathKey(key);
    trackInteraction({ mathModalsOpened: [key] });
  }, [trackInteraction]);
  const closeMathModal = useCallback(() => setActiveMathKey(null), []);

  const buildConciergeContext = useCallback((): ConciergeContext | null => {
    if (!brief) return null;
    const temporal = brief.temporal as Record<string, unknown>;
    const quarter = temporal?.fiscalQuarter as string | undefined;
    const week = temporal?.weekOfQuarter as number | undefined;
    const urgency = temporal?.urgencyLabel as string | undefined;
    const quarterLabel = quarter && week
      ? `${quarter}, Week ${week}${urgency ? ` (${urgency})` : ''}`
      : quarter || '';
    const topF = (brief.findings?.topFindings?.slice(0, 3) ?? []).map((f: TopFinding) => ({
      severity: f.severity,
      message: cleanFindingMessage(f.message || ''),
    }));
    return {
      quarter: quarterLabel,
      attainmentPct: brief.targets?.hasTarget !== false ? (brief.targets?.pctAttained ?? null) : null,
      pipelineScope: {
        totalValue: brief.pipeline?.totalValue ?? null,
        dealCount: brief.pipeline?.dealCount ?? null,
        coverageRatio: brief.pipeline?.coverageRatio ?? null,
      },
      topFindings: topF,
    };
  }, [brief]);

  const navigateToChat = useCallback((message: string, ctx: ConciergeContext | null, wbrContributions?: any[]) => {
    navigate(window.location.pathname, {
      state: {
        openChatWithMessage: message,
        conciergeContext: ctx,
        wbrContributions: wbrContributions || undefined,
      },
    });
  }, [navigate]);

  const [askBarPrefill, setAskBarPrefill] = useState('');

  const handleStartWBR = useCallback(() => {
    const ctx = buildConciergeContext();
    const contributions: Array<{ id: string; type: 'finding' | 'recommendation'; title: string; body: string; severity?: 'critical' | 'warning' | 'info' }> = [];
    if (brief) {
      const _hasTarget = brief.targets?.hasTarget !== false;
      const _pct = brief.targets?.pctAttained;
      if (_hasTarget && _pct != null) {
        contributions.push({
          id: `seed-attainment-${Date.now()}`,
          type: 'finding',
          title: `Attainment: ${Math.round(_pct)}%`,
          body: `Current attainment is ${Math.round(_pct)}% against a ${fmtCurrency(brief.targets?.headline?.amount)} target. ${brief.targets?.gap ? `Gap: ${typeof brief.targets.gap === 'number' ? fmtCurrency(brief.targets.gap) : brief.targets.gap}.` : ''}`,
        });
      }
      if (brief.pipeline?.totalValue != null) {
        contributions.push({
          id: `seed-pipeline-${Date.now()}`,
          type: 'finding',
          title: `Pipeline: ${fmtCurrency(brief.pipeline.totalValue)}`,
          body: `${brief.pipeline.dealCount ?? 0} deals in pipeline. ${brief.pipeline.coverageRatio != null ? `Coverage ratio: ${brief.pipeline.coverageRatio.toFixed(1)}×.` : ''} ${brief.pipeline.weightedValue != null ? `Weighted value: ${fmtCurrency(brief.pipeline.weightedValue)}.` : ''}`,
        });
      }
      const topF = brief.findings?.topFindings?.slice(0, 3) ?? [];
      topF.forEach((f: TopFinding, i: number) => {
        contributions.push({
          id: `seed-finding-${i}-${Date.now()}`,
          type: 'finding',
          title: f.dealName || cleanFindingMessage(f.message || '').slice(0, 60),
          body: cleanFindingMessage(f.message || ''),
          severity: f.severity === 'critical' ? 'critical' : f.severity === 'warning' ? 'warning' : 'info',
        });
      });
    }
    navigateToChat(
      '📄 Assemble a WBR from this briefing. Use the attainment, pipeline, and findings as initial contributions.',
      ctx,
      contributions.length > 0 ? contributions : undefined,
    );
  }, [brief, buildConciergeContext, navigateToChat]);

  const handleChipClick = useCallback((chipId: ChipId) => {
    switch (chipId) {
      case 'live_queries': {
        const q = brief?.suggestedQuestion || 'What should I focus on today?';
        setAskBarPrefill(q);
        break;
      }
      case 'show_math': {
        const _hasTarget = brief?.targets?.hasTarget !== false;
        openMathModal(_hasTarget ? 'attainment' : 'pipeline');
        break;
      }
      case 'action_cards':
        navigate('/actions');
        break;
      case 'doc_accumulator': {
        handleStartWBR();
        break;
      }
    }
  }, [brief, navigate, openMathModal, handleStartWBR]);

  const handleQuarterTab = (tab: QuarterTab) => {
    const currentPhaseOrder = tabPhaseOrder(phaseToTab(brief?.temporal?.quarterPhase));
    const newOrder = tabPhaseOrder(tab);
    setActiveQuarterTab(tab);
    setIsProjection(newOrder > currentPhaseOrder);
  };

  const subTabs = getSubTabs(pandoraRole);
  const hasTarget = brief?.targets?.hasTarget !== false;
  const pct = brief?.targets?.pctAttained;
  const verdictColor = hasTarget ? healthColor(pct) : S.blue;
  const wsName = brief?.workspace?.name || currentWorkspace?.name || 'Pandora';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: S.font, position: 'relative' }}>
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 0 }}>

        {/* TOPBAR */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 0 10px', borderBottom: `0.5px solid ${S.border}`, marginBottom: 16, gap: 12, flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 22, height: 22, borderRadius: 5, background: S.teal,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0,
            }}>P</div>
            <span style={{ fontSize: 14, fontWeight: 600, color: S.text }}>Pandora</span>
            {pandoraRole && (
              <span style={{
                fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
                color: S.teal, background: 'rgba(29,158,117,0.10)',
                border: `0.5px solid rgba(29,158,117,0.25)`, borderRadius: 99, padding: '2px 7px',
              }}>
                {pandoraRole}
              </span>
            )}
            {brief?.temporal?.urgencyLabel && (
              <>
                <span style={{ color: S.textDim, fontSize: 12 }}>·</span>
                <span style={{ fontSize: 12, color: S.textMuted }}>{brief.temporal.urgencyLabel}</span>
              </>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {brief?.temporal?.quarterLabel && (
              <span style={{ fontSize: 12, color: S.textSub }}>{brief.temporal.quarterLabel}</span>
            )}
            {isProjection && (
              <span style={{
                fontSize: 10, fontWeight: 700, color: S.purple,
                background: 'rgba(167,139,250,0.10)', border: `0.5px solid rgba(167,139,250,0.25)`,
                borderRadius: 99, padding: '2px 8px',
              }}>
                ↗ Projection
              </span>
            )}
          </div>
        </div>

        {/* PROJECTION / PAST BANNER */}
        {(() => {
          if (!brief) return null;
          const currentOrder = tabPhaseOrder(phaseToTab(brief.temporal?.quarterPhase));
          const activeOrder = tabPhaseOrder(activeQuarterTab);
          const isFutureTab = activeOrder > currentOrder;
          const isPastTab = activeOrder < currentOrder;
          if (!isFutureTab && !isPastTab) return null;

          const coverage = brief.pipeline?.coverageRatio != null
            ? brief.pipeline.coverageRatio.toFixed(1) + '×'
            : '—';
          const critCount = brief.findings?.critical ?? 0;
          const qLabel = (brief.temporal as any)?.fiscalQuarter ?? 'Q1';

          let bannerText = '';
          if (isPastTab) {
            bannerText = `↩ Past · W1–3 · Planning — This is how ${qLabel} started. Historical data from this period.`;
          } else if (activeQuarterTab === 'end') {
            const critStr = critCount > 0 ? ` ${critCount} critical finding${critCount === 1 ? '' : 's'} active.` : '';
            bannerText = `↗ Projection · W12–13 · Close — Based on current pipeline velocity, here's how this quarter is likely to finish. Pipeline coverage today is ${coverage}.${critStr}`;
          } else if (activeQuarterTab === 'mid') {
            bannerText = `↗ Projection · W5–9 · Execution — At the midpoint, top performers have 60%+ of quota in late stage. Current weighted coverage is ${coverage}.`;
          } else if (activeQuarterTab === 'late') {
            bannerText = `↗ Projection · W10–11 · Push — Three weeks from close, the number is largely set. Key question: which deals are real?`;
          }
          if (!bannerText) return null;

          const isProj = isFutureTab;
          return (
            <div style={{
              background: isProj ? 'rgba(167,139,250,0.08)' : 'rgba(90,101,120,0.06)',
              border: `0.5px solid ${isProj ? 'rgba(167,139,250,0.3)' : 'rgba(90,101,120,0.2)'}`,
              borderLeft: `2px solid ${isProj ? '#a78bfa' : '#5a6578'}`,
              borderRadius: 8,
              padding: '9px 13px',
              marginBottom: 16,
              fontSize: 12,
              color: isProj ? '#a78bfa' : '#5a6578',
              lineHeight: 1.5,
            }}>
              {bannerText}
            </div>
          );
        })()}

        {/* QUARTER TABS */}
        <div style={{ display: 'flex', borderBottom: `0.5px solid ${S.border}`, marginBottom: 0 }}>
          {QUARTER_TABS.map(tab => {
            const currentPhaseOrder = tabPhaseOrder(phaseToTab(brief?.temporal?.quarterPhase));
            const tabOrder = tabPhaseOrder(tab.key);
            const isFuture = tabOrder > currentPhaseOrder;
            const isPast = tabOrder < currentPhaseOrder;
            const isActive = activeQuarterTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => handleQuarterTab(tab.key)}
                style={{
                  flex: 1, padding: '10px 8px', background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 11, fontWeight: isActive ? 600 : 400,
                  color: isActive ? S.text : isPast ? S.textDim : S.textMuted,
                  borderBottom: isActive ? `2px solid ${S.teal}` : '2px solid transparent',
                  fontFamily: S.font, position: 'relative', transition: 'color 0.1s',
                  whiteSpace: 'nowrap',
                }}
              >
                {tab.label}
                {isFuture && (
                  <span style={{
                    display: 'inline-block', width: 5, height: 5, borderRadius: '50%',
                    background: S.purple, marginLeft: 5, verticalAlign: 'middle', marginBottom: 1,
                  }} />
                )}
                {isPast && (
                  <span style={{
                    display: 'inline-block', width: 5, height: 5, borderRadius: '50%',
                    background: '#5a6578', marginLeft: 5, verticalAlign: 'middle', marginBottom: 1,
                  }} />
                )}
              </button>
            );
          })}
        </div>

        {/* SUB-TABS */}
        <div style={{ display: 'flex', borderBottom: `0.5px solid ${S.border}`, marginBottom: 20 }}>
          {subTabs.map(tab => {
            const isVP = tab === 'strategic' || tab === 'tactical';
            const isActive = activeSubTab === tab;
            const activeColor = isVP ? S.blue : S.teal;
            return (
              <button
                key={tab}
                onClick={() => setActiveSubTab(tab)}
                style={{
                  padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 11, fontWeight: isActive ? 600 : 400,
                  color: isActive ? S.text : S.textMuted,
                  borderBottom: isActive ? `2px solid ${activeColor}` : '2px solid transparent',
                  fontFamily: S.font, textTransform: 'capitalize', transition: 'color 0.1s',
                }}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            );
          })}
        </div>

        {/* MAIN CONTENT */}
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <style>{`@keyframes skeleton-pulse { 0%,100% { opacity:0.4; } 50% { opacity:0.8; } }`}</style>
          </div>
        ) : error ? (
          <div style={{ color: S.textMuted, fontSize: 13, padding: 24 }}>{error}</div>
        ) : brief ? (
          <>
            {/* GREETING + SITUATION */}
            {brief.user?.name && (
              <div style={{ fontSize: 20, fontWeight: 500, color: S.text, marginBottom: 6 }}>
                {brief.user.name}.
              </div>
            )}
            {(() => {
              const line = brief.situationLine || deriveSituationLine(brief);
              return line ? (
                <div style={{ fontSize: 13, color: S.textSub, maxWidth: 600, marginBottom: 18, lineHeight: 1.6 }}>
                  {line}
                </div>
              ) : null;
            })()}

            {/* VERDICT BLOCK */}
            {hasTarget && pct !== undefined && pct !== null ? (
              <div
                onClick={() => openMathModal('attainment')}
                style={{
                  border: `0.5px solid ${verdictColor}44`,
                  borderRadius: 10,
                  padding: '14px 16px',
                  cursor: 'pointer',
                  marginBottom: 20,
                  background: `${verdictColor}06`,
                  transition: 'border-color 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = `${verdictColor}88`; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = `${verdictColor}44`; }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
                  <span style={{ fontSize: 32, fontWeight: 500, color: verdictColor }}>
                    {fmtPct(pct)}
                  </span>
                  {brief.targets?.headline != null && (
                    <span style={{ fontSize: 13, color: S.textSub }}>
                      {typeof brief.targets.headline === 'object'
                        ? `${brief.targets.headline.label} · ${fmtCurrency(brief.targets.headline.amount)}`
                        : brief.targets.headline}
                    </span>
                  )}
                  <span
                    onClick={e => { e.stopPropagation(); openMathModal('attainment'); }}
                    style={{ fontSize: 10, color: S.textDim, marginLeft: 'auto', cursor: 'pointer' }}
                  >
                    ∑ Show math
                  </span>
                </div>

                <div style={{ height: 3, background: S.border2, borderRadius: 2, marginBottom: 8, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: verdictColor, borderRadius: 2, transition: 'width 0.5s ease' }} />
                </div>

                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {brief.targets?.closedWonValue !== undefined && (
                    <span style={{ fontSize: 11, color: S.textMuted }}>{fmtCurrency(brief.targets.closedWonValue)} closed won</span>
                  )}
                  {brief.targets?.gap !== undefined && brief.targets.gap !== null && (
                    <span style={{ fontSize: 11, color: S.textMuted }}>{typeof brief.targets.gap === 'number' ? fmtCurrency(brief.targets.gap) : brief.targets.gap} gap</span>
                  )}
                  {brief.pipeline?.coverageRatio != null && pct < 100 && (
                    <span
                      onClick={e => { e.stopPropagation(); openMathModal('coverage'); }}
                      style={{ fontSize: 11, color: S.textMuted, cursor: 'pointer', textDecoration: 'underline dotted' }}
                    >
                      {brief.pipeline.coverageRatio.toFixed(1)}x pipeline coverage
                    </span>
                  )}
                  {pct >= 100 && brief.pipeline?.totalValue != null && (
                    <span
                      onClick={e => { e.stopPropagation(); openMathModal('pipeline'); }}
                      style={{ fontSize: 11, color: S.textMuted, cursor: 'pointer', textDecoration: 'underline dotted' }}
                    >
                      {fmtCurrency(brief.pipeline.totalValue)} open pipeline
                    </span>
                  )}
                </div>
              </div>
            ) : !hasTarget && brief?.pipeline?.coverageRatio != null ? (
              <div
                onClick={() => openMathModal('pipeline')}
                style={{
                  border: `0.5px solid ${S.blue}44`,
                  borderRadius: 10,
                  padding: '14px 16px',
                  cursor: 'pointer',
                  marginBottom: 20,
                  background: `${S.blue}06`,
                  transition: 'border-color 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = `${S.blue}88`; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = `${S.blue}44`; }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
                  <span style={{ fontSize: 32, fontWeight: 500, color: S.blue }}>
                    {brief.pipeline.coverageRatio.toFixed(1)}×
                  </span>
                  <span style={{ fontSize: 13, color: S.textSub }}>Pipeline coverage</span>
                  <span
                    onClick={e => { e.stopPropagation(); openMathModal('pipeline'); }}
                    style={{ fontSize: 10, color: S.textDim, marginLeft: 'auto', cursor: 'pointer' }}
                  >
                    ∑ Show math
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {brief.pipeline?.totalValue !== undefined && (
                    <span style={{ fontSize: 11, color: S.textMuted }}>{fmtCurrency(brief.pipeline.totalValue)} open pipeline</span>
                  )}
                  {brief.pipeline?.weightedValue !== undefined && (
                    <span style={{ fontSize: 11, color: S.textMuted }}>{fmtCurrency(brief.pipeline.weightedValue)} weighted</span>
                  )}
                  {brief.targets?.closedWonValue !== undefined && brief.targets.closedWonValue > 0 && (
                    <span style={{ fontSize: 11, color: S.textMuted }}>{fmtCurrency(brief.targets.closedWonValue)} closed won</span>
                  )}
                </div>
              </div>
            ) : null}

            {/* ACTIVITY LOG — tactical sub-tab for non-ae roles */}
            {(pandoraRole !== 'ae') && activeSubTab === 'tactical' && brief.findings?.skillRuns && brief.findings.skillRuns.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: S.textDim, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                  Pandora overnight
                </div>
                {brief.findings.skillRuns.map((run, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: i < brief.findings.skillRuns!.length - 1 ? `0.5px solid ${S.border}` : 'none' }}>
                    <StatusDot status={run.status} />
                    <span style={{ flex: 1, fontSize: 12, color: S.textSub }}>
                      {run.skillName}{run.findingCount !== undefined ? ` · ${run.findingCount} finding${run.findingCount === 1 ? '' : 's'}` : ''}
                    </span>
                    <span style={{ fontSize: 10, color: S.textDim }}>{fmtTs(run.ranAt)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* BRIEF ITEMS */}
            {(() => {
              const riskDeals = brief.bigDealsAtRisk ?? [];
              const topFindings = brief.findings?.topFindings ?? [];
              const totalCount = (brief.findings?.critical ?? 0) + (brief.findings?.warning ?? 0);
              if (riskDeals.length === 0 && topFindings.length === 0) return null;
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 11, color: '#5a6578', marginBottom: 8 }}>
                    {riskDeals.length > 0
                      ? `${riskDeals.length} big deal${riskDeals.length > 1 ? 's' : ''} at risk · ${Math.min(topFindings.length, 5)} of ${totalCount} findings · sorted by severity`
                      : `Showing ${Math.min(topFindings.length, 5)} of ${totalCount} findings · sorted by severity`}
                  </div>

                  {/* Big Deals at Risk — always first */}
                  {riskDeals.map((deal, i) => (
                    <BriefCard
                      key={`risk-${deal.id}`}
                      rank={i + 1}
                      category="risk"
                      eyebrow="Big Deal at Risk · RFM"
                      title={deal.name}
                      body={`${fmtCurrency(deal.amount)} · ${deal.daysSinceActivity} days no activity · ${deal.rfmLabel}`}
                      chips={[]}
                      onClick={() => trackInteraction({ cardsDrilledInto: [`risk-${deal.id}`] })}
                    />
                  ))}

                  {/* Findings — ranked after big deals */}
                  {topFindings.slice(0, 5).map((finding, i) => {
                    const eyebrow = toTitleCaseSkillName(finding.skillName || finding.dealName || '');
                    const fullMsg = cleanFindingMessage(finding.message || '');
                    const title = finding.dealName
                      ? finding.dealName
                      : fullMsg.slice(0, 60) + (fullMsg.length > 60 ? '…' : '');
                    const body = fullMsg;
                    return (
                      <BriefCard
                        key={i}
                        rank={riskDeals.length + i + 1}
                        category={severityToCategory(finding.severity)}
                        eyebrow={eyebrow}
                        title={title}
                        body={body}
                        chips={[]}
                        mathKey={finding.mathKey}
                        onClick={() => {
                          const cardId = finding.mathKey || `finding-${i}`;
                          trackInteraction({ cardsDrilledInto: [cardId] });
                          if (finding.mathKey) openMathModal(finding.mathKey);
                        }}
                        onMathClick={openMathModal}
                      />
                    );
                  })}
                </div>
              );
            })()}

            {/* START WBR CTA */}
            {brief.findings?.topFindings && brief.findings.topFindings.length > 0 && (
              <button
                type="button"
                onClick={handleStartWBR}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  width: '100%', marginTop: 12, padding: '10px 14px',
                  background: 'none', border: `0.5px solid ${S.border}`,
                  borderRadius: 8, cursor: 'pointer', fontFamily: S.font,
                  fontSize: 12, color: S.textSub, transition: 'border-color 0.15s, background 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = S.teal; e.currentTarget.style.background = `${S.teal}08`; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = S.border; e.currentTarget.style.background = 'none'; }}
              >
                <span style={{ fontSize: 14 }}>📄</span>
                <span>Assemble WBR from this briefing</span>
                <span style={{ marginLeft: 'auto', fontSize: 10, color: S.textDim }}>→</span>
              </button>
            )}

            {/* EMPTY STATE */}
            {(!brief.findings?.topFindings || brief.findings.topFindings.length === 0) && (!brief.bigDealsAtRisk || brief.bigDealsAtRisk.length === 0) && (
              <div style={{ textAlign: 'center', padding: '48px 24px', color: S.textMuted, fontSize: 13 }}>
                <div style={{ fontSize: 24, marginBottom: 12 }}>✓</div>
                No findings right now — your pipeline looks healthy.
              </div>
            )}

            {/* PANDORA OVERNIGHT — strategic sub-tab, below findings */}
            {(pandoraRole !== 'ae') && activeSubTab === 'strategic' && overnight && (overnight.skillsRun > 0 || overnight.findingsSurfaced > 0 || overnight.autonomousActionsCompleted > 0 || overnight.pendingApprovalCount > 0) && (
              <div style={{
                border: `0.5px solid ${S.border}`,
                borderRadius: 10,
                marginTop: 20,
                marginBottom: 20,
                background: S.surface,
                overflow: 'hidden',
              }}>
                <div
                  onClick={() => setOvernightExpanded(prev => !prev)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '12px 16px', cursor: 'pointer', userSelect: 'none',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: S.teal, flexShrink: 0 }} />
                    <span style={{ fontSize: 10, fontWeight: 700, color: S.textDim, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Pandora ran overnight
                    </span>
                    {overnight.lastRunAt && (
                      <span style={{ fontSize: 10, color: S.textDim }}>· {fmtTs(overnight.lastRunAt)}</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ display: 'flex', gap: 12 }}>
                      {overnight.skillsRun > 0 && (
                        <span style={{ fontSize: 11, color: S.textMuted }}>
                          {overnight.skillsRun} skill{overnight.skillsRun === 1 ? '' : 's'}
                        </span>
                      )}
                      {overnight.findingsSurfaced > 0 && (
                        <span style={{ fontSize: 11, color: S.textMuted }}>
                          {overnight.findingsSurfaced} finding{overnight.findingsSurfaced === 1 ? '' : 's'}
                        </span>
                      )}
                      {overnight.autonomousActionsCompleted > 0 && (
                        <span style={{ fontSize: 11, color: S.textMuted }}>
                          {overnight.autonomousActionsCompleted} action{overnight.autonomousActionsCompleted === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: 10, color: S.textDim, transition: 'transform 0.15s', transform: overnightExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
                  </div>
                </div>

                {overnightExpanded && (
                  <div style={{ padding: '0 16px 14px', borderTop: `0.5px solid ${S.border}` }}>
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', padding: '12px 0' }}>
                      <span style={{ fontSize: 12, color: S.textSub }}>
                        <strong style={{ color: S.text }}>{overnight.skillsRun}</strong> skill{overnight.skillsRun === 1 ? '' : 's'} run
                      </span>
                      <span style={{ fontSize: 12, color: S.textSub }}>
                        <strong style={{ color: S.text }}>{overnight.findingsSurfaced}</strong> finding{overnight.findingsSurfaced === 1 ? '' : 's'} surfaced
                      </span>
                      <span style={{ fontSize: 12, color: S.textSub }}>
                        <strong style={{ color: S.text }}>{overnight.autonomousActionsCompleted}</strong> action{overnight.autonomousActionsCompleted === 1 ? '' : 's'} completed
                      </span>
                    </div>

                    {overnight.recentActions.length > 0 && (
                      <div style={{ borderTop: `0.5px solid ${S.border}`, paddingTop: 10, marginBottom: overnight.pendingApprovalCount > 0 ? 12 : 0 }}>
                        {overnight.recentActions.map((action, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                            <span style={{ width: 5, height: 5, borderRadius: '50%', background: S.teal, flexShrink: 0 }} />
                            <span style={{ fontSize: 10, color: S.textDim, flexShrink: 0 }}>{formatActionType(action.actionType)}</span>
                            <span style={{ flex: 1, fontSize: 11, color: S.textSub, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {action.title}
                            </span>
                            <span style={{ fontSize: 10, color: S.textDim, flexShrink: 0 }}>{fmtTs(action.executedAt)}</span>
                          </div>
                        ))}
                        {overnight.autonomousActionsCompleted > 5 && (
                          <div
                            onClick={() => navigate('/settings/automations')}
                            style={{ fontSize: 11, color: S.teal, cursor: 'pointer', paddingTop: 6 }}
                          >
                            See all {overnight.autonomousActionsCompleted} actions →
                          </div>
                        )}
                      </div>
                    )}

                    {overnight.pendingApprovalCount > 0 && (
                      <div
                        onClick={() => navigate('/settings/automations')}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '8px 12px', borderRadius: 6, cursor: 'pointer',
                          background: 'rgba(249,115,22,0.08)', border: '0.5px solid rgba(249,115,22,0.25)',
                          transition: 'background 0.15s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(249,115,22,0.14)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(249,115,22,0.08)'; }}
                      >
                        <span style={{ fontSize: 12, fontWeight: 500, color: '#f97316' }}>
                          {overnight.pendingApprovalCount} action{overnight.pendingApprovalCount === 1 ? '' : 's'} pending your approval
                        </span>
                        <span style={{ fontSize: 11, color: '#f97316' }}>Review →</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        ) : null}
      </div>

      {/* ASK BAR — sticky bottom */}
      <AskBar
        pandoraRole={pandoraRole}
        suggestedQuestion={brief?.suggestedQuestion}
        onChipClick={handleChipClick}
        conciergeContext={buildConciergeContext() as Record<string, unknown> | null}
        prefillValue={askBarPrefill}
        onPrefillConsumed={() => setAskBarPrefill('')}
        onSubmit={(msg) => trackInteraction({ followUpQuestions: [msg] })}
      />

      {/* MATH MODAL */}
      <MathModal
        mathKey={activeMathKey}
        onClose={closeMathModal}
        onActionApproved={(actionId) => trackInteraction({ actionsApproved: [actionId] })}
        onActionsIgnored={(actionIds) => trackInteraction({ actionsIgnored: actionIds })}
      />

      <style>{`
        @keyframes skeleton-pulse { 0%,100% { opacity:0.4; } 50% { opacity:0.8; } }
      `}</style>
    </div>
  );
}
