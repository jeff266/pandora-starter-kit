import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getAuthToken } from '../lib/api';
import { useWorkspace } from '../context/WorkspaceContext';
import { usePandoraRole, type PandoraRole } from '../context/PandoraRoleContext';
import BriefCard from '../components/BriefCard';
import MathModal from '../components/MathModal';
import StreamingGreeting from '../components/StreamingGreeting';
import { PixelAvatarPandora } from '../components/PixelAvatar';
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

interface TemporalContext {
  quarterPhase: QuarterPhase;
  quarterLabel: string;
  weekNumber?: number;
  totalWeeks?: number;
  urgencyLabel?: string;
  [key: string]: unknown;
}

interface TopFinding {
  id?: string;
  severity: string;
  message: string;
  skillName?: string;
  dealName?: string;
  age?: number | string;
  mathKey?: string;
  is_watched?: boolean;
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

interface PendingAction {
  id: string;
  title: string;
  description?: string;
  rule_name?: string;
  deal_name?: string;
  action_type?: string;
  created_at?: string;
  // Available from actions table — used for HITL-aware labels
  category?: string | null;
  block_reason?: string | null;
  approval_status?: string | null;
  execution_status?: string | null;
  // NOTE: columns hitl_required (boolean), is_always_queue (boolean), and hitl_reason (text)
  // do not yet exist on the actions table. Once added and included in the
  // /workflow-rules/pending SELECT, replace the block_reason fallback below
  // with: action.hitl_required && action.is_always_queue → "protected field — always requires approval"
  //        action.hitl_required && !action.is_always_queue → "awaiting approval" + category sub-label
  //        !action.hitl_required && action.status === 'executed' → "executed automatically"
  hitl_required?: boolean;
  is_always_queue?: boolean;
  hitl_reason?: string | null;
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
    pipeline?: string;
    scopeId?: string;
  }>;
  groupedDeals?: Array<{
    group: string;
    label: string;
    deals: Array<{
      id: string;
      name: string;
      amount: number;
      stage: string;
      rfmGrade: string;
      rfmLabel: string;
      daysSinceActivity: number;
      ownerEmail: string;
      pipeline?: string;
      scopeId?: string;
    }>;
    totalValue: number;
    criticalCount: number;
  }> | null;
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
  estimatedQ2Coverage?: { estimatedQ2Coverage: number | null; openPipelineWeighted?: number; expectedRolloverValue?: number; rolloverDealCount?: number; q2Target?: number; confidence?: string; note?: string } | null;
  priorityFrame?: {
    frameLabel: string;
    primaryTopics: string[];
    suppressTopics: string[];
    cell?: string;
  } | null;
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

function healthColor(pct?: number): string {
  if (pct === undefined || pct === null) return S.teal;
  if (pct < 80) return S.red;
  if (pct < 95) return S.yellow;
  return S.teal;
}

function fmtStage(stage: string): string {
  const map: Record<string, string> = {
    evaluation: 'Evaluation',
    proposal: 'Proposal',
    contract: 'Contract Review',
    demo: 'Demo',
  };
  return map[(stage || '').toLowerCase()] || (stage ? stage.charAt(0).toUpperCase() + stage.slice(1) : '');
}

function fmtDormantAge(days: number): string {
  if (days > 365) { const y = Math.round(days / 365); return `${y} year${y === 1 ? '' : 's'} ago`; }
  if (days > 60)  { const m = Math.round(days / 30);  return `${m} month${m === 1 ? '' : 's'} ago`; }
  if (days > 30)  { const w = Math.round(days / 7);   return `${w} week${w === 1 ? '' : 's'} ago`; }
  return `${Math.round(days)} days ago`;
}

function fmtCurrency(val?: number): string {
  if (val === undefined || val === null) return '—';
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
  return `$${val}`;
}

interface RiskCardAction {
  label: string;
  variant: 'primary' | 'secondary' | 'danger';
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
}

const RISK_ACTION_VARIANT: Record<'primary' | 'secondary' | 'danger', React.CSSProperties> = {
  primary:   { background: '#1D9E75', color: '#fff', border: 'none' },
  secondary: { background: 'transparent', color: '#94a3b8', border: '0.5px solid #242b3a' },
  danger:    { background: 'transparent', color: '#ef4444', border: '0.5px solid rgba(239,68,68,0.5)' },
};

interface RiskDealCardProps {
  rank: number;
  eyebrow: string;
  title: string;
  body: string;
  dormantLine: string | null;
  soWhat: string | null;
  borderColor: string;
  surface: string;
  border: string;
  borderLight: string;
  textColor: string;
  textSub: string;
  textMuted: string;
  textDim: string;
  font: string;
  onClick: () => void;
  actions?: RiskCardAction[];
}

function RiskDealCard({ rank, eyebrow, title, body, dormantLine, soWhat, borderColor, surface, border, borderLight, textColor, textSub, textMuted, textDim, font, onClick, actions }: RiskDealCardProps) {
  const [hovered, setHovered] = React.useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: surface,
        border: `0.5px solid ${hovered ? borderLight : border}`,
        borderRadius: 10,
        borderLeft: `2px solid ${borderColor}`,
        padding: '12px 13px',
        cursor: 'pointer',
        transition: 'border-color 0.15s',
        fontFamily: font,
      }}
    >
      {/* TOP ROW */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 10, color: textDim, fontWeight: 600, minWidth: 14 }}>#{rank}</span>
        <span style={{
          fontSize: 9, fontWeight: 600, color: '#ef4444',
          background: 'rgba(239,68,68,0.10)',
          border: '0.5px solid rgba(239,68,68,0.22)',
          borderRadius: 99, padding: '2px 7px',
          textTransform: 'uppercase' as const, letterSpacing: '0.04em',
        }}>
          Risk
        </span>
        <span style={{ fontSize: 11, color: textMuted, flex: 1, whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {eyebrow}
        </span>
      </div>
      {/* TITLE */}
      <div style={{ fontSize: 13, fontWeight: 500, color: textColor, marginBottom: 5, lineHeight: 1.4 }}>
        {title}
      </div>
      {/* BODY */}
      <div style={{ fontSize: 12, color: textSub, lineHeight: 1.5 }}>
        {body}
      </div>
      {/* DORMANT SECONDARY LINE */}
      {dormantLine && (
        <div style={{ fontSize: 11, color: '#5a6578', marginTop: 4, lineHeight: 1.5 }}>
          {dormantLine}
        </div>
      )}
      {/* SO WHAT */}
      {soWhat && (
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6, fontStyle: 'italic', lineHeight: 1.5 }}>
          {soWhat}
        </div>
      )}
      {/* ACTION BUTTONS */}
      {actions && actions.length > 0 && (
        <div
          onClick={e => e.stopPropagation()}
          style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10, marginBottom: 2 }}
        >
          {actions.map((action, i) => (
            <button
              key={i}
              disabled={action.disabled}
              onClick={e => { e.stopPropagation(); action.onClick(e); }}
              style={{
                fontSize: 11,
                padding: '4px 11px',
                borderRadius: 6,
                cursor: action.disabled ? 'default' : 'pointer',
                fontFamily: font,
                opacity: action.disabled ? 0.6 : 1,
                transition: 'opacity 0.15s',
                ...RISK_ACTION_VARIANT[action.variant],
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
      {/* FOOTER */}
      <div style={{ fontSize: 10, color: textDim, marginTop: 4 }}>
        Tap to drill in →
      </div>
    </div>
  );
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

function fmtSkillDisplayName(name: string): string {
  const map: Record<string, string> = {
    'pipeline-hygiene': 'Pipeline Hygiene',
    'single-thread-alert': 'Single Thread Alert',
    'deal-rfm-scoring': 'RFM Scoring',
    'deal-risk-review': 'Deal Risk Review',
    'data-quality-audit': 'Data Quality Audit',
  };
  return map[name] ?? toTitleCaseSkillName(name);
}

function fmtTimeAgo(ts?: string | null): string {
  if (!ts) return '';
  try {
    const diff = Date.now() - new Date(ts).getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours < 1) return 'just now';
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  } catch { return ''; }
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

// ===== CONCIERGE FILTER DROPDOWN =====

type ConciergeFilter = { id: string; label: string; pipelineGroup?: string; repEmail?: string };

const BUILT_IN_PIPELINE_FILTERS: ConciergeFilter[] = [
  { id: 'all', label: 'All Data' },
  { id: 'renewal', label: 'Renewal Only', pipelineGroup: 'renewal' },
  { id: 'expansion', label: 'Expansion Only', pipelineGroup: 'expansion' },
  { id: 'new_business', label: 'New Business Only', pipelineGroup: 'new_business' },
];

function ConciergeFilterDropdown({
  activeFilter,
  onSelect,
  reps,
  colors: C,
}: {
  activeFilter: ConciergeFilter;
  onSelect: (f: ConciergeFilter) => void;
  reps: Array<{ name: string; email: string }>;
  colors: typeof S;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const isFiltered = activeFilter.id !== 'all';

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 10px', borderRadius: 7,
          border: isFiltered ? '1px solid rgba(29,158,117,0.5)' : `1px solid ${C.border}`,
          background: isFiltered ? 'rgba(29,158,117,0.08)' : 'rgba(255,255,255,0.04)',
          color: isFiltered ? C.teal : C.textSub,
          fontSize: 12, fontFamily: C.font, cursor: 'pointer', whiteSpace: 'nowrap',
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="4" y1="6" x2="20" y2="6" /><line x1="8" y1="12" x2="16" y2="12" /><line x1="10" y1="18" x2="14" y2="18" />
        </svg>
        {activeFilter.label}
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ opacity: 0.6 }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0,
          minWidth: 220, maxHeight: 340, overflowY: 'auto',
          background: C.surface, border: `1px solid ${C.border}`,
          borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          zIndex: 200, padding: 4,
        }}>
          <div style={{ padding: '6px 12px 4px', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 1 }}>View by type</div>
          {BUILT_IN_PIPELINE_FILTERS.map(f => (
            <FilterOption key={f.id} label={f.label} selected={activeFilter.id === f.id} onClick={() => { onSelect(f); setOpen(false); }} colors={C} />
          ))}

          {reps.length > 0 && (
            <>
              <div style={{ margin: '4px 0', borderTop: `1px solid ${C.border}` }} />
              <div style={{ padding: '6px 12px 4px', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 1 }}>View by rep</div>
              {reps.map(rep => {
                const f: ConciergeFilter = { id: `rep_${rep.email}`, label: rep.name, repEmail: rep.email };
                return <FilterOption key={f.id} label={rep.name} selected={activeFilter.id === f.id} onClick={() => { onSelect(f); setOpen(false); }} colors={C} />;
              })}
            </>
          )}

          <div style={{ margin: '4px 0', borderTop: `1px solid ${C.border}` }} />
          <div style={{ padding: '6px 12px 8px', fontSize: 11, color: C.textMuted }}>
            Custom views — <span style={{ opacity: 0.5 }}>coming soon</span>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterOption({ label, selected, onClick, colors: C }: { label: string; selected: boolean; onClick: () => void; colors: typeof S }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 9, width: '100%',
        padding: '7px 12px', borderRadius: 6, border: 'none',
        background: selected ? 'rgba(29,158,117,0.1)' : hovered ? 'rgba(255,255,255,0.04)' : 'transparent',
        color: selected ? C.teal : C.text,
        fontSize: 13, fontFamily: C.font, cursor: 'pointer', textAlign: 'left',
      }}
    >
      <div style={{
        width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
        border: selected ? `2px solid ${C.teal}` : `2px solid ${C.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {selected && <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.teal }} />}
      </div>
      {label}
    </button>
  );
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
  const [isProjection, setIsProjection] = useState(false);
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const [expandedActionId, setExpandedActionId] = useState<string | null>(null);
  const [actionStates, setActionStates] = useState<Record<string, 'pending' | 'approved' | 'rejected'>>({});
  const [assignedDealIds, setAssignedDealIds] = useState<Set<string>>(new Set());
  const [lostDealIds, setLostDealIds] = useState<Set<string>>(new Set());
  const [watchedFindingIds, setWatchedFindingIds] = useState<Set<string>>(new Set());
  const [unwatchedFindingIds, setUnwatchedFindingIds] = useState<Set<string>>(new Set());
  const [dismissedFindingIds, setDismissedFindingIds] = useState<Set<string>>(new Set());
  const [overnightTopExpanded, setOvernightTopExpanded] = useState(false);

  const skeletonTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [sessionId] = useState(() => crypto.randomUUID());
  const pageLoadTime = useRef(Date.now());
  const [greetingDone, setGreetingDone] = useState(false);

  // Concierge filter — persisted in localStorage per workspace
  const filterStorageKey = currentWorkspace?.id ? `pandora_concierge_filter_${currentWorkspace.id}` : null;
  const [activeFilter, setActiveFilter] = useState<{ id: string; pipelineGroup?: string; repEmail?: string; label: string }>(() => {
    if (filterStorageKey) {
      try {
        const saved = localStorage.getItem(filterStorageKey);
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    return { id: 'all', label: 'All Data' };
  });

  const setAndPersistFilter = (f: typeof activeFilter) => {
    setActiveFilter(f);
    if (filterStorageKey) {
      try { localStorage.setItem(filterStorageKey, JSON.stringify(f)); } catch {}
    }
  };

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
      const filterParams = [
        activeFilter.pipelineGroup ? `pipelineGroup=${encodeURIComponent(activeFilter.pipelineGroup)}` : '',
        activeFilter.repEmail ? `repEmail=${encodeURIComponent(activeFilter.repEmail)}` : '',
      ].filter(Boolean).join('&');
      const filterSuffix = filterParams ? `&${filterParams}` : '';
      const raw = await api.get(`/briefing/concierge?sessionId=${sessionId}${filterSuffix}`) as any;
      // Server returns { brief: OpeningBriefData, temporal: TemporalContext, ... }
      // Merge fresh temporal over the brief object so all fields are at the top level.
      const data: OpeningBriefData = {
        ...(raw.brief ?? raw),
        temporal: raw.temporal ?? raw.brief?.temporal,
      };
      console.log('[ConciergeView] brief data:', data);
      console.log('[ConciergeView] recentSkillRuns:', data.findings?.skillRuns);
      setBrief(data);
      setOvernight(raw.overnightSummary ?? null);
      try {
        const actionsRaw = await api.get('/workflow-rules/pending') as any;
        const fetched: PendingAction[] = actionsRaw.pending_actions ?? [];
        setPendingActions(fetched);
        console.log('[ConciergeView] pendingActions:', fetched);
      } catch { /* silent — pending actions are non-critical */ }
      setError(null);

      const role = (data?.user?.pandoraRole ?? null) as PandoraRole;
      if (role) {
        setPandoraRole(role);
        try { localStorage.setItem('pandora_role', role); } catch {}
      }

      const tab = phaseToTab(data?.temporal?.quarterPhase);
      setActiveQuarterTab(tab);

    } catch (e: unknown) {
      if (!silent) setError('Could not load your brief. Please refresh.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [currentWorkspace?.id, setPandoraRole, sessionId, activeFilter]);

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

  const navigateToChat = useCallback((message: string, ctx: ConciergeContext | null, wbrContributions?: any[], dealScope?: { type: string; entity_id: string; entity_name: string }) => {
    navigate(window.location.pathname, {
      state: {
        openChatWithMessage: message,
        conciergeContext: ctx,
        wbrContributions: wbrContributions || undefined,
        chatScope: dealScope ?? undefined,
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

  const assignToRep = useCallback(async (deal: { id: string; name: string; daysSinceActivity: number }) => {
    if (!currentWorkspace?.id) return;
    try {
      await api.post('/actions/assign-to-rep', {
        dealId: deal.id,
        taskTitle: `Follow up — ${deal.name}`,
        taskNote: `Cold for ${Math.round(deal.daysSinceActivity)} days. Re-engage for Q2 pipeline.`,
      });
      setAssignedDealIds(prev => new Set([...prev, deal.id]));
    } catch {}
  }, [currentWorkspace?.id]);

  const markLost = useCallback(async (deal: { id: string }) => {
    setLostDealIds(prev => new Set([...prev, deal.id]));
  }, []);

  const watchFinding = useCallback(async (finding: { id?: string }) => {
    if (!currentWorkspace?.id || !finding.id) return;
    try {
      await api.post(`/briefing/findings/${finding.id}/preference`, { preference: 'watch' });
      setWatchedFindingIds(prev => new Set([...prev, finding.id!]));
    } catch {}
  }, [currentWorkspace?.id]);

  const unwatchFinding = useCallback(async (finding: { id?: string }) => {
    if (!currentWorkspace?.id || !finding.id) return;
    try {
      await api.delete(`/briefing/findings/${finding.id}/preference`);
      setUnwatchedFindingIds(prev => new Set([...prev, finding.id!]));
      setWatchedFindingIds(prev => { const s = new Set(prev); s.delete(finding.id!); return s; });
    } catch {}
  }, [currentWorkspace?.id]);

  const dismissFinding = useCallback(async (finding: { id?: string }) => {
    if (!currentWorkspace?.id || !finding.id) return;
    try {
      await api.post(`/briefing/findings/${finding.id}/preference`, { preference: 'dismissed' });
      setDismissedFindingIds(prev => new Set([...prev, finding.id!]));
    } catch {}
  }, [currentWorkspace?.id]);

  const openAskPandora = useCallback((deal: { id: string; name: string }) => {
    navigate(window.location.pathname, {
      state: {
        prefillChatInput: `Tell me about ${deal.name}`,
        chatScope: { type: 'deal', entity_id: deal.id, entity_name: deal.name },
      },
    });
  }, [navigate]);

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

  const hasTarget = brief?.targets?.hasTarget !== false;
  const pct = brief?.targets?.pctAttained;
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
            <PixelAvatarPandora size={22} />
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
            <ConciergeFilterDropdown
              activeFilter={activeFilter}
              onSelect={f => { setAndPersistFilter(f); }}
              reps={Array.from(
                new Map(
                  (brief?.bigDealsAtRisk ?? [])
                    .filter(d => d.ownerEmail)
                    .map(d => {
                      const parts = (d.ownerEmail.split('@')[0] ?? '').split('.');
                      const name = parts.map((p: string) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
                      return [d.ownerEmail, { name, email: d.ownerEmail }] as const;
                    })
                ).values()
              )}
              colors={S}
            />
          </div>
        </div>

        {/* STREAMING GREETING */}
        {currentWorkspace?.id && (
          <div style={{ marginBottom: 18, marginTop: 6, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <PixelAvatarPandora size={40} style={{ marginTop: 2, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <StreamingGreeting
                workspaceId={currentWorkspace.id}
                onComplete={() => setGreetingDone(true)}
              />
            </div>
          </div>
        )}

        {/* fade-in content */}
        <div style={{
          opacity: (greetingDone || !currentWorkspace?.id) ? 1 : 0,
          transform: (greetingDone || !currentWorkspace?.id) ? 'translateY(0)' : 'translateY(8px)',
          transition: 'opacity 0.4s ease, transform 0.4s ease',
        }}>

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
              <div style={{ fontSize: 20, fontWeight: 500, color: S.text, marginBottom: 14 }}>
                {brief.user.name}.
              </div>
            )}

            {/* 4-COLUMN METRIC ROW */}
            {(() => {
              const estQ2Raw = brief.estimatedQ2Coverage?.estimatedQ2Coverage != null ? Number(brief.estimatedQ2Coverage.estimatedQ2Coverage) : null;
              const estQ2Valid = estQ2Raw !== null && !isNaN(estQ2Raw) && isFinite(estQ2Raw);
              const fallbackCoverage = brief.pipeline?.coverageRatio != null ? Number(brief.pipeline.coverageRatio) : null;
              const q2Display = estQ2Valid
                ? `~${estQ2Raw!.toFixed(1)}×`
                : fallbackCoverage != null ? `${fallbackCoverage.toFixed(1)}×` : '—';
              const q2Label = estQ2Valid ? 'Est. Q2 coverage' : 'Pipeline coverage';
              const q2Value = estQ2Valid ? estQ2Raw! : fallbackCoverage;
              const q2Color = q2Value === null || isNaN(q2Value!) ? S.textMuted : q2Value >= 3 ? S.teal : q2Value >= 1.5 ? S.yellow : S.red;
              const attainColor = pct == null ? S.teal : pct >= 100 ? S.teal : pct >= 85 ? S.yellow : S.red;
              const fiscalQ = (brief.temporal?.fiscalQuarter as string) ?? 'Q1';
              const fiscalY = (brief.temporal?.fiscalYear as string) ?? '';
              const periodLabel = fiscalY ? `${fiscalQ} ${fiscalY}` : fiscalQ;
              const metricCellStyle: React.CSSProperties = {
                padding: '12px 14px',
                cursor: 'pointer',
                background: S.surface,
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                userSelect: 'none',
              };
              return (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: 1,
                  marginBottom: 20,
                  border: `0.5px solid ${S.border}`,
                  borderRadius: 10,
                  overflow: 'hidden',
                  background: S.border,
                }}>
                  {/* Col 1: Attainment */}
                  <div
                    onClick={() => openMathModal('attainment')}
                    style={metricCellStyle}
                  >
                    <span style={{ fontSize: 22, fontWeight: 500, color: attainColor, lineHeight: 1.2 }}>
                      {pct != null ? fmtPct(pct) : '—'}
                    </span>
                    <span style={{ fontSize: 10, color: S.textSub, fontWeight: 600 }}>Attained</span>
                    <span style={{ fontSize: 10, color: S.textDim }}>
                      {pct != null && pct >= 100 ? `${fiscalQ} done` : `${fiscalQ} in progress`}
                    </span>
                  </div>
                  {/* Col 2: Closed */}
                  <div
                    onClick={() => openMathModal('attainment')}
                    style={metricCellStyle}
                  >
                    <span style={{ fontSize: 22, fontWeight: 500, color: S.teal, lineHeight: 1.2 }}>
                      {fmtCurrency(brief.targets?.closedWonValue)}
                    </span>
                    <span style={{ fontSize: 10, color: S.textSub, fontWeight: 600 }}>Closed</span>
                    <span style={{ fontSize: 10, color: S.textDim }}>{periodLabel}</span>
                  </div>
                  {/* Col 3: Open pipeline */}
                  <div
                    onClick={() => openMathModal('pipeline')}
                    style={metricCellStyle}
                  >
                    <span style={{ fontSize: 22, fontWeight: 500, color: '#94a3b8', lineHeight: 1.2 }}>
                      {fmtCurrency(brief.pipeline?.totalValue)}
                    </span>
                    <span style={{ fontSize: 10, color: S.textSub, fontWeight: 600 }}>Open</span>
                    <span style={{ fontSize: 10, color: S.textDim }}>pipeline</span>
                  </div>
                  {/* Col 4: Est. Q2 / Pipeline coverage */}
                  <div
                    onClick={() => openMathModal('coverage')}
                    title={estQ2Valid ? 'Includes stage-weighted open pipeline and expected Q1 rollover deals' : 'Open pipeline ÷ quota target'}
                    style={metricCellStyle}
                  >
                    <span style={{ fontSize: 22, fontWeight: 500, color: q2Color, lineHeight: 1.2 }}>
                      {q2Display}
                    </span>
                    <span style={{ fontSize: 10, color: S.textSub, fontWeight: 600 }}>{q2Label}</span>
                    <span style={{ fontSize: 10, color: S.textDim }}>target: 3×</span>
                  </div>
                </div>
              );
            })()}
            {/* ∑ Show math hint */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: -14, marginBottom: 10 }}>
              <span style={{ fontSize: 10, color: '#3a4252' }}>∑ Show math</span>
            </div>

            {/* ACTIVITY LOG — collapsible overnight (non-AE roles) */}
            {pandoraRole !== 'ae' && (brief.findings?.skillRuns?.length ?? 0) > 0 && (
              <div style={{ marginBottom: 20 }}>
                {/* HEADER ROW — always visible */}
                <div
                  onClick={() => setOvernightTopExpanded(prev => !prev)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', marginBottom: 6, userSelect: 'none' }}
                >
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#5a6578', textTransform: 'uppercase' as const, letterSpacing: '0.07em' }}>
                    Pandora overnight
                  </span>
                  <span style={{ fontSize: 10, color: S.textDim, transition: 'transform 0.15s', display: 'inline-block', transform: overnightTopExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
                </div>

                {/* COLLAPSED: compact skill run lines + pending count */}
                {!overnightTopExpanded && (
                  <>
                    {brief.findings!.skillRuns!.map((run, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: `0.5px solid ${S.border}` }}>
                        <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: run.status === 'failed' ? S.red : run.status === 'partial' ? S.yellow : S.teal, flexShrink: 0 }} />
                        <span style={{ flex: 1, fontSize: 12, color: S.textSub }}>
                          {fmtSkillDisplayName(run.skillName)}
                          {run.findingCount !== undefined ? ` · ${run.findingCount} finding${run.findingCount === 1 ? '' : 's'}` : ''}
                        </span>
                        <span style={{ fontSize: 10, color: S.textDim }}>{fmtTimeAgo(run.ranAt)}</span>
                      </div>
                    ))}
                    {pendingActions.length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                        <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: S.yellow, flexShrink: 0 }} />
                        <span style={{ fontSize: 12, color: S.textSub }}>
                          {pendingActions.length} action{pendingActions.length === 1 ? '' : 's'} pending approval
                        </span>
                      </div>
                    )}
                  </>
                )}

                {/* EXPANDED: full log with approve/reject */}
                {overnightTopExpanded && (
                  <>
                    {brief.findings!.skillRuns!.map((run, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: `0.5px solid ${S.border}` }}>
                        <StatusDot status={run.status} />
                        <span style={{ flex: 1, fontSize: 12, color: S.textSub }}>
                          {fmtSkillDisplayName(run.skillName)}
                          {run.findingCount !== undefined ? ` · ${run.findingCount} finding${run.findingCount === 1 ? '' : 's'}` : ''}
                        </span>
                        <span style={{ fontSize: 10, color: S.textDim }}>{fmtTimeAgo(run.ranAt)}</span>
                      </div>
                    ))}
                    {pendingActions.slice(0, 3).map((action, i, arr) => {
                      const state = actionStates[action.id] ?? 'pending';
                      const isExecuted = state === 'approved' || action.execution_status === 'completed';
                      const dotColor = state === 'approved' ? S.teal : state === 'rejected' ? '#6b7280' : isExecuted ? S.teal : S.yellow;
                      const isExpanded = expandedActionId === action.id;
                      const isClickable = state === 'pending' && !isExecuted;

                      let mainLabel: string;
                      let subLabel: string | null = null;
                      let rowTooltip: string | undefined;

                      if (action.hitl_required === true && action.is_always_queue === true) {
                        mainLabel = `${action.title} · protected field — always requires approval`;
                        rowTooltip = 'Fields like close date, amount, and forecast category always require human review regardless of automation settings.';
                      } else if (action.hitl_required === true && action.is_always_queue === false) {
                        mainLabel = `${action.title} · awaiting approval`;
                        subLabel = action.category ? `${action.category} actions require approval in your current settings` : null;
                      } else if (action.hitl_required === false && isExecuted) {
                        mainLabel = `${action.title} · executed automatically`;
                      } else if (action.block_reason) {
                        mainLabel = `${action.title} · protected field — always requires approval`;
                        rowTooltip = 'Fields like close date, amount, and forecast category always require human review regardless of automation settings.';
                      } else if (isExecuted) {
                        mainLabel = `${action.title} · executed automatically`;
                      } else {
                        mainLabel = `${action.title} · awaiting approval`;
                        subLabel = action.category ? `${action.category} actions require approval in your current settings` : null;
                      }

                      return (
                        <div key={action.id}>
                          <div
                            onClick={() => { if (isClickable) setExpandedActionId(isExpanded ? null : action.id); }}
                            title={rowTooltip}
                            style={{
                              display: 'flex', alignItems: 'flex-start', gap: 8, padding: '5px 0',
                              cursor: isClickable ? 'pointer' : rowTooltip ? 'help' : 'default',
                              borderBottom: (i < arr.length - 1 || isExpanded) ? `0.5px solid ${S.border}` : 'none',
                            }}
                          >
                            <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: dotColor, flexShrink: 0, marginTop: 4 }} />
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 12, color: S.textSub }}>{mainLabel}</div>
                              {subLabel && (
                                <div style={{ fontSize: 11, color: '#5a6578', marginTop: 1 }}>{subLabel}</div>
                              )}
                            </div>
                          </div>
                          {isExpanded && (
                            <div style={{ padding: '10px 14px', background: S.surface2, borderRadius: 8, marginBottom: 6, marginTop: 2 }}>
                              {action.description && (
                                <div style={{ fontSize: 12, color: S.textSub, lineHeight: 1.5, marginBottom: 10 }}>{action.description}</div>
                              )}
                              <div style={{ display: 'flex', gap: 8 }}>
                                <button
                                  onClick={async () => {
                                    try {
                                      await api.post(`/workflow-rules/pending/${action.id}/approve`, {});
                                      setActionStates(prev => ({ ...prev, [action.id]: 'approved' }));
                                      setExpandedActionId(null);
                                    } catch {}
                                  }}
                                  style={{ fontSize: 11, padding: '4px 12px', background: S.teal, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
                                >Approve</button>
                                <button
                                  onClick={async () => {
                                    try {
                                      await api.post(`/workflow-rules/pending/${action.id}/reject`, {});
                                      setActionStates(prev => ({ ...prev, [action.id]: 'rejected' }));
                                      setExpandedActionId(null);
                                    } catch {}
                                  }}
                                  style={{ fontSize: 11, padding: '4px 12px', background: 'transparent', color: S.textSub, border: `0.5px solid ${S.border}`, borderRadius: 6, cursor: 'pointer' }}
                                >Reject</button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            )}


            {/* BRIEF ITEMS */}
            {(() => {
              const riskDeals = brief.bigDealsAtRisk ?? [];
              const topFindings = brief.findings?.topFindings ?? [];
              const totalCount = (brief.findings?.critical ?? 0) + (brief.findings?.warning ?? 0);
              if (riskDeals.length === 0 && topFindings.length === 0) return null;
              // Compute Q2 coverage from open pipeline / target (valid even when gap=0)
              const _gap = typeof brief.targets?.gap === 'number' ? brief.targets.gap : null;
              const _headlineAmt = typeof brief.targets?.headline === 'object' ? (brief.targets.headline?.amount ?? null) : null;
              const _totalPipeline = brief.pipeline?.totalValue ?? 0;
              const _pctAttained = brief.targets?.pctAttained ?? 0;
              const q2Coverage = _headlineAmt && _headlineAmt > 0
                ? Math.round((_totalPipeline / _headlineAmt) * 10) / 10
                : (brief.pipeline?.coverageRatio ?? null);
              const avgRiskAmt = riskDeals.length > 0
                ? Math.round(riskDeals.reduce((s, d) => s + d.amount, 0) / riskDeals.length)
                : 0;

              // Priority-framed narrative (Task 2)
              let contextNarrative: string | null = null;
              const priorityFrame = brief.priorityFrame ?? null;
              if (priorityFrame) {
                const topics = priorityFrame.primaryTopics ?? [];
                const estQ2 = brief.estimatedQ2Coverage?.estimatedQ2Coverage != null ? Number(brief.estimatedQ2Coverage.estimatedQ2Coverage) : null;
                let frameSentence = '';
                if (topics.includes('q2_setup') && (estQ2 === null || isNaN(estQ2) || estQ2 < 3)) {
                  const coldTotal = riskDeals.reduce((s, d) => s + d.amount, 0);
                  if (riskDeals.length > 0) {
                    frameSentence = `${riskDeals.length} cold deal${riskDeals.length !== 1 ? 's' : ''} worth ${fmtCurrency(coldTotal)} represent the fastest path to Q2 coverage.`;
                  } else {
                    frameSentence = `Q2 coverage is currently ${estQ2 != null && !isNaN(estQ2) ? `${estQ2.toFixed(1)}×` : 'below'} the 3× threshold.`;
                  }
                } else if (topics.includes('rep_variance')) {
                  frameSentence = 'Pipeline coverage varies by rep. Review by rep before quarter close.';
                } else if (topics.includes('q1_close_risk')) {
                  const daysLeft = (brief.temporal as any)?.daysRemainingInQuarter;
                  frameSentence = daysLeft
                    ? `${daysLeft} days remain. Review deal risk.`
                    : 'Review deal risk before quarter close.';
                } else if (topics.includes('big_deals_at_risk')) {
                  frameSentence = `${riskDeals.length > 0 ? riskDeals.length : 'High-value'} deal${riskDeals.length !== 1 ? 's' : ''} require re-engagement.`;
                }
                if (frameSentence) {
                  contextNarrative = `${priorityFrame.frameLabel} ${frameSentence}`;
                }
              } else if (riskDeals.length > 0 && _pctAttained >= 100 && q2Coverage !== null) {
                const covStr = `${q2Coverage.toFixed(1)}×`;
                const dealWord = riskDeals.length === 1 ? 'deal' : 'deals';
                if (q2Coverage < 3) {
                  contextNarrative = `Q1 closed at ${Math.round(_pctAttained)}% attainment. Q2 coverage is ${covStr}, below the 3× threshold. These ${riskDeals.length} cold ${dealWord} average ${fmtCurrency(avgRiskAmt)} and represent available Q2 pipeline.`;
                } else {
                  contextNarrative = `Q1 closed at ${Math.round(_pctAttained)}% attainment. Q2 coverage is ${covStr}, above the 3× threshold. These ${riskDeals.length} cold ${dealWord} average ${fmtCurrency(avgRiskAmt)}.`;
                }
              }

              const skillRunCount = brief.findings?.skillRuns?.length ?? 0;
              const overnightPart = skillRunCount > 0 ? `${skillRunCount} skill${skillRunCount === 1 ? '' : 's'} ran overnight` : null;
              const pendingPart = pendingActions.length > 0 ? `${pendingActions.length} awaiting approval` : null;
              const tailParts = [overnightPart, pendingPart].filter(Boolean);
              const countTail = tailParts.length > 0 ? tailParts.join(' · ') : 'sorted by severity';

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 11, color: '#5a6578', marginBottom: 8 }}>
                    {riskDeals.length > 0
                      ? `${riskDeals.length} big deal${riskDeals.length > 1 ? 's' : ''} at risk · ${Math.min(topFindings.length, 5)} of ${totalCount} findings · ${countTail}`
                      : `Showing ${Math.min(topFindings.length, 5)} of ${totalCount} findings · ${countTail}`}
                  </div>

                  {/* Priority-framed narrative — plain text, no gray box */}
                  {contextNarrative && (
                    <div style={{
                      fontSize: 14, color: S.text, lineHeight: 1.5, marginBottom: 4,
                    }}>
                      {contextNarrative}
                    </div>
                  )}

                  {/* Big Deals at Risk — grouped or flat */}
                  {(() => {
                    const renderDeal = (deal: NonNullable<typeof brief.bigDealsAtRisk>[0], i: number, rankOffset = 0) => {
                      if (lostDealIds.has(deal.id)) return null;
                      const dormant = deal.daysSinceActivity > 120;
                      const borderColor = dormant ? '#ef4444' : '#f87171';
                      const eyebrow = dormant ? 'Big Deal at Risk · RFM · Long dormant' : 'Big Deal at Risk · RFM';
                      const body = `${fmtCurrency(deal.amount)} · ${Math.round(deal.daysSinceActivity)} days no activity · ${fmtStage(deal.stage)} stage`;
                      const dormantLine = dormant ? `Last activity was ${fmtDormantAge(deal.daysSinceActivity)} — consider closing or a re-engagement campaign before Q2.` : null;
                      let soWhat: string | null = null;
                      if (deal.amount != null && brief.targets != null) {
                        if (_gap != null && _gap > 0) {
                          soWhat = `Losing this deal costs ${Math.round(deal.amount / _gap * 100)}% of the remaining ${fmtCurrency(_gap)} gap.`;
                        } else if ((_gap === 0 || _gap === null) && q2Coverage !== null && q2Coverage < 3 && _headlineAmt) {
                          const isEarly = ['awareness', 'evaluation', 'discovery', 'prospecting'].includes((deal.stage || '').toLowerCase());
                          soWhat = isEarly
                            ? `Starting the conversation now seeds Q2 pipeline — not a Q2 close, but builds the buffer you need.`
                            : `At $0 gap this quarter, this deal closes in Q2. It represents ${Math.round(deal.amount / (_headlineAmt * 3) * 100)}% of 3× Q2 coverage.`;
                        } else if ((_gap === 0 || _gap === null) && q2Coverage !== null && q2Coverage >= 3) {
                          soWhat = `Q1 is won. Re-engaging this deal builds Q2 buffer above the 3× coverage threshold.`;
                        }
                      }
                      const isAssigned = assignedDealIds.has(deal.id);
                      const riskActions: RiskCardAction[] = dormant
                        ? [
                            { label: isAssigned ? '✓ Assigned' : 'Re-engage', variant: 'primary', disabled: isAssigned, onClick: () => assignToRep(deal) },
                            { label: 'Mark lost', variant: 'danger', onClick: () => markLost(deal) },
                            { label: 'Ask →', variant: 'secondary', onClick: () => openAskPandora(deal) },
                          ]
                        : [
                            { label: isAssigned ? '✓ Assigned' : 'Assign to rep', variant: 'primary', disabled: isAssigned, onClick: () => assignToRep(deal) },
                            { label: 'Ask →', variant: 'secondary', onClick: () => openAskPandora(deal) },
                          ];
                      return (
                        <RiskDealCard
                          key={`risk-${deal.id}`}
                          rank={rankOffset + i + 1}
                          eyebrow={eyebrow}
                          title={deal.name}
                          body={body}
                          dormantLine={dormantLine}
                          soWhat={soWhat}
                          borderColor={borderColor}
                          surface={S.surface}
                          border={S.border}
                          borderLight={S.border2}
                          textColor={S.text}
                          textSub={S.textSub}
                          textMuted={S.textMuted}
                          textDim={S.textDim}
                          font={S.font}
                          actions={riskActions}
                          onClick={() => trackInteraction({ cardsDrilledInto: [`risk-${deal.id}`] })}
                        />
                      );
                    };

                    if (brief.groupedDeals && brief.groupedDeals.length > 0) {
                      let runningRank = 0;
                      return brief.groupedDeals.map((group, gi) => {
                        const groupDeals = group.deals.filter((d: any) => !lostDealIds.has(d.id));
                        const groupStart = runningRank;
                        runningRank += groupDeals.length;
                        return (
                          <div key={group.group}>
                            <div style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              padding: '6px 0', marginTop: gi === 0 ? 0 : 16, marginBottom: 6,
                              borderBottom: `0.5px solid ${S.border}`,
                            }}>
                              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: S.textMuted }}>
                                {group.label}
                              </span>
                              <span style={{ fontSize: 11, color: S.textDim }}>
                                {groupDeals.length} deal{groupDeals.length !== 1 ? 's' : ''} · {fmtCurrency(group.totalValue)}
                                {group.criticalCount > 0 && (
                                  <span style={{ marginLeft: 6, padding: '1px 6px', background: 'rgba(239,68,68,0.12)', color: '#f87171', borderRadius: 4, fontSize: 10, fontWeight: 500 }}>
                                    {group.criticalCount} critical
                                  </span>
                                )}
                              </span>
                            </div>
                            {groupDeals.map((deal: any, i: number) => renderDeal(deal, i, groupStart))}
                          </div>
                        );
                      });
                    }

                    return riskDeals.filter(d => !lostDealIds.has(d.id)).map((deal, i) => renderDeal(deal, i));
                  })()}

                  {/* Findings — ranked after big deals */}
                  {topFindings.slice(0, 5).filter(f => !dismissedFindingIds.has(f.id ?? '')).map((finding, i) => {
                    const eyebrow = toTitleCaseSkillName(finding.skillName || finding.dealName || '');
                    const fullMsg = cleanFindingMessage(finding.message || '');
                    const title = finding.dealName
                      ? finding.dealName
                      : fullMsg.slice(0, 60) + (fullMsg.length > 60 ? '…' : '');
                    const body = fullMsg;

                    const isWatched = watchedFindingIds.has(finding.id ?? '') || (finding.is_watched && !unwatchedFindingIds.has(finding.id ?? ''));
                    const findingDealRef = {
                      id: finding.id ?? String(i),
                      name: finding.dealName || (finding.message?.slice(0, 60) ?? 'this finding'),
                    };

                    const findingActions = [
                      {
                        label: assignedDealIds.has(finding.id ?? '') ? '✓ Assigned' : 'Assign to rep',
                        variant: 'primary' as const,
                        disabled: assignedDealIds.has(finding.id ?? ''),
                        onClick: (_e: React.MouseEvent) => assignToRep({ id: findingDealRef.id, name: findingDealRef.name, daysSinceActivity: 0 }),
                      },
                      ...(finding.id ? (isWatched
                        ? [{
                            label: 'Unwatch',
                            variant: 'secondary' as const,
                            onClick: (_e: React.MouseEvent) => unwatchFinding(finding),
                          }]
                        : [{
                            label: 'Watch',
                            variant: 'secondary' as const,
                            onClick: (_e: React.MouseEvent) => watchFinding(finding),
                          }]
                      ) : []),
                      ...(finding.id ? [{
                        label: 'Dismiss',
                        variant: 'secondary' as const,
                        onClick: (_e: React.MouseEvent) => dismissFinding(finding),
                      }] : []),
                      {
                        label: 'Ask →',
                        variant: 'secondary' as const,
                        onClick: (_e: React.MouseEvent) => openAskPandora(findingDealRef),
                      },
                    ];

                    return (
                      <BriefCard
                        key={finding.id ?? i}
                        rank={riskDeals.filter(d => !lostDealIds.has(d.id)).length + i + 1}
                        category={severityToCategory(finding.severity)}
                        eyebrow={eyebrow}
                        title={title}
                        body={body}
                        chips={[]}
                        mathKey={finding.mathKey}
                        is_watched={isWatched}
                        actions={findingActions}
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
            {pandoraRole !== 'ae' && overnight && (overnight.skillsRun > 0 || overnight.findingsSurfaced > 0 || overnight.autonomousActionsCompleted > 0 || overnight.pendingApprovalCount > 0) && (
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
        </div>{/* end fade-in content */}
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
