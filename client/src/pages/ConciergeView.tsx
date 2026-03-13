import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../lib/api';
import { useWorkspace } from '../context/WorkspaceContext';
import { usePandoraRole, type PandoraRole } from '../context/PandoraRoleContext';
import BriefCard from '../components/BriefCard';
import MathModal from '../components/MathModal';
import AskBar from '../components/AskBar';

const S = {
  bg: '#0a0d14',
  surface: '#0f1219',
  surface2: '#141820',
  border: '#1a1f2b',
  border2: '#242b3a',
  text: '#e8ecf4',
  textSub: '#94a3b8',
  textMuted: '#5a6578',
  textDim: '#3a4252',
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

interface OpeningBriefData {
  temporal: TemporalContext;
  user: { name: string; email: string; pandoraRole: string; workspaceRole: string };
  workspace: { name: string; salesMotion: string };
  targets: {
    headline?: string;
    pctAttained?: number;
    gap?: number | string;
    closedWonValue?: number;
    periodStart?: string;
    periodEnd?: string;
    coverageRatio?: number;
  };
  pipeline: {
    totalValue?: number;
    dealCount?: number;
    weightedValue?: number;
    coverageRatio?: number;
    pipelineLabel?: string;
    closingThisWeek?: number;
    closingThisMonth?: number;
    newThisWeek?: number;
  };
  findings: {
    critical?: number;
    warning?: number;
    topFindings: TopFinding[];
    lastSkillRunAt?: string | null;
    skillRuns?: SkillRunLog[];
  };
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
      background: '#0f1219', borderRadius: 10, padding: '16px',
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

export default function ConciergeView() {
  const { currentWorkspace } = useWorkspace();
  const { pandoraRole, setPandoraRole } = usePandoraRole();

  const [loading, setLoading] = useState(true);
  const [brief, setBrief] = useState<OpeningBriefData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeMathKey, setActiveMathKey] = useState<string | null>(null);
  const [activeQuarterTab, setActiveQuarterTab] = useState<QuarterTab>('early');
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('strategic');
  const [isProjection, setIsProjection] = useState(false);

  const skeletonTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchBrief = useCallback(async (silent = false) => {
    if (!currentWorkspace?.id) return;
    if (!silent) setLoading(true);

    if (!silent) {
      skeletonTimer.current = setTimeout(() => {
        setLoading(prev => { if (prev) { setError('Brief is taking longer than expected. Please refresh.'); return false; } return prev; });
      }, 3000);
    }

    try {
      const data: OpeningBriefData = await api.get('/briefing/concierge');
      if (skeletonTimer.current) { clearTimeout(skeletonTimer.current); skeletonTimer.current = null; }
      console.log('[ConciergeView] brief response:', data);
      setBrief(data);
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
      if (skeletonTimer.current) { clearTimeout(skeletonTimer.current); skeletonTimer.current = null; }
      if (!silent) setError('Could not load your brief. Please refresh.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [currentWorkspace?.id, setPandoraRole]);

  useEffect(() => {
    fetchBrief();
    pollRef.current = setInterval(() => fetchBrief(true), 5 * 60 * 1000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (skeletonTimer.current) clearTimeout(skeletonTimer.current);
    };
  }, [fetchBrief]);

  const openMathModal = useCallback((key: string) => setActiveMathKey(key), []);
  const closeMathModal = useCallback(() => setActiveMathKey(null), []);

  const handleQuarterTab = (tab: QuarterTab) => {
    const currentPhaseOrder = tabPhaseOrder(phaseToTab(brief?.temporal?.quarterPhase));
    const newOrder = tabPhaseOrder(tab);
    setActiveQuarterTab(tab);
    setIsProjection(newOrder > currentPhaseOrder);
  };

  const subTabs = getSubTabs(pandoraRole);
  const pct = brief?.targets?.pctAttained;
  const verdictColor = healthColor(pct);
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

        {/* PROJECTION BANNER */}
        {isProjection && (
          <div style={{
            background: 'rgba(167,139,250,0.08)', border: `0.5px solid rgba(167,139,250,0.25)`,
            borderRadius: 8, padding: '8px 14px', marginBottom: 14, fontSize: 12, color: '#c4b5fd',
          }}>
            ↗ Projection — This is where{brief?.temporal?.quarterLabel ? ` ${brief.temporal.quarterLabel}` : ' this quarter'} typically stands. Based on current pipeline velocity.
          </div>
        )}

        {/* QUARTER TABS */}
        <div style={{ display: 'flex', borderBottom: `0.5px solid ${S.border}`, marginBottom: 0 }}>
          {QUARTER_TABS.map(tab => {
            const currentPhaseOrder = tabPhaseOrder(phaseToTab(brief?.temporal?.quarterPhase));
            const isFuture = tabPhaseOrder(tab.key) > currentPhaseOrder;
            const isActive = activeQuarterTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => handleQuarterTab(tab.key)}
                style={{
                  flex: 1, padding: '10px 8px', background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 11, fontWeight: isActive ? 600 : 400,
                  color: isActive ? S.text : S.textMuted,
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
            {brief.situationLine && (
              <div style={{ fontSize: 13, color: S.textSub, maxWidth: 600, marginBottom: 18, lineHeight: 1.6 }}>
                {brief.situationLine}
              </div>
            )}

            {/* VERDICT BLOCK */}
            {pct !== undefined && pct !== null && (
              <div
                onClick={() => openMathModal('coverage')}
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
                  {brief.targets?.headline && (
                    <span style={{ fontSize: 13, color: S.textSub }}>{brief.targets.headline}</span>
                  )}
                  <span
                    onClick={e => { e.stopPropagation(); openMathModal('attainment'); }}
                    style={{ fontSize: 10, color: S.textDim, marginLeft: 'auto', cursor: 'pointer' }}
                  >
                    ∑ Show math
                  </span>
                </div>

                {/* Progress bar */}
                <div style={{ height: 3, background: S.border2, borderRadius: 2, marginBottom: 8, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: verdictColor, borderRadius: 2, transition: 'width 0.5s ease' }} />
                </div>

                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {brief.targets?.closedWonValue !== undefined && (
                    <span style={{ fontSize: 11, color: S.textMuted }}>{fmtCurrency(brief.targets.closedWonValue)} closed won</span>
                  )}
                  {brief.targets?.gap !== undefined && (
                    <span style={{ fontSize: 11, color: S.textMuted }}>{typeof brief.targets.gap === 'number' ? fmtCurrency(brief.targets.gap) : brief.targets.gap} gap</span>
                  )}
                  {brief.pipeline?.coverageRatio !== undefined && (
                    <span
                      onClick={e => { e.stopPropagation(); openMathModal('coverage'); }}
                      style={{ fontSize: 11, color: S.textMuted, cursor: 'pointer', textDecoration: 'underline dotted' }}
                    >
                      {brief.pipeline.coverageRatio.toFixed(1)}x pipeline coverage
                    </span>
                  )}
                </div>
              </div>
            )}

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
            {brief.findings?.topFindings && brief.findings.topFindings.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {brief.findings.topFindings.slice(0, 5).map((finding, i) => (
                  <BriefCard
                    key={i}
                    rank={i + 1}
                    category={severityToCategory(finding.severity)}
                    eyebrow={finding.skillName || finding.dealName || ''}
                    title={finding.message || ''}
                    body={''}
                    chips={[]}
                    mathKey={finding.mathKey}
                    onClick={() => finding.mathKey ? openMathModal(finding.mathKey) : undefined}
                    onMathClick={openMathModal}
                  />
                ))}
              </div>
            )}

            {/* EMPTY STATE */}
            {(!brief.findings?.topFindings || brief.findings.topFindings.length === 0) && (
              <div style={{ textAlign: 'center', padding: '48px 24px', color: S.textMuted, fontSize: 13 }}>
                <div style={{ fontSize: 24, marginBottom: 12 }}>✓</div>
                No findings right now — your pipeline looks healthy.
              </div>
            )}
          </>
        ) : null}
      </div>

      {/* ASK BAR — sticky bottom */}
      <AskBar pandoraRole={pandoraRole} suggestedQuestion={brief?.suggestedQuestion} />

      {/* MATH MODAL */}
      <MathModal mathKey={activeMathKey} onClose={closeMathModal} />

      <style>{`
        @keyframes skeleton-pulse { 0%,100% { opacity:0.4; } 50% { opacity:0.8; } }
      `}</style>
    </div>
  );
}
