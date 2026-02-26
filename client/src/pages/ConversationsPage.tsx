import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { useWorkspace } from '../context/WorkspaceContext';
import LinkDealModal from '../components/LinkDealModal';

interface Conversation {
  id: string;
  title: string;
  call_date: string | null;
  duration_seconds: number | null;
  rep_email: string | null;
  account_id: string | null;
  account_name: string | null;
  deal_id: string | null;
  deal_name: string | null;
  deal_stage: string | null;
  deal_amount: number | null;
  is_internal: boolean;
  call_disposition: string | null;
  engagement_quality: string | null;
  source_type: string | null;
  signals_extracted: boolean;
}

interface NextActionGap {
  deal_id: string;
  deal_name: string;
  deal_amount: number | null;
  deal_stage: string;
  deal_owner: string;
  last_call_date: string;
  days_since_last_call: number;
  last_call_title: string | null;
  last_call_id: string;
  gap_severity: 'critical' | 'warning' | 'moderate';
}

export default function ConversationsPage() {
  const navigate = useNavigate();
  const { currentWorkspace } = useWorkspace();
  const workspaceId = currentWorkspace?.id || '';
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [nextActionGaps, setNextActionGaps] = useState<NextActionGap[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'with_deals' | 'without_deals'>('all');
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    fetchData();
  }, [workspaceId, filter]);

  async function fetchData() {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filter === 'with_deals') params.set('has_deal', 'true');
      if (filter === 'without_deals') params.set('has_deal', 'false');
      params.set('is_internal', 'false');
      params.set('limit', '50');

      const [conversationsRes, gapsRes] = await Promise.all([
        api.get(`/conversations/list?${params.toString()}`),
        api.get(`/conversations/next-action-gaps`),
      ]);

      console.log('[ConversationsPage] API response:', {
        conversations: conversationsRes.conversations?.length || 0,
        gaps: gapsRes.gaps?.length || 0,
        params: params.toString(),
      });

      setConversations(conversationsRes.conversations || []);
      setNextActionGaps(gapsRes.gaps || []);
    } catch (err) {
      console.error('Failed to load conversations:', err);
      console.error('Error details:', { workspaceId, filter });
    } finally {
      setLoading(false);
    }
  }

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function formatDuration(seconds: number | null): string {
    if (!seconds) return '—';
    const mins = Math.floor(seconds / 60);
    return `${mins}m`;
  }

  function getGapColor(severity: 'critical' | 'warning' | 'moderate'): string {
    if (severity === 'critical') return colors.red;
    if (severity === 'warning') return '#eab308';
    return colors.textMuted;
  }

  async function handleLinkDeal(conversationId: string, dealId: string) {
    try {
      await api.post(`/conversations/${conversationId}/link`, {
        deal_id: dealId,
        link_method: 'manual',
      });
      setShowLinkModal(false);
      setSelectedConversation(null);
      fetchData(); // Refresh
    } catch (err) {
      console.error('Failed to link conversation:', err);
      alert('Failed to link conversation to deal');
    }
  }

  async function handleDismissLink(conversationId: string) {
    try {
      await api.post(`/conversations/${conversationId}/link`, {
        action: 'dismiss',
      });
      setShowLinkModal(false);
      setSelectedConversation(null);
      fetchData(); // Refresh
    } catch (err) {
      console.error('Failed to dismiss link:', err);
      alert('Failed to dismiss link suggestion');
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 24, fontFamily: fonts.sans }}>
        <div style={{ fontSize: 14, color: colors.textMuted }}>Loading conversations...</div>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, fontFamily: fonts.sans, maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: colors.text, margin: 0 }}>Conversations</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setFilter('all')}
            style={{
              background: filter === 'all' ? colors.accent : 'transparent',
              color: filter === 'all' ? '#fff' : colors.textSecondary,
              border: `1px solid ${filter === 'all' ? colors.accent : colors.border}`,
              borderRadius: 6,
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            All
          </button>
          <button
            onClick={() => setFilter('with_deals')}
            style={{
              background: filter === 'with_deals' ? colors.accent : 'transparent',
              color: filter === 'with_deals' ? '#fff' : colors.textSecondary,
              border: `1px solid ${filter === 'with_deals' ? colors.accent : colors.border}`,
              borderRadius: 6,
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Linked to Deals
          </button>
          <button
            onClick={() => setFilter('without_deals')}
            style={{
              background: filter === 'without_deals' ? colors.accent : 'transparent',
              color: filter === 'without_deals' ? '#fff' : colors.textSecondary,
              border: `1px solid ${filter === 'without_deals' ? colors.accent : colors.border}`,
              borderRadius: 6,
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Unlinked
          </button>
        </div>
      </div>

      {/* Needs Attention Section */}
      {nextActionGaps.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: colors.text, margin: 0 }}>
              Needs Attention
            </h2>
            <span
              style={{
                background: colors.red,
                color: '#fff',
                borderRadius: 12,
                padding: '2px 8px',
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {nextActionGaps.length}
            </span>
          </div>
          <div
            style={{
              background: colors.surfaceRaised,
              border: `1px solid ${colors.border}`,
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '2fr 1fr 1fr 1.5fr 120px',
                gap: 12,
                padding: '10px 16px',
                background: colors.surface,
                borderBottom: `1px solid ${colors.border}`,
                fontSize: 11,
                fontWeight: 600,
                color: colors.textMuted,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              <div>Deal</div>
              <div>Owner</div>
              <div>Stage</div>
              <div>Last Call</div>
              <div style={{ textAlign: 'right' }}>Days Since</div>
            </div>
            {/* Rows */}
            {nextActionGaps.map(gap => (
              <div
                key={gap.deal_id}
                onClick={() => navigate(`/deals/${gap.deal_id}`)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 1fr 1fr 1.5fr 120px',
                  gap: 12,
                  padding: '12px 16px',
                  borderBottom: `1px solid ${colors.border}`,
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = colors.surface;
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 2 }}>
                    {gap.deal_name}
                  </div>
                  {gap.deal_amount != null && (
                    <div style={{ fontSize: 11, color: colors.textMuted }}>
                      ${(gap.deal_amount / 1000).toFixed(0)}k
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 12, color: colors.textSecondary }}>{gap.deal_owner}</div>
                <div style={{ fontSize: 12, color: colors.textSecondary }}>{gap.deal_stage}</div>
                <div style={{ fontSize: 12, color: colors.textSecondary }}>
                  {gap.last_call_title || formatDate(gap.last_call_date)}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: getGapColor(gap.gap_severity),
                    textAlign: 'right',
                  }}
                >
                  {gap.days_since_last_call}d
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All Conversations Section */}
      <div>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: colors.text, marginBottom: 12 }}>
          All Conversations
        </h2>
        <div
          style={{
            background: colors.surfaceRaised,
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '2.5fr 1.5fr 1fr 1fr 100px 100px',
              gap: 12,
              padding: '10px 16px',
              background: colors.surface,
              borderBottom: `1px solid ${colors.border}`,
              fontSize: 11,
              fontWeight: 600,
              color: colors.textMuted,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            <div>Title</div>
            <div>Account</div>
            <div>Deal</div>
            <div>Rep</div>
            <div>Date</div>
            <div style={{ textAlign: 'right' }}>Duration</div>
          </div>
          {/* Rows */}
          {conversations.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: colors.textMuted }}>
              No conversations found
            </div>
          ) : (
            conversations.map(conv => (
              <div
                key={conv.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '2.5fr 1.5fr 1fr 1fr 100px 100px',
                  gap: 12,
                  padding: '12px 16px',
                  borderBottom: `1px solid ${colors.border}`,
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
                onClick={() => {
                  if (conv.deal_id) {
                    navigate(`/deals/${conv.deal_id}`);
                  }
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = colors.surface;
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 2 }}>
                    {conv.title}
                  </div>
                  {conv.call_disposition && (
                    <div
                      style={{
                        fontSize: 10,
                        color: colors.textMuted,
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                      }}
                    >
                      {conv.call_disposition}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 12, color: colors.textSecondary }}>
                  {conv.account_name || '—'}
                </div>
                <div>
                  {conv.deal_name ? (
                    <div style={{ fontSize: 12, color: colors.accent, fontWeight: 500 }}>
                      {conv.deal_name.length > 20
                        ? conv.deal_name.substring(0, 20) + '...'
                        : conv.deal_name}
                    </div>
                  ) : (
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        setSelectedConversation(conv);
                        setShowLinkModal(true);
                      }}
                      style={{
                        background: 'transparent',
                        color: colors.textMuted,
                        border: `1px dashed ${colors.border}`,
                        borderRadius: 4,
                        padding: '2px 8px',
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      Link Deal
                    </button>
                  )}
                </div>
                <div style={{ fontSize: 12, color: colors.textSecondary }}>
                  {conv.rep_email?.split('@')[0] || '—'}
                </div>
                <div style={{ fontSize: 12, color: colors.textSecondary }}>
                  {formatDate(conv.call_date)}
                </div>
                <div style={{ fontSize: 12, color: colors.textSecondary, textAlign: 'right' }}>
                  {formatDuration(conv.duration_seconds)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Link Deal Modal */}
      {showLinkModal && selectedConversation && workspaceId && (
        <LinkDealModal
          workspaceId={workspaceId}
          conversation={selectedConversation}
          onClose={() => {
            setShowLinkModal(false);
            setSelectedConversation(null);
          }}
          onLink={handleLinkDeal}
          onDismiss={handleDismissLink}
        />
      )}
    </div>
  );
}
