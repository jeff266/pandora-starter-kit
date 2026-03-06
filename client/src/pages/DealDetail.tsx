import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ExternalLink, ChevronDown, Check } from 'lucide-react';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { formatCurrency, formatDate, formatTimeAgo, severityColor } from '../lib/format';
import Skeleton from '../components/Skeleton';
import SectionErrorBoundary from '../components/SectionErrorBoundary';
import { DossierNarrative, AnalysisModal } from '../components/shared';
import { useDemoMode } from '../contexts/DemoModeContext';
import { useIsMobile } from '../hooks/useIsMobile';
import { buildDealCrmUrl, buildConversationUrl, useCrmInfo } from '../lib/deeplinks';
import { useWorkspace } from '../context/WorkspaceContext';
import { useInlineActions } from '../hooks/useInlineActions';
import StageRecCard from '../components/actions/StageRecCard';

const SEVERITY_LABELS: Record<string, string> = {
  act: 'Critical', watch: 'Warning', notable: 'Notable', info: 'Info',
};

function Accordion({
  title,
  badge,
  children,
  defaultOpen = false,
}: {
  title: string;
  badge?: number | null;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 10,
      overflow: 'hidden',
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', padding: '12px 16px',
          background: 'none', border: 'none', cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>{title}</span>
          {badge != null && badge > 0 && (
            <span style={{
              fontSize: 10, fontWeight: 600, color: colors.textMuted,
              background: colors.surfaceHover, padding: '1px 7px', borderRadius: 10,
            }}>{badge}</span>
          )}
        </div>
        <ChevronDown
          size={14}
          color={colors.textMuted}
          style={{ transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>
      {open && (
        <div style={{ padding: '0 16px 16px', borderTop: `1px solid ${colors.border}` }}>
          {children}
        </div>
      )}
    </div>
  );
}

function BScoreRing({
  score,
  grade,
  onClick,
}: {
  score: number;
  grade: string;
  onClick?: () => void;
}) {
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const color = score >= 80 ? colors.green : score >= 60 ? colors.yellow : colors.red;
  const progress = Math.max(0, Math.min(1, score / 100)) * circumference;
  return (
    <button
      onClick={onClick}
      title="Click to see score breakdown"
      style={{
        background: 'none', border: 'none', cursor: onClick ? 'pointer' : 'default',
        padding: 0, position: 'relative', width: 72, height: 72, flexShrink: 0,
      }}
    >
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r={radius} fill="none" stroke={colors.border} strokeWidth="4" />
        <circle
          cx="36" cy="36" r={radius} fill="none"
          stroke={color} strokeWidth="4"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - progress}
          strokeLinecap="round"
          transform="rotate(-90 36 36)"
          style={{ transition: 'stroke-dashoffset 0.8s ease' }}
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontSize: 9, color: colors.textMuted, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' }}>B</span>
        <span style={{ fontSize: 17, fontWeight: 700, color, lineHeight: 1 }}>{Math.round(score)}</span>
        <span style={{ fontSize: 9, fontWeight: 700, color, letterSpacing: 0.5 }}>{grade}</span>
      </div>
    </button>
  );
}

function InsightCard({
  severity,
  title,
  children,
}: {
  severity: 'critical' | 'warning' | 'info' | 'ok';
  title: string;
  children: React.ReactNode;
}) {
  const map = {
    critical: { bg: `${colors.red}08`, border: `${colors.red}30`, dot: colors.red },
    warning: { bg: `${colors.yellow}08`, border: `${colors.yellow}30`, dot: colors.yellow },
    info: { bg: `${colors.accent}08`, border: `${colors.accent}25`, dot: colors.accent },
    ok: { bg: `${colors.green}08`, border: `${colors.green}25`, dot: colors.green },
  };
  const s = map[severity];
  return (
    <div style={{
      background: s.bg, border: `1px solid ${s.border}`, borderRadius: 10,
      padding: '14px 16px', flex: 1, minWidth: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
        <div style={{
          width: 6, height: 6, borderRadius: '50%',
          background: s.dot, boxShadow: `0 0 7px ${s.dot}`,
          flexShrink: 0,
        }} />
        <span style={{
          fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.08em', color: s.dot,
        }}>{title}</span>
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.6, color: colors.text }}>{children}</div>
    </div>
  );
}

function StakeholderRing({
  label,
  engaged,
  total,
  color,
}: {
  label: string;
  engaged: number;
  total: number;
  color: string;
}) {
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const progress = total > 0 ? (engaged / total) * circumference : 0;
  const isEmpty = total === 0 || engaged === 0;
  const ringColor = isEmpty ? colors.red : (engaged === total ? color : colors.yellow);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ position: 'relative', width: 44, height: 44, flexShrink: 0 }}>
        <svg width="44" height="44" viewBox="0 0 44 44">
          <circle cx="22" cy="22" r={radius} fill="none" stroke={colors.border} strokeWidth="3" />
          <circle
            cx="22" cy="22" r={radius} fill="none"
            stroke={ringColor} strokeWidth="3"
            strokeDasharray={circumference}
            strokeDashoffset={total > 0 ? circumference - progress : 0}
            strokeLinecap="round"
            transform="rotate(-90 22 22)"
            opacity={total === 0 ? 0.3 : 1}
          />
        </svg>
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 700, color: ringColor,
        }}>
          {total === 0 ? '—' : `${engaged}/${total}`}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: colors.text }}>{label}</div>
        <div style={{ fontSize: 11, color: isEmpty ? colors.red : colors.textMuted }}>
          {total === 0 ? 'None identified' : isEmpty ? 'None engaged' : `${engaged} engaged`}
        </div>
      </div>
    </div>
  );
}

const SNOOZE_OPTIONS = [
  { label: '1d', days: 1 },
  { label: '3d', days: 3 },
  { label: '7d', days: 7 },
  { label: '14d', days: 14 },
  { label: '30d', days: 30 },
];

const ENGAGEMENT_ORDER: Record<string, number> = { unengaged: 0, dark: 1, fading: 2, active: 3 };
const ROLE_PRIORITY: Record<string, number> = {
  executive_sponsor: 1,
  decision_maker: 2,
  influencer: 3,
  champion: 4,
  economic_buyer: 5,
};

function engagementDot(level?: string): { color: string; label: string } {
  switch (level) {
    case 'active': return { color: colors.green, label: 'Engaged' };
    case 'fading': return { color: colors.yellow, label: 'Going dark' };
    case 'dark': return { color: colors.red, label: 'Dark' };
    case 'unengaged': return { color: colors.textMuted, label: 'Unengaged' };
    default: return { color: colors.textMuted, label: 'Unknown' };
  }
}

function linkMethodPill(method?: string): { bg: string; color: string; label: string } | null {
  if (!method) return null;
  switch (method.toLowerCase()) {
    case 'crm': return { bg: `${colors.accent}18`, color: colors.accent, label: 'CRM' };
    case 'email_match': case 'email match': return { bg: `${colors.green}18`, color: colors.green, label: 'Email Match' };
    case 'domain_inferred': case 'domain inferred': return { bg: `${colors.textMuted}18`, color: colors.textMuted, label: 'Domain Inferred' };
    default: return { bg: `${colors.textMuted}18`, color: colors.textMuted, label: method };
  }
}

function gradeColor(grade: string): string {
  switch (grade) {
    case 'A': return colors.green;
    case 'B': return '#38bdf8';
    case 'C': return colors.yellow;
    case 'D': return colors.orange;
    case 'F': return colors.red;
    default: return colors.textMuted;
  }
}

function gradeBg(grade: string): string {
  switch (grade) {
    case 'A': return `${colors.green}20`;
    case 'B': return '#38bdf820';
    case 'C': return `${colors.yellow}20`;
    case 'D': return `${colors.orange}20`;
    case 'F': return `${colors.red}20`;
    default: return `${colors.textMuted}20`;
  }
}


interface ActiveScore {
  score: number;
  grade: string;
  source: 'skill' | 'health';
  skill_score: number | null;
  health_score: number | null;
  divergence: number;
  divergence_flag: boolean;
  conversation_modifier: number;
  weights_used: { crm: number; findings: number; conversations: number };
  degradation_state: 'full' | 'no_conversations' | 'no_findings' | 'crm_only';
}

interface MechanicalScore {
  score: number | null;
  grade: string;
}

export default function DealDetail() {
  const { dealId } = useParams<{ dealId: string }>();
  const navigate = useNavigate();
  const { anon } = useDemoMode();
  const isMobile = useIsMobile();
  const [dossier, setDossier] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [narrativeLoading, setNarrativeLoading] = useState(false);
  const [error, setError] = useState('');
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [snoozingId, setSnoozingId] = useState<string | null>(null);
  const [snoozeDropdownId, setSnoozeDropdownId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const { crmInfo } = useCrmInfo();
  const { user, currentWorkspace } = useWorkspace();
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [showScoreBreakdown, setShowScoreBreakdown] = useState(false);
  const [scoreHistory, setScoreHistory] = useState<any[]>([]);
  const [pipelines, setPipelines] = useState<string[]>([]);
  const [pipelineEditing, setPipelineEditing] = useState(false);
  const [pipelineSaving, setPipelineSaving] = useState(false);
  const [scopes, setScopes] = useState<Array<{ scope_id: string; name: string }>>([]);
  const [scopeEditing, setScopeEditing] = useState(false);
  const [scopeSaving, setScopeSaving] = useState(false);
  const [coverageGapsExpanded, setCoverageGapsExpanded] = useState(true);
  const [expandedSummaries, setExpandedSummaries] = useState<Set<string>>(new Set());
  const pipelineDropdownRef = useRef<HTMLDivElement>(null);
  const scopeDropdownRef = useRef<HTMLDivElement>(null);
  const [dealComposite, setDealComposite] = useState<{ label: string; color: string } | null>(null);
  const [coachingNextStep, setCoachingNextStep] = useState<string | null>(null);
  const [meddicCoverage, setMeddicCoverage] = useState<{ covered_fields: string[]; field_signal_counts?: Record<string, number> } | null>(null);
  const { actions: inlineActions, executeAction, dismissAction } = useInlineActions(dealId);
  const [showSignals, setShowSignals] = useState<boolean | null>(null);

  useEffect(() => {
    if (!pipelineEditing) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (pipelineDropdownRef.current && !pipelineDropdownRef.current.contains(e.target as Node)) {
        setPipelineEditing(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [pipelineEditing]);

  useEffect(() => {
    if (!scopeEditing) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (scopeDropdownRef.current && !scopeDropdownRef.current.contains(e.target as Node)) {
        setScopeEditing(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [scopeEditing]);

  const fetchDossier = async (withNarrative = false) => {
    if (!dealId) return;
    if (withNarrative) {
      setNarrativeLoading(true);
    } else {
      setLoading(true);
    }
    try {
      const url = withNarrative
        ? `/deals/${dealId}/dossier?narrative=true`
        : `/deals/${dealId}/dossier`;
      const data = await api.get(url);
      setDossier(data);
      setError('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
      if (withNarrative) {
        setNarrativeLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!dealId) return;
    api.get(`/deals/${dealId}/coaching`)
      .then((data: any) => {
        if (data?.composite?.label) setDealComposite({ label: data.composite.label, color: data.composite.color });
        if (data?.composite?.next_step) setCoachingNextStep(data.composite.next_step);
      })
      .catch(() => {});
  }, [dealId]);

  useEffect(() => {
    if (!dealId) return;
    api.post('/activity-signals/coverage', { deal_ids: [dealId] })
      .then((data: any) => {
        setMeddicCoverage(data.coverage?.[dealId] ?? { covered_fields: [] });
      })
      .catch(() => { setMeddicCoverage({ covered_fields: [] }); });
  }, [dealId]);

  useEffect(() => {
    fetchDossier(true);
    if (dealId) {
      api.get(`/deals/${dealId}/score-history`).then((res: any) => {
        setScoreHistory(res.snapshots || []);
      }).catch(() => {});
    }
    api.get('/deals/pipelines').then((res: any) => {
      setPipelines(res.data || []);
    }).catch(() => {});
    api.get('/admin/scopes').then((res: any) => {
      const confirmed = (res.scopes || []).filter((s: any) => s.scope_id !== 'default');
      setScopes(confirmed.map((s: any) => ({ scope_id: s.scope_id, name: s.name || s.scope_id })));
    }).catch(() => {});
  }, [dealId]);

  const canEditPipeline = (() => {
    if (!user || !dossier?.deal) return false;
    const role = currentWorkspace?.role;
    if (role === 'admin') return true;
    const dealOwner = (dossier.deal.owner || '').toLowerCase();
    return dealOwner === user.email.toLowerCase() || dealOwner === (user.name || '').toLowerCase();
  })();

  const handlePipelineChange = async (newPipeline: string) => {
    if (!dealId || !dossier?.deal) return;
    setPipelineSaving(true);
    try {
      await api.patch(`/deals/${dealId}/pipeline`, { pipeline: newPipeline });
      setDossier((prev: any) => ({
        ...prev,
        deal: { ...prev.deal, pipeline: newPipeline },
      }));
      setToast({ message: 'Pipeline updated', type: 'success' });
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to update pipeline', type: 'error' });
    } finally {
      setPipelineSaving(false);
      setPipelineEditing(false);
    }
  };

  const handleScopeChange = async (newScopeId: string | null) => {
    if (!dealId || !dossier?.deal) return;
    setScopeSaving(true);
    try {
      await api.patch(`/deals/${dealId}/scope`, { scope_id: newScopeId });
      setDossier((prev: any) => ({
        ...prev,
        deal: { ...prev.deal, scope_id: newScopeId },
      }));
      setToast({ message: newScopeId ? 'Pandora Pipeline updated' : 'Pipeline reset to inferred', type: 'success' });
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to update Pandora Pipeline', type: 'error' });
    } finally {
      setScopeSaving(false);
      setScopeEditing(false);
    }
  };

  const dismissFinding = async (findingId: string) => {
    setDismissingId(findingId);
    try {
      await api.patch(`/findings/${findingId}/resolve`, { resolution_method: 'user_dismissed' });
      setDossier((prev: any) => {
        if (!prev) return prev;
        return {
          ...prev,
          findings: (prev.findings || []).filter((f: any) => f.id !== findingId),
        };
      });
    } catch (err: any) {
      if (err.message?.includes('409') || err.message?.includes('already')) {
        setDossier((prev: any) => {
          if (!prev) return prev;
          return {
            ...prev,
            findings: (prev.findings || []).filter((f: any) => f.id !== findingId),
          };
        });
      } else {
        setToast({ message: 'Failed to resolve finding', type: 'error' });
        setTimeout(() => setToast(null), 3000);
      }
    } finally {
      setDismissingId(null);
    }
  };

  const snoozeFinding = async (findingId: string, days: number) => {
    setSnoozingId(findingId);
    setSnoozeDropdownId(null);
    try {
      await api.post(`/findings/${findingId}/snooze`, { days });
      setDossier((prev: any) => {
        if (!prev) return prev;
        return {
          ...prev,
          findings: (prev.findings || []).filter((f: any) => f.id !== findingId),
        };
      });
      setToast({ message: `Finding snoozed for ${days} day${days > 1 ? 's' : ''}`, type: 'success' });
      setTimeout(() => setToast(null), 3000);
    } catch (err: any) {
      setToast({ message: 'Failed to snooze finding', type: 'error' });
      setTimeout(() => setToast(null), 3000);
    } finally {
      setSnoozingId(null);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Skeleton height={120} />
        <Skeleton height={100} />
        <div style={{ display: 'flex', gap: 12 }}>
          <Skeleton height={80} />
          <Skeleton height={80} />
          <Skeleton height={80} />
        </div>
        <Skeleton height={60} />
        <Skeleton height={48} />
        <Skeleton height={48} />
        <Skeleton height={48} />
      </div>
    );
  }

  if (error || !dossier) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <p style={{ fontSize: 15, color: colors.textSecondary }}>
          {error || 'Deal not found'}
        </p>
        <button onClick={() => navigate('/')} style={{
          fontSize: 12, color: colors.accent, background: 'none', marginTop: 12,
        }}>
          Back to Command Center
        </button>
      </div>
    );
  }

  const deal = dossier.deal || {};
  const health = dossier.health_signals || {};
  const findingsList = dossier.findings || [];
  const sortedContacts = [...(dossier.contacts || [])].sort((a: any, b: any) => {
    // Sort by buying role first (Executive Sponsor > Decision Maker > Influencer)
    const aRole = a.buying_role ? a.buying_role.toLowerCase().replace(/ /g, '_') : '';
    const bRole = b.buying_role ? b.buying_role.toLowerCase().replace(/ /g, '_') : '';
    const aRolePriority = ROLE_PRIORITY[aRole] ?? 999;
    const bRolePriority = ROLE_PRIORITY[bRole] ?? 999;
    if (aRolePriority !== bRolePriority) {
      return aRolePriority - bRolePriority;
    }
    // Then by engagement level
    const aEngagement = ENGAGEMENT_ORDER[a.engagement_level] ?? 3;
    const bEngagement = ENGAGEMENT_ORDER[b.engagement_level] ?? 3;
    return bEngagement - aEngagement; // Active first
  });

  // Deduplicate contacts by id and merge buying roles
  const contactsById = new Map<string, any>();
  for (const contact of sortedContacts) {
    const id = contact.id;
    if (!id) {
      // If no id, treat as unique
      contactsById.set(`no-id-${Math.random()}`, contact);
      continue;
    }

    if (contactsById.has(id)) {
      // Merge buying_role if different
      const existing = contactsById.get(id);
      if (contact.buying_role && contact.buying_role !== existing.buying_role) {
        const existingRoles = existing.buying_role ? existing.buying_role.split(' / ') : [];
        if (!existingRoles.includes(contact.buying_role)) {
          existing.buying_role = [...existingRoles, contact.buying_role].join(' / ');
        }
      }
    } else {
      contactsById.set(id, { ...contact });
    }
  }
  const contactsList = Array.from(contactsById.values());

  const activities = dossier.activities || [];
  const conversations = dossier.conversations || [];
  const stageHistory = dossier.stage_history || [];
  const narrative = dossier.narrative;
  const recommended_actions = dossier.recommended_actions || [];
  const riskScore = dossier.risk_score;
  const activeScore: ActiveScore | undefined = dossier.active_score;
  const mechanicalScore: MechanicalScore | null = dossier.mechanical_score ?? null;
  const coverageGapsData = dossier.coverage_gaps || {};

  const daysInStage = deal.days_in_current_stage ??
    (stageHistory.length > 0 ? Math.round(stageHistory[stageHistory.length - 1]?.days_in_stage || 0) : null);

  // Filter contacts_never_called to show only VP+/buying role contacts
  const keyContactsNeverCalled = (coverageGapsData.contacts_never_called || []).filter((c: any) => {
    const seniorityMatch = c.seniority && ['vp', 'c_suite', 'director', 'svp', 'evp'].includes(c.seniority.toLowerCase());
    const hasBuyingRole = c.buying_role != null && c.buying_role !== '';
    return seniorityMatch || hasBuyingRole;
  });

  const hasCoverageGaps =
    (keyContactsNeverCalled.length > 0) ||
    (coverageGapsData.days_since_last_call != null && coverageGapsData.days_since_last_call > (coverageGapsData.days_threshold || 10)) ||
    (coverageGapsData.unlinked_calls > 0) ||
    (coverageGapsData.total_contacts === 0);

  // Map signal values to readable labels
  const signalLabel = (type: string, value?: string | null) => {
    if (!value) return 'N/A';
    if (type === 'activity_recency') {
      if (value === 'active') return 'Active';
      if (value === 'cooling') return 'Cooling';
      if (value === 'stale') return 'No activity';
    }
    if (type === 'threading') {
      if (value === 'multi') return 'Multi-threaded';
      if (value === 'dual') return '2 contacts';
      if (value === 'single') return 'Single-threaded';
    }
    if (type === 'stage_velocity') {
      if (value === 'fast') return 'Moving fast';
      if (value === 'normal') return 'On track';
      if (value === 'slow') return 'Stalled';
    }
    return value;
  };

  const healthItems = [
    { label: 'Activity', value: signalLabel('activity_recency', health.activity_recency), color: statusColor(health.activity_recency), tooltip: undefined },
    { label: 'Threading', value: signalLabel('threading', health.threading), color: statusColor(health.threading), tooltip: undefined },
    {
      label: 'Health',
      value: dealComposite ? dealComposite.label : (health.velocity_suspect ? 'Check velocity' : signalLabel('stage_velocity', health.stage_velocity)),
      color: dealComposite ? dealComposite.color : (health.velocity_suspect ? colors.yellow : statusColor(health.stage_velocity)),
      tooltip: dealComposite ? `Stage-specific velocity benchmark · ${dealComposite.label}` : (health.velocity_suspect ? 'Recent call activity suggests this deal may be moving — stage data may be stale.' : undefined)
    },
    { label: 'Data', value: health.data_completeness != null ? `${health.data_completeness}% complete` : null, color: (health.data_completeness || 0) > 60 ? colors.green : colors.yellow, tooltip: undefined },
  ];

  // Merge activities and conversations into unified timeline
  const timeline = [
    ...activities.map((a: any) => ({
      id: a.id,
      date: a.date,
      type: 'activity' as const,
      source: 'crm',
      label: a.subject || a.type || 'Activity',
      meta: a.owner_email,
      icon: activityIcon(a.type),
      body: a.body ?? null,
    })),
    ...conversations.map((c: any) => ({
      id: c.id,
      date: c.date,
      type: 'conversation' as const,
      source: c.source || (c.link_method?.toLowerCase().includes('gong') ? 'gong' : c.link_method?.toLowerCase().includes('fireflies') ? 'fireflies' : 'crm'),
      label: c.title || 'Untitled conversation',
      meta: `${c.duration_minutes ? `${c.duration_minutes}min` : ''}${c.participants?.length ? ` · ${c.participants.length} participant${c.participants.length > 1 ? 's' : ''}` : ''}`,
      summary: c.summary,
      source_id: c.source_id,
      source_data: c.source_data,
      custom_fields: c.custom_fields,
      link_method: c.link_method,
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Stage-annotated timeline: merge stage history with timeline events
  const stageAnnotatedTimeline = (() => {
    if (!stageHistory || stageHistory.length === 0) return timeline;

    // Step 1: Pre-process stageHistory - filter sub-1-day transitions, merge consecutive same stages
    const processedStages: Array<{
      stage: string;
      stage_normalized: string;
      entered_at: string;
      exited_at: string | null;
      days_in_stage: number;
    }> = [];

    for (const stage of stageHistory) {
      const enteredAt = new Date(stage.entered_at).getTime();
      const exitedAt = stage.exited_at ? new Date(stage.exited_at).getTime() : null;
      const daysInStage = exitedAt ? (exitedAt - enteredAt) / (1000 * 60 * 60 * 24) : stage.days_in_stage;

      // Skip sub-1-day transitions (except current stage where exited_at === null)
      if (exitedAt && daysInStage < 1) continue;

      // Merge with previous if same stage_normalized
      const prev = processedStages[processedStages.length - 1];
      if (prev && prev.stage_normalized === stage.stage_normalized) {
        prev.exited_at = stage.exited_at;
        prev.days_in_stage = (prev.exited_at ? new Date(prev.exited_at).getTime() : Date.now()) - new Date(prev.entered_at).getTime();
        prev.days_in_stage = prev.days_in_stage / (1000 * 60 * 60 * 24);
      } else {
        processedStages.push({
          stage: stage.stage,
          stage_normalized: stage.stage_normalized || stage.stage,
          entered_at: stage.entered_at,
          exited_at: stage.exited_at,
          days_in_stage: daysInStage,
        });
      }
    }

    // Step 2: Walk timeline (DESC), find active stage for each item
    const annotated: any[] = [];
    let lastStage: string | null = null;

    for (const item of timeline) {
      const itemDate = new Date(item.date).getTime();

      // Find active stage span (last span where entered_at <= item.date)
      const activeStage = processedStages
        .filter(s => new Date(s.entered_at).getTime() <= itemDate)
        .sort((a, b) => new Date(b.entered_at).getTime() - new Date(a.entered_at).getTime())[0];

      const currentStage = activeStage?.stage_normalized || null;

      // Insert stage marker when stage changes
      if (currentStage && currentStage !== lastStage) {
        const enteredAt = activeStage.entered_at;
        const exitedAt = activeStage.exited_at;
        const daysInStage = Math.round(activeStage.days_in_stage);
        const isCurrent = exitedAt === null;

        annotated.push({
          type: 'stage_marker',
          id: `stage-${activeStage.entered_at}`,
          stage: activeStage.stage,
          stage_normalized: currentStage,
          entered_at: enteredAt,
          exited_at: exitedAt,
          days_in_stage: daysInStage,
          isCurrent,
        });
        lastStage = currentStage;
      }

      annotated.push(item);
    }

    return annotated;
  })();

  const sourceBadge = (source: string) => {
    switch (source.toLowerCase()) {
      case 'crm':
        return { label: 'CRM', bg: `${colors.textMuted}18`, color: colors.textMuted };
      case 'gong':
        return { label: 'Gong', bg: `${colors.accent}18`, color: colors.accent };
      case 'fireflies':
        return { label: 'Fireflies', bg: `${colors.purple || '#9333EA'}18`, color: colors.purple || '#9333EA' };
      default:
        return { label: source.toUpperCase(), bg: `${colors.textMuted}18`, color: colors.textMuted };
    }
  };

  // ── Tier 2 derivations ──────────────────────────────────────────────────────

  // Stakeholder coverage rings
  const dmContacts = contactsList.filter((c: any) => ['decision_maker', 'executive_sponsor'].includes((c.buying_role || '').toLowerCase().replace(/ /g, '_')));
  const ebContacts = contactsList.filter((c: any) => (c.buying_role || '').toLowerCase().replace(/ /g, '_') === 'economic_buyer');
  const infContacts = contactsList.filter((c: any) => ['influencer', 'champion'].includes((c.buying_role || '').toLowerCase().replace(/ /g, '_')));
  const isEngaged = (c: any) => c.last_activity_date != null && c.engagement_level !== 'unengaged';

  // Insight card generation (max 3, priority order)
  const insightCards: Array<{ severity: 'critical' | 'warning' | 'info' | 'ok'; title: string; body: React.ReactNode }> = [];
  {
    const unengagedDMs = dmContacts.filter((c: any) => !isEngaged(c));
    const eb = ebContacts[0];
    if (unengagedDMs.length > 0) {
      insightCards.push({
        severity: 'critical',
        title: 'Single-Thread Risk',
        body: (
          <>
            <strong>{unengagedDMs.length} of {dmContacts.length}</strong> decision maker{dmContacts.length !== 1 ? 's' : ''} have had zero touchpoints.
            {eb && !isEngaged(eb) && (
              <> The economic buyer ({eb.name ? anon.person(eb.name) : eb.email}, {eb.title}) has not been engaged.</>
            )}
          </>
        ),
      });
    }

    if (insightCards.length < 3 && timeline.length === 0 && (coverageGapsData.days_since_last_call == null || coverageGapsData.days_since_last_call > (coverageGapsData.days_threshold || 10))) {
      insightCards.push({
        severity: 'warning',
        title: 'Activity Gap',
        body: 'No activity or conversations recorded in CRM or connected conversation tools. Unable to assess deal momentum.',
      });
    }

    if (insightCards.length < 3 && daysInStage != null && daysInStage > 14 && !['closed_won', 'closed_lost', 'closed'].includes((deal.stage_normalized || '').toLowerCase())) {
      insightCards.push({
        severity: 'warning',
        title: 'Stalled Deal',
        body: <>This deal has been in <strong>{deal.stage_normalized?.replace(/_/g, ' ') || deal.stage}</strong> for <strong>{daysInStage} days</strong> without stage progression.</>,
      });
    }

    if (insightCards.length < 3 && coverageGapsData.unlinked_calls > 0) {
      insightCards.push({
        severity: 'info',
        title: 'Unlinked Conversations',
        body: <><strong>{coverageGapsData.unlinked_calls}</strong> conversation{coverageGapsData.unlinked_calls > 1 ? 's' : ''} with matching domain participants are not linked to this deal.</>,
      });
    }

    if (insightCards.length < 3) {
      const critFinding = findingsList.find((f: any) => f.severity === 'act');
      if (critFinding) {
        insightCards.push({
          severity: 'critical',
          title: 'Critical Finding',
          body: anon.text(critFinding.message),
        });
      }
    }
  }

  // Recommended next steps
  const nextSteps: Array<{ priority: 'P0' | 'P1' | 'P2'; action: string }> = [];
  if (recommended_actions.length > 0) {
    recommended_actions.slice(0, 3).forEach((a: string) => nextSteps.push({ priority: 'P1', action: a }));
  } else {
    const eb0 = ebContacts.find((c: any) => !isEngaged(c));
    if (eb0) nextSteps.push({ priority: 'P0', action: `Multi-thread into ${eb0.name ? anon.person(eb0.name) : eb0.email || 'the economic buyer'}${eb0.title ? ` (${eb0.title})` : ''} — schedule introductory meeting.` });
    if (timeline.length === 0 && conversations.length === 0) nextSteps.push({ priority: 'P0', action: `Confirm deal is active with owner${deal.owner_email ? ` (${anon.email(deal.owner_email)})` : ''} — zero CRM activity recorded.` });
    if (coverageGapsData.unlinked_calls > 0) nextSteps.push({ priority: 'P1', action: `Review ${coverageGapsData.unlinked_calls} unlinked conversation${coverageGapsData.unlinked_calls > 1 ? 's' : ''} for potential deal intelligence.` });
    if (stageHistory.length === 0) nextSteps.push({ priority: 'P1', action: 'Request CRM stage history tracking to be enabled in your CRM.' });
    const unknownRoles = contactsList.filter((c: any) => !c.buying_role || c.buying_role === 'unknown');
    if (unknownRoles.length > 0) nextSteps.push({ priority: 'P2', action: `Classify ${unknownRoles.length} contact${unknownRoles.length > 1 ? 's' : ''} with unknown buying roles.` });
  }
  // Coaching velocity next step (from stage-specific benchmark)
  if (coachingNextStep && nextSteps.length < 5) {
    nextSteps.push({ priority: 'P1', action: coachingNextStep });
  }
  // MEDDIC gap next steps — only when data has loaded (not null)
  if (meddicCoverage !== null) {
    const meddicGapCopy: Record<string, string> = {
      economic_buyer: 'Economic buyer not confirmed in calls — get them on a call before advancing stage',
      champion: 'No internal champion identified in calls — establish an internal sponsor who will advocate for this deal',
      metrics: 'Success metrics not established — quantify ROI and business impact with the prospect',
      decision_criteria: 'Decision criteria not captured — ask how they will evaluate and select a vendor',
      decision_process: 'Decision process unknown — map out evaluation steps from POC to signed contract',
      identify_pain: 'Pain not documented in calls — ensure the core business problem is articulated and agreed',
    };
    const priorityOrder = ['economic_buyer', 'champion', 'metrics', 'decision_criteria', 'decision_process', 'identify_pain'];
    let meddicAdded = 0;
    for (const field of priorityOrder) {
      if (meddicAdded >= 2 || nextSteps.length >= 5) break;
      if (!meddicCoverage.covered_fields.includes(field)) {
        nextSteps.push({ priority: 'P1', action: meddicGapCopy[field] });
        meddicAdded++;
      }
    }
  }
  const priorityMeta = {
    P0: { color: colors.red, bg: `${colors.red}15` },
    P1: { color: colors.yellow, bg: `${colors.yellow}12` },
    P2: { color: colors.accent, bg: colors.accentSoft },
  };

  // Client-side narrative fallback
  const fallbackSummary = (() => {
    const parts: string[] = [];
    if (deal.amount) parts.push(`${formatCurrency(Number(deal.amount) || 0)} ${deal.stage || 'deal'}.`);
    if (contactsList.length > 0) parts.push(`${contactsList.length} contact${contactsList.length !== 1 ? 's' : ''} identified, ${contactsList.filter(isEngaged).length} engaged.`);
    if (timeline.length > 0) parts.push(`Last activity: ${formatTimeAgo(timeline[0].date)}.`);
    else parts.push('No activity records found.');
    return parts.join(' ');
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Breadcrumbs */}
      <nav style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
        <Link to="/" style={{ color: colors.accent, textDecoration: 'none' }}>Command Center</Link>
        <span style={{ color: colors.textMuted }}>&gt;</span>
        <Link to="/deals" style={{ color: colors.accent, textDecoration: 'none' }}>Deals</Link>
        <span style={{ color: colors.textMuted }}>&gt;</span>
        <span style={{ color: colors.textSecondary }}>{anon.deal(deal.name || 'Deal')}</span>
      </nav>

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

      {/* ══════════════════════════════════════════════════════════════════════
          TIER 1: Executive Summary
          ══════════════════════════════════════════════════════════════════════ */}

      {/* Deal Header */}
      <SectionErrorBoundary fallbackMessage="Unable to load deal header.">
      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: 20,
      }}>
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: isMobile ? 'stretch' : 'flex-start', gap: isMobile ? 12 : 16 }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: colors.text }}>
              {anon.deal(deal.name || 'Unnamed Deal')}
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
              <span style={{ fontSize: 24, fontWeight: 700, fontFamily: fonts.mono, color: colors.text }}>
                {formatCurrency(anon.amount(Number(deal.amount) || 0))}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '3px 10px',
                  borderRadius: 6,
                  background: colors.accentSoft,
                  color: colors.accent,
                }}>
                  {deal.stage || deal.stage_normalized?.replace(/_/g, ' ') || 'Unknown'}
                </span>
                {deal.stage && deal.stage_normalized && deal.stage.toLowerCase().replace(/\s+/g, '') !== deal.stage_normalized.toLowerCase().replace(/_/g, '') && (
                  <span style={{
                    fontSize: 10,
                    color: colors.textMuted,
                    textTransform: 'capitalize',
                  }}>
                    → {deal.stage_normalized.replace(/_/g, ' ')}
                  </span>
                )}
              </div>
              {daysInStage != null && (
                <span style={{
                  fontSize: 11, fontWeight: 500, fontFamily: fonts.mono,
                  color: colors.textMuted,
                }}>
                  {daysInStage}d in stage
                </span>
              )}
              {deal.phase_divergence && deal.phase_confidence >= 0.6 && (
                <>
                  <span style={{ color: colors.textMuted, fontSize: 13 }}>→</span>
                  <div
                    style={{
                      background: colors.yellowSoft,
                      border: `1px solid ${colors.yellow}`,
                      borderRadius: 6,
                      padding: '4px 10px',
                      fontSize: 11,
                      fontWeight: 600,
                      color: colors.yellow,
                      cursor: 'help',
                    }}
                    title={`Signals: ${deal.phase_signals?.map((s: any) => `${s.keyword} (${s.count})`).join(', ')}`}
                  >
                    ⚡ Likely: {deal.inferred_phase} ({Math.round(deal.phase_confidence * 100)}%)
                  </div>
                  <button
                    onClick={() => {
                      console.log('Update stage clicked - implement CRM navigation');
                    }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: colors.accent,
                      fontSize: 11,
                      cursor: 'pointer',
                      textDecoration: 'underline',
                      padding: 0,
                    }}
                  >
                    Update stage
                  </button>
                </>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: isMobile ? 8 : 16, marginTop: 8, fontSize: 12, color: colors.textMuted }}>
              <span>Owner: {deal.owner_name ? anon.person(deal.owner_name) : deal.owner_email ? anon.email(deal.owner_email) : deal.owner ? anon.person(deal.owner) : '--'}</span>
              <span>
                Close: {deal.close_date ? formatDate(deal.close_date) : '--'}
                {deal.close_date_suspect && (
                  <span style={{ color: colors.yellow, marginLeft: 4 }} title="A recent conversation mentions a timeline — close date may need updating">
                    ⚠ May be stale
                  </span>
                )}
              </span>
              {deal.account_name && (
                <span
                  style={{ color: colors.accent, cursor: 'pointer' }}
                  onClick={() => deal.account_id && navigate(`/accounts/${deal.account_id}`)}
                >
                  {anon.company(deal.account_name)}
                </span>
              )}
            </div>

            {/* Metadata strip — pipeline, probability, forecast */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
              {/* CRM Pipeline chip */}
              {(deal.pipeline || deal.pipeline_name) && (
                canEditPipeline ? (
                  <div ref={pipelineDropdownRef} style={{ position: 'relative' }}>
                    {pipelineEditing && (
                      <div style={{
                        position: 'absolute', left: 0, top: 'calc(100% + 4px)', zIndex: 20,
                        background: colors.surface, border: `1px solid ${colors.border}`,
                        borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
                        minWidth: 200, maxHeight: 240, overflowY: 'auto',
                      }}>
                        {pipelines.map(p => (
                          <button key={p} onClick={() => handlePipelineChange(p)} disabled={pipelineSaving}
                            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', border: 'none', background: p === deal.pipeline ? `${colors.accent}15` : 'transparent', color: colors.text, fontSize: 13, cursor: 'pointer', textAlign: 'left' }}
                            onMouseEnter={e => { (e.target as HTMLElement).style.background = `${colors.accent}15`; }}
                            onMouseLeave={e => { (e.target as HTMLElement).style.background = p === deal.pipeline ? `${colors.accent}15` : 'transparent'; }}
                          >
                            {p === deal.pipeline && <Check size={14} color={colors.accent} />}
                            <span style={{ marginLeft: p === deal.pipeline ? 0 : 22 }}>{p}</span>
                          </button>
                        ))}
                        <div style={{ borderTop: pipelines.length > 0 ? `1px solid ${colors.border}` : 'none', padding: '6px 8px' }}>
                          <form onSubmit={e => { e.preventDefault(); const input = (e.target as HTMLFormElement).elements.namedItem('heroPipeline') as HTMLInputElement; const val = input?.value?.trim(); if (val) handlePipelineChange(val); }}>
                            <input name="heroPipeline" placeholder="Type custom pipeline..." disabled={pipelineSaving}
                              style={{ width: '100%', padding: '6px 8px', fontSize: 12, background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 4, color: colors.text, outline: 'none', boxSizing: 'border-box' }}
                              onFocus={e => { e.target.style.borderColor = colors.accent; }}
                              onBlur={e => { e.target.style.borderColor = colors.border; }}
                            />
                          </form>
                        </div>
                      </div>
                    )}
                    <button onClick={() => setPipelineEditing(!pipelineEditing)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 20, border: `1px solid ${colors.border}`, background: colors.surfaceHover, cursor: 'pointer', fontSize: 11, color: colors.text }}>
                      <span style={{ color: colors.textMuted, marginRight: 2 }}>Pipeline:</span>
                      {pipelineSaving ? 'Saving…' : (deal.pipeline_name || deal.pipeline)}
                      <ChevronDown size={11} color={colors.textMuted} />
                    </button>
                  </div>
                ) : (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 20, background: colors.surfaceHover, fontSize: 11, color: colors.text }}>
                    <span style={{ color: colors.textMuted }}>Pipeline:</span> {deal.pipeline_name || deal.pipeline}
                  </span>
                )
              )}

              {/* Pandora Pipeline chip */}
              {scopes.length > 0 && (deal.scope_id || canEditPipeline) && (
                canEditPipeline ? (
                  <div ref={scopeDropdownRef} style={{ position: 'relative' }}>
                    {scopeEditing && (
                      <div style={{
                        position: 'absolute', left: 0, top: 'calc(100% + 4px)', zIndex: 20,
                        background: colors.surface, border: `1px solid ${colors.border}`,
                        borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
                        minWidth: 200, maxHeight: 240, overflowY: 'auto',
                      }}>
                        {scopes.map(s => (
                          <button key={s.scope_id} onClick={() => handleScopeChange(s.scope_id)} disabled={scopeSaving}
                            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', border: 'none', background: s.scope_id === deal.scope_id ? `${colors.accent}15` : 'transparent', color: colors.text, fontSize: 13, cursor: 'pointer', textAlign: 'left' }}
                            onMouseEnter={e => { (e.target as HTMLElement).style.background = `${colors.accent}15`; }}
                            onMouseLeave={e => { (e.target as HTMLElement).style.background = s.scope_id === deal.scope_id ? `${colors.accent}15` : 'transparent'; }}
                          >
                            {s.scope_id === deal.scope_id && <Check size={14} color={colors.accent} />}
                            <span style={{ marginLeft: s.scope_id === deal.scope_id ? 0 : 22 }}>{s.name}</span>
                          </button>
                        ))}
                        {deal.scope_id && (
                          <div style={{ borderTop: `1px solid ${colors.border}`, padding: '6px 8px' }}>
                            <button onClick={() => handleScopeChange(null)} disabled={scopeSaving}
                              style={{ width: '100%', padding: '6px 8px', border: 'none', background: 'transparent', color: colors.textMuted, fontSize: 12, cursor: 'pointer', textAlign: 'left', borderRadius: 4 }}
                              onMouseEnter={e => { (e.target as HTMLElement).style.background = colors.surfaceHover; }}
                              onMouseLeave={e => { (e.target as HTMLElement).style.background = 'transparent'; }}
                            >↩ Reset to inferred</button>
                          </div>
                        )}
                      </div>
                    )}
                    <button onClick={() => setScopeEditing(!scopeEditing)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 20, border: `1px solid ${colors.accent}30`, background: `${colors.accent}08`, cursor: 'pointer', fontSize: 11, color: colors.text }}>
                      <span style={{ color: colors.textMuted, marginRight: 2 }}>Pandora:</span>
                      {scopeSaving ? 'Saving…' : (scopes.find(s => s.scope_id === deal.scope_id)?.name || deal.scope_id || 'Unassigned')}
                      <ChevronDown size={11} color={colors.textMuted} />
                    </button>
                  </div>
                ) : deal.scope_id ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 20, background: `${colors.accent}08`, border: `1px solid ${colors.accent}20`, fontSize: 11, color: colors.text }}>
                    <span style={{ color: colors.textMuted }}>Pandora:</span> {scopes.find(s => s.scope_id === deal.scope_id)?.name || deal.scope_id}
                  </span>
                ) : null
              )}

              {/* Probability chip */}
              {deal.probability != null && deal.probability !== '' && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 20, background: colors.surfaceHover, fontSize: 11, color: colors.text }}>
                  <span style={{ color: colors.textMuted }}>Prob:</span> {deal.probability}%
                </span>
              )}

              {/* Forecast chip */}
              {deal.forecast_category && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 20, background: colors.surfaceHover, fontSize: 11, color: colors.text }}>
                  <span style={{ color: colors.textMuted }}>Forecast:</span> {deal.forecast_category}
                </span>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
            {/* B-Score Ring */}
            {activeScore ? (
              <div style={{ position: 'relative' }}>
                <BScoreRing
                  score={activeScore.score}
                  grade={activeScore.grade}
                  onClick={() => setShowScoreBreakdown(true)}
                />
                {showScoreBreakdown && activeScore && riskScore && (
                  <ScoreBreakdownPanel
                    riskScore={riskScore}
                    mechanicalScore={mechanicalScore}
                    activeScore={activeScore}
                    coverageGaps={coverageGapsData}
                    onClose={() => setShowScoreBreakdown(false)}
                  />
                )}
              </div>
            ) : mechanicalScore?.score != null ? (
              <BScoreRing score={mechanicalScore.score} grade={mechanicalScore.grade} />
            ) : null}

            {/* CRM Link */}
            {(() => {
              const crmUrl = buildDealCrmUrl(crmInfo.crm, crmInfo.portalId ?? null, crmInfo.instanceUrl ?? null, deal.source_id, deal.source);
              if (!crmUrl) return null;
              const label = crmInfo.crm === 'hubspot' ? 'Open in HubSpot' : 'Open in Salesforce';
              return (
                <a href={crmUrl} target="_blank" rel="noopener noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 500, padding: '6px 12px', borderRadius: 6, textDecoration: 'none', background: colors.accentSoft, color: colors.accent, border: `1px solid ${colors.accent}30`, transition: 'all 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = `${colors.accent}25`; }}
                  onMouseLeave={e => { e.currentTarget.style.background = colors.accentSoft; }}
                >
                  {label}
                  <ExternalLink size={11} color={colors.accent} />
                </a>
              );
            })()}
          </div>
        </div>

      </div>
      </SectionErrorBoundary>

      {/* AI Narrative (Tier 1 continued) */}
      <SectionErrorBoundary fallbackMessage="Unable to load AI narrative.">
      {dealId && (
        <DossierNarrative
          narrative={narrative}
          recommended_actions={[]}
          narrative_generated_at={dossier?.narrative_generated_at}
          loading={narrativeLoading}
          onGenerate={() => fetchDossier(true)}
          fallbackSummary={fallbackSummary}
        />
      )}
      </SectionErrorBoundary>

      {/* ══════════════════════════════════════════════════════════════════════
          TIER 2: Key Insights
          ══════════════════════════════════════════════════════════════════════ */}

      {/* Insight Cards */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {insightCards.length === 0 ? (
          <InsightCard severity="ok" title="No Issues Detected">
            No significant risk signals found. Deal appears healthy based on available data.
          </InsightCard>
        ) : (
          insightCards.slice(0, 3).map((card, i) => (
            <InsightCard key={i} severity={card.severity} title={card.title}>
              {card.body}
            </InsightCard>
          ))
        )}
      </div>

      {/* High Priority Signals */}
      {inlineActions.length > 0 && showSignals !== false && (
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          padding: '14px 20px',
        }}>
          {showSignals === null ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 28, height: 28, borderRadius: 6, flexShrink: 0,
                background: colors.accentSoft, border: `1px solid ${colors.accentGlow}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
              }}>
                ✦
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: colors.text, marginBottom: 3, fontFamily: fonts.sans }}>
                  I found {inlineActions.length} high priority signal{inlineActions.length !== 1 ? 's' : ''} for this deal
                </div>
                <div style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.sans }}>
                  {inlineActions.filter(a => a.severity === 'critical').length > 0 && (
                    <span style={{ color: colors.red, fontWeight: 600 }}>{inlineActions.filter(a => a.severity === 'critical').length} critical</span>
                  )}
                  {inlineActions.filter(a => a.severity === 'critical').length > 0 && inlineActions.filter(a => a.severity === 'warning').length > 0 && ' • '}
                  {inlineActions.filter(a => a.severity === 'warning').length > 0 && (
                    <span style={{ color: colors.orange, fontWeight: 600 }}>{inlineActions.filter(a => a.severity === 'warning').length} warning</span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button
                  onClick={() => setShowSignals(true)}
                  style={{
                    padding: '6px 12px', fontSize: 11, fontWeight: 600, border: 'none',
                    borderRadius: 6, cursor: 'pointer', background: colors.accent, color: '#fff',
                    fontFamily: fonts.sans, boxShadow: `0 0 12px ${colors.accentGlow}`,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = '0.9')}
                  onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                >
                  Yes, show signals
                </button>
                <button
                  onClick={() => setShowSignals(false)}
                  style={{
                    padding: '6px 12px', fontSize: 11, fontWeight: 500,
                    border: `1px solid ${colors.border}`, borderRadius: 6, cursor: 'pointer',
                    background: 'transparent', color: colors.textSecondary, fontFamily: fonts.sans,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = colors.text)}
                  onMouseLeave={e => (e.currentTarget.style.color = colors.textSecondary)}
                >
                  No thanks
                </button>
              </div>
            </div>
          ) : (
            <>
              <div style={{
                fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                letterSpacing: '0.07em', color: colors.textMuted, marginBottom: 12, fontFamily: fonts.sans,
              }}>
                High Priority Signals
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {inlineActions.map((action) => (
                  <StageRecCard
                    key={action.id}
                    action={action}
                    onExecute={(overrideStage) => executeAction(action.id, overrideStage)}
                    onDismiss={() => dismissAction(action.id)}
                    compact={false}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Stakeholder Coverage Rings */}
      {contactsList.length > 0 && (
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          padding: '14px 20px',
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: colors.textMuted, marginBottom: 14 }}>
            Stakeholder Coverage
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: isMobile ? 16 : 32 }}>
            <StakeholderRing
              label="Decision Makers"
              engaged={dmContacts.filter(isEngaged).length}
              total={dmContacts.length}
              color={colors.red}
            />
            <StakeholderRing
              label="Economic Buyers"
              engaged={ebContacts.filter(isEngaged).length}
              total={ebContacts.length}
              color={colors.yellow}
            />
            <StakeholderRing
              label="Influencers"
              engaged={infContacts.filter(isEngaged).length}
              total={infContacts.length}
              color={colors.accent}
            />
          </div>
        </div>
      )}

      {/* Recommended Next Steps */}
      {nextSteps.length > 0 && (
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          padding: '14px 20px',
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: colors.textMuted, marginBottom: 12 }}>
            Recommended Next Steps
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {nextSteps.slice(0, 5).map((step, i) => {
              const pm = priorityMeta[step.priority];
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                    background: pm.bg, color: pm.color,
                    flexShrink: 0, marginTop: 1,
                  }}>{step.priority}</span>
                  <span style={{ fontSize: 13, color: colors.text, lineHeight: 1.5 }}>{step.action}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TIER 3: Drill-Down Details
          ══════════════════════════════════════════════════════════════════════ */}

      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: colors.textMuted, paddingTop: 4 }}>
        Details
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

        {/* Contacts accordion */}
        <Accordion title="All Contacts" badge={contactsList.length}>
          <div style={{ paddingTop: 12 }}>
          {contactsList.length === 0 ? (
            <p style={{ fontSize: 13, color: colors.textMuted, padding: '8px 0' }}>No contacts linked — this deal is single-threaded.</p>
          ) : (
            contactsList.map((c: any, i: number) => {
              const eng = engagementDot(c.engagement_level);
              const prevContact = i > 0 ? contactsList[i - 1] : null;
              const showUnengagedSeparator = prevContact && prevContact.engagement_level !== 'unengaged' && c.engagement_level === 'unengaged';
              return (
                <React.Fragment key={i}>
                  {showUnengagedSeparator && (
                    <div style={{ borderTop: `1px solid ${colors.border}`, padding: '8px 0', fontSize: 10, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
                      Not yet engaged
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: `1px solid ${colors.border}` }}>
                    <div style={{ width: 26, height: 26, borderRadius: '50%', background: colors.surfaceHover, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 600, color: colors.textSecondary, flexShrink: 0 }}>
                      {(c.name ? anon.person(c.name) : c.email ? anon.email(c.email) : '?').charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 12, fontWeight: 500, color: colors.text }}>{c.name ? anon.person(c.name) : c.email ? anon.email(c.email) : 'Unknown'}</span>
                      {c.title && <span style={{ fontSize: 11, color: colors.textMuted, display: 'block' }}>{c.title}</span>}
                      {c.last_activity_date && <span style={{ fontSize: 10, color: colors.textDim, display: 'block' }}>Last active {formatTimeAgo(c.last_activity_date)}</span>}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: eng.color, boxShadow: `0 0 4px ${eng.color}40` }} />
                        <span style={{ fontSize: 10, color: eng.color }}>{eng.label}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {c.role && (
                          <span title={c.role_confidence ? `Confidence: ${c.role_confidence}` : undefined} style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: colors.accentSoft, color: colors.accent, textTransform: 'capitalize' }}>
                            {c.role}
                          </span>
                        )}
                        {c.buying_role && c.buying_role !== c.role && (
                          <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: `${colors.purple}15`, color: colors.purple, textTransform: 'capitalize' }}>
                            {c.buying_role}
                          </span>
                        )}
                        {(() => {
                          const pill = linkMethodPill(c.link_method);
                          return pill ? (
                            <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: pill.bg, color: pill.color }}>{pill.label}</span>
                          ) : null;
                        })()}
                      </div>
                    </div>
                  </div>
                </React.Fragment>
              );
            })
          )}
          </div>
        </Accordion>

        {/* MEDDIC Coverage accordion */}
        {(() => {
          const MEDDIC_FIELDS: Array<{ key: string; label: string }> = [
            { key: 'metrics', label: 'Metrics' },
            { key: 'economic_buyer', label: 'Economic Buyer' },
            { key: 'decision_criteria', label: 'Decision Criteria' },
            { key: 'decision_process', label: 'Decision Process' },
            { key: 'identify_pain', label: 'Identify Pain' },
            { key: 'champion', label: 'Champion' },
          ];
          const covered = meddicCoverage?.covered_fields ?? [];
          const coveredCount = covered.length;
          return (
            <Accordion title="MEDDIC Coverage" badge={`${coveredCount}/6`}>
              <div style={{ paddingTop: 12 }}>
                <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 14, lineHeight: 1.5 }}>
                  Confirmed from call signals extracted across conversations with this account
                </div>
                {meddicCoverage === null ? (
                  <div style={{ fontSize: 12, color: colors.textMuted }}>Loading…</div>
                ) : coveredCount === 0 ? (
                  <div style={{ fontSize: 12, color: colors.textMuted, lineHeight: 1.6 }}>
                    No MEDDIC signals extracted from conversations yet. Signals populate automatically when call recordings are processed.
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px' }}>
                    {MEDDIC_FIELDS.map(({ key, label }) => {
                      const isCovered = covered.includes(key);
                      const sigCount = meddicCoverage.field_signal_counts?.[key];
                      return (
                        <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                          <span style={{ fontSize: 12, color: colors.textSecondary }}>{label}</span>
                          {isCovered ? (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: colors.green, background: `${colors.green}18`, padding: '2px 8px', borderRadius: 10, whiteSpace: 'nowrap' }}>
                              ✓ Covered{sigCount ? <span style={{ fontWeight: 400, color: colors.textMuted }}> · {sigCount}</span> : null}
                            </span>
                          ) : (
                            <span style={{ fontSize: 11, fontWeight: 500, color: colors.textMuted, background: colors.surfaceHover, padding: '2px 8px', borderRadius: 10 }}>
                              Gap
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </Accordion>
          );
        })()}

        {/* Findings accordion — only show if there are findings */}
        {findingsList.length > 0 && (
          <SectionErrorBoundary fallbackMessage="Something went wrong loading findings.">
          <Accordion title="Findings" badge={findingsList.length}>
            <div style={{ paddingTop: 12 }}>
            {findingsList.map((f: any, i: number) => {
              const isProcessing = dismissingId === f.id || snoozingId === f.id;
              return (
                <div key={f.id || i} style={{ display: 'flex', gap: 8, padding: '8px 0', borderBottom: `1px solid ${colors.border}`, opacity: isProcessing ? 0.4 : 1, transition: 'opacity 0.3s' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: severityColor(f.severity), marginTop: 5, flexShrink: 0, boxShadow: `0 0 6px ${severityColor(f.severity)}40` }} />
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 13, color: colors.text }}>{anon.text(f.message)}</p>
                    <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'center' }}>
                      <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 3, background: `${severityColor(f.severity)}15`, color: severityColor(f.severity), textTransform: 'capitalize' }}>
                        {SEVERITY_LABELS[f.severity] || f.severity}
                      </span>
                      <span style={{ fontSize: 11, color: colors.textMuted }}>{f.skill_id} · {formatTimeAgo(f.found_at)}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 4, alignSelf: 'center', flexShrink: 0, position: 'relative' }}>
                    <button onClick={() => setSnoozeDropdownId(snoozeDropdownId === f.id ? null : f.id)} disabled={isProcessing}
                      style={{ fontSize: 11, fontWeight: 500, padding: '4px 10px', borderRadius: 4, border: `1px solid ${colors.border}`, background: 'transparent', color: colors.textMuted, cursor: isProcessing ? 'not-allowed' : 'pointer' }}
                      onMouseEnter={e => { if (!isProcessing) { e.currentTarget.style.borderColor = colors.yellow; e.currentTarget.style.color = colors.yellow; } }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = colors.border; e.currentTarget.style.color = colors.textMuted; }}
                    >Snooze</button>
                    {snoozeDropdownId === f.id && (
                      <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: colors.surfaceRaised, border: `1px solid ${colors.border}`, borderRadius: 6, padding: 4, zIndex: 100, display: 'flex', flexDirection: 'column', gap: 2, boxShadow: '0 4px 12px rgba(0,0,0,0.3)', minWidth: 80 }}>
                        {SNOOZE_OPTIONS.map(opt => (
                          <button key={opt.days} onClick={() => snoozeFinding(f.id, opt.days)}
                            style={{ fontSize: 11, padding: '4px 8px', borderRadius: 4, background: 'transparent', border: 'none', color: colors.textSecondary, cursor: 'pointer', textAlign: 'left' }}
                            onMouseEnter={e => { e.currentTarget.style.background = colors.surfaceHover; e.currentTarget.style.color = colors.yellow; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = colors.textSecondary; }}
                          >{opt.label}</button>
                        ))}
                      </div>
                    )}
                    <button onClick={() => dismissFinding(f.id)} disabled={isProcessing}
                      style={{ fontSize: 11, fontWeight: 500, padding: '4px 10px', borderRadius: 4, border: `1px solid ${colors.border}`, background: 'transparent', color: colors.textMuted, cursor: isProcessing ? 'not-allowed' : 'pointer' }}
                      onMouseEnter={e => { if (!isProcessing) { e.currentTarget.style.borderColor = colors.red; e.currentTarget.style.color = colors.red; } }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = colors.border; e.currentTarget.style.color = colors.textMuted; }}
                    >{dismissingId === f.id ? '...' : 'Dismiss'}</button>
                  </div>
                </div>
              );
            })}
            </div>
          </Accordion>
          </SectionErrorBoundary>
        )}

        {/* Stage History accordion */}
        <Accordion title="Stage History">
          <div style={{ paddingTop: 12 }}>
          {stageHistory.length === 0 ? (
            <p style={{ fontSize: 13, color: colors.textMuted, lineHeight: 1.6 }}>
              Stage history not available — requires CRM field history tracking to be enabled in Salesforce/HubSpot.
            </p>
          ) : (
            <div style={{ paddingLeft: 12 }}>
              {stageHistory.map((s: any, i: number) => (
                <div key={i} style={{ display: 'flex', gap: 12, paddingBottom: 12, position: 'relative', borderLeft: i < stageHistory.length - 1 ? `2px solid ${colors.border}` : `2px solid ${colors.accent}`, paddingLeft: 16 }}>
                  <div style={{ position: 'absolute', left: -5, top: 0, width: 8, height: 8, borderRadius: '50%', background: i === stageHistory.length - 1 ? colors.accent : colors.border }} />
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 500, color: colors.text }}>{s.stage_label || s.stage_normalized?.replace(/_/g, ' ') || s.stage?.replace(/_/g, ' ') || 'Unknown'}</span>
                    <div style={{ fontSize: 11, color: colors.textMuted }}>{s.entered_at ? formatDate(s.entered_at) : ''}{s.days_in_stage ? ` · ${Math.round(s.days_in_stage)}d` : ''}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          </div>
        </Accordion>

        {/* Activity Timeline accordion - merged with stage markers */}
        <Accordion title="Activity Timeline" badge={timeline.length}>
          <div style={{ paddingTop: 12 }}>
          {timeline.length === 0 ? (
            <p style={{ fontSize: 13, color: colors.textMuted, lineHeight: 1.6 }}>
              No activity or conversation records found. Connect a conversation intelligence tool (Gong, Fireflies) for richer deal context.
            </p>
          ) : (
            stageAnnotatedTimeline.slice(0, 50).map((item: any) => {
              // Render stage marker as section header
              if (item.type === 'stage_marker') {
                const dateRange = item.exited_at
                  ? `${formatDate(item.entered_at)} → ${formatDate(item.exited_at)}`
                  : `${formatDate(item.entered_at)} → Present`;
                return (
                  <div key={item.id} style={{
                    padding: '10px 12px',
                    background: item.isCurrent ? `${colors.accent}08` : colors.surfaceHover,
                    border: `1px solid ${item.isCurrent ? colors.accent : colors.border}`,
                    borderRadius: 6,
                    marginBottom: 8,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: item.isCurrent ? colors.accent : colors.text }}>
                        {item.stage}
                      </span>
                      <span style={{ fontSize: 10, color: colors.textMuted }}>
                        {item.days_in_stage} day{item.days_in_stage !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div style={{ fontSize: 10, color: colors.textMuted, marginTop: 2 }}>
                      {dateRange}
                    </div>
                  </div>
                );
              }

              // Render regular activity/conversation
              const badge = sourceBadge(item.source);
              const isExpanded = expandedSummaries.has(item.id);
              return (
                <div key={item.id} style={{ padding: '8px 0 8px 12px', borderLeft: `2px solid ${colors.borderLight}`, marginLeft: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    {item.type === 'activity' && <span style={{ fontSize: 12, width: 20, textAlign: 'center', flexShrink: 0, marginTop: 2 }}>{item.icon}</span>}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        {item.type === 'conversation' ? (
                          <Link to={`/conversations/${item.id}`} style={{ fontSize: 13, fontWeight: 500, color: colors.text, margin: 0, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'none' }}>
                            {anon.text(item.label)}
                          </Link>
                        ) : (
                          <p style={{ fontSize: 12, fontWeight: 400, color: colors.text, margin: 0, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {anon.text(item.label)}
                          </p>
                        )}
                        <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 4, background: badge.bg, color: badge.color, flexShrink: 0 }}>{badge.label}</span>
                        {item.type === 'conversation' && (() => {
                          const url = buildConversationUrl(item.source, item.source_id, item.source_data, item.custom_fields);
                          return url ? <a href={url} target="_blank" rel="noopener noreferrer" title={`Open in ${item.source}`} style={{ color: colors.accent, lineHeight: 0, flexShrink: 0 }}><ExternalLink size={14} /></a> : null;
                        })()}
                      </div>
                      <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                        {item.date ? formatTimeAgo(item.date) : ''}{item.meta && ` · ${anon.text(item.meta)}`}
                      </div>
                      {item.summary && (
                        <div style={{ marginTop: 4 }}>
                          <button onClick={() => { const n = new Set(expandedSummaries); isExpanded ? n.delete(item.id) : n.add(item.id); setExpandedSummaries(n); }}
                            style={{ background: 'none', border: 'none', color: colors.accent, fontSize: 11, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
                            {isExpanded ? 'Hide summary' : 'Show summary'}
                          </button>
                          {isExpanded && <p style={{ fontSize: 12, color: colors.textSecondary, marginTop: 4, lineHeight: 1.4 }}>{anon.text(item.summary)}</p>}
                        </div>
                      )}
                      {item.body && item.type === 'activity' && (
                        <div style={{ marginTop: 4 }}>
                          <button onClick={() => { const n = new Set(expandedSummaries); isExpanded ? n.delete(item.id) : n.add(item.id); setExpandedSummaries(n); }}
                            style={{ background: 'none', border: 'none', color: colors.accent, fontSize: 11, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
                            {isExpanded ? 'Hide note' : 'Show note'}
                          </button>
                          {isExpanded && <p style={{ fontSize: 12, color: colors.textSecondary, marginTop: 4, lineHeight: 1.4 }}>{anon.text((() => {
                            const stripped = item.body.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/gi, ' ').trim();
                            return stripped.length > 400 ? stripped.slice(0, 400) + '…' : stripped;
                          })())}</p>}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          </div>
        </Accordion>

        {/* Deal Metadata accordion */}
        <Accordion title="Deal Metadata">
          <div style={{ paddingTop: 12 }}>
            {/* CRM section */}
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: colors.textMuted, marginBottom: 8 }}>CRM</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: colors.textMuted, marginBottom: 3 }}>Pipeline</div>
                {canEditPipeline ? (
                  <div ref={pipelineDropdownRef} style={{ position: 'relative' }}>
                    {pipelineEditing && (
                      <div style={{ position: 'absolute', left: 0, top: 'calc(100% + 4px)', zIndex: 20, background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.25)', minWidth: 200, maxHeight: 240, overflowY: 'auto' }}>
                        {pipelines.map(p => (
                          <button key={p} onClick={() => handlePipelineChange(p)} disabled={pipelineSaving}
                            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', border: 'none', background: p === deal.pipeline ? `${colors.accent}15` : 'transparent', color: colors.text, fontSize: 13, cursor: 'pointer', textAlign: 'left' }}
                            onMouseEnter={e => { (e.target as HTMLElement).style.background = `${colors.accent}15`; }}
                            onMouseLeave={e => { (e.target as HTMLElement).style.background = p === deal.pipeline ? `${colors.accent}15` : 'transparent'; }}
                          >
                            {p === deal.pipeline && <Check size={14} color={colors.accent} />}
                            <span style={{ marginLeft: p === deal.pipeline ? 0 : 22 }}>{p}</span>
                          </button>
                        ))}
                        <div style={{ borderTop: pipelines.length > 0 ? `1px solid ${colors.border}` : 'none', padding: '6px 8px' }}>
                          <form onSubmit={e => { e.preventDefault(); const input = (e.target as HTMLFormElement).elements.namedItem('metaPipeline') as HTMLInputElement; if (input?.value?.trim()) handlePipelineChange(input.value.trim()); }}>
                            <input name="metaPipeline" placeholder="Custom pipeline…" disabled={pipelineSaving} style={{ width: '100%', padding: '6px 8px', fontSize: 12, background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 4, color: colors.text, outline: 'none', boxSizing: 'border-box' }} onFocus={e => { e.target.style.borderColor = colors.accent; }} onBlur={e => { e.target.style.borderColor = colors.border; }} />
                          </form>
                        </div>
                      </div>
                    )}
                    <button onClick={() => setPipelineEditing(!pipelineEditing)} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: 'transparent', border: `1px solid ${colors.border}`, borderRadius: 5, padding: '3px 8px', cursor: 'pointer', color: colors.text, fontSize: 12 }}>
                      {pipelineSaving ? 'Saving…' : (deal.pipeline_name || deal.pipeline || '—')}
                      <ChevronDown size={11} color={colors.textMuted} />
                    </button>
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: colors.text }}>{deal.pipeline_name || deal.pipeline || '—'}</div>
                )}
              </div>
              <div>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: colors.textMuted, marginBottom: 3 }}>Source</div>
                <div style={{ fontSize: 12, color: colors.text }}>{deal.source || '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: colors.textMuted, marginBottom: 3 }}>Probability</div>
                <div style={{ fontSize: 12, color: colors.text }}>{deal.probability != null ? `${deal.probability}%` : '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: colors.textMuted, marginBottom: 3 }}>Forecast</div>
                <div style={{ fontSize: 12, color: colors.text }}>{deal.forecast_category || '—'}</div>
              </div>
              {deal.lead_source && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: colors.textMuted, marginBottom: 3 }}>Lead Source</div>
                  <div style={{ fontSize: 12, color: colors.text }}>{deal.lead_source}</div>
                </div>
              )}
            </div>
            {/* Pandora section */}
            {scopes.length > 0 && (
              <>
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: colors.textMuted, marginBottom: 8, borderTop: `1px solid ${colors.border}`, paddingTop: 10 }}>Pandora</div>
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: colors.textMuted, marginBottom: 3 }}>Pipeline</div>
                  {canEditPipeline ? (
                    <div ref={scopeDropdownRef} style={{ position: 'relative' }}>
                      {scopeEditing && (
                        <div style={{ position: 'absolute', left: 0, top: 'calc(100% + 4px)', zIndex: 20, background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.25)', minWidth: 200, maxHeight: 240, overflowY: 'auto' }}>
                          {scopes.map(s => (
                            <button key={s.scope_id} onClick={() => handleScopeChange(s.scope_id)} disabled={scopeSaving}
                              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', border: 'none', background: s.scope_id === deal.scope_id ? `${colors.accent}15` : 'transparent', color: colors.text, fontSize: 13, cursor: 'pointer', textAlign: 'left' }}
                              onMouseEnter={e => { (e.target as HTMLElement).style.background = `${colors.accent}15`; }}
                              onMouseLeave={e => { (e.target as HTMLElement).style.background = s.scope_id === deal.scope_id ? `${colors.accent}15` : 'transparent'; }}
                            >
                              {s.scope_id === deal.scope_id && <Check size={14} color={colors.accent} />}
                              <span style={{ marginLeft: s.scope_id === deal.scope_id ? 0 : 22 }}>{s.name}</span>
                            </button>
                          ))}
                          {deal.scope_id && (
                            <div style={{ borderTop: `1px solid ${colors.border}`, padding: '6px 8px' }}>
                              <button onClick={() => handleScopeChange(null)} disabled={scopeSaving} style={{ width: '100%', padding: '6px 8px', border: 'none', background: 'transparent', color: colors.textMuted, fontSize: 12, cursor: 'pointer', textAlign: 'left', borderRadius: 4 }} onMouseEnter={e => { (e.target as HTMLElement).style.background = colors.surfaceHover; }} onMouseLeave={e => { (e.target as HTMLElement).style.background = 'transparent'; }}>
                                ↩ Reset to inferred
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                      <button onClick={() => setScopeEditing(!scopeEditing)} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: 'transparent', border: `1px solid ${colors.border}`, borderRadius: 5, padding: '3px 8px', cursor: 'pointer', color: colors.text, fontSize: 12 }}>
                        {scopeSaving ? 'Saving…' : (scopes.find(s => s.scope_id === deal.scope_id)?.name || deal.scope_id || 'Unassigned')}
                        <ChevronDown size={11} color={colors.textMuted} />
                      </button>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: colors.text }}>{scopes.find(s => s.scope_id === deal.scope_id)?.name || deal.scope_id || '—'}</div>
                  )}
                </div>
              </>
            )}
            {/* Dates section */}
            <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', color: colors.textMuted, marginBottom: 8, borderTop: `1px solid ${colors.border}`, paddingTop: 10 }}>Dates</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>
              <div>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: colors.textMuted, marginBottom: 3 }}>Close Date</div>
                <div style={{ fontSize: 12, color: colors.text }}>
                  {deal.close_date ? formatDate(deal.close_date) : '—'}
                  {deal.close_date_suspect && <span style={{ color: colors.yellow, marginLeft: 4 }} title="May be stale">⚠</span>}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: colors.textMuted, marginBottom: 3 }}>Created</div>
                <div style={{ fontSize: 12, color: colors.text }}>{deal.created_at ? formatDate(deal.created_at) : '—'}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: colors.textMuted, marginBottom: 3 }}>Last Modified</div>
                <div style={{ fontSize: 12, color: colors.text }}>{deal.updated_at ? formatDate(deal.updated_at) : '—'}</div>
              </div>
            </div>
          </div>
        </Accordion>

        {/* Score History accordion — hidden if no data */}
        {scoreHistory.length > 0 && (
          <SectionErrorBoundary fallbackMessage="Unable to load score history.">
          <Accordion title="Score History">
            <div style={{ paddingTop: 12, overflowX: 'auto', maxWidth: '100%', WebkitOverflowScrolling: 'touch' as any }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: isMobile ? 500 : undefined }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                    {['Week', 'Score', 'Grade', 'Change', 'Notes'].map(h => (
                      <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: colors.textMuted }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {scoreHistory.slice(0, 8).map((s: any, i: number) => {
                    const delta = s.score_delta;
                    const deltaEl = delta == null ? <span style={{ color: colors.textMuted }}>—</span>
                      : delta > 0 ? <span style={{ color: colors.green }}>↑{delta}</span>
                      : delta < 0 ? <span style={{ color: colors.red }}>↓{Math.abs(delta)}</span>
                      : <span style={{ color: colors.textMuted }}>—</span>;
                    const weekLabel = s.snapshot_date ? new Date(s.snapshot_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
                    const commentary = s.commentary ? (s.commentary.length > 100 ? s.commentary.slice(0, 100) + '...' : s.commentary) : '';
                    return (
                      <tr key={i} style={{ borderBottom: `1px solid ${colors.border}` }}>
                        <td style={{ padding: '8px 10px', color: colors.textSecondary, fontFamily: fonts.mono, fontSize: 11 }}>{weekLabel}</td>
                        <td style={{ padding: '8px 10px', color: colors.text, fontFamily: fonts.mono, fontWeight: 600 }}>{s.active_score ?? s.health_score ?? '—'}</td>
                        <td style={{ padding: '8px 10px' }}>
                          <span style={{ fontSize: 11, fontWeight: 700, fontFamily: fonts.mono, padding: '1px 6px', borderRadius: 4, background: `${gradeColor(s.grade || '—')}20`, color: gradeColor(s.grade || '—') }}>{s.grade || '—'}</span>
                        </td>
                        <td style={{ padding: '8px 10px', fontFamily: fonts.mono, fontWeight: 600 }}>{deltaEl}</td>
                        <td style={{ padding: '8px 10px', color: colors.textMuted, fontStyle: 'italic', maxWidth: isMobile ? '100%' : 320 }}>{commentary}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Accordion>
          </SectionErrorBoundary>
        )}

      </div>{/* end Tier 3 accordions */}

      {/* Floating Ask button */}
      <button
        onClick={() => setAnalysisOpen(true)}
        style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 50,
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '12px 20px', borderRadius: 100,
          background: colors.accent, color: '#fff',
          border: 'none', cursor: 'pointer',
          fontSize: 13, fontWeight: 600,
          boxShadow: `0 4px 20px ${colors.accent}50`,
          transition: 'transform 0.15s, box-shadow 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.05)'; e.currentTarget.style.boxShadow = `0 6px 28px ${colors.accent}70`; }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = `0 4px 20px ${colors.accent}50`; }}
      >
        ✦ Ask about this deal
      </button>

      {dealId && (
        <AnalysisModal
          scope={{ type: 'deal', entity_id: dealId }}
          visible={analysisOpen}
          onClose={() => setAnalysisOpen(false)}
        />
      )}
    </div>
  );
}
function ScoreBreakdownPanel({
  riskScore,
  mechanicalScore,
  activeScore,
  coverageGaps,
  onClose,
}: {
  riskScore: { score: number; grade: string; signal_counts: { act: number; watch: number; notable: number; info: number } };
  mechanicalScore: { score: number | null; grade: string } | null;
  activeScore: ActiveScore;
  coverageGaps: any;
  onClose: () => void;
}) {
  const weights = activeScore.weights_used;
  const crmScore = activeScore.health_score;
  const findingsScore = activeScore.skill_score;
  const conversationScore = activeScore.conversation_modifier !== 0
    ? Math.max(0, Math.min(100, 50 + activeScore.conversation_modifier * 2.5))
    : null;

  const contributions = [
    {
      label: 'CRM Data',
      score: crmScore,
      weight: weights.crm,
      color: colors.accent,
    },
    {
      label: 'AI Findings',
      score: findingsScore,
      weight: weights.findings,
      color: '#6488ea',
    },
    {
      label: 'Conversations',
      score: conversationScore,
      weight: weights.conversations,
      color: colors.green,
    },
  ];

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 99,
        }}
      />
      {/* Panel */}
      <div style={{
        position: 'absolute', top: 60, right: 0, zIndex: 100,
        background: colors.surface, border: `1px solid ${colors.border}`,
        borderRadius: 10, padding: 20, width: 300, fontSize: 13,
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 12 }}>
          Score Breakdown
        </div>
        <div style={{ height: 1, background: colors.border, marginBottom: 12 }} />

        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
            Composite Score
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, fontFamily: fonts.mono, color: gradeColor(activeScore.grade) }}>
            {activeScore.score}
          </div>
          <div style={{ fontSize: 12, color: gradeColor(activeScore.grade), fontWeight: 600 }}>
            {activeScore.grade}
          </div>
        </div>

        <div style={{ height: 1, background: colors.border, marginBottom: 12 }} />

        <div style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
          Score Contributions
        </div>

        {contributions.map((c, idx) => {
          const isActive = c.weight > 0;
          const contribution = isActive && c.score !== null ? c.score * c.weight : 0;

          return (
            <div key={idx} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: isActive ? colors.text : colors.textMuted,
                }}>
                  {c.label}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {!isActive && (
                    <span style={{ fontSize: 10, color: colors.textMuted, fontStyle: 'italic' }}>
                      No data yet
                    </span>
                  )}
                  <span style={{
                    fontSize: 11,
                    fontFamily: fonts.mono,
                    color: isActive ? colors.text : colors.textMuted,
                  }}>
                    {Math.round(c.weight * 100)}%
                  </span>
                </div>
              </div>
              <div style={{
                height: 6,
                background: colors.surfaceRaised,
                borderRadius: 3,
                overflow: 'hidden',
              }}>
                {isActive && c.score !== null && (
                  <div style={{
                    height: '100%',
                    width: `${(contribution / activeScore.score) * 100}%`,
                    background: c.color,
                    transition: 'width 0.3s ease',
                  }} />
                )}
              </div>
              {isActive && c.score !== null && (
                <div style={{
                  fontSize: 10,
                  color: colors.textMuted,
                  marginTop: 2,
                }}>
                  {c.score.toFixed(0)} × {Math.round(c.weight * 100)}% = {contribution.toFixed(1)}
                </div>
              )}
              {/* Warning for account conversations not linked to deal */}
              {c.label === 'Conversations' && activeScore.degradation_state === 'no_conversations' && coverageGaps?.days_since_last_call != null && (
                <div style={{
                  fontSize: 10,
                  marginTop: 6,
                  padding: '6px 8px',
                  background: `${colors.yellow}15`,
                  borderRadius: 4,
                  border: `1px solid ${colors.yellow}30`,
                  color: colors.text,
                }}>
                  <div style={{ marginBottom: 4 }}>Recent account calls not linked to this deal — score may be understated.</div>
                  <a href="/conversations" style={{ color: colors.accent, textDecoration: 'none', fontSize: 10 }}>
                    View in Conversations →
                  </a>
                </div>
              )}
            </div>
          );
        })}

        {activeScore.degradation_state !== 'full' && (
          <div style={{
            fontSize: 10,
            color: colors.textMuted,
            marginTop: 12,
            padding: '8px 10px',
            background: colors.surfaceRaised,
            borderRadius: 6,
          }}>
            Weights automatically redistributed based on available data
          </div>
        )}
      </div>
    </>
  );
}

function Card({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 10,
      padding: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>{title}</h3>
        {count !== undefined && (
          <span style={{ fontSize: 10, fontFamily: fonts.mono, color: colors.textMuted }}>{count}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: `1px solid ${colors.border}` }}>
      <span style={{ fontSize: 12, color: colors.textMuted }}>{label}</span>
      <span style={{ fontSize: 12, color: colors.text, textTransform: 'capitalize' }}>{value}</span>
    </div>
  );
}

function EmptyText({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 12, color: colors.textMuted, padding: '8px 0' }}>{children}</p>;
}

function statusColor(status?: string): string {
  if (!status) return colors.textMuted;
  switch (status.toLowerCase()) {
    case 'active': case 'fast': case 'multi': return colors.green;
    case 'cooling': case 'normal': case 'dual': return colors.yellow;
    case 'stale': case 'slow': case 'single': return colors.red;
    default: return colors.textMuted;
  }
}

function activityIcon(type?: string): string {
  switch (type?.toLowerCase()) {
    case 'email': return '\u2709';
    case 'call': return '\u260E';
    case 'meeting': return '\u{1F4C5}';
    case 'task': return '\u2713';
    default: return '\u2022';
  }
}
