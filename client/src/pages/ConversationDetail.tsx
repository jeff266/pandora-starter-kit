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

interface CoachingSignal {
  type: 'positive' | 'warning' | 'action';
  label: string;
  insight: string;
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

  const { conversation, deal_context, health_impact, crm_follow_through, conversation_arc, coaching_signals, contacts_absent } = dossier;

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
            {tab === 'impact' ? 'Deal Impact' : tab === 'actions' ? 'Action Tracker' : 'Coaching Signals'}
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
              callMetrics={conversation.call_metrics}
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

function DealImpactTab({
  conversation,
  healthImpact,
  crmFollowThrough,
  conversationArc,
}: {
  conversation: ConversationDossier['conversation'];
  healthImpact: ConversationDossier['health_impact'];
  crmFollowThrough: ConversationDossier['crm_follow_through'];
  conversationArc: ConversationArcEntry[];
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
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
  callMetrics,
}: {
  coachingSignals: CoachingSignal[];
  callMetrics: CallMetrics | null;
}) {
  // Check if we have pattern-based signals (vs building benchmarks message)
  const hasPatternData = coachingSignals.some(s => s.data != null);
  const patternCount = hasPatternData ? coachingSignals.filter(s => s.data).length : 0;
  const totalSampleSize = hasPatternData
    ? Math.max(...coachingSignals.filter(s => s.data).map(s => s.data!.sample_size))
    : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {hasPatternData ? (
        <div style={{ fontSize: 13, color: colors.textMuted, fontStyle: 'italic' }}>
          Compared against your closed-won deal benchmarks • Based on {totalSampleSize} closed deals
        </div>
      ) : (
        <div style={{ fontSize: 13, color: colors.textMuted, fontStyle: 'italic' }}>
          Pattern discovery analyzes your closed deals to identify what predicts winning
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
          {coachingSignals.map((signal, i) => (
            <div
              key={i}
              style={{
                background: colors.surface,
                border: `1px solid ${signal.type === 'positive' ? colors.green : signal.type === 'warning' ? colors.yellow : colors.red}`,
                borderRadius: 8,
                padding: 16,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={{
                  background: signal.type === 'positive' ? colors.greenSoft : signal.type === 'warning' ? colors.yellowSoft : colors.redSoft,
                  color: signal.type === 'positive' ? colors.green : signal.type === 'warning' ? colors.yellow : colors.red,
                  padding: '4px 8px',
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                }}>
                  {signal.type === 'positive' ? 'STRENGTH' : signal.type === 'warning' ? 'RISK' : 'ACTION NEEDED'}
                </div>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{signal.label}</span>
              </div>
              <div style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.5, marginBottom: signal.data ? 8 : 0 }}>
                {signal.insight}
              </div>
              {signal.data && (
                <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${colors.border}` }}>
                  Based on {signal.data.sample_size} deals | Pattern strength: {signal.separation_score && signal.separation_score >= 0.7 ? 'Strong' : signal.separation_score && signal.separation_score >= 0.5 ? 'Moderate' : 'Emerging'} ({signal.separation_score ? (signal.separation_score * 100).toFixed(0) + '%' : 'N/A'})
                </div>
              )}
            </div>
          ))}
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
