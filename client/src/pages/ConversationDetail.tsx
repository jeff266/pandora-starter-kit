import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ExternalLink, ChevronLeft } from 'lucide-react';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { formatCurrency, formatDate, formatTimeAgo } from '../lib/format';
import Skeleton from '../components/Skeleton';
import { useWorkspace } from '../context/WorkspaceContext';

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
  won_median: number | null;
  lost_median: number | null;
  sample_size: number;
  confidence_tier: 'high' | 'directional' | 'insufficient';
  is_inverted: boolean;
  is_current: boolean;
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

export default function ConversationDetail() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const { currentWorkspace } = useWorkspace();
  const workspaceId = currentWorkspace?.id;
  const [dossier, setDossier] = useState<ConversationDossier | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'impact' | 'actions' | 'coaching'>('impact');
  const [coachingData, setCoachingData] = useState<CoachingData | null>(null);
  const [coachingLoading, setCoachingLoading] = useState(false);

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

  // Fetch coaching data when deal context is available
  useEffect(() => {
    const dealId = dossier?.deal_context?.deal_id;
    if (!dealId || !workspaceId) return;
    setCoachingLoading(true);
    api.get(`/deals/${dealId}/coaching`)
      .then((data: CoachingData) => setCoachingData(data))
      .catch(() => setCoachingData(null))
      .finally(() => setCoachingLoading(false));
  }, [dossier?.deal_context?.deal_id, workspaceId]);

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
          onClick={() => navigate(isWorkspaceError ? '/' : -1)}
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

  const { conversation, deal_context, health_impact, crm_follow_through, conversation_arc, coaching_signals, coaching_mode, coaching_metadata, contacts_absent } = dossier;

  return (
    <div style={{ background: colors.background, minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ background: colors.surface, borderBottom: `1px solid ${colors.border}`, padding: '20px 40px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <button
            onClick={() => navigate(-1)}
            style={{
              background: 'transparent',
              border: 'none',
              color: colors.textMuted,
              cursor: 'pointer',
              padding: 4,
            }}
          >
            <ChevronLeft size={20} />
          </button>
          <h1 style={{ ...fonts.heading, fontSize: 20, margin: 0 }}>
            {conversation.title}
          </h1>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: colors.textMuted }}>
            {formatDate(conversation.started_at)} · {Math.round(conversation.duration_seconds / 60)} min
          </span>

          {/* Source badge */}
          <div style={{
            background: colors.accent + '18',
            color: colors.accent,
            padding: '4px 10px',
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 600,
          }}>
            via {conversation.source === 'gong' ? 'Gong' : conversation.source === 'fireflies' ? 'Fireflies' : conversation.source}
          </div>

          {/* Open in source */}
          {conversation.source_url && (
            <a
              href={conversation.source_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
                color: colors.accent,
                textDecoration: 'none',
              }}
            >
              Open in {conversation.source === 'gong' ? 'Gong' : 'Fireflies'} <ExternalLink size={14} />
            </a>
          )}
        </div>
      </div>

      {/* Deal Context Bar */}
      {deal_context && (
        <div style={{
          background: colors.surfaceHover,
          borderBottom: `1px solid ${colors.border}`,
          padding: '16px 40px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 4 }}>Deal</div>
              <Link
                to={`/deals/${deal_context.deal_id}`}
                style={{ fontSize: 14, fontWeight: 600, color: colors.text, textDecoration: 'none' }}
              >
                {deal_context.deal_name}
              </Link>
            </div>

            <div>
              <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 4 }}>Amount</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>
                {formatCurrency(deal_context.amount)}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 4 }}>Stage</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>
                {deal_context.stage} · {deal_context.days_in_stage}d
                {deal_context.stage_benchmark_median && (
                  <span style={{ fontSize: 12, color: colors.textMuted, fontWeight: 400 }}>
                    {' '}(median: {Math.round(deal_context.stage_benchmark_median)}d)
                  </span>
                )}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 4 }}>Close Date</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>
                {formatDate(deal_context.close_date)}
                {deal_context.close_date_pushes > 0 && (
                  <span style={{ fontSize: 12, color: colors.yellow }}> ({deal_context.close_date_pushes} pushes)</span>
                )}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 4 }}>On this call</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>
                {conversation.resolved_participants.filter(p => p.role === 'external' && p.confidence >= 0.7).length} contacts
              </div>
            </div>
          </div>
        </div>
      )}

      {/* No deal linked */}
      {!deal_context && (
        <div style={{
          background: colors.yellowSoft,
          border: `1px solid ${colors.yellow}`,
          borderRadius: 8,
          padding: 16,
          margin: '20px 40px',
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: colors.yellow, marginBottom: 8 }}>
            Unlinked conversation
          </div>
          <div style={{ fontSize: 13, color: colors.textSecondary }}>
            This conversation is not linked to a deal. Link it to unlock deal impact analysis.
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{
        display: 'flex',
        gap: 24,
        padding: '0 40px',
        borderBottom: `1px solid ${colors.border}`,
        marginTop: 20,
      }}>
        {['impact', 'actions', 'coaching'].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab as any)}
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: `2px solid ${activeTab === tab ? colors.accent : 'transparent'}`,
              color: activeTab === tab ? colors.accent : colors.textMuted,
              fontSize: 14,
              fontWeight: 600,
              padding: '12px 0',
              cursor: 'pointer',
            }}
          >
            {tab === 'impact' ? 'Deal Health' : tab === 'actions' ? 'Action Tracker' : 'Coaching Signals'}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ padding: '24px 40px', display: 'flex', gap: 24 }}>
        {/* Main content */}
        <div style={{ flex: 1 }}>
          {activeTab === 'impact' && (
            <DealImpactTab
              conversation={conversation}
              healthImpact={health_impact}
              crmFollowThrough={crm_follow_through}
              conversationArc={conversation_arc}
              coachingData={coachingData}
              coachingLoading={coachingLoading}
            />
          )}

          {activeTab === 'actions' && (
            <ActionTrackerTab
              actionItems={conversation.action_items}
              crmFollowThrough={crm_follow_through}
            />
          )}

          {activeTab === 'coaching' && (
            <CoachingSignalsTab
              coachingSignals={coaching_signals}
              coachingMode={coaching_mode}
              coachingMetadata={coaching_metadata}
              callMetrics={conversation.call_metrics}
              coachingData={coachingData}
              dealId={deal_context?.deal_id ?? null}
            />
          )}
        </div>

        {/* Sidebar: Absent contacts */}
        {deal_context && contacts_absent.length > 0 && (
          <div style={{ width: 300 }}>
            <div style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 8,
              padding: 16,
            }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
                Contacts Not on This Call
              </div>
              <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 16 }}>
                Deal contacts who were absent from this conversation
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {contacts_absent.slice(0, 5).map(contact => (
                  <div key={contact.email} style={{ paddingBottom: 12, borderBottom: `1px solid ${colors.border}` }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>
                      {contact.name}
                    </div>
                    {contact.title && (
                      <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                        {contact.title}
                      </div>
                    )}
                    {contact.buying_role && (
                      <div style={{ fontSize: 11, color: colors.accent, marginTop: 4 }}>
                        {contact.buying_role}
                      </div>
                    )}
                    {contact.last_conversation_date && (
                      <div style={{ fontSize: 10, color: colors.textMuted, marginTop: 4 }}>
                        Last on call: {formatTimeAgo(contact.last_conversation_date)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Tab Components
// ============================================================================

const SIGNAL_COLOR_MAP: Record<string, string> = {
  healthy: '#38A169',
  watch: '#D69E2E',
  at_risk: '#DD6B20',
  critical: '#E53E3E',
  premature: '#805AD5',
};

function signalDot(signal: string, size = 8) {
  return (
    <span style={{
      display: 'inline-block',
      width: size,
      height: size,
      borderRadius: '50%',
      background: SIGNAL_COLOR_MAP[signal] ?? '#94a3b8',
      flexShrink: 0,
    }} />
  );
}

function DealImpactTab({
  conversation,
  healthImpact,
  crmFollowThrough,
  conversationArc,
  coachingData,
  coachingLoading,
}: {
  conversation: ConversationDossier['conversation'];
  healthImpact: ConversationDossier['health_impact'];
  crmFollowThrough: ConversationDossier['crm_follow_through'];
  conversationArc: ConversationArcEntry[];
  coachingData: CoachingData | null;
  coachingLoading: boolean;
}) {
  const [expandedStages, setExpandedStages] = React.useState<Set<string>>(
    () => new Set(coachingData?.stage_journey.filter(s => s.is_current).map(s => s.stage) ?? [])
  );

  const toggleStage = (stage: string) => {
    setExpandedStages(prev => {
      const next = new Set(prev);
      next.has(stage) ? next.delete(stage) : next.add(stage);
      return next;
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Composite health verdict banner */}
      {coachingLoading && (
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderLeft: `4px solid ${colors.border}`,
          borderRadius: 8,
          padding: 16,
          fontSize: 13,
          color: colors.textMuted,
        }}>
          Computing stage velocity benchmarks...
        </div>
      )}
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

      {/* Stage Journey panel */}
      {!coachingLoading && coachingData && coachingData.stage_journey.length > 0 && (
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 20,
        }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, color: colors.text }}>Stage Journey</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {coachingData.stage_journey.map((s, i) => {
              const expanded = expandedStages.has(s.stage) || s.is_current;
              const color = SIGNAL_COLOR_MAP[s.signal] ?? '#94a3b8';
              const maxDays = Math.max(
                s.won_median ?? 1,
                s.lost_median ?? 1,
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
                  {/* Row header */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 14px',
                      cursor: 'pointer',
                    }}
                    onClick={() => toggleStage(s.stage)}
                  >
                    {/* Status icon */}
                    {s.is_current ? (
                      <span style={{
                        width: 10, height: 10, borderRadius: '50%',
                        background: color,
                        boxShadow: `0 0 0 3px ${color}30`,
                        flexShrink: 0,
                        animation: 'pulse 2s infinite',
                      }} />
                    ) : (
                      <span style={{ color: colors.green, fontSize: 12, flexShrink: 0 }}>✓</span>
                    )}
                    <span style={{ flex: 1, fontSize: 13, fontWeight: s.is_current ? 600 : 400, color: colors.text }}>
                      {s.stage}
                    </span>
                    <span style={{ fontSize: 12, color: colors.textMuted }}>
                      {s.duration_days !== null ? `${s.duration_days}d${s.is_current ? ' and counting' : ''}` : '—'}
                    </span>
                    {signalDot(s.signal)}
                    <span style={{ fontSize: 11, color: colors.textMuted }}>
                      {expanded ? '▲' : '▼'}
                    </span>
                  </div>

                  {/* Expanded detail */}
                  {expanded && (
                    <div style={{ padding: '0 14px 14px', borderTop: `1px solid ${colors.border}` }}>
                      <div style={{ fontSize: 12, color: colors.textSecondary, margin: '10px 0 12px' }}>
                        {s.explanation}
                        {s.countdown_days !== null && s.countdown_days > 0 && (
                          <span style={{ color: SIGNAL_COLOR_MAP.at_risk, fontWeight: 600 }}>
                            {' '}· Crosses lost-deal threshold in ~{s.countdown_days}d.
                          </span>
                        )}
                      </div>

                      {/* Comparison bars */}
                      {(s.won_median !== null || s.lost_median !== null) && s.duration_days !== null && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {[
                            { label: 'This deal', days: s.duration_days, color },
                            { label: 'Won avg', days: s.won_median, color: SIGNAL_COLOR_MAP.healthy },
                            { label: 'Lost avg', days: s.lost_median, color: SIGNAL_COLOR_MAP.critical },
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
                              <span style={{ fontSize: 11, color: colors.textMuted, width: 28, flexShrink: 0, textAlign: 'right' }}>{bar.days}d</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Confidence + inversion badges */}
                      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                        <span style={{
                          fontSize: 10,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: s.confidence_tier === 'high' ? '#38A16918' : s.confidence_tier === 'directional' ? '#D69E2E18' : '#94a3b818',
                          color: s.confidence_tier === 'high' ? '#38A169' : s.confidence_tier === 'directional' ? '#D69E2E' : '#94a3b8',
                        }}>
                          {s.confidence_tier === 'high' ? `High confidence · ${s.sample_size} won deals`
                            : s.confidence_tier === 'directional' ? `Directional · ${s.sample_size} deals`
                            : 'Insufficient data'}
                        </span>
                        {s.is_inverted && (
                          <span style={{
                            fontSize: 10,
                            padding: '2px 6px',
                            borderRadius: 4,
                            background: '#805AD518',
                            color: '#805AD5',
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
            {/* Call recency */}
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
            {/* Multi-threading */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {signalDot(coachingData.engagement.contact_count >= 3 ? 'healthy' : coachingData.engagement.contact_count >= 2 ? 'watch' : 'at_risk')}
              <span style={{ fontSize: 13, color: colors.text }}>
                {coachingData.engagement.contact_count} unique contact{coachingData.engagement.contact_count !== 1 ? 's' : ''} on calls
              </span>
            </div>
            {/* Missing stakeholders */}
            {coachingData.engagement.missing_stakeholders.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 8 }}>Missing stakeholders:</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {coachingData.engagement.missing_stakeholders.slice(0, 4).map((ms, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#E53E3E', display: 'inline-block', flexShrink: 0 }} />
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
      {/* Health impact */}
      {healthImpact && (
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 20,
        }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Deal Health Impact</div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 11, color: colors.textMuted }}>Before</div>
              <div style={{ fontSize: 20, fontWeight: 600 }}>{healthImpact.health_before?.toFixed(1) || 'N/A'}</div>
            </div>
            <div style={{ fontSize: 20, color: colors.textMuted }}>→</div>
            <div>
              <div style={{ fontSize: 11, color: colors.textMuted }}>After</div>
              <div style={{ fontSize: 20, fontWeight: 600 }}>{healthImpact.health_after?.toFixed(1) || 'N/A'}</div>
            </div>
            {healthImpact.health_delta !== null && (
              <div style={{
                background: healthImpact.health_delta >= 0 ? colors.greenSoft : colors.redSoft,
                color: healthImpact.health_delta >= 0 ? colors.green : colors.red,
                padding: '6px 12px',
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 600,
              }}>
                {healthImpact.health_delta >= 0 ? '+' : ''}{healthImpact.health_delta}
              </div>
            )}
          </div>

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
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{factor.label}</span>
                    <span style={{
                      fontSize: 12,
                      color: factor.delta >= 0 ? colors.green : colors.red,
                      fontWeight: 600,
                    }}>
                      {factor.delta >= 0 ? '+' : ''}{factor.delta}
                    </span>
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
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>CRM Gaps</div>

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
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{gap.label}</div>
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
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Conversation Timeline</div>

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
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{entry.title}</span>
                  {entry.health_delta !== null && (
                    <span style={{
                      fontSize: 12,
                      color: entry.health_delta >= 0 ? colors.green : colors.red,
                      fontWeight: 600,
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
                    {entry.summary_one_liner}
                  </div>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Summary */}
      {conversation.summary && (
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 20,
        }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Summary</div>
          <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 12, fontStyle: 'italic' }}>
            Borrowed from {conversation.source === 'gong' ? 'Gong' : 'Fireflies'} — not regenerated
          </div>
          <div style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.6 }}>
            {conversation.summary}
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
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Action items */}
      {actionItems && actionItems.length > 0 && (
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 20,
        }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Action Items</div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {actionItems.map((item, i) => (
              <div
                key={i}
                style={{
                  background: colors.surfaceHover,
                  padding: 12,
                  borderRadius: 6,
                }}
              >
                <div style={{ fontSize: 13, color: colors.text }}>{item.text || item.description || JSON.stringify(item)}</div>
                {item.owner && (
                  <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 4 }}>
                    Owner: {item.owner}
                  </div>
                )}
              </div>
            ))}
          </div>
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
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>CRM Follow-Through</div>
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

      {/* Pandora insight */}
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
  callMetrics,
  coachingData,
  dealId,
}: {
  coachingSignals: CoachingSignal[];
  coachingMode: CoachingMode;
  coachingMetadata: { won_count: number; lost_count: number; pattern_count: number };
  callMetrics: CallMetrics | null;
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

  // Check if we have pattern-based signals (vs building benchmarks message)
  const hasPatternData = coachingSignals.some(s => s.data != null);

  // Velocity gauge data
  const journey = coachingData?.stage_journey ?? [];
  const currentStage = journey.find(s => s.is_current);
  const wonMedian = currentStage?.won_median ?? null;
  const lostMedian = currentStage?.lost_median ?? null;
  const daysInStage = currentStage?.duration_days ?? null;

  // Badge configuration by mode
  function getBadgeConfig(type: string) {
    if (coachingMode === 'retrospective') {
      return {
        action: { text: 'RISK FACTOR', bg: colors.yellowSoft, color: colors.yellow, border: colors.yellow },
        positive: { text: 'WIN FACTOR', bg: colors.greenSoft, color: colors.green, border: colors.green },
        warning: { text: 'NOTABLE', bg: colors.blueSoft, color: colors.accent, border: colors.accent },
      }[type] || { text: 'NOTABLE', bg: colors.surfaceHover, color: colors.textMuted, border: colors.border };
    }

    // Active mode
    return {
      action: { text: 'ACTION NEEDED', bg: colors.redSoft, color: colors.red, border: colors.red },
      positive: { text: 'ON TRACK', bg: colors.greenSoft, color: colors.green, border: colors.green },
      warning: { text: 'WATCH', bg: colors.yellowSoft, color: colors.yellow, border: colors.yellow },
    }[type] || { text: 'INFO', bg: colors.surfaceHover, color: colors.textMuted, border: colors.border };
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* Velocity Gauge */}
      {currentStage && daysInStage !== null && (wonMedian !== null || lostMedian !== null) && (
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 20,
        }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 14, color: colors.text }}>
            Stage Velocity — {currentStage.stage}
          </div>
          {(() => {
            const maxDays = Math.max(wonMedian ?? 0, lostMedian ?? 1, daysInStage, 1) * 1.3;
            const wonPct = wonMedian !== null ? Math.min(100, (wonMedian / maxDays) * 100) : null;
            const lostPct = lostMedian !== null ? Math.min(100, (lostMedian / maxDays) * 100) : null;
            const dealPct = Math.min(100, (daysInStage / maxDays) * 100);
            const signalColor = SIGNAL_COLOR_MAP[currentStage.signal] ?? '#94a3b8';
            return (
              <>
                {/* Spectrum bar */}
                <div style={{ position: 'relative', height: 16, borderRadius: 8, background: `linear-gradient(to right, #38A169 ${wonPct ?? 40}%, #D69E2E ${wonPct ?? 40}%, #D69E2E ${lostPct ? (wonPct ?? 40) + (lostPct - (wonPct ?? 40)) / 2 : 65}%, #E53E3E ${lostPct ?? 80}%)`, marginBottom: 8 }}>
                  {/* Deal position marker */}
                  <div style={{
                    position: 'absolute',
                    left: `${dealPct}%`,
                    top: -4,
                    transform: 'translateX(-50%)',
                    width: 4,
                    height: 24,
                    background: signalColor,
                    borderRadius: 2,
                    boxShadow: `0 0 8px ${signalColor}80`,
                  }} />
                </div>
                {/* Labels */}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: colors.textMuted, marginBottom: 10 }}>
                  <span>0d</span>
                  {wonMedian !== null && <span style={{ color: '#38A169' }}>Won avg: {Math.round(wonMedian)}d</span>}
                  {lostMedian !== null && <span style={{ color: '#E53E3E' }}>Lost avg: {Math.round(lostMedian)}d</span>}
                </div>
                {/* Summary */}
                <div style={{ fontSize: 13, color: colors.textSecondary }}>
                  <strong>{daysInStage}d</strong> in {currentStage.stage}
                  {currentStage.ratio !== null && (
                    <span style={{ color: signalColor, marginLeft: 6 }}>
                      — {currentStage.ratio.toFixed(1)}× won pace
                    </span>
                  )}
                </div>
                {currentStage.countdown_days !== null && currentStage.countdown_days > 0 && (
                  <div style={{ fontSize: 12, color: SIGNAL_COLOR_MAP.at_risk, marginTop: 4 }}>
                    Crosses lost-deal threshold in ~{currentStage.countdown_days} days.
                  </div>
                )}
                {currentStage.is_inverted && (
                  <div style={{ fontSize: 12, color: '#805AD5', marginTop: 4, fontStyle: 'italic' }}>
                    ⚠ Inverted stage: winning deals spend longer here — being fast isn't good.
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* Manager Coaching Script */}
      {dealId && (
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 20,
        }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, color: colors.text }}>
            Manager Coaching Script
          </div>
          <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 14 }}>
            AI-generated script based on stage patterns, engagement signals, and action items. Adapt to your style.
          </div>

          {!script && (
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
              }}
            >
              {scriptLoading ? 'Generating…' : 'Generate Coaching Script'}
            </button>
          )}

          {scriptError && (
            <div style={{ fontSize: 12, color: colors.red, marginTop: 8 }}>{scriptError}</div>
          )}

          {script && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
        </div>
      )}

      {/* Subtitle with mode-aware messaging */}
      {coachingMode === 'retrospective' && hasPatternData && (
        <div style={{ fontSize: 13, color: colors.textMuted, fontStyle: 'italic' }}>
          What patterns showed up on this deal • Based on {coachingMetadata.won_count + coachingMetadata.lost_count} closed deals
        </div>
      )}
      {coachingMode === 'active' && hasPatternData && (
        <div style={{ fontSize: 13, color: colors.textMuted, fontStyle: 'italic' }}>
          Compared against your closed-won deal benchmarks • Based on {coachingMetadata.won_count + coachingMetadata.lost_count} closed deals
        </div>
      )}
      {!hasPatternData && (
        <div style={{ fontSize: 13, color: colors.textMuted, fontStyle: 'italic' }}>
          Pattern discovery analyzes your closed deals to identify what predicts winning
        </div>
      )}

      {/* Retrospective mode disclaimer */}
      {coachingMode === 'retrospective' && hasPatternData && (
        <div style={{
          background: colors.surfaceHover,
          border: `1px solid ${colors.border}`,
          borderRadius: 6,
          padding: 12,
          fontSize: 13,
          color: colors.textSecondary,
          fontStyle: 'italic',
        }}>
          This deal is closed. Signals below show what patterns were present — useful for coaching reviews, not current action.
        </div>
      )}

      {/* Call metrics summary */}
      {callMetrics && (
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 20,
        }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Call Metrics</div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
            {callMetrics.talk_ratio_rep !== null && (
              <div>
                <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 4 }}>Rep Talk Time</div>
                <div style={{ fontSize: 20, fontWeight: 600 }}>{callMetrics.talk_ratio_rep}%</div>
              </div>
            )}
            {callMetrics.talk_ratio_buyer !== null && (
              <div>
                <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 4 }}>Buyer Talk Time</div>
                <div style={{ fontSize: 20, fontWeight: 600 }}>{callMetrics.talk_ratio_buyer}%</div>
              </div>
            )}
            <div>
              <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 4 }}>Internal Speakers</div>
              <div style={{ fontSize: 20, fontWeight: 600 }}>{callMetrics.speaker_count_internal}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 4 }}>External Speakers</div>
              <div style={{ fontSize: 20, fontWeight: 600 }}>{callMetrics.speaker_count_external}</div>
            </div>
          </div>
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
            {callMetrics ? 'No coaching signals generated' : 'Call metrics unavailable — coaching signals require conversation metrics from Gong or Fireflies'}
          </div>
        </div>
      )}

      <div style={{ fontSize: 12, color: colors.textMuted, fontStyle: 'italic', textAlign: 'center' }}>
        These benchmarks are from YOUR pipeline data, not industry averages
      </div>
    </div>
  );
}

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
