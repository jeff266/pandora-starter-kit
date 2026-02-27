import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { useWorkspace } from '../context/WorkspaceContext';
import LinkDealModal from '../components/LinkDealModal';
import Toast from '../components/Toast';
import { useDemoMode } from '../contexts/DemoModeContext';

const CONVERSATIONS_THRESHOLD = 500;

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
  deal_owner: string | null;
  deal_amount: number | null;
  is_internal: boolean;
  call_disposition: string | null;
  engagement_quality: string | null;
  source_type: string | null;
  signals_extracted: boolean;
  summary: string | null;
  has_transcript: boolean;
  has_coaching: boolean;
}

interface ToastItem {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
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

interface FilterOptions {
  owners: string[];
  stages: string[];
}

export default function ConversationsPage() {
  const navigate = useNavigate();
  const { currentWorkspace } = useWorkspace();
  const workspaceId = currentWorkspace?.id || '';
  const { anon } = useDemoMode();

  // Core data
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [nextActionGaps, setNextActionGaps] = useState<NextActionGap[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterMode, setFilterMode] = useState<'client' | 'server' | null>(null);
  const [totalConversations, setTotalConversations] = useState(0);

  // Tabs
  const [activeTab, setActiveTab] = useState<'needs_attention' | 'all'>('needs_attention');

  // Needs Attention filter
  const [gapOwnerFilter, setGapOwnerFilter] = useState('');

  // All Conversations filters
  const [searchQuery, setSearchQuery] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [linkedFilter, setLinkedFilter] = useState<'all' | 'linked' | 'unlinked'>('all');
  const [coachingFilter, setCoachingFilter] = useState(false);

  // Server-mode specific
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({ owners: [], stages: [] });
  const [serverLoading, setServerLoading] = useState(false);

  // UI state
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [summarizing, setSummarizing] = useState<Map<string, boolean>>(new Map());
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Initial load ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!workspaceId) return;
    const controller = new AbortController();
    initialLoad(controller.signal);
    return () => controller.abort();
  }, [workspaceId]);

  async function initialLoad(signal?: AbortSignal) {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        is_internal: 'false',
        limit: String(CONVERSATIONS_THRESHOLD),
      });

      const [convRes, gapsRes] = await Promise.all([
        api.get(`/conversations/list?${params}`, signal),
        api.get(`/conversations/next-action-gaps`, signal),
      ]);

      const total = convRes.pagination?.total ?? convRes.conversations?.length ?? 0;
      const mode: 'client' | 'server' = total <= CONVERSATIONS_THRESHOLD ? 'client' : 'server';

      setConversations(convRes.conversations || []);
      setTotalConversations(total);
      setFilterMode(mode);
      setNextActionGaps(gapsRes.gaps || []);

      // Default to "All" tab when there are no gaps
      if ((gapsRes.gaps || []).length === 0) {
        setActiveTab('all');
      }

      // Server mode: also fetch filter option values
      if (mode === 'server') {
        const opts = await api.get(`/conversations/filter-options`, signal);
        setFilterOptions({ owners: opts.owners || [], stages: opts.stages || [] });
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.error('[ConversationsPage] Failed to load:', err);
    } finally {
      setLoading(false);
    }
  }

  // ─── Server-side re-fetch when filters change ─────────────────────────────

  const fetchServerFiltered = useCallback(async (
    search: string,
    owner: string,
    stage: string,
    linked: 'all' | 'linked' | 'unlinked',
    coaching: boolean,
  ) => {
    if (filterMode !== 'server') return;
    setServerLoading(true);
    try {
      const params = new URLSearchParams({ is_internal: 'false', limit: '100' });
      if (search) params.set('search', search);
      if (owner) params.set('deal_owner', owner);
      if (stage) params.set('deal_stage', stage);
      if (linked === 'linked') params.set('has_deal', 'true');
      if (linked === 'unlinked') params.set('has_deal', 'false');
      if (coaching) params.set('has_coaching', 'true');

      const res = await api.get(`/conversations/list?${params}`);
      setConversations(res.conversations || []);
      setTotalConversations(res.pagination?.total ?? res.conversations?.length ?? 0);
    } catch (err) {
      console.error('[ConversationsPage] Server filter failed:', err);
    } finally {
      setServerLoading(false);
    }
  }, [filterMode]);

  // Trigger server fetch on filter changes (debounce search only)
  useEffect(() => {
    if (filterMode !== 'server') return;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      fetchServerFiltered(searchQuery, ownerFilter, stageFilter, linkedFilter, coachingFilter);
    }, searchQuery ? 300 : 0);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [filterMode, searchQuery, ownerFilter, stageFilter, linkedFilter, coachingFilter, fetchServerFiltered]);

  // ─── Client-side filtering ────────────────────────────────────────────────

  const filteredConversations = useMemo(() => {
    if (filterMode !== 'client') return conversations;
    return conversations.filter(c => {
      if (searchQuery && !c.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (ownerFilter && c.deal_owner !== ownerFilter) return false;
      if (stageFilter && c.deal_stage !== stageFilter) return false;
      if (linkedFilter === 'linked' && !c.deal_id) return false;
      if (linkedFilter === 'unlinked' && c.deal_id) return false;
      if (coachingFilter && !c.has_coaching) return false;
      return true;
    });
  }, [filterMode, conversations, searchQuery, ownerFilter, stageFilter, linkedFilter, coachingFilter]);

  const displayedConversations = filterMode === 'client' ? filteredConversations : conversations;

  // Derive filter option values from loaded data in client mode
  const clientOwners = useMemo(() => {
    if (filterMode !== 'client') return [];
    return [...new Set(conversations.map(c => c.deal_owner).filter(Boolean) as string[])].sort();
  }, [filterMode, conversations]);

  const clientStages = useMemo(() => {
    if (filterMode !== 'client') return [];
    return [...new Set(conversations.map(c => c.deal_stage).filter(Boolean) as string[])].sort();
  }, [filterMode, conversations]);

  const availableOwners = filterMode === 'client' ? clientOwners : filterOptions.owners;
  const availableStages = filterMode === 'client' ? clientStages : filterOptions.stages;

  // Gap owner options
  const gapOwners = useMemo(
    () => [...new Set(nextActionGaps.map(g => g.deal_owner))].sort(),
    [nextActionGaps]
  );

  const filteredGaps = useMemo(
    () => gapOwnerFilter ? nextActionGaps.filter(g => g.deal_owner === gapOwnerFilter) : nextActionGaps,
    [nextActionGaps, gapOwnerFilter]
  );

  const anyFilterActive = searchQuery || ownerFilter || stageFilter || linkedFilter !== 'all' || coachingFilter;

  function clearAllFilters() {
    setSearchQuery('');
    setOwnerFilter('');
    setStageFilter('');
    setLinkedFilter('all');
    setCoachingFilter(false);
  }

  // ─── Utility functions ────────────────────────────────────────────────────

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

  function showToast(message: string, type: 'success' | 'error' | 'info' = 'success') {
    const id = Math.random().toString(36);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  }

  // ─── Event handlers ───────────────────────────────────────────────────────

  async function handleLinkDeal(conversationId: string, dealId: string) {
    try {
      await api.post(`/conversations/${conversationId}/link`, {
        deal_id: dealId,
        link_method: 'manual',
      });
      setShowLinkModal(false);
      setSelectedConversation(null);
      initialLoad();
    } catch (err) {
      console.error('Failed to link conversation:', err);
      alert('Failed to link conversation to deal');
    }
  }

  async function handleDismissLink(conversationId: string) {
    try {
      await api.post(`/conversations/${conversationId}/link`, { action: 'dismiss' });
      setShowLinkModal(false);
      setSelectedConversation(null);
      initialLoad();
    } catch (err) {
      console.error('Failed to dismiss link:', err);
      alert('Failed to dismiss link suggestion');
    }
  }

  async function handleGenerateSummary(conversationId: string, force: boolean) {
    setSummarizing(prev => new Map(prev).set(conversationId, true));
    try {
      const url = force
        ? `/conversations/${conversationId}/summarize?force=true`
        : `/conversations/${conversationId}/summarize`;
      const res = await api.post(url);

      setConversations(prev =>
        prev.map(c => (c.id === conversationId ? { ...c, summary: res.summary } : c))
      );
      setExpandedRows(prev => new Set(prev).add(conversationId));

      if (res.deal_updated) {
        showToast('Summary generated · Deal score updated');
      } else {
        showToast('Summary generated');
      }
    } catch (err: any) {
      console.error('Failed to generate summary:', err);
      if (err.response?.status === 429) {
        showToast('Rate limit reached — try again in an hour', 'error');
      } else if (err.response?.status === 400) {
        showToast('No transcript available', 'error');
      } else {
        showToast('Failed to generate summary', 'error');
      }
    } finally {
      setSummarizing(prev => new Map(prev).set(conversationId, false));
    }
  }

  // ─── Loading state ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ padding: 24, fontFamily: fonts.sans }}>
        <div style={{ fontSize: 14, color: colors.textMuted }}>Loading conversations...</div>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: 24, fontFamily: fonts.sans, maxWidth: 1400, margin: '0 auto' }}>

      {/* Page header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: colors.text, margin: 0 }}>
          Conversations
        </h1>
      </div>

      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          gap: 0,
          borderBottom: `1px solid ${colors.border}`,
          marginBottom: 24,
        }}
      >
        <TabButton
          label="Needs Attention"
          badge={nextActionGaps.length || undefined}
          active={activeTab === 'needs_attention'}
          onClick={() => setActiveTab('needs_attention')}
        />
        <TabButton
          label="All Conversations"
          active={activeTab === 'all'}
          onClick={() => setActiveTab('all')}
        />
      </div>

      {/* ── Needs Attention tab ── */}
      {activeTab === 'needs_attention' && (
        <div>
          {nextActionGaps.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '64px 24px',
                color: colors.textMuted,
              }}
            >
              <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: colors.text, marginBottom: 6 }}>
                All deals are on track
              </div>
              <div style={{ fontSize: 13 }}>No calls are overdue for follow-up.</div>
            </div>
          ) : (
            <>
              {/* Rep filter */}
              {gapOwners.length > 1 && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                  <select
                    value={gapOwnerFilter}
                    onChange={e => setGapOwnerFilter(e.target.value)}
                    style={selectStyle}
                  >
                    <option value="">All Reps</option>
                    {gapOwners.map(o => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </div>
              )}

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
                {filteredGaps.length === 0 ? (
                  <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: colors.textMuted }}>
                    No deals match this rep filter.
                  </div>
                ) : (
                  filteredGaps.map(gap => (
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
                      onMouseEnter={e => { e.currentTarget.style.background = colors.surface; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>
                          {anon.deal(gap.deal_name)}
                        </div>
                        {gap.deal_amount != null && (
                          <div style={{ fontSize: 11, color: colors.textMuted }}>
                            ${(anon.amount(gap.deal_amount) / 1000).toFixed(0)}k
                          </div>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: colors.textSecondary }}>{anon.person(gap.deal_owner)}</div>
                      <div style={{ fontSize: 12, color: colors.textSecondary }}>{gap.deal_stage}</div>
                      <div style={{ fontSize: 12, color: colors.textSecondary }}>
                        {gap.last_call_title ? anon.text(gap.last_call_title) : formatDate(gap.last_call_date)}
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: getGapColor(gap.gap_severity),
                          textAlign: 'right',
                        }}
                      >
                        {gap.days_since_last_call}d
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── All Conversations tab ── */}
      {activeTab === 'all' && (
        <div>
          {/* Filter bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 16,
              flexWrap: 'wrap',
            }}
          >
            {/* Search */}
            <div style={{ position: 'relative', flex: '0 0 280px' }}>
              <span
                style={{
                  position: 'absolute',
                  left: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  fontSize: 13,
                  color: colors.textMuted,
                  pointerEvents: 'none',
                }}
              >
                🔍
              </span>
              <input
                type="text"
                placeholder="Search calls..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  paddingLeft: 32,
                  paddingRight: 12,
                  paddingTop: 7,
                  paddingBottom: 7,
                  fontSize: 13,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  background: colors.surface,
                  color: colors.text,
                  outline: 'none',
                  fontFamily: fonts.sans,
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Owner dropdown */}
            {availableOwners.length > 0 && (
              <select
                value={ownerFilter}
                onChange={e => setOwnerFilter(e.target.value)}
                style={selectStyle}
              >
                <option value="">All Owners</option>
                {availableOwners.map(o => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            )}

            {/* Stage dropdown */}
            {availableStages.length > 0 && (
              <select
                value={stageFilter}
                onChange={e => setStageFilter(e.target.value)}
                style={selectStyle}
              >
                <option value="">All Stages</option>
                {availableStages.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            )}

            {/* Linked status */}
            <select
              value={linkedFilter}
              onChange={e => setLinkedFilter(e.target.value as 'all' | 'linked' | 'unlinked')}
              style={selectStyle}
            >
              <option value="all">All Calls</option>
              <option value="linked">Linked to Deal</option>
              <option value="unlinked">Unlinked</option>
            </select>

            {/* Coaching filter */}
            <button
              onClick={() => setCoachingFilter(v => !v)}
              title="Show only calls with coaching patterns available"
              style={{
                padding: '4px 10px',
                fontSize: 12,
                borderRadius: 20,
                border: `1px solid ${coachingFilter ? colors.accent : colors.border}`,
                background: coachingFilter ? `${colors.accent}22` : 'transparent',
                color: coachingFilter ? colors.accent : colors.textMuted,
                cursor: 'pointer',
                fontFamily: fonts.sans,
                whiteSpace: 'nowrap',
              }}
            >
              C Coaching
            </button>

            {/* Clear + count */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto' }}>
              {anyFilterActive && (
                <button
                  onClick={clearAllFilters}
                  style={{
                    background: 'none',
                    border: 'none',
                    fontSize: 12,
                    color: colors.accent,
                    cursor: 'pointer',
                    padding: 0,
                    fontFamily: fonts.sans,
                  }}
                >
                  Clear filters
                </button>
              )}
              <span style={{ fontSize: 12, color: colors.textMuted, whiteSpace: 'nowrap' }}>
                {filterMode === 'client'
                  ? `${filteredConversations.length} of ${conversations.length}`
                  : serverLoading
                    ? 'Loading...'
                    : `${conversations.length} of ${totalConversations}`
                } conversations
              </span>
            </div>
          </div>

          {/* Conversations table */}
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
              <div>Owner</div>
              <div>Date</div>
              <div style={{ textAlign: 'right' }}>Intel</div>
            </div>

            {/* Rows */}
            {(serverLoading && filterMode === 'server') ? (
              <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: colors.textMuted }}>
                Filtering...
              </div>
            ) : displayedConversations.length === 0 ? (
              <div style={{ padding: 48, textAlign: 'center' }}>
                <div style={{ fontSize: 13, color: colors.textMuted, marginBottom: 8 }}>
                  No conversations match your filters.
                </div>
                {anyFilterActive && (
                  <button
                    onClick={clearAllFilters}
                    style={{
                      background: 'none',
                      border: 'none',
                      fontSize: 12,
                      color: colors.accent,
                      cursor: 'pointer',
                      padding: 0,
                      fontFamily: fonts.sans,
                    }}
                  >
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              displayedConversations.map(conv => {
                const isExpanded = expandedRows.has(conv.id);
                return (
                  <div key={conv.id}>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '2.5fr 1.5fr 1fr 1fr 100px 100px',
                        gap: 12,
                        padding: '12px 16px',
                        borderBottom: isExpanded ? 'none' : `1px solid ${colors.border}`,
                        cursor: 'pointer',
                        transition: 'background 0.15s',
                      }}
                      onClick={() => navigate(`/conversations/${conv.id}`)}
                      onMouseEnter={e => { e.currentTarget.style.background = colors.surface; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 2 }}>
                          {anon.text(conv.title)}
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
                        {conv.account_name ? anon.company(conv.account_name) : '—'}
                      </div>

                      <div>
                        {conv.deal_name ? (
                          <div style={{ fontSize: 12, color: colors.accent, fontWeight: 500 }}>
                            {(() => {
                              const anonName = anon.deal(conv.deal_name);
                              return anonName.length > 20 ? anonName.substring(0, 20) + '...' : anonName;
                            })()}
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
                        {conv.deal_owner
                          ? anon.person(conv.deal_owner).split(' ')[0]
                          : conv.rep_email ? anon.email(conv.rep_email).split('@')[0] : '—'}
                      </div>

                      <div style={{ fontSize: 12, color: colors.textSecondary }}>
                        {formatDate(conv.call_date)}
                      </div>

                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', alignItems: 'center' }}>
                        {conv.signals_extracted && (
                          <span
                            title="Conversation signals extracted"
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              padding: '2px 5px',
                              borderRadius: 4,
                              background: '#1e40af22',
                              color: '#60a5fa',
                              border: '1px solid #1e40af44',
                              fontFamily: fonts.sans,
                              letterSpacing: '0.3px',
                            }}
                          >S</span>
                        )}
                        {conv.has_coaching && (
                          <span
                            title="Coaching patterns available"
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              padding: '2px 5px',
                              borderRadius: 4,
                              background: `${colors.accent}22`,
                              color: colors.accent,
                              border: `1px solid ${colors.accent}44`,
                              fontFamily: fonts.sans,
                              letterSpacing: '0.3px',
                            }}
                          >C</span>
                        )}
                        {!conv.signals_extracted && !conv.has_coaching && (
                          <span style={{ fontSize: 11, color: colors.textMuted }}>—</span>
                        )}
                      </div>
                    </div>

                    {/* Expandable summary */}
                    {isExpanded && (
                      <div
                        style={{
                          padding: 16,
                          borderBottom: `1px solid ${colors.border}`,
                          background: colors.surface,
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'flex-start',
                            marginBottom: 12,
                          }}
                        >
                          <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted }}>
                            Summary
                          </div>
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              setExpandedRows(prev => {
                                const next = new Set(prev);
                                next.delete(conv.id);
                                return next;
                              });
                            }}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: colors.textMuted,
                              fontSize: 11,
                              cursor: 'pointer',
                            }}
                          >
                            Close ✕
                          </button>
                        </div>

                        {conv.summary ? (
                          <div>
                            <div
                              style={{
                                fontSize: 12,
                                color: colors.textSecondary,
                                lineHeight: 1.6,
                                marginBottom: 8,
                              }}
                            >
                              {conv.summary}
                            </div>
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                handleGenerateSummary(conv.id, true);
                              }}
                              disabled={summarizing.get(conv.id)}
                              style={{
                                fontSize: 10,
                                color: colors.textMuted,
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                padding: 0,
                              }}
                            >
                              {summarizing.get(conv.id) ? 'Regenerating...' : '↺ Regenerate'}
                            </button>
                          </div>
                        ) : conv.has_transcript ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 12, color: colors.textMuted, fontStyle: 'italic' }}>
                              No summary available
                            </span>
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                handleGenerateSummary(conv.id, false);
                              }}
                              disabled={summarizing.get(conv.id)}
                              style={{
                                fontSize: 11,
                                color: colors.accent,
                                background: 'none',
                                border: `1px solid ${colors.accent}`,
                                borderRadius: 4,
                                padding: '2px 8px',
                                cursor: 'pointer',
                              }}
                            >
                              {summarizing.get(conv.id) ? 'Generating...' : 'Generate summary →'}
                            </button>
                          </div>
                        ) : (
                          <span style={{ fontSize: 12, color: colors.textMuted, fontStyle: 'italic' }}>
                            No transcript — summary unavailable
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

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

      {/* Toast Notifications */}
      {toasts.map(toast => (
        <Toast
          key={toast.id}
          message={toast.message}
          type={toast.type}
          onClose={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
        />
      ))}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function TabButton({
  label,
  badge,
  active,
  onClick,
}: {
  label: string;
  badge?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '10px 18px',
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        color: active ? colors.accent : colors.textSecondary,
        background: 'none',
        border: 'none',
        borderBottom: active ? `2px solid ${colors.accent}` : '2px solid transparent',
        cursor: 'pointer',
        marginBottom: -1,
        fontFamily: fonts.sans,
        transition: 'color 0.15s',
      }}
    >
      {label}
      {badge != null && badge > 0 && (
        <span
          style={{
            background: colors.red,
            color: '#fff',
            borderRadius: 10,
            padding: '1px 6px',
            fontSize: 10,
            fontWeight: 700,
            lineHeight: 1.5,
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

// Shared select style
const selectStyle: React.CSSProperties = {
  padding: '7px 28px 7px 10px',
  fontSize: 13,
  border: `1px solid ${colors.border}`,
  borderRadius: 6,
  background: colors.surface,
  color: colors.text,
  cursor: 'pointer',
  outline: 'none',
  appearance: 'none',
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23888'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 10px center',
  fontFamily: 'inherit',
};
