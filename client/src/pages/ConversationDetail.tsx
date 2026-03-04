import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ExternalLink, ChevronLeft, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { formatCurrency, formatDate, formatTimeAgo } from '../lib/format';
import Skeleton from '../components/Skeleton';
import { useWorkspace } from '../context/WorkspaceContext';
import { useDemoMode } from '../contexts/DemoModeContext';

interface ResolvedParticipant {
  name: string;
  email: string | null;
  role: 'internal' | 'external' | 'unknown';
  confidence: number;
  resolution_method: string;
  crm_contact_id?: string;
  crm_user_id?: string;
  talk_pct?: number;
}

interface CallMetrics {
  talk_ratio_rep: number | null;
  talk_ratio_buyer: number | null;
  speaker_count_internal: number;
  speaker_count_external: number;
  question_count: number | null;
  longest_monologue_seconds: number | null;
  source_of_metrics: 'gong_native' | 'fireflies_derived' | 'unavailable';
}

interface HealthFactor {
  label: string;
  delta: number;
  detail: string;
}

interface CrmGap {
  type: 'missing' | 'stale' | 'inconsistent';
  label: string;
  severity: 'high' | 'medium' | 'low';
  detail: string;
}

type CoachingMode = 'active' | 'retrospective' | 'hidden';

interface CoachingSignal {
  type: 'positive' | 'warning' | 'action';
  label: string;
  insight: string;
  action_sentence: string;
  separation_score?: number;
  data?: {
    dimension: string;
    current_value: number;
    won_median: number;
    won_p25: number;
    won_p75: number;
    sample_size: number;
  };
}

interface CoachingJourneyEntry {
  stage: string;
  stage_normalized: string;
  duration_days: number | null;
  signal: 'healthy' | 'watch' | 'at_risk' | 'critical' | 'premature';
  ratio: number | null;
  explanation: string;
  countdown_days: number | null;
  is_current: boolean;
  benchmark: {
    won_median: number | null;
    lost_median: number | null;
    confidence_tier: string;
    is_inverted: boolean;
    won_sample_size: number;
    won_p75?: number | null;
  } | null;
}

interface CoachingData {
  stage_journey: CoachingJourneyEntry[];
  current_velocity: {
    signal: string;
    ratio: number | null;
    explanation: string;
    countdown_days: number | null;
  };
  engagement: {
    last_call_days_ago: number | null;
    contact_count: number;
    signal: 'active' | 'cooling' | 'dark' | 'no_data';
    missing_stakeholders: { name: string; email: string; buying_role: string | null }[];
  };
  composite: {
    label: string;
    color: string;
    summary: string;
    next_step: string;
  };
  action_items: {
    text: string;
    owner: string | null;
    committed_date: string | null;
    status: string | null;
    source_conversation_title: string | null;
    source_date: string | null;
  }[];
}

interface ConversationArcEntry {
  id: string;
  title: string;
  started_at: string;
  duration_seconds: number;
  health_delta: number | null;
  is_current: boolean;
  participant_count_external: number;
  summary_one_liner: string | null;
}

interface ActivitySignalLocal {
  id: string;
  signal_type: string;
  signal_value: string | null;
  framework_field: string | null;
  source_quote: string | null;
  speaker_type: string | null;
  confidence: number;
  verbatim: boolean;
}

interface ConversationDossier {
  conversation: {
    id: string;
    title: string;
    started_at: string;
    duration_seconds: number;
    source: string;
    source_url: string | null;
    summary: string | null;
    action_items: any[];
    keywords: string[];
    resolved_participants: ResolvedParticipant[];
    call_metrics: CallMetrics | null;
  };
  deal_context: {
    deal_id: string;
    deal_name: string;
    amount: number;
    stage: string;
    stage_normalized: string;
    days_in_stage: number;
    stage_benchmark_median: number | null;
    close_date: string;
    original_close_date: string | null;
    close_date_pushes: number;
    forecast_category: string | null;
    owner_name: string;
    owner_email: string;
    health_score: number | null;
    inferred_phase: string | null;
    phase_confidence: number | null;
    phase_divergence: boolean;
    phase_signals: any;
  } | null;
  health_impact: {
    health_before: number | null;
    health_after: number | null;
    health_delta: number | null;
    factors: HealthFactor[];
  } | null;
  crm_follow_through: {
    stage_changed: boolean;
    next_step_updated: boolean;
    close_date_changed: boolean;
    amount_changed: boolean;
    activity_logged: boolean;
    next_meeting_scheduled: boolean | null;
    hours_since_call: number;
    gaps: CrmGap[];
  } | null;
  conversation_arc: ConversationArcEntry[];
  coaching_signals: CoachingSignal[];
  coaching_mode: CoachingMode;
  coaching_metadata: {
    won_count: number;
    lost_count: number;
    pattern_count: number;
  };
  skill_findings: {
    skill_id: string;
    severity: string;
    message: string;
    found_at: string;
  }[];
  contacts_absent: {
    name: string;
    title: string;
    email: string;
    last_conversation_date: string | null;
    buying_role: string | null;
  }[];
}

// ============================================================================
// Helpers
// ============================================================================

const SIGNAL_COLOR_MAP: Record<string, string> = {
  healthy: colors.green,
  watch: colors.yellow,
  at_risk: colors.orange,
  critical: colors.red,
  premature: colors.purple,
};

function formatStageNormalized(sn: string): string {
  if (!sn) return sn;
  return sn.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatDays(days: number | null): string {
  if (days === null) return '—';
  if (days < 1) return '< 1d';
  return `${Math.round(days)}d`;
}

function signalDot(signal: string, size = 8) {
  return (
    <span style={{
      display: 'inline-block',
      width: size,
      height: size,
      borderRadius: '50%',
      background: SIGNAL_COLOR_MAP[signal] ?? colors.textMuted,
      flexShrink: 0,
    }} />
  );
}

function getInitials(name: string): string {
  const parts = name.trim().split(' ').filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getSourceLabel(source: string): string {
  if (source === 'gong') return 'Gong';
  if (source === 'fireflies') return 'Fireflies';
  return source;
}

function buildFallbackNarrative(
  dossier: ConversationDossier,
): string {
  const { conversation, deal_context, coaching_signals } = dossier;
  const durationMin = Math.round(conversation.duration_seconds / 60);
  const source = getSourceLabel(conversation.source);
  const date = formatDate(conversation.started_at);
  const externals = conversation.resolved_participants
    .filter(p => p.role === 'external' && p.confidence >= 0.6)
    .slice(0, 3)
    .map(p => p.name)
    .join(', ');
  const externalText = externals ? ` with ${externals}` : '';

  let parts = [
    `${durationMin}-minute ${source} call on ${date}${externalText}.`,
  ];

  if (deal_context) {
    parts.push(
      `Deal: ${deal_context.deal_name} — ${formatCurrency(deal_context.amount)}, ${deal_context.stage}.`,
    );
  }

  const firstSignal = coaching_signals.find(s => s.action_sentence || s.insight);
  if (firstSignal) {
    parts.push(firstSignal.action_sentence || firstSignal.insight);
  }

  return parts.join(' ');
}

interface ImpactCard {
  severity: 'positive' | 'warning' | 'critical' | 'info';
  label: string;
  description: string;
}

function buildImpactCards(
  dossier: ConversationDossier,
  coachingData: CoachingData | null,
): ImpactCard[] {
  const cards: ImpactCard[] = [];
  const { deal_context, crm_follow_through, skill_findings, conversation, conversation_arc } = dossier;

  // Multi-threading signal
  const thisCallExternals = conversation.resolved_participants.filter(
    p => p.role === 'external' && p.confidence >= 0.6
  ).length;
  const prevCalls = conversation_arc.filter(c => !c.is_current);
  if (prevCalls.length > 0) {
    const avgPrevExternal = prevCalls.reduce((sum, c) => sum + c.participant_count_external, 0) / prevCalls.length;
    if (thisCallExternals > avgPrevExternal + 0.5) {
      cards.push({
        severity: 'positive',
        label: 'MULTI-THREADING IMPROVED',
        description: `${thisCallExternals} external participants on this call, up from an average of ${avgPrevExternal.toFixed(1)}. Broader engagement is a positive signal for deal progression.`,
      });
    } else if (thisCallExternals <= 1 && avgPrevExternal >= 2) {
      cards.push({
        severity: 'warning',
        label: 'SINGLE-THREADED RISK',
        description: `Only ${thisCallExternals} external participant on this call. Previous calls averaged ${avgPrevExternal.toFixed(1)}. Engagement breadth is dropping — consider re-engaging the buying committee.`,
      });
    }
  } else if (thisCallExternals === 1) {
    cards.push({
      severity: 'warning',
      label: 'SINGLE-THREADED',
      description: 'Only one external participant on this call. Deals with broader stakeholder engagement close at higher rates.',
    });
  }

  // Stage velocity warning
  if (deal_context && deal_context.stage_benchmark_median !== null && deal_context.days_in_stage > deal_context.stage_benchmark_median * 1.5) {
    cards.push({
      severity: 'warning',
      label: 'STAGE VELOCITY WARNING',
      description: `${deal_context.days_in_stage} days in ${deal_context.stage} — ${Math.round(deal_context.days_in_stage / deal_context.stage_benchmark_median * 10) / 10}× the median of ${Math.round(deal_context.stage_benchmark_median)}d. Deals spending this long here are more likely to slip.`,
    });
  }

  // Critical skill findings
  const criticalFinding = skill_findings.find(f => f.severity === 'critical');
  if (criticalFinding) {
    cards.push({
      severity: 'critical',
      label: criticalFinding.skill_id.replace(/_/g, ' ').toUpperCase(),
      description: criticalFinding.message,
    });
  }

  // High-severity CRM gap
  const highCrmGap = crm_follow_through?.gaps.find(g => g.severity === 'high');
  if (highCrmGap) {
    cards.push({
      severity: 'warning',
      label: 'CRM FOLLOW-UP NEEDED',
      description: highCrmGap.detail,
    });
  }

  if (cards.length === 0) {
    cards.push({
      severity: 'positive',
      label: 'NO ISSUES DETECTED',
      description: 'No multi-threading gaps, velocity warnings, or CRM follow-up gaps identified for this call.',
    });
  }

  return cards.slice(0, 3);
}

const SEVERITY_STYLE: Record<string, { border: string; label: string; bg: string }> = {
  positive: { border: colors.green, label: colors.green, bg: colors.greenSoft },
  warning: { border: colors.yellow, label: colors.yellow, bg: colors.yellowSoft },
  critical: { border: colors.red, label: colors.red, bg: colors.redSoft },
  info: { border: colors.accent, label: colors.accent, bg: colors.accentSoft },
};

// ============================================================================
// Main Component
// ============================================================================

export default function ConversationDetail() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const { currentWorkspace } = useWorkspace();
  const { anon } = useDemoMode();
  const workspaceId = currentWorkspace?.id;
  const [dossier, setDossier] = useState<ConversationDossier | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'impact' | 'actions' | 'coaching'>('impact');
  const [coachingData, setCoachingData] = useState<CoachingData | null>(null);
  const [coachingLoading, setCoachingLoading] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [activitySignals, setActivitySignals] = useState<ActivitySignalLocal[]>([]);
  const [signalsLoading, setSignalsLoading] = useState(false);

  const toggleSection = (key: string) =>
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));

  useEffect(() => {
    if (!conversationId) {
      setError('No conversation ID provided');
      setLoading(false);
      return;
    }

    if (!currentWorkspace) {
      setError('No workspace selected. Please select a workspace from the Command Center.');
      setLoading(false);
      return;
    }

    async function loadDossier() {
      try {
        setLoading(true);
        setError(null);
        const data = await api.get(`/conversations/${conversationId}/dossier`);
        setDossier(data);
      } catch (err: any) {
        console.error('Failed to load conversation dossier:', err);
        setError(err.response?.data?.error || 'Failed to load conversation');
      } finally {
        setLoading(false);
      }
    }

    loadDossier();
  }, [conversationId, currentWorkspace]);

  useEffect(() => {
    const dealId = dossier?.deal_context?.deal_id;
    if (!dealId || !workspaceId) return;
    setCoachingLoading(true);
    api.get(`/deals/${dealId}/coaching`)
      .then((data: CoachingData) => setCoachingData(data))
      .catch(() => setCoachingData(null))
      .finally(() => setCoachingLoading(false));
  }, [dossier?.deal_context?.deal_id, workspaceId]);

  useEffect(() => {
    const dealId = dossier?.deal_context?.deal_id;
    const startedAt = dossier?.conversation?.started_at;
    if (!dealId || !startedAt || !workspaceId) return;
    const ts = new Date(startedAt);
    const from = new Date(ts.getTime() - 3 * 86400000).toISOString().split('T')[0];
    const to = new Date(ts.getTime() + 3 * 86400000).toISOString().split('T')[0];
    setSignalsLoading(true);
    api.get(`/activity-signals?deal_id=${dealId}&from_date=${from}&to_date=${to}&limit=100`)
      .then((data: any) => setActivitySignals(data.signals ?? []))
      .catch(() => setActivitySignals([]))
      .finally(() => setSignalsLoading(false));
  }, [dossier?.deal_context?.deal_id, dossier?.conversation?.started_at, workspaceId]);

  if (loading) {
    return (
      <div style={{ padding: 40 }}>
        <Skeleton height={24} width={300} style={{ marginBottom: 16 }} />
        <Skeleton height={60} style={{ marginBottom: 24 }} />
        <Skeleton height={200} />
      </div>
    );
  }

  if (error || !dossier) {
    const isWorkspaceError = error?.includes('workspace');
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 16, color: colors.textMuted, marginBottom: 16 }}>
          {error || 'Conversation not found'}
        </div>
        <button
          onClick={() => { if (isWorkspaceError) { navigate('/'); } else { navigate(-1); } }}
          style={{
            background: colors.accent,
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '10px 20px',
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          {isWorkspaceError ? 'Return to Command Center' : 'Go back'}
        </button>
      </div>
    );
  }

  const { conversation, deal_context, health_impact, crm_follow_through, conversation_arc, coaching_signals, coaching_mode, coaching_metadata, contacts_absent, skill_findings } = dossier;

  const internalParticipants = conversation.resolved_participants.filter(p => p.role === 'internal');
  const externalParticipants = conversation.resolved_participants.filter(p => p.role === 'external');
  const allParticipants = [...externalParticipants, ...internalParticipants];
  const displayParticipants = allParticipants.slice(0, 6);
  const overflowCount = Math.max(0, allParticipants.length - 6);

  const narrative = conversation.summary || buildFallbackNarrative(dossier);

  const healthScore = deal_context?.health_score ?? null;
  const healthTag = healthScore === null
    ? null
    : healthScore >= 70
    ? { label: 'Healthy', color: colors.green, bg: colors.greenSoft }
    : healthScore >= 45
    ? { label: 'At Risk', color: colors.yellow, bg: colors.yellowSoft }
    : { label: 'Critical', color: colors.red, bg: colors.redSoft };

  const impactCards = buildImpactCards(dossier, coachingData);

  const showCoachingTab = coaching_mode !== 'hidden';
  const tabs: { key: 'impact' | 'actions' | 'coaching'; label: string; count: number }[] = [
    { key: 'impact', label: 'Deal Impact', count: impactCards.length },
    { key: 'actions', label: 'Action Items', count: conversation.action_items?.length ?? 0 },
    ...(showCoachingTab ? [{ key: 'coaching' as const, label: 'Coaching Signals', count: coaching_signals?.length ?? 0 }] : []),
  ];

  if (activeTab === 'coaching' && !showCoachingTab) {
    setActiveTab('impact');
  }

  return (
    <div style={{ background: colors.bg, minHeight: '100vh' }}>

      {/* ================================================================
          TIER 1: Call Header + Deal Strip + AI Narrative
      ================================================================ */}

      {/* Compact Header */}
      <div style={{ background: colors.surface, borderBottom: `1px solid ${colors.border}`, padding: '16px 40px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <button
            onClick={() => navigate(-1)}
            style={{ background: 'transparent', border: 'none', color: colors.textMuted, cursor: 'pointer', padding: 4 }}
          >
            <ChevronLeft size={20} />
          </button>
          <h1 style={{ fontFamily: fonts.sans, fontSize: 18, fontWeight: 700, margin: 0, color: colors.text, flex: 1 }}>
            {conversation.title}
          </h1>
          {conversation.source_url && (
            <a
              href={conversation.source_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: colors.accent, textDecoration: 'none' }}
            >
              Open in {getSourceLabel(conversation.source)} <ExternalLink size={12} />
            </a>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          {/* Metadata */}
          <span style={{ fontSize: 12, color: colors.textMuted }}>
            {formatDate(conversation.started_at)} · {Math.round(conversation.duration_seconds / 60)} min
          </span>
          <div style={{
            background: colors.accentSoft,
            color: colors.accent,
            padding: '3px 8px',
            borderRadius: 5,
            fontSize: 11,
            fontWeight: 600,
          }}>
            via {getSourceLabel(conversation.source)}
          </div>

          {/* Participant avatars */}
          {allParticipants.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 4 }}>
              {displayParticipants.map((p, i) => {
                const isInternal = p.role === 'internal';
                const bg = isInternal ? colors.accent : colors.orange;
                return (
                  <div
                    key={i}
                    title={`${p.name} (${p.role})`}
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: '50%',
                      background: bg + '30',
                      border: `2px solid ${bg}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 10,
                      fontWeight: 700,
                      color: bg,
                      fontFamily: fonts.mono,
                      flexShrink: 0,
                    }}
                  >
                    {getInitials(p.name)}
                  </div>
                );
              })}
              {overflowCount > 0 && (
                <span style={{ fontSize: 11, color: colors.textMuted, marginLeft: 4 }}>
                  +{overflowCount} more
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Deal Context Strip */}
      <div style={{ background: colors.surfaceHover, borderBottom: `1px solid ${colors.border}`, padding: '12px 40px' }}>
        {deal_context ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 10, color: colors.textMuted, marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Deal</div>
              <Link
                to={`/deals/${deal_context.deal_id}`}
                style={{ fontSize: 13, fontWeight: 600, color: colors.text, textDecoration: 'none' }}
              >
                {anon.deal(deal_context.deal_name)}
              </Link>
            </div>
            <div>
              <div style={{ fontSize: 10, color: colors.textMuted, marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Amount</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, fontFamily: fonts.mono }}>{formatCurrency(deal_context.amount)}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: colors.textMuted, marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Stage</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>
                {formatStageNormalized(deal_context.stage_normalized)}
                <span style={{ fontSize: 11, color: colors.textMuted, fontWeight: 400 }}> · {deal_context.days_in_stage}d</span>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: colors.textMuted, marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Close Date</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>
                {formatDate(deal_context.close_date)}
                {deal_context.close_date_pushes > 0 && (
                  <span style={{ fontSize: 11, color: colors.yellow }}> ({deal_context.close_date_pushes} pushes)</span>
                )}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: colors.textMuted, marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>On this call</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>
                {externalParticipants.filter(p => p.confidence >= 0.6).length} contacts
              </div>
            </div>
            {healthTag && (
              <div style={{
                marginLeft: 'auto',
                background: healthTag.bg,
                color: healthTag.color,
                padding: '4px 10px',
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 700,
              }}>
                {healthTag.label}
              </div>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: colors.textMuted, fontStyle: 'italic' }}>
            No deal linked to this conversation
          </div>
        )}
      </div>

      {/* AI Call Narrative hero */}
      <div style={{ padding: '20px 40px 0' }}>
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: '16px 20px',
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: colors.textMuted, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
            ✦ Call Intelligence
          </div>
          <div style={{ fontSize: 14, color: colors.textSecondary, lineHeight: 1.7 }}>
            {anon.text(narrative)}
          </div>
          {!conversation.summary && (
            <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 8, fontStyle: 'italic' }}>
              Structured summary — full AI narrative available when Gong/Fireflies summary is present.
            </div>
          )}
        </div>
      </div>

      {/* ================================================================
          TIER 2: Tabbed Insights
      ================================================================ */}

      {/* Tab bar */}
      <div style={{
        display: 'flex',
        gap: 0,
        padding: '0 40px',
        borderBottom: `1px solid ${colors.border}`,
        marginTop: 20,
      }}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: `2px solid ${activeTab === tab.key ? colors.accent : 'transparent'}`,
              color: activeTab === tab.key ? colors.accent : colors.textMuted,
              fontSize: 13,
              fontWeight: 600,
              padding: '12px 20px 12px 0',
              marginRight: 8,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              fontFamily: fonts.sans,
            }}
          >
            {tab.label}
            {tab.count > 0 && (
              <span style={{
                background: activeTab === tab.key ? colors.accent : colors.surfaceHover,
                color: activeTab === tab.key ? '#fff' : colors.textMuted,
                borderRadius: 10,
                padding: '1px 6px',
                fontSize: 10,
                fontWeight: 700,
                minWidth: 18,
                textAlign: 'center',
              }}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ padding: '24px 40px 0' }}>
        {activeTab === 'impact' && (
          <DealImpactTab
            conversation={conversation}
            healthImpact={health_impact}
            crmFollowThrough={crm_follow_through}
            conversationArc={conversation_arc}
            coachingData={coachingData}
            coachingLoading={coachingLoading}
            dealContext={deal_context}
            impactCards={impactCards}
            anon={anon}
          />
        )}

        {activeTab === 'actions' && (
          <ActionTrackerTab
            actionItems={conversation.action_items}
            crmFollowThrough={crm_follow_through}
          />
        )}

        {activeTab === 'coaching' && showCoachingTab && (
          <CoachingSignalsTab
            coachingSignals={coaching_signals}
            coachingMode={coaching_mode}
            coachingMetadata={coaching_metadata}
            coachingData={coachingData}
            dealId={deal_context?.deal_id ?? null}
          />
        )}
      </div>

      {/* ================================================================
          TIER 3: Collapsed Accordions
      ================================================================ */}
      <div style={{ padding: '24px 40px 48px', display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>

        {/* 3a: Stage Journey */}
        {coachingData && coachingData.stage_journey.length > 0 && (
          <Accordion
            sectionKey="stage_journey"
            title="Stage Journey"
            badge={coachingData.stage_journey.length}
            expanded={expandedSections['stage_journey'] ?? false}
            onToggle={() => toggleSection('stage_journey')}
          >
            <StageJourneyContent coachingData={coachingData} />
          </Accordion>
        )}

        {/* 3b: Participants */}
        {conversation.resolved_participants.length > 0 && (
          <Accordion
            sectionKey="participants"
            title="Participants"
            badge={conversation.resolved_participants.length}
            expanded={expandedSections['participants'] ?? false}
            onToggle={() => toggleSection('participants')}
          >
            <ParticipantsContent
              participants={conversation.resolved_participants}
              contactsAbsent={contacts_absent}
              anon={anon}
            />
          </Accordion>
        )}

        {/* 3c: Signal Coverage — MEDDIC/buyer signals from this call's time window */}
        {(activitySignals.length > 0 || signalsLoading) && deal_context && (
          <Accordion
            sectionKey="signal_coverage"
            title="Signal Coverage"
            badge={signalsLoading ? null : activitySignals.length}
            expanded={expandedSections['signal_coverage'] ?? activitySignals.length > 0}
            onToggle={() => toggleSection('signal_coverage')}
          >
            <SignalCoverageContent signals={activitySignals} loading={signalsLoading} />
          </Accordion>
        )}

        {/* 3d: Skill Findings — only if data exists */}
        {skill_findings && skill_findings.length > 0 && (
          <Accordion
            sectionKey="skill_findings"
            title="Skill Findings"
            badge={skill_findings.length}
            expanded={expandedSections['skill_findings'] ?? false}
            onToggle={() => toggleSection('skill_findings')}
          >
            <SkillFindingsContent findings={skill_findings} />
          </Accordion>
        )}

        {/* 3d: Call Metrics */}
        {conversation.call_metrics && (
          <Accordion
            sectionKey="call_metrics"
            title="Call Metrics"
            badge={null}
            expanded={expandedSections['call_metrics'] ?? false}
            onToggle={() => toggleSection('call_metrics')}
          >
            <CallMetricsContent metrics={conversation.call_metrics} />
          </Accordion>
        )}

        {/* 3e: Source / Transcript */}
        <Accordion
          sectionKey="source"
          title={`Open in ${getSourceLabel(conversation.source)}`}
          badge={null}
          expanded={expandedSections['source'] ?? false}
          onToggle={() => toggleSection('source')}
        >
          <div style={{ padding: '12px 0' }}>
            {conversation.source_url ? (
              <a
                href={conversation.source_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 13,
                  color: colors.accent,
                  textDecoration: 'none',
                  fontWeight: 600,
                }}
              >
                Open full transcript in {getSourceLabel(conversation.source)} <ExternalLink size={13} />
              </a>
            ) : (
              <div style={{ fontSize: 13, color: colors.textMuted }}>
                Full transcript available in {getSourceLabel(conversation.source)}. Use the link in the header to open it.
              </div>
            )}
          </div>
        </Accordion>

      </div>
    </div>
  );
}

// ============================================================================
// Signal Coverage Component
// ============================================================================

const MEDDIC_FIELDS = [
  { key: 'metrics', label: 'Metrics' },
  { key: 'economic_buyer', label: 'Econ. Buyer' },
  { key: 'decision_criteria', label: 'Dec. Criteria' },
  { key: 'decision_process', label: 'Dec. Process' },
  { key: 'identify_pain', label: 'Identify Pain' },
  { key: 'champion', label: 'Champion' },
];

function SignalCoverageContent({ signals, loading }: { signals: ActivitySignalLocal[]; loading: boolean }) {
  const [expandedField, setExpandedField] = useState<string | null>(null);

  if (loading) {
    return (
      <div style={{ padding: '16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Skeleton height={28} width={400} />
        <Skeleton height={60} />
      </div>
    );
  }

  if (signals.length === 0) {
    return (
      <div style={{ padding: '16px 0', fontSize: 13, color: colors.textMuted }}>
        No signals extracted for this time window. Signals are extracted automatically after CRM activities sync.
      </div>
    );
  }

  const frameworkSignals = signals.filter(s => s.signal_type === 'framework_signal');
  const prospectQuotes = signals.filter(s => s.signal_type === 'notable_quote' && s.speaker_type === 'prospect');
  const blockers = signals.filter(s => s.signal_type === 'blocker_mention');
  const competitors = signals.filter(s => s.signal_type === 'competitor_mention');
  const timelines = signals.filter(s => s.signal_type === 'timeline_mention');

  const coveredFields = new Set(frameworkSignals.map(s => s.framework_field).filter(Boolean));

  const otherGroups: { label: string; emoji: string; items: ActivitySignalLocal[]; color: string }[] = [
    { label: 'Blockers', emoji: '🚧', items: blockers, color: colors.orange },
    { label: 'Competitors', emoji: '⚔️', items: competitors, color: colors.purple ?? colors.accent },
    { label: 'Timelines', emoji: '📅', items: timelines, color: colors.blue ?? colors.textSecondary },
  ].filter(g => g.items.length > 0);

  return (
    <div style={{ padding: '12px 0', display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* MEDDIC Coverage Strip */}
      {frameworkSignals.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: colors.textMuted, marginBottom: 10 }}>
            Framework Coverage · {coveredFields.size}/{MEDDIC_FIELDS.length} fields
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {MEDDIC_FIELDS.map(field => {
              const covered = coveredFields.has(field.key);
              const isExpanded = expandedField === field.key;
              const topSignal = frameworkSignals.find(s => s.framework_field === field.key);
              return (
                <div key={field.key}>
                  <button
                    onClick={() => covered ? setExpandedField(isExpanded ? null : field.key) : undefined}
                    style={{
                      padding: '5px 12px',
                      borderRadius: 20,
                      border: `1px solid ${covered ? colors.accent : colors.border}`,
                      background: covered ? `${colors.accent}18` : colors.surface,
                      color: covered ? colors.accent : colors.textMuted,
                      fontSize: 12,
                      fontWeight: covered ? 600 : 400,
                      fontFamily: fonts.sans,
                      cursor: covered ? 'pointer' : 'default',
                      opacity: covered ? 1 : 0.6,
                    }}
                  >
                    {covered && <span style={{ marginRight: 5 }}>✓</span>}
                    {field.label}
                  </button>
                  {isExpanded && topSignal?.source_quote && (
                    <div style={{
                      marginTop: 6,
                      padding: '8px 12px',
                      background: colors.surface,
                      border: `1px solid ${colors.border}`,
                      borderRadius: 6,
                      fontSize: 12,
                      color: colors.textSecondary,
                      fontStyle: 'italic',
                      maxWidth: 360,
                    }}>
                      "{topSignal.source_quote}"
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Voice of the Buyer */}
      {prospectQuotes.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: colors.textMuted, marginBottom: 10 }}>
            Voice of the Buyer · {prospectQuotes.length} quote{prospectQuotes.length !== 1 ? 's' : ''}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {prospectQuotes.slice(0, 5).map(q => (
              <div key={q.id} style={{
                padding: '10px 14px',
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderLeft: `3px solid ${colors.accent}`,
                borderRadius: 6,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
              }}>
                <span style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: q.confidence >= 0.85 ? colors.green : colors.yellow,
                  flexShrink: 0,
                  marginTop: 4,
                }} />
                <span style={{ fontSize: 13, color: colors.text, fontStyle: 'italic', lineHeight: 1.5 }}>
                  "{q.source_quote || q.signal_value}"
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Blockers, Competitors, Timelines */}
      {otherGroups.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {otherGroups.map(group => (
            <div key={group.label}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: colors.textMuted, marginBottom: 8 }}>
                {group.emoji} {group.label} · {group.items.length}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {group.items.slice(0, 4).map(s => (
                  <div key={s.id} style={{
                    padding: '6px 12px',
                    background: colors.surface,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 6,
                    fontSize: 12,
                    color: colors.text,
                  }}>
                    <span style={{ fontWeight: 600, color: group.color }}>{s.signal_value || '—'}</span>
                    {s.source_quote && s.source_quote !== s.signal_value && (
                      <span style={{ color: colors.textMuted, marginLeft: 8 }}>· {s.source_quote.slice(0, 80)}{s.source_quote.length > 80 ? '…' : ''}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Accordion Shell
// ============================================================================

function Accordion({
  sectionKey,
  title,
  badge,
  expanded,
  onToggle,
  children,
}: {
  sectionKey: string;
  title: string;
  badge: number | null;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={{
      border: `1px solid ${colors.border}`,
      borderRadius: 8,
      overflow: 'hidden',
    }}>
      <div
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 16px',
          background: colors.surfaceHover,
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: colors.text, flex: 1 }}>{title}</span>
        {badge !== null && badge > 0 && (
          <span style={{
            background: colors.surface,
            color: colors.textMuted,
            borderRadius: 10,
            padding: '1px 7px',
            fontSize: 10,
            fontWeight: 700,
          }}>
            {badge}
          </span>
        )}
        {expanded
          ? <ChevronDown size={15} color={colors.textMuted} />
          : <ChevronRight size={15} color={colors.textMuted} />
        }
      </div>
      {expanded && (
        <div style={{ padding: '16px', background: colors.surface }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Tab Components
// ============================================================================

function DealImpactTab({
  conversation,
  healthImpact,
  crmFollowThrough,
  conversationArc,
  coachingData,
  coachingLoading,
  dealContext,
  impactCards,
  anon,
}: {
  conversation: ConversationDossier['conversation'];
  healthImpact: ConversationDossier['health_impact'];
  crmFollowThrough: ConversationDossier['crm_follow_through'];
  conversationArc: ConversationArcEntry[];
  coachingData: CoachingData | null;
  coachingLoading: boolean;
  dealContext: ConversationDossier['deal_context'];
  impactCards: ImpactCard[];
  anon: ReturnType<typeof useDemoMode>['anon'];
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Impact Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {impactCards.map((card, i) => {
          const style = SEVERITY_STYLE[card.severity] ?? SEVERITY_STYLE.info;
          return (
            <div
              key={i}
              style={{
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderLeft: `4px solid ${style.border}`,
                borderRadius: 8,
                padding: '12px 16px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{
                  background: style.bg,
                  color: style.label,
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '2px 7px',
                  borderRadius: 4,
                  letterSpacing: '0.05em',
                }}>
                  {card.label}
                </span>
              </div>
              <div style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.6 }}>
                {card.description}
              </div>
            </div>
          );
        })}
      </div>

      {/* Engagement Snapshot tiles */}
      {(coachingLoading || coachingData) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {/* Last call gap */}
          <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 10, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Last call gap</div>
            {coachingLoading ? (
              <Skeleton height={28} width={60} />
            ) : (
              <>
                <div style={{
                  fontSize: 28,
                  fontWeight: 700,
                  fontFamily: fonts.mono,
                  color: coachingData?.engagement.last_call_days_ago === null ? colors.textMuted
                    : (coachingData?.engagement.last_call_days_ago ?? -1) > 14 ? colors.yellow
                    : (coachingData?.engagement.last_call_days_ago ?? -1) <= 7 ? colors.green
                    : colors.text,
                }}>
                  {coachingData?.engagement.last_call_days_ago !== null && coachingData?.engagement.last_call_days_ago !== undefined
                    ? `${coachingData.engagement.last_call_days_ago}d`
                    : '—'}
                </div>
                {coachingData?.engagement.last_call_days_ago !== null && coachingData?.engagement.last_call_days_ago !== undefined && coachingData.engagement.last_call_days_ago > 14 && (
                  <div style={{ fontSize: 11, color: colors.yellow, marginTop: 4 }}>Cooling off</div>
                )}
              </>
            )}
          </div>

          {/* Contacts on calls */}
          <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 10, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Contacts on calls</div>
            {coachingLoading ? (
              <Skeleton height={28} width={40} />
            ) : (
              <>
                <div style={{
                  fontSize: 28,
                  fontWeight: 700,
                  fontFamily: fonts.mono,
                  color: (coachingData?.engagement.contact_count ?? 0) >= 3 ? colors.green
                    : (coachingData?.engagement.contact_count ?? 0) >= 2 ? colors.text
                    : colors.yellow,
                }}>
                  {coachingData?.engagement.contact_count ?? '—'}
                </div>
                <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 4 }}>unique contacts</div>
              </>
            )}
          </div>

          {/* Days in stage */}
          <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 10, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Days in stage</div>
            <div style={{
              fontSize: 28,
              fontWeight: 700,
              fontFamily: fonts.mono,
              color: dealContext && dealContext.stage_benchmark_median !== null && dealContext.days_in_stage > dealContext.stage_benchmark_median * 1.5
                ? colors.yellow
                : colors.text,
            }}>
              {dealContext ? `${dealContext.days_in_stage}d` : '—'}
            </div>
            {dealContext?.stage_benchmark_median !== null && dealContext?.stage_benchmark_median !== undefined && (
              <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 4 }}>
                median {Math.round(dealContext.stage_benchmark_median)}d
              </div>
            )}
          </div>
        </div>
      )}

      {/* Composite health verdict banner */}
      {!coachingLoading && coachingData?.composite && (
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderLeft: `4px solid ${coachingData.composite.color}`,
          borderRadius: 8,
          padding: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{
              display: 'inline-block',
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: coachingData.composite.color,
              flexShrink: 0,
            }} />
            <span style={{ fontSize: 15, fontWeight: 700, color: colors.text }}>{coachingData.composite.label}</span>
          </div>
          {coachingData.composite.summary && (
            <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 6 }}>
              {coachingData.composite.summary}
            </div>
          )}
          {coachingData.composite.next_step && (
            <div style={{ fontSize: 12, color: colors.textMuted, fontStyle: 'italic' }}>
              Next: {coachingData.composite.next_step}
            </div>
          )}
        </div>
      )}

      {/* Engagement signals */}
      {!coachingLoading && coachingData?.engagement && (
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 20,
        }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 14, color: colors.text }}>Engagement Signals</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {signalDot(
                coachingData.engagement.signal === 'active' ? 'healthy'
                  : coachingData.engagement.signal === 'cooling' ? 'watch'
                  : coachingData.engagement.signal === 'dark' ? 'critical'
                  : 'watch'
              )}
              <span style={{ fontSize: 13, color: colors.text }}>
                {coachingData.engagement.last_call_days_ago !== null
                  ? `Last call ${coachingData.engagement.last_call_days_ago}d ago`
                  : 'No calls recorded'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {signalDot(coachingData.engagement.contact_count >= 3 ? 'healthy' : coachingData.engagement.contact_count >= 2 ? 'watch' : 'at_risk')}
              <span style={{ fontSize: 13, color: colors.text }}>
                {coachingData.engagement.contact_count} unique contact{coachingData.engagement.contact_count !== 1 ? 's' : ''} on calls
              </span>
            </div>
            {coachingData.engagement.missing_stakeholders.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 8 }}>Missing stakeholders:</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {coachingData.engagement.missing_stakeholders.slice(0, 4).map((ms, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: colors.red, display: 'inline-block', flexShrink: 0 }} />
                      <span style={{ fontSize: 12, color: colors.text }}>{ms.name}</span>
                      {ms.buying_role && (
                        <span style={{ fontSize: 11, color: colors.textMuted }}>· {ms.buying_role}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Health impact / Call Signals */}
      {healthImpact && (healthImpact.health_before !== null || healthImpact.health_after !== null || healthImpact.factors.length > 0) && (
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 20,
        }}>
          {/* Title: "Deal Health Impact" only when we have real before/after scores */}
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: colors.text }}>
            {healthImpact.health_before !== null && healthImpact.health_after !== null
              ? 'Deal Health Impact'
              : 'Call Signals'}
          </div>

          {/* Before → After row: only show when we have real scores */}
          {healthImpact.health_before !== null && healthImpact.health_after !== null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 11, color: colors.textMuted }}>Before</div>
                <div style={{ fontSize: 20, fontWeight: 600, fontFamily: fonts.mono, color: colors.text }}>
                  {healthImpact.health_before.toFixed(1)}
                </div>
              </div>
              <div style={{ fontSize: 20, color: colors.textMuted }}>→</div>
              <div>
                <div style={{ fontSize: 11, color: colors.textMuted }}>After</div>
                <div style={{ fontSize: 20, fontWeight: 600, fontFamily: fonts.mono, color: colors.text }}>
                  {healthImpact.health_after.toFixed(1)}
                </div>
              </div>
              {healthImpact.health_delta !== null && (
                <div style={{
                  background: healthImpact.health_delta >= 0 ? colors.greenSoft : colors.redSoft,
                  color: healthImpact.health_delta >= 0 ? colors.green : colors.red,
                  padding: '6px 12px',
                  borderRadius: 6,
                  fontSize: 14,
                  fontWeight: 600,
                  fontFamily: fonts.mono,
                }}>
                  {healthImpact.health_delta >= 0 ? '+' : ''}{healthImpact.health_delta}
                </div>
              )}
            </div>
          )}

          {healthImpact.factors.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {healthImpact.factors.map((factor, i) => (
                <div
                  key={i}
                  style={{
                    background: colors.surfaceHover,
                    padding: 12,
                    borderRadius: 6,
                    borderLeft: `3px solid ${factor.delta >= 0 ? colors.green : colors.red}`,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>{factor.label}</span>
                  </div>
                  <div style={{ fontSize: 12, color: colors.textMuted }}>{factor.detail}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* CRM gaps */}
      {crmFollowThrough && crmFollowThrough.gaps.length > 0 && (
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 20,
        }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: colors.text }}>CRM Gaps</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {crmFollowThrough.gaps.map((gap, i) => (
              <div
                key={i}
                style={{
                  background: gap.severity === 'high' ? colors.redSoft : gap.severity === 'medium' ? colors.yellowSoft : colors.surfaceHover,
                  border: `1px solid ${gap.severity === 'high' ? colors.red : gap.severity === 'medium' ? colors.yellow : colors.border}`,
                  padding: 12,
                  borderRadius: 6,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, color: colors.text }}>{gap.label}</div>
                <div style={{ fontSize: 12, color: colors.textMuted }}>{gap.detail}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Conversation arc */}
      {conversationArc.length > 0 && (
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 20,
        }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: colors.text }}>Conversation Timeline</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {conversationArc.map(entry => (
              <Link
                key={entry.id}
                to={`/conversations/${entry.id}`}
                style={{
                  display: 'block',
                  background: entry.is_current ? colors.accent + '10' : colors.surfaceHover,
                  border: `1px solid ${entry.is_current ? colors.accent : colors.border}`,
                  padding: 12,
                  borderRadius: 6,
                  textDecoration: 'none',
                  color: colors.text,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>{anon.deal(entry.title)}</span>
                  {entry.health_delta !== null && (
                    <span style={{
                      fontSize: 12,
                      color: entry.health_delta >= 0 ? colors.green : colors.red,
                      fontWeight: 600,
                      fontFamily: fonts.mono,
                    }}>
                      {entry.health_delta >= 0 ? '+' : ''}{entry.health_delta}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: colors.textMuted }}>
                  {formatDate(entry.started_at)} · {entry.participant_count_external} contacts · {Math.round(entry.duration_seconds / 60)} min
                </div>
                {entry.summary_one_liner && (
                  <div style={{ fontSize: 11, color: colors.textSecondary, marginTop: 6, fontStyle: 'italic' }}>
                    {anon.text(entry.summary_one_liner)}
                  </div>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ActionTrackerTab({
  actionItems,
  crmFollowThrough,
}: {
  actionItems: any[];
  crmFollowThrough: ConversationDossier['crm_follow_through'];
}) {
  const [checkedItems, setCheckedItems] = useState<Set<number>>(new Set());

  const toggleItem = (i: number) => {
    setCheckedItems(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  const priorityStyle = (index: number) => {
    if (index === 0) return { label: 'P0', color: colors.red, bg: colors.redSoft };
    if (index === 1) return { label: 'P1', color: colors.yellow, bg: colors.yellowSoft };
    return { label: 'P2', color: colors.accent, bg: colors.accentSoft };
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {actionItems && actionItems.length > 0 ? (
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 20,
        }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: colors.text }}>Action Items</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {actionItems.map((item, i) => {
              const checked = checkedItems.has(i);
              const p = priorityStyle(i);
              return (
                <div
                  key={i}
                  onClick={() => toggleItem(i)}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 12,
                    background: colors.surfaceHover,
                    padding: '10px 12px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    opacity: checked ? 0.5 : 1,
                    transition: 'opacity 0.15s',
                  }}
                >
                  <div style={{
                    width: 18,
                    height: 18,
                    borderRadius: 4,
                    background: checked ? colors.green : 'transparent',
                    border: `2px solid ${checked ? colors.green : colors.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    marginTop: 1,
                  }}>
                    {checked && <span style={{ color: '#fff', fontSize: 11, lineHeight: 1 }}>✓</span>}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{
                      fontSize: 13,
                      color: colors.text,
                      textDecoration: checked ? 'line-through' : 'none',
                    }}>
                      {item.text || item.description || JSON.stringify(item)}
                    </div>
                    {item.owner && (
                      <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 3 }}>
                        Owner: {item.owner}
                      </div>
                    )}
                  </div>
                  <span style={{
                    background: p.bg,
                    color: p.color,
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '2px 6px',
                    borderRadius: 4,
                    flexShrink: 0,
                  }}>
                    {p.label}
                  </span>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: colors.textMuted, fontStyle: 'italic', marginTop: 14 }}>
            Action items extracted from conversation transcript via AI analysis
          </div>
        </div>
      ) : (
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 32,
          textAlign: 'center',
          color: colors.textMuted,
          fontSize: 14,
        }}>
          No action items extracted from this conversation.
        </div>
      )}

      {/* CRM follow-through checklist */}
      {crmFollowThrough && (
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 20,
        }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6, color: colors.text }}>CRM Follow-Through</div>
          <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 16 }}>
            {crmFollowThrough.hours_since_call}h since call
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <ChecklistItem label="Deal stage updated" checked={crmFollowThrough.stage_changed} />
            <ChecklistItem label="Next step field updated" checked={crmFollowThrough.next_step_updated} />
            <ChecklistItem label="Activity logged" checked={crmFollowThrough.activity_logged} />
            <ChecklistItem label="Next meeting scheduled" checked={crmFollowThrough.next_meeting_scheduled === true} />
          </div>
        </div>
      )}

      {actionItems && actionItems.length > 0 && crmFollowThrough && !crmFollowThrough.next_meeting_scheduled && (
        <div style={{
          background: colors.yellowSoft,
          border: `1px solid ${colors.yellow}`,
          borderRadius: 8,
          padding: 16,
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: colors.yellow, marginBottom: 8 }}>
            ⚡ Follow-up needed
          </div>
          <div style={{ fontSize: 13, color: colors.textSecondary }}>
            {actionItems.length} action items created but no follow-up meeting scheduled.
          </div>
        </div>
      )}
    </div>
  );
}

function CoachingSignalsTab({
  coachingSignals,
  coachingMode,
  coachingMetadata,
  coachingData,
  dealId,
}: {
  coachingSignals: CoachingSignal[];
  coachingMode: CoachingMode;
  coachingMetadata: { won_count: number; lost_count: number; pattern_count: number };
  coachingData: CoachingData | null;
  dealId: string | null;
}) {
  const { currentWorkspace } = useWorkspace();
  const workspaceId = currentWorkspace?.id;
  const [scriptLoading, setScriptLoading] = useState(false);
  const [script, setScript] = useState<{ opener: string; points: { focus: string; evidence: string; question: string }[]; closing_note: string } | null>(null);
  const [scriptError, setScriptError] = useState<string | null>(null);

  const generateScript = async () => {
    if (!dealId || !workspaceId) return;
    setScriptLoading(true);
    setScriptError(null);
    try {
      const data: any = await api.post(`/deals/${dealId}/coaching-script`, {});
      setScript(data.script);
    } catch (err: any) {
      setScriptError(err.response?.data?.error || 'Failed to generate script');
    } finally {
      setScriptLoading(false);
    }
  };

  const copyScript = () => {
    if (!script) return;
    const text = [
      script.opener,
      '',
      ...script.points.map((p, i) => `${i + 1}. ${p.focus}\n   Evidence: ${p.evidence}\n   Ask: ${p.question}`),
      '',
      script.closing_note,
    ].join('\n');
    navigator.clipboard.writeText(text).catch(() => {});
  };

  const hasPatternData = coachingSignals.some(s => s.data != null);

  function getBadgeConfig(type: string) {
    if (coachingMode === 'retrospective') {
      return {
        action: { text: 'RISK FACTOR', bg: colors.yellowSoft, color: colors.yellow, border: colors.yellow },
        positive: { text: 'WIN FACTOR', bg: colors.greenSoft, color: colors.green, border: colors.green },
        warning: { text: 'NOTABLE', bg: colors.accentSoft, color: colors.accent, border: colors.accent },
      }[type] || { text: 'NOTABLE', bg: colors.surfaceHover, color: colors.textMuted, border: colors.border };
    }
    return {
      action: { text: 'ACTION NEEDED', bg: colors.redSoft, color: colors.red, border: colors.red },
      positive: { text: 'ON TRACK', bg: colors.greenSoft, color: colors.green, border: colors.green },
      warning: { text: 'WATCH', bg: colors.yellowSoft, color: colors.yellow, border: colors.yellow },
    }[type] || { text: 'INFO', bg: colors.surfaceHover, color: colors.textMuted, border: colors.border };
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Retrospective mode banner */}
      {coachingMode === 'retrospective' && (
        <div style={{
          background: colors.accentSoft,
          border: `1px solid ${colors.accent}`,
          borderLeft: `4px solid ${colors.accent}`,
          borderRadius: 8,
          padding: '12px 16px',
          color: colors.textSecondary,
        }}>
          <div style={{ fontSize: 13, marginBottom: 4 }}>
            This deal is closed. Signals below show what patterns were present — useful for coaching reviews, not current action.
          </div>
          <div style={{ fontSize: 12, color: colors.textMuted }}>
            WIN FACTOR and RISK FACTOR signals show patterns that were present at close — not current predictions.
          </div>
        </div>
      )}

      {/* Manager Coaching Script — horizontal card */}
      {dealId && (
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 20,
        }}>
          {!script ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 4 }}>
                  Manager Coaching Script
                </div>
                <div style={{ fontSize: 12, color: colors.textMuted }}>
                  AI-generated script based on stage patterns, engagement signals, and action items.
                </div>
              </div>
              <button
                onClick={generateScript}
                disabled={scriptLoading}
                style={{
                  padding: '8px 18px',
                  borderRadius: 6,
                  background: scriptLoading ? colors.surfaceHover : colors.accent,
                  color: scriptLoading ? colors.textMuted : '#fff',
                  border: 'none',
                  fontSize: 13,
                  cursor: scriptLoading ? 'wait' : 'pointer',
                  fontFamily: fonts.sans,
                  flexShrink: 0,
                  whiteSpace: 'nowrap',
                }}
              >
                {scriptLoading ? 'Generating…' : 'Generate Script'}
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>Manager Coaching Script</div>
              <div style={{ fontSize: 13, fontStyle: 'italic', color: colors.textSecondary, lineHeight: 1.6 }}>
                {script.opener}
              </div>
              <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {script.points.map((p, i) => (
                  <li key={i} style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.6 }}>
                    <strong style={{ color: colors.text }}>{p.focus}</strong>
                    <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>Evidence: {p.evidence}</div>
                    <div style={{ fontSize: 12, color: colors.accent, marginTop: 2 }}>Ask: {p.question}</div>
                  </li>
                ))}
              </ol>
              <div style={{ fontSize: 13, fontStyle: 'italic', color: colors.textSecondary }}>{script.closing_note}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button
                  onClick={copyScript}
                  style={{ padding: '6px 14px', borderRadius: 6, border: `1px solid ${colors.border}`, background: 'transparent', color: colors.text, fontSize: 12, cursor: 'pointer', fontFamily: fonts.sans }}
                >
                  Copy to clipboard
                </button>
                <button
                  onClick={generateScript}
                  disabled={scriptLoading}
                  style={{ padding: '6px 14px', borderRadius: 6, border: `1px solid ${colors.border}`, background: 'transparent', color: colors.textMuted, fontSize: 12, cursor: 'pointer', fontFamily: fonts.sans }}
                >
                  {scriptLoading ? 'Regenerating…' : 'Regenerate'}
                </button>
              </div>
            </div>
          )}
          {scriptError && (
            <div style={{ fontSize: 12, color: colors.red, marginTop: 8 }}>{scriptError}</div>
          )}
        </div>
      )}

      {/* Mode subtitle */}
      {coachingMode === 'retrospective' && hasPatternData && (
        <div style={{ fontSize: 13, color: colors.textMuted, fontStyle: 'italic' }}>
          What patterns showed up on this deal · Based on {coachingMetadata.won_count + coachingMetadata.lost_count} closed deals
        </div>
      )}
      {coachingMode === 'active' && hasPatternData && (
        <div style={{ fontSize: 13, color: colors.textMuted, fontStyle: 'italic' }}>
          Compared against your closed-won deal benchmarks · Based on {coachingMetadata.won_count + coachingMetadata.lost_count} closed deals
        </div>
      )}
      {!hasPatternData && (
        <div style={{ fontSize: 13, color: colors.textMuted, fontStyle: 'italic' }}>
          Pattern discovery analyzes your closed deals to identify what predicts winning
        </div>
      )}

      {/* Coaching signals */}
      {coachingSignals.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {coachingSignals.map((signal, i) => {
            const badgeConfig = getBadgeConfig(signal.type);
            return (
              <div
                key={i}
                style={{
                  background: colors.surface,
                  border: `1px solid ${badgeConfig.border}`,
                  borderLeft: `4px solid ${badgeConfig.border}`,
                  borderRadius: 8,
                  padding: 16,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={{
                    background: badgeConfig.bg,
                    color: badgeConfig.color,
                    padding: '4px 8px',
                    borderRadius: 4,
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                  }}>
                    {badgeConfig.text}
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>{signal.label}</span>
                </div>
                <div style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.5, marginBottom: 8 }}>
                  {signal.action_sentence || signal.insight}
                </div>
                {signal.data && (
                  <div style={{ fontSize: 11, color: colors.textMuted, paddingTop: 8, borderTop: `1px solid ${colors.border}` }}>
                    Based on {signal.data.sample_size} deals | Pattern strength: {signal.separation_score && signal.separation_score >= 0.7 ? 'Strong' : signal.separation_score && signal.separation_score >= 0.5 ? 'Moderate' : 'Emerging'} ({signal.separation_score ? (signal.separation_score * 100).toFixed(0) + '%' : 'N/A'})
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 40,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 14, color: colors.textMuted }}>
            {dealId
              ? 'No coaching signals generated for this conversation'
              : 'Coaching signals require a linked deal'}
          </div>
        </div>
      )}

      <div style={{ fontSize: 12, color: colors.textMuted, fontStyle: 'italic', textAlign: 'center' }}>
        These benchmarks are from YOUR pipeline data, not industry averages
      </div>
    </div>
  );
}

// ============================================================================
// Tier 3 Accordion Content Components
// ============================================================================

function StageJourneyContent({ coachingData }: { coachingData: CoachingData }) {
  const [expandedStages, setExpandedStages] = React.useState<Set<string>>(
    () => new Set(coachingData.stage_journey.filter(s => s.is_current).map(s => s.stage_normalized) ?? [])
  );

  const toggleStage = (key: string) => {
    setExpandedStages(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {coachingData.stage_journey.map((s, i) => {
        const stageKey = s.stage_normalized || s.stage;
        const stageName = formatStageNormalized(s.stage_normalized || s.stage);
        const expanded = expandedStages.has(stageKey) || s.is_current;
        const color = SIGNAL_COLOR_MAP[s.signal] ?? colors.textMuted;
        const wonMedian = s.benchmark?.won_median ?? null;
        const lostMedian = s.benchmark?.lost_median ?? null;
        const confidenceTier = s.benchmark?.confidence_tier ?? 'insufficient';
        const isInverted = s.benchmark?.is_inverted ?? false;
        const sampleSize = s.benchmark?.won_sample_size ?? 0;
        const maxDays = Math.max(
          wonMedian ?? 1,
          lostMedian ?? 1,
          s.duration_days ?? 1,
          1
        ) * 2;
        return (
          <div key={i} style={{
            borderRadius: 6,
            border: `1px solid ${s.is_current ? color + '60' : colors.border}`,
            background: s.is_current ? color + '08' : 'transparent',
            overflow: 'hidden',
          }}>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer' }}
              onClick={() => toggleStage(stageKey)}
            >
              {s.is_current ? (
                <span style={{
                  width: 10, height: 10, borderRadius: '50%',
                  background: color,
                  boxShadow: `0 0 0 3px ${color}30`,
                  flexShrink: 0,
                }} />
              ) : (
                <span style={{ color: colors.green, fontSize: 12, flexShrink: 0 }}>✓</span>
              )}
              <span style={{ flex: 1, fontSize: 13, fontWeight: s.is_current ? 600 : 400, color: colors.text }}>
                {stageName}
              </span>
              <span style={{ fontSize: 12, color: colors.textMuted, fontFamily: fonts.mono }}>
                {s.duration_days !== null ? `${formatDays(s.duration_days)}${s.is_current ? ' and counting' : ''}` : '—'}
              </span>
              {signalDot(s.signal)}
              <span style={{ fontSize: 11, color: colors.textMuted }}>{expanded ? '▲' : '▼'}</span>
            </div>

            {expanded && (
              <div style={{ padding: '0 14px 14px', borderTop: `1px solid ${colors.border}` }}>
                <div style={{ fontSize: 12, color: colors.textSecondary, margin: '10px 0 12px' }}>
                  {s.explanation}
                  {s.countdown_days !== null && s.countdown_days > 0 && (
                    <span style={{ color: colors.orange, fontWeight: 600 }}>
                      {' '}· Crosses lost-deal threshold in ~{s.countdown_days}d.
                    </span>
                  )}
                </div>

                {(wonMedian !== null || lostMedian !== null) && s.duration_days !== null && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {[
                      { label: 'This deal', days: s.duration_days, color },
                      { label: 'Won avg', days: wonMedian, color: colors.green },
                      { label: 'Lost avg', days: lostMedian, color: colors.red },
                    ].map(bar => bar.days !== null && (
                      <div key={bar.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11, color: colors.textMuted, width: 60, flexShrink: 0 }}>{bar.label}</span>
                        <div style={{ flex: 1, background: colors.border, borderRadius: 4, height: 6, overflow: 'hidden' }}>
                          <div style={{
                            width: `${Math.min(100, (bar.days / maxDays) * 100)}%`,
                            background: bar.color,
                            height: '100%',
                            borderRadius: 4,
                          }} />
                        </div>
                        <span style={{ fontSize: 11, color: colors.textMuted, width: 32, flexShrink: 0, textAlign: 'right', fontFamily: fonts.mono }}>{formatDays(bar.days)}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: 10,
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: confidenceTier === 'high' ? colors.greenSoft : confidenceTier === 'directional' ? colors.yellowSoft : colors.surfaceHover,
                    color: confidenceTier === 'high' ? colors.green : confidenceTier === 'directional' ? colors.yellow : colors.textMuted,
                  }}>
                    {confidenceTier === 'high' ? `High confidence · ${sampleSize} won deals`
                      : confidenceTier === 'directional' ? `Directional · ${sampleSize} deals`
                      : 'Insufficient data'}
                  </span>
                  {isInverted && (
                    <span style={{
                      fontSize: 10,
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: colors.purpleSoft,
                      color: colors.purple,
                    }}>
                      ⚠ Won deals spend longer here
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ParticipantsContent({
  participants,
  contactsAbsent,
  anon,
}: {
  participants: ResolvedParticipant[];
  contactsAbsent: ConversationDossier['contacts_absent'];
  anon: ReturnType<typeof useDemoMode>['anon'];
}) {
  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {participants.map((p, i) => {
          const isInternal = p.role === 'internal';
          const bg = isInternal ? colors.accent : colors.orange;
          const displayName = anon.person(p.name);
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: bg + '25',
                border: `2px solid ${bg}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                fontWeight: 700,
                color: bg,
                fontFamily: fonts.mono,
                flexShrink: 0,
              }}>
                {getInitials(displayName)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>{displayName}</div>
                {p.email && <div style={{ fontSize: 11, color: colors.textMuted }}>{anon.email(p.email)}</div>}
              </div>
              <span style={{
                fontSize: 10,
                fontWeight: 600,
                padding: '2px 7px',
                borderRadius: 4,
                background: isInternal ? colors.accentSoft : colors.orange + '20',
                color: isInternal ? colors.accent : colors.orange,
              }}>
                {p.role === 'internal' ? 'Internal' : p.role === 'external' ? 'External' : 'Unknown'}
              </span>
            </div>
          );
        })}
      </div>

      {contactsAbsent.length > 0 && (
        <>
          <div style={{ borderTop: `1px solid ${colors.border}`, margin: '16px 0' }} />
          <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, marginBottom: 10 }}>
            Not on this call
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {contactsAbsent.map(contact => {
              const displayContactName = anon.person(contact.name);
              return (
              <div key={contact.email} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: colors.surfaceHover,
                  border: `2px dashed ${colors.border}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  color: colors.textMuted,
                  flexShrink: 0,
                }}>
                  {getInitials(displayContactName)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: colors.textSecondary }}>{displayContactName}</div>
                  {contact.title && <div style={{ fontSize: 11, color: colors.textMuted }}>{contact.title}</div>}
                </div>
                {contact.buying_role && (
                  <span style={{ fontSize: 10, color: colors.accent, fontWeight: 600 }}>{contact.buying_role}</span>
                )}
                {contact.last_conversation_date && (
                  <span style={{ fontSize: 10, color: colors.textMuted }}>
                    Last: {formatTimeAgo(contact.last_conversation_date)}
                  </span>
                )}
              </div>
            )})}
          </div>
        </>
      )}
    </div>
  );
}

function SkillFindingsContent({ findings }: { findings: ConversationDossier['skill_findings'] }) {
  const severityStyle = (severity: string) => {
    switch (severity) {
      case 'critical': return { color: colors.red, bg: colors.redSoft };
      case 'high': return { color: colors.orange, bg: colors.orange + '15' };
      case 'medium': return { color: colors.yellow, bg: colors.yellowSoft };
      default: return { color: colors.accent, bg: colors.accentSoft };
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {findings.map((f, i) => {
        const s = severityStyle(f.severity);
        return (
          <div key={i} style={{
            background: colors.surfaceHover,
            borderRadius: 6,
            padding: 12,
            borderLeft: `3px solid ${s.color}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{
                fontSize: 10,
                fontWeight: 700,
                padding: '2px 6px',
                borderRadius: 4,
                background: s.bg,
                color: s.color,
                textTransform: 'uppercase',
              }}>
                {f.severity}
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: colors.text }}>
                {f.skill_id.replace(/_/g, ' ')}
              </span>
              <span style={{ fontSize: 10, color: colors.textMuted, marginLeft: 'auto' }}>
                {formatTimeAgo(f.found_at)}
              </span>
            </div>
            <div style={{ fontSize: 12, color: colors.textSecondary, lineHeight: 1.5 }}>
              {f.message}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CallMetricsContent({ metrics }: { metrics: CallMetrics }) {
  const items = [
    metrics.talk_ratio_rep !== null && { label: 'Rep Talk Time', value: `${metrics.talk_ratio_rep}%` },
    metrics.talk_ratio_buyer !== null && { label: 'Buyer Talk Time', value: `${metrics.talk_ratio_buyer}%` },
    { label: 'Internal Speakers', value: `${metrics.speaker_count_internal}` },
    { label: 'External Speakers', value: `${metrics.speaker_count_external}` },
    metrics.question_count !== null && { label: 'Questions Asked', value: `${metrics.question_count}` },
    metrics.longest_monologue_seconds !== null && {
      label: 'Longest Monologue',
      value: `${Math.round(metrics.longest_monologue_seconds / 60)}min`,
    },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
      {items.map((item, i) => (
        <div key={i}>
          <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 4 }}>{item.label}</div>
          <div style={{ fontSize: 22, fontWeight: 700, fontFamily: fonts.mono, color: colors.text }}>{item.value}</div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Shared micro-components
// ============================================================================

function ChecklistItem({ label, checked }: { label: string; checked: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{
        width: 18,
        height: 18,
        borderRadius: 4,
        background: checked ? colors.green : colors.surfaceHover,
        border: `1px solid ${checked ? colors.green : colors.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        {checked && <span style={{ color: '#fff', fontSize: 12 }}>✓</span>}
      </div>
      <span style={{ fontSize: 13, color: checked ? colors.text : colors.textMuted }}>
        {label}
      </span>
    </div>
  );
}
