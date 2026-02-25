import React, { useEffect, useState, useRef, useCallback } from 'react';
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

const SEVERITY_LABELS: Record<string, string> = {
  act: 'Critical', watch: 'Warning', notable: 'Notable', info: 'Info',
};

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

// Simple markdown renderer for basic formatting
function renderMarkdown(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;

  // Handle bold (**text**)
  const boldRegex = /\*\*(.+?)\*\*/g;
  let match: RegExpExecArray | null;

  while ((match = boldRegex.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }
    // Add the bolded text
    parts.push(
      <strong key={match.index} style={{ fontWeight: 600 }}>
        {match[1]}
      </strong>
    );
    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after the last match
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return <>{parts}</>;
}


interface ActiveScore {
  score: number;
  grade: string;
  source: 'skill' | 'health';
  skill_score: number;
  health_score: number | null;
  divergence: number;
  divergence_flag: boolean;
  conversation_modifier: number;
  conversation_signals: Array<{
    keyword: string;
    call_title: string;
    call_date: string;
    points: number;
  }>;
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
  const [askQuestion, setAskQuestion] = useState('');
  const [askHistory, setAskHistory] = useState<Array<{ role: 'user' | 'assistant'; content: string; metadata?: any }>>([]);
  const [askLoading, setAskLoading] = useState(false);
  const [askError, setAskError] = useState('');
  const { crmInfo } = useCrmInfo();
  const { user, currentWorkspace } = useWorkspace();
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [showScoreBreakdown, setShowScoreBreakdown] = useState(false);
  const [scoreHistory, setScoreHistory] = useState<any[]>([]);
  const [pipelines, setPipelines] = useState<string[]>([]);
  const [pipelineEditing, setPipelineEditing] = useState(false);
  const [pipelineSaving, setPipelineSaving] = useState(false);
  const [coverageGapsExpanded, setCoverageGapsExpanded] = useState(true);
  const [expandedSummaries, setExpandedSummaries] = useState<Set<string>>(new Set());
  const pipelineDropdownRef = useRef<HTMLDivElement>(null);

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
      if (withNarrative) {
        setNarrativeLoading(false);
      } else {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchDossier();
    fetchAskHistory();
    if (dealId) {
      api.get(`/deals/${dealId}/score-history`).then((res: any) => {
        setScoreHistory(res.snapshots || []);
      }).catch(() => {});
    }
    api.get('/deals/pipelines').then((res: any) => {
      setPipelines(res.data || []);
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

  const fetchAskHistory = useCallback(async () => {
    if (!dealId || !currentWorkspace) return;
    try {
      const result = await api.get(`/analyze/history/deal/${dealId}`);
      setAskHistory(result.messages || []);
    } catch (err: any) {
      console.warn('Failed to load Q&A history:', err);
      setAskHistory([]);
    }
  }, [dealId, currentWorkspace]);

  const handleAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!askQuestion.trim() || askLoading || !dealId) return;

    const userQuestion = askQuestion.trim();
    setAskQuestion(''); // Clear input immediately
    setAskLoading(true);
    setAskError('');

    // Optimistically add user message to history
    setAskHistory(prev => [...prev, { role: 'user', content: userQuestion }]);

    try {
      const result = await api.post('/analyze', {
        question: userQuestion,
        scope: { type: 'deal', entity_id: dealId },
      });

      // Add assistant response to history
      setAskHistory(prev => [...prev, {
        role: 'assistant',
        content: result.answer,
        follow_up_questions: result.follow_up_questions || [],
        metadata: {
          confidence: result.confidence,
          data_consulted: result.data_consulted,
          tokens_used: result.tokens_used,
          latency_ms: result.latency_ms,
        }
      }]);
    } catch (err: any) {
      // Remove optimistic user message on error
      setAskHistory(prev => prev.slice(0, -1));

      if (err.message?.includes('429') || err.message?.includes('rate limit')) {
        setAskError('Analysis limit reached. Try again in a few minutes.');
      } else {
        setAskError(err.message || 'Failed to get answer');
      }
    } finally {
      setAskLoading(false);
    }
  };

  const handleFollowUpClick = async (question: string) => {
    if (askLoading || !dealId) return;

    setAskQuestion(question);
    setAskLoading(true);
    setAskError('');

    // Add user message to history
    setAskHistory(prev => [...prev, { role: 'user', content: question }]);

    try {
      const result = await api.post('/analyze', {
        question: question,
        scope: { type: 'deal', entity_id: dealId },
      });

      // Add assistant response to history
      setAskHistory(prev => [...prev, {
        role: 'assistant',
        content: result.answer,
        follow_up_questions: result.follow_up_questions || [],
        metadata: {
          confidence: result.confidence,
          data_consulted: result.data_consulted,
          tokens_used: result.tokens_used,
          latency_ms: result.latency_ms,
        }
      }]);
    } catch (err: any) {
      // Remove optimistic user message on error
      setAskHistory(prev => prev.slice(0, -1));

      if (err.message?.includes('429') || err.message?.includes('rate limit')) {
        setAskError('Analysis limit reached. Try again in a few minutes.');
      } else {
        setAskError(err.message || 'Failed to get answer');
      }
    } finally {
      setAskLoading(false);
      setAskQuestion(''); // Clear input after submission
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Skeleton height={80} />
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr', gap: 16 }}>
          <Skeleton height={300} />
          <Skeleton height={300} />
        </div>
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
      label: 'Velocity',
      value: health.velocity_suspect ? 'Check velocity' : signalLabel('stage_velocity', health.stage_velocity),
      color: health.velocity_suspect ? colors.yellow : statusColor(health.stage_velocity),
      tooltip: health.velocity_suspect ? 'Recent call activity suggests this deal may be moving — stage data may be stale.' : undefined
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
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

      {/* Deal Header */}
      <SectionErrorBoundary fallbackMessage="Unable to load deal header.">
      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: 20,
      }}>
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: isMobile ? 'stretch' : 'flex-start', gap: isMobile ? 12 : 0 }}>
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
              {(activeScore || (riskScore && riskScore.grade)) && (() => {
                const displayGrade = activeScore ? activeScore.grade : riskScore.grade;
                const displayScore = activeScore ? activeScore.score : riskScore.score;
                const isProvisional = activeScore && (activeScore as any).degradation_state === 'crm_only';
                return (
                  <div style={{ position: 'relative' }}>
                    <div
                      onClick={() => setShowScoreBreakdown(v => !v)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '2px 8px', borderRadius: 4,
                        background: gradeBg(displayGrade),
                        border: `1px solid ${gradeColor(displayGrade)}30`,
                        cursor: 'pointer',
                        userSelect: 'none',
                      }}
                      title="Click to see score breakdown"
                    >
                      <span style={{
                        fontSize: 11, fontWeight: 700,
                        color: gradeColor(displayGrade),
                        fontFamily: fonts.mono,
                      }}>
                        {displayGrade}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 600, fontFamily: fonts.mono, color: colors.text }}>
                        {displayScore}
                      </span>
                      {isProvisional && (
                        <span
                          title="Score based on CRM data only"
                          style={{
                            fontSize: 8,
                            fontWeight: 600,
                            color: colors.accent,
                            background: `${colors.accent}15`,
                            padding: '1px 3px',
                            borderRadius: 2,
                            textTransform: 'uppercase',
                          }}
                        >
                          P
                        </span>
                      )}
                    </div>
                    {showScoreBreakdown && riskScore && activeScore && (
                      <ScoreBreakdownPanel
                        riskScore={riskScore}
                        mechanicalScore={mechanicalScore}
                        activeScore={activeScore}
                        coverageGaps={coverageGapsData}
                        onClose={() => setShowScoreBreakdown(false)}
                      />
                    )}
                  </div>
                );
              })()}
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
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button
              onClick={() => setAnalysisOpen(true)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: 11, fontWeight: 500, padding: '6px 12px',
                borderRadius: 6, border: `1px solid ${colors.accent}30`,
                background: colors.accentSoft, color: colors.accent,
                cursor: 'pointer', transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = `${colors.accent}25`; }}
              onMouseLeave={e => { e.currentTarget.style.background = colors.accentSoft; }}
            >
              Ask about this deal
            </button>

            {(() => {
              const crmUrl = buildDealCrmUrl(crmInfo.crm, crmInfo.portalId ?? null, crmInfo.instanceUrl ?? null, deal.source_id, deal.source);
              if (!crmUrl) return null;
              const label = crmInfo.crm === 'hubspot' ? 'Open in HubSpot' : 'Open in Salesforce';
              return (
                <a
                  href={crmUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    fontSize: 11, fontWeight: 500, padding: '6px 12px',
                    borderRadius: 6, textDecoration: 'none',
                    background: colors.accentSoft, color: colors.accent,
                    border: `1px solid ${colors.accent}30`,
                    transition: 'all 0.15s',
                  }}
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

        {/* Deal Signals */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: isMobile ? 10 : 16, marginTop: 16 }}>
          {healthItems.map((h, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }} title={h.tooltip}>
              <span style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: h.color,
                boxShadow: `0 0 6px ${h.color}40`,
              }} />
              <span style={{ fontSize: 11, color: colors.textMuted }}>{h.label}:</span>
              <span style={{ fontSize: 11, fontWeight: 500, color: colors.textSecondary, textTransform: 'capitalize' }}>
                {h.value || 'N/A'}
              </span>
            </div>
          ))}
        </div>
      </div>
      </SectionErrorBoundary>

      {/* AI Narrative */}
      <SectionErrorBoundary fallbackMessage="Unable to load AI narrative.">
      {dealId && (
        <DossierNarrative
          narrative={narrative}
          recommended_actions={recommended_actions}
          loading={narrativeLoading}
          onGenerate={() => fetchDossier(true)}
        />
      )}
      </SectionErrorBoundary>

      {/* Coverage Gaps */}
      <SectionErrorBoundary fallbackMessage="Unable to load coverage gaps.">
      {hasCoverageGaps && (
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderLeft: `3px solid ${colors.yellow}`,
          borderRadius: 10,
          padding: 16,
        }}>
          <div
            onClick={() => setCoverageGapsExpanded(!coverageGapsExpanded)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              marginBottom: coverageGapsExpanded ? 12 : 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, color: colors.text, margin: 0 }}>
                ⚠ Coverage Gaps
              </h3>
              <span style={{ fontSize: 11, color: colors.textMuted }}>
                {[
                  coverageGapsData.total_contacts === 0 ? 'no contacts' : null,
                  coverageGapsData.days_since_last_call != null && coverageGapsData.days_since_last_call > (coverageGapsData.days_threshold || 10) ? `${coverageGapsData.days_since_last_call}d since call` : null,
                  keyContactsNeverCalled.length > 0 ? `${keyContactsNeverCalled.length} key contact${keyContactsNeverCalled.length > 1 ? 's' : ''}` : null,
                  coverageGapsData.unlinked_calls > 0 ? `${coverageGapsData.unlinked_calls} unlinked` : null,
                ].filter(Boolean).join(' · ')}
              </span>
            </div>
            <span style={{ fontSize: 12, color: colors.textMuted }}>
              {coverageGapsExpanded ? '▼' : '▶'}
            </span>
          </div>

          {coverageGapsExpanded && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {coverageGapsData.total_contacts === 0 && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ color: colors.yellow, fontSize: 14, marginTop: 1, flexShrink: 0 }}>&#9888;</span>
                  <p style={{ fontSize: 13, color: colors.text, lineHeight: 1.4 }}>No contacts linked to this deal</p>
                </div>
              )}

              {coverageGapsData.days_since_last_call != null && coverageGapsData.days_since_last_call > (coverageGapsData.days_threshold || 10) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ color: colors.yellow, fontSize: 14, flexShrink: 0 }}>&#9888;</span>
                  <span style={{ fontSize: 13, color: colors.text }}>Days Since Last Call</span>
                  <span style={{
                    fontSize: 18, fontWeight: 700, fontFamily: fonts.mono,
                    color: coverageGapsData.days_since_last_call > (coverageGapsData.days_threshold || 10) ? colors.red : colors.yellow,
                  }}>
                    {coverageGapsData.days_since_last_call}
                  </span>
                  <span style={{ fontSize: 11, color: colors.textMuted }}>
                    (threshold: {coverageGapsData.days_threshold || 10}d)
                  </span>
                </div>
              )}

              {keyContactsNeverCalled.length > 0 && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                    <span style={{ color: colors.yellow, fontSize: 14, marginTop: 1, flexShrink: 0 }}>&#9888;</span>
                    <span style={{ fontSize: 13, fontWeight: 500, color: colors.text }}>
                      Key Contacts Never Engaged
                    </span>
                  </div>
                  <div style={{ paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {keyContactsNeverCalled.slice(0, 5).map((c: any, i: number) => (
                      <div key={i} style={{ fontSize: 12, color: colors.textSecondary }}>
                        {c.name ? anon.person(c.name) : c.email ? anon.email(c.email) : 'Unknown'}
                        {c.title && <span style={{ color: colors.textMuted }}> — {c.title}</span>}
                        {c.buying_role && <span style={{ color: colors.accent, marginLeft: 4 }}>({c.buying_role.replace(/_/g, ' ')})</span>}
                      </div>
                    ))}
                    {keyContactsNeverCalled.length > 5 && (
                      <div style={{ fontSize: 11, color: colors.textMuted, fontStyle: 'italic' }}>
                        and {keyContactsNeverCalled.length - 5} other{keyContactsNeverCalled.length - 5 > 1 ? 's' : ''}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {coverageGapsData.unlinked_calls > 0 && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ color: colors.yellow, fontSize: 14, marginTop: 1, flexShrink: 0 }}>&#9888;</span>
                  <p style={{ fontSize: 13, color: colors.text, lineHeight: 1.4 }}>
                    {coverageGapsData.unlinked_calls} call{coverageGapsData.unlinked_calls > 1 ? 's' : ''} match this account's domain but aren't linked to this deal
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      </SectionErrorBoundary>

      {/* Two Column Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.8fr 1fr', gap: 16, alignItems: 'start' }}>
        {/* Left Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Findings */}
          {findingsList.length > 0 && (
          <SectionErrorBoundary fallbackMessage="Something went wrong loading findings.">
          <Card title="Findings" count={findingsList.length}>
            {findingsList.map((f: any, i: number) => {
                const isProcessing = dismissingId === f.id || snoozingId === f.id;
                return (
                  <div key={f.id || i} style={{
                    display: 'flex', gap: 8, padding: '8px 0',
                    borderBottom: `1px solid ${colors.border}`,
                    opacity: isProcessing ? 0.4 : 1,
                    transition: 'opacity 0.3s',
                  }}>
                    <span style={{
                      width: 7, height: 7, borderRadius: '50%',
                      background: severityColor(f.severity), marginTop: 5, flexShrink: 0,
                      boxShadow: `0 0 6px ${severityColor(f.severity)}40`,
                    }} />
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: 13, color: colors.text }}>{anon.text(f.message)}</p>
                      <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'center' }}>
                        <span style={{
                          fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 3,
                          background: `${severityColor(f.severity)}15`,
                          color: severityColor(f.severity),
                          textTransform: 'capitalize',
                        }}>
                          {SEVERITY_LABELS[f.severity] || f.severity}
                        </span>
                        <span style={{ fontSize: 11, color: colors.textMuted }}>
                          {f.skill_id} · {formatTimeAgo(f.found_at)}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4, alignSelf: 'center', flexShrink: 0, position: 'relative' }}>
                      <button
                        onClick={() => setSnoozeDropdownId(snoozeDropdownId === f.id ? null : f.id)}
                        disabled={isProcessing}
                        style={{
                          fontSize: 11, fontWeight: 500, padding: '4px 10px',
                          borderRadius: 4, border: `1px solid ${colors.border}`,
                          background: 'transparent', color: colors.textMuted,
                          cursor: isProcessing ? 'not-allowed' : 'pointer',
                          transition: 'all 0.15s',
                        }}
                        onMouseEnter={e => { if (!isProcessing) { e.currentTarget.style.borderColor = colors.yellow; e.currentTarget.style.color = colors.yellow; } }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = colors.border; e.currentTarget.style.color = colors.textMuted; }}
                      >
                        Snooze
                      </button>
                      {snoozeDropdownId === f.id && (
                        <div style={{
                          position: 'absolute', top: '100%', right: 0, marginTop: 4,
                          background: colors.surfaceRaised, border: `1px solid ${colors.border}`,
                          borderRadius: 6, padding: 4, zIndex: 100,
                          display: 'flex', flexDirection: 'column', gap: 2,
                          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                          minWidth: 80,
                        }}>
                          {SNOOZE_OPTIONS.map(opt => (
                            <button
                              key={opt.days}
                              onClick={() => snoozeFinding(f.id, opt.days)}
                              style={{
                                fontSize: 11, padding: '4px 8px', borderRadius: 4,
                                background: 'transparent', border: 'none',
                                color: colors.textSecondary, cursor: 'pointer',
                                textAlign: 'left', transition: 'all 0.1s',
                              }}
                              onMouseEnter={e => { e.currentTarget.style.background = colors.surfaceHover; e.currentTarget.style.color = colors.yellow; }}
                              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = colors.textSecondary; }}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      )}
                      <button
                        onClick={() => dismissFinding(f.id)}
                        disabled={isProcessing}
                        style={{
                          fontSize: 11, fontWeight: 500, padding: '4px 10px',
                          borderRadius: 4, border: `1px solid ${colors.border}`,
                          background: 'transparent', color: colors.textMuted,
                          cursor: isProcessing ? 'not-allowed' : 'pointer',
                          transition: 'all 0.15s',
                        }}
                        onMouseEnter={e => { if (!isProcessing) { e.currentTarget.style.borderColor = colors.red; e.currentTarget.style.color = colors.red; } }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = colors.border; e.currentTarget.style.color = colors.textMuted; }}
                      >
                        {dismissingId === f.id ? '...' : 'Dismiss'}
                      </button>
                    </div>
                  </div>
                );
              })
            }
          </Card>
          </SectionErrorBoundary>
          )}

          {/* Stage History */}
          <SectionErrorBoundary fallbackMessage="Unable to load stage history.">
          <Card title="Stage History">
            {stageHistory.length === 0 ? (
              <EmptyText>Stage history not available</EmptyText>
            ) : (
              <div style={{ paddingLeft: 12 }}>
                {stageHistory.map((s: any, i: number) => (
                  <div key={i} style={{
                    display: 'flex', gap: 12, paddingBottom: 12, position: 'relative',
                    borderLeft: i < stageHistory.length - 1 ? `2px solid ${colors.border}` : `2px solid ${colors.accent}`,
                    paddingLeft: 16,
                  }}>
                    <div style={{
                      position: 'absolute', left: -5, top: 0,
                      width: 8, height: 8, borderRadius: '50%',
                      background: i === stageHistory.length - 1 ? colors.accent : colors.border,
                    }} />
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 500, color: colors.text, textTransform: 'capitalize' }}>
                        {s.stage_label || s.stage_normalized?.replace(/_/g, ' ') || s.stage?.replace(/_/g, ' ') || 'Unknown'}
                      </span>
                      <div style={{ fontSize: 11, color: colors.textMuted }}>
                        {s.entered_at ? formatDate(s.entered_at) : ''} {s.days_in_stage ? `· ${Math.round(s.days_in_stage)}d` : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
          </SectionErrorBoundary>

          {/* Activity Timeline */}
          <SectionErrorBoundary fallbackMessage="Unable to load recent activity.">
          <Card title="Timeline" count={timeline.length}>
            {timeline.length === 0 ? (
              <EmptyText>No activity or conversation records</EmptyText>
            ) : (
              timeline.slice(0, 30).map((item: any) => {
                const badge = sourceBadge(item.source);
                const isExpanded = expandedSummaries.has(item.id);

                return (
                  <div key={item.id} style={{ padding: '8px 0', borderBottom: `1px solid ${colors.border}` }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      {item.type === 'activity' && (
                        <span style={{ fontSize: 12, width: 20, textAlign: 'center', flexShrink: 0, marginTop: 2 }}>
                          {item.icon}
                        </span>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <p style={{
                            fontSize: item.type === 'conversation' ? 13 : 12,
                            fontWeight: item.type === 'conversation' ? 500 : 400,
                            color: colors.text,
                            margin: 0,
                            flex: 1,
                            minWidth: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}>
                            {anon.text(item.label)}
                          </p>
                          <span style={{
                            fontSize: 9,
                            fontWeight: 600,
                            padding: '1px 6px',
                            borderRadius: 4,
                            background: badge.bg,
                            color: badge.color,
                            flexShrink: 0,
                          }}>
                            {badge.label}
                          </span>
                          {item.type === 'conversation' && (() => {
                            const conversationUrl = buildConversationUrl(
                              item.source,
                              item.source_id,
                              item.source_data,
                              item.custom_fields
                            );
                            return conversationUrl ? (
                              <a
                                href={conversationUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={`Open in ${item.source}`}
                                style={{ color: colors.accent, lineHeight: 0, flexShrink: 0 }}
                              >
                                <ExternalLink size={14} />
                              </a>
                            ) : null;
                          })()}
                        </div>
                        <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                          {item.date ? formatTimeAgo(item.date) : ''}
                          {item.meta && ` · ${anon.text(item.meta)}`}
                        </div>
                        {item.summary && (
                          <div style={{ marginTop: 4 }}>
                            <button
                              onClick={() => {
                                const newExpanded = new Set(expandedSummaries);
                                if (isExpanded) {
                                  newExpanded.delete(item.id);
                                } else {
                                  newExpanded.add(item.id);
                                }
                                setExpandedSummaries(newExpanded);
                              }}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: colors.accent,
                                fontSize: 11,
                                cursor: 'pointer',
                                padding: 0,
                                textDecoration: 'underline',
                              }}
                            >
                              {isExpanded ? 'Hide summary' : 'Show summary'}
                            </button>
                            {isExpanded && (
                              <p style={{ fontSize: 12, color: colors.textSecondary, marginTop: 4, lineHeight: 1.4 }}>
                                {anon.text(item.summary)}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </Card>
          </SectionErrorBoundary>
        </div>

        {/* Right Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Contacts */}
          <SectionErrorBoundary fallbackMessage="Unable to load deal contacts.">
          <Card title="Contacts" count={contactsList.length}>
            {contactsList.length === 0 ? (
              <EmptyText>No contacts linked — this deal is single-threaded</EmptyText>
            ) : (
              contactsList.map((c: any, i: number) => {
                const eng = engagementDot(c.engagement_level);
                // Add visual separator between engaged and unengaged contacts
                const prevContact = i > 0 ? contactsList[i - 1] : null;
                const showUnengagedSeparator = prevContact && prevContact.engagement_level !== 'unengaged' && c.engagement_level === 'unengaged';
                return (
                  <React.Fragment key={i}>
                    {showUnengagedSeparator && (
                      <div style={{
                        borderTop: `1px solid ${colors.border}`,
                        padding: '8px 0',
                        fontSize: 10,
                        color: colors.textMuted,
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                        fontWeight: 600,
                      }}>
                        Not yet engaged
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: `1px solid ${colors.border}` }}>
                    <div style={{
                      width: 26, height: 26, borderRadius: '50%',
                      background: colors.surfaceHover,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, fontWeight: 600, color: colors.textSecondary, flexShrink: 0,
                    }}>
                      {(c.name ? anon.person(c.name) : c.email ? anon.email(c.email) : '?').charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 12, fontWeight: 500, color: colors.text }}>
                        {c.name ? anon.person(c.name) : c.email ? anon.email(c.email) : 'Unknown'}
                      </span>
                      {c.title && <span style={{ fontSize: 11, color: colors.textMuted, display: 'block' }}>{c.title}</span>}
                      {c.last_activity_date && (
                        <span style={{ fontSize: 10, color: colors.textDim, display: 'block' }}>
                          Last active {formatTimeAgo(c.last_activity_date)}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{
                          width: 6, height: 6, borderRadius: '50%',
                          background: eng.color,
                          boxShadow: `0 0 4px ${eng.color}40`,
                        }} />
                        <span style={{ fontSize: 10, color: eng.color }}>{eng.label}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {c.role && (
                          <span
                            title={c.role_confidence ? `Confidence: ${c.role_confidence}` : undefined}
                            style={{
                              fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                              background: colors.accentSoft, color: colors.accent, textTransform: 'capitalize',
                            }}
                          >
                            {c.role}
                          </span>
                        )}
                        {c.buying_role && c.buying_role !== c.role && (
                          <span style={{
                            fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 4,
                            background: `${colors.purple}15`, color: colors.purple, textTransform: 'capitalize',
                          }}>
                            {c.buying_role}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  </React.Fragment>
                );
              })
            )}
          </Card>
          </SectionErrorBoundary>

          {/* Deal Details */}
          <Card title="Deal Details">
            <DetailRow label="Source" value={deal.source} />
            {canEditPipeline ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${colors.border}` }}>
                <span style={{ fontSize: 12, color: colors.textMuted, minWidth: 110 }}>Pipeline</span>
                <div ref={pipelineDropdownRef} style={{ position: 'relative' }}>
                  {pipelineEditing ? (
                    <div style={{
                      position: 'absolute', right: 0, top: -4, zIndex: 20,
                      background: colors.surface, border: `1px solid ${colors.border}`,
                      borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
                      minWidth: 200, maxHeight: 240, overflowY: 'auto',
                    }}>
                      {pipelines.map(p => (
                        <button
                          key={p}
                          onClick={() => handlePipelineChange(p)}
                          disabled={pipelineSaving}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            width: '100%', padding: '8px 12px', border: 'none',
                            background: p === deal.pipeline ? `${colors.accent}15` : 'transparent',
                            color: colors.text, fontSize: 13, cursor: 'pointer',
                            textAlign: 'left',
                          }}
                          onMouseEnter={e => { (e.target as HTMLElement).style.background = `${colors.accent}15`; }}
                          onMouseLeave={e => { (e.target as HTMLElement).style.background = p === deal.pipeline ? `${colors.accent}15` : 'transparent'; }}
                        >
                          {p === deal.pipeline && <Check size={14} color={colors.accent} />}
                          <span style={{ marginLeft: p === deal.pipeline ? 0 : 22 }}>{p}</span>
                        </button>
                      ))}
                      <div style={{ borderTop: pipelines.length > 0 ? `1px solid ${colors.border}` : 'none', padding: '6px 8px' }}>
                        <form onSubmit={e => {
                          e.preventDefault();
                          const input = (e.target as HTMLFormElement).elements.namedItem('customPipeline') as HTMLInputElement;
                          const val = input?.value?.trim();
                          if (val) handlePipelineChange(val);
                        }}>
                          <input
                            name="customPipeline"
                            placeholder="Type custom pipeline..."
                            autoFocus={pipelines.length === 0}
                            disabled={pipelineSaving}
                            style={{
                              width: '100%', padding: '6px 8px', fontSize: 12,
                              background: colors.background, border: `1px solid ${colors.border}`,
                              borderRadius: 4, color: colors.text, outline: 'none',
                              boxSizing: 'border-box',
                            }}
                            onFocus={e => { e.target.style.borderColor = colors.accent; }}
                            onBlur={e => { e.target.style.borderColor = colors.border; }}
                          />
                        </form>
                      </div>
                    </div>
                  ) : null}
                  <button
                    onClick={() => setPipelineEditing(!pipelineEditing)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      background: 'transparent', border: `1px solid ${colors.border}`,
                      borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
                      color: colors.text, fontSize: 13,
                    }}
                  >
                    {pipelineSaving ? 'Saving...' : (deal.pipeline_name || deal.pipeline || '—')}
                    <ChevronDown size={14} color={colors.textMuted} />
                  </button>
                </div>
              </div>
            ) : (
              <DetailRow label="Pipeline" value={deal.pipeline_name || deal.pipeline} />
            )}
            <DetailRow label="Probability" value={deal.probability ? `${deal.probability}%` : undefined} />
            <DetailRow label="Forecast" value={deal.forecast_category} />
            <DetailRow label="Created" value={deal.created_at ? formatDate(deal.created_at) : undefined} />
            <DetailRow label="Close Date" value={deal.close_date ? formatDate(deal.close_date) : undefined} />
            <DetailRow label="Last Modified" value={deal.updated_at ? formatDate(deal.updated_at) : undefined} />
          </Card>

          {/* Ask Pandora */}
          {dealId && (
            <div style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 10,
              padding: 20,
            }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 12 }}>
                Ask Pandora
              </h3>
              <form onSubmit={handleAsk} style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  value={askQuestion}
                  onChange={e => setAskQuestion(e.target.value)}
                  placeholder="Ask about this deal... e.g. 'What are the biggest risks?'"
                  disabled={askLoading}
                  style={{
                    flex: 1, fontSize: 13, padding: '8px 12px',
                    background: colors.surfaceRaised,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 6, color: colors.text, outline: 'none',
                  }}
                />
                <button
                  type="submit"
                  disabled={askLoading || !askQuestion.trim()}
                  style={{
                    fontSize: 12, fontWeight: 500, padding: '8px 16px',
                    background: askLoading || !askQuestion.trim() ? colors.surfaceRaised : colors.accentSoft,
                    color: askLoading || !askQuestion.trim() ? colors.textMuted : colors.accent,
                    border: 'none', borderRadius: 6,
                    cursor: askLoading || !askQuestion.trim() ? 'not-allowed' : 'pointer',
                  }}
                >
                  {askLoading ? 'Analyzing...' : 'Ask'}
                </button>
              </form>

              {askError && (
                <div style={{
                  marginTop: 12, padding: 12, background: colors.redSoft,
                  border: `1px solid ${colors.red}33`, borderRadius: 6,
                  color: colors.red, fontSize: 12,
                }}>
                  {askError}
                </div>
              )}

              {/* Conversation History */}
              {askHistory.length > 0 && (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 500, overflowY: 'auto' }}>
                  {askHistory.map((msg, i) => (
                    <div
                      key={i}
                      style={{
                        padding: 12,
                        background: msg.role === 'user' ? colors.accentSoft : colors.surfaceRaised,
                        border: `1px solid ${msg.role === 'user' ? `${colors.accent}30` : colors.borderLight}`,
                        borderRadius: 6,
                        borderLeft: `3px solid ${msg.role === 'user' ? colors.accent : colors.textMuted}`,
                      }}
                    >
                      <div style={{ fontSize: 10, fontWeight: 600, color: colors.textMuted, marginBottom: 6, textTransform: 'uppercase' }}>
                        {msg.role === 'user' ? 'You' : 'Pandora'}
                      </div>
                      <div style={{ fontSize: 13, lineHeight: 1.6, color: colors.text, whiteSpace: 'pre-wrap' }}>
                        {renderMarkdown(anon.text(msg.content))}
                      </div>
                      {msg.metadata && msg.role === 'assistant' && (
                        <div style={{ display: 'flex', gap: 12, fontSize: 10, color: colors.textMuted, fontFamily: fonts.mono, marginTop: 8 }}>
                          {msg.metadata.data_consulted && (
                            <span>Data: {Object.values(msg.metadata.data_consulted).filter((v: any) => typeof v === 'number' && v > 0).length} sources</span>
                          )}
                          {msg.metadata.tokens_used && <span>{msg.metadata.tokens_used} tokens</span>}
                          {msg.metadata.latency_ms && <span>{(msg.metadata.latency_ms / 1000).toFixed(1)}s</span>}
                        </div>
                      )}
                      {msg.follow_up_questions && msg.follow_up_questions.length > 0 && msg.role === 'assistant' && (
                        <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${colors.borderLight}` }}>
                          <div style={{ fontSize: 10, fontWeight: 600, color: colors.textMuted, marginBottom: 8, textTransform: 'uppercase' }}>
                            Follow-up Questions
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {msg.follow_up_questions.slice(0, 3).map((question: string, qIdx: number) => (
                              <button
                                key={qIdx}
                                onClick={() => handleFollowUpClick(question)}
                                disabled={askLoading}
                                style={{
                                  fontSize: 12,
                                  padding: '8px 12px',
                                  background: askLoading ? colors.surfaceRaised : colors.accentSoft,
                                  color: askLoading ? colors.textMuted : colors.accent,
                                  border: `1px solid ${askLoading ? colors.borderLight : `${colors.accent}30`}`,
                                  borderRadius: 6,
                                  cursor: askLoading ? 'not-allowed' : 'pointer',
                                  textAlign: 'left',
                                  transition: 'all 0.2s',
                                }}
                                onMouseEnter={(e) => {
                                  if (!askLoading) {
                                    e.currentTarget.style.background = colors.accent;
                                    e.currentTarget.style.color = 'white';
                                  }
                                }}
                                onMouseLeave={(e) => {
                                  if (!askLoading) {
                                    e.currentTarget.style.background = colors.accentSoft;
                                    e.currentTarget.style.color = colors.accent;
                                  }
                                }}
                              >
                                {question}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Score History */}
      <SectionErrorBoundary fallbackMessage="Unable to load score history.">
      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: 16,
      }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 12 }}>Score History</h3>
        {scoreHistory.length === 0 ? (
          <p style={{ fontSize: 12, color: colors.textMuted, padding: '8px 0' }}>
            No score history yet — history builds weekly.
          </p>
        ) : (
          <div style={{ overflowX: 'auto', maxWidth: '100%', WebkitOverflowScrolling: 'touch' as any }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: isMobile ? 500 : undefined }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                  {['Week', 'Score', 'Grade', 'Change', 'Notes'].map(h => (
                    <th key={h} style={{
                      padding: '6px 10px', textAlign: 'left',
                      fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
                      letterSpacing: '0.05em', color: colors.textMuted,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scoreHistory.slice(0, 8).map((s: any, i: number) => {
                  const delta = s.score_delta;
                  const deltaEl = delta == null ? (
                    <span style={{ color: colors.textMuted }}>—</span>
                  ) : delta > 0 ? (
                    <span style={{ color: colors.green }}>\u2191{delta}</span>
                  ) : delta < 0 ? (
                    <span style={{ color: colors.red }}>\u2193{Math.abs(delta)}</span>
                  ) : (
                    <span style={{ color: colors.textMuted }}>—</span>
                  );

                  const weekLabel = s.snapshot_date
                    ? new Date(s.snapshot_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                    : '—';

                  const commentary = s.commentary
                    ? s.commentary.length > 100
                      ? s.commentary.slice(0, 100) + '...'
                      : s.commentary
                    : '';

                  return (
                    <tr key={i} style={{ borderBottom: `1px solid ${colors.border}` }}>
                      <td style={{ padding: '8px 10px', color: colors.textSecondary, fontFamily: fonts.mono, fontSize: 11 }}>
                        {weekLabel}
                      </td>
                      <td style={{ padding: '8px 10px', color: colors.text, fontFamily: fonts.mono, fontWeight: 600 }}>
                        {s.active_score ?? s.health_score ?? '—'}
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <span style={{
                          fontSize: 11, fontWeight: 700, fontFamily: fonts.mono,
                          padding: '1px 6px', borderRadius: 4,
                          background: `${gradeColor(s.grade || '—')}20`,
                          color: gradeColor(s.grade || '—'),
                        }}>
                          {s.grade || '—'}
                        </span>
                      </td>
                      <td style={{ padding: '8px 10px', fontFamily: fonts.mono, fontWeight: 600 }}>
                        {deltaEl}
                      </td>
                      <td style={{ padding: '8px 10px', color: colors.textMuted, fontStyle: 'italic', maxWidth: isMobile ? '100%' : 320 }}>
                        {commentary}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </SectionErrorBoundary>

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
              {/* Show conversation signals for Conversations contribution */}
              {c.label === 'Conversations' && activeScore.conversation_signals && activeScore.conversation_signals.length > 0 && (
                <div style={{
                  fontSize: 10,
                  marginTop: 6,
                  padding: '6px 8px',
                  background: colors.surfaceRaised,
                  borderRadius: 4,
                  color: activeScore.conversation_modifier < 0 ? colors.red : colors.text,
                }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Adjusted by:</div>
                  {activeScore.conversation_signals.map((signal, sIdx) => (
                    <div key={sIdx} style={{ marginBottom: 2 }}>
                      {signal.keyword} ({signal.points > 0 ? '+' : ''}{signal.points}) · from "{signal.call_title}"
                    </div>
                  ))}
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
