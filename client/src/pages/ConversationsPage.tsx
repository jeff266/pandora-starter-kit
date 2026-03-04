import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
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
  const [activeTab, setActiveTab] = useState<'needs_attention' | 'all' | 'coaching'>('needs_attention');

  // Coaching breakdown state
  interface CoachingBreakdownRow { stage: string; signal_type: string; deal_count: number; deal_value: number; display_order: number | null; }
  interface CoachingConvMeta { signal_type: string; stage: string; days_old: number; won_median: number; }
  interface AnalysisScope { scope_id: string; name: string; }
  const [coachingBreakdown, setCoachingBreakdown] = useState<CoachingBreakdownRow[]>([]);
  const [coachingConvMeta, setCoachingConvMeta] = useState<Map<string, CoachingConvMeta>>(new Map());
  const [breakdownTotalAtRisk, setBreakdownTotalAtRisk] = useState(0);
  const [breakdownTotalAtRiskCount, setBreakdownTotalAtRiskCount] = useState(0);
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const [fiscalYearStartMonth, setFiscalYearStartMonth] = useState<number | null>(null);
  const [availableScopes, setAvailableScopes] = useState<AnalysisScope[]>([]);

  // Coaching tab filters
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const [selectedSignal, setSelectedSignal] = useState<string | null>(null);
  const [selectedOwner, setSelectedOwner] = useState<string | null>(null);
  const [selectedScope, setSelectedScope] = useState<string | null>(null);
  const [selectedQuarter, setSelectedQuarter] = useState<string | null>(null);
  const [chartMode, setChartMode] = useState<'health' | 'meddic'>('health');

  // Activity signal coverage and buyer quotes for coaching tab
  type CoverageEntry = { fields_covered: number; covered_fields: string[] };
  type BuyerQuote = { id: string; signal_value: string | null; source_quote: string | null; deal_name?: string; confidence: number };
  const [coverageData, setCoverageData] = useState<Record<string, CoverageEntry>>({});
  const [buyerQuotes, setBuyerQuotes] = useState<BuyerQuote[]>([]);

  // Needs Attention filter
  const [gapOwnerFilter, setGapOwnerFilter] = useState('');

  // All Conversations filters
  const [searchQuery, setSearchQuery] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [linkedFilter, setLinkedFilter] = useState<'all' | 'linked' | 'unlinked'>('all');
  const [coachingFilter, setCoachingFilter] = useState(false);
  const [dateRangeFilter, setDateRangeFilter] = useState<'all' | '30d' | '60d' | '90d'>('all');

  // Coaching tab additional filters
  const [selectedMeddicGap, setSelectedMeddicGap] = useState<string | null>(null);
  const [coachingSort, setCoachingSort] = useState<'recent' | 'coverage_asc' | 'coverage_desc'>('recent');
  const [coachingSearch, setCoachingSearch] = useState('');

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

  // ─── Coaching breakdown fetch (re-runs when scope changes) ───────────────

  useEffect(() => {
    if (activeTab !== 'coaching' || !workspaceId) return;
    let cancelled = false;
    setBreakdownLoading(true);
    const qs = selectedScope ? `?scope_id=${encodeURIComponent(selectedScope)}` : '';
    api.get(`/conversations/coaching-breakdown${qs}`)
      .then((res: any) => {
        if (cancelled) return;
        setCoachingBreakdown(res.breakdown || []);
        setBreakdownTotalAtRisk(res.total_at_risk_value || 0);
        setBreakdownTotalAtRiskCount(res.total_at_risk_count || 0);
        if (res.fiscal_year_start_month) setFiscalYearStartMonth(res.fiscal_year_start_month);
        const meta = new Map<string, CoachingConvMeta>();
        for (const c of (res.conversations || [])) {
          meta.set(c.id, { signal_type: c.signal_type, stage: c.stage, days_old: c.days_old, won_median: c.won_median });
        }
        setCoachingConvMeta(meta);
      })
      .catch((err: any) => {
        if (cancelled) return;
        console.error('[CoachingBreakdown] fetch failed:', err);
      })
      .finally(() => { if (!cancelled) setBreakdownLoading(false); });
    return () => { cancelled = true; };
  }, [activeTab, workspaceId, selectedScope]);

  // ─── Fetch analysis scopes for pipeline filter ────────────────────────────

  useEffect(() => {
    if (activeTab !== 'coaching' || !workspaceId || availableScopes.length > 0) return;
    api.get('/admin/scopes')
      .then((data: any) => {
        const scopes: AnalysisScope[] = (data.scopes || []).map((s: any) => ({ scope_id: s.scope_id, name: s.name }));
        setAvailableScopes(scopes);
      })
      .catch(() => {});
  }, [activeTab, workspaceId]);

  // ─── Fetch MEDDIC coverage for coaching deals ─────────────────────────────

  useEffect(() => {
    if (activeTab !== 'coaching' || !workspaceId || coachingConvMeta.size === 0) return;
    const dealIds = [...new Set(
      conversations
        .filter(c => coachingConvMeta.has(c.id) && c.deal_id)
        .map(c => c.deal_id as string)
    )];
    if (dealIds.length === 0) return;
    api.post('/activity-signals/coverage', { deal_ids: dealIds })
      .then((data: any) => setCoverageData(data.coverage ?? {}))
      .catch(() => {});
  }, [activeTab, workspaceId, coachingConvMeta]);

  // ─── Fetch buyer quotes for "What Prospects Are Saying" panel ────────────

  useEffect(() => {
    if (activeTab !== 'coaching' || !workspaceId) return;
    api.get('/activity-signals?signal_type=notable_quote&speaker_type=prospect&min_confidence=0.75&limit=10')
      .then((data: any) => setBuyerQuotes(data.signals ?? []))
      .catch(() => {});
  }, [activeTab, workspaceId]);

  // ─── Server-side re-fetch when filters change ─────────────────────────────

  const fetchServerFiltered = useCallback(async (
    search: string,
    owner: string,
    stage: string,
    linked: 'all' | 'linked' | 'unlinked',
    coaching: boolean,
    dateRange: 'all' | '30d' | '60d' | '90d',
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
      if (dateRange !== 'all') {
        const days = dateRange === '30d' ? 30 : dateRange === '60d' ? 60 : 90;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        params.set('from_date', cutoff.toISOString());
      }

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
      fetchServerFiltered(searchQuery, ownerFilter, stageFilter, linkedFilter, coachingFilter, dateRangeFilter);
    }, searchQuery ? 300 : 0);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [filterMode, searchQuery, ownerFilter, stageFilter, linkedFilter, coachingFilter, dateRangeFilter, fetchServerFiltered]);

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
      if (dateRangeFilter !== 'all') {
        const days = dateRangeFilter === '30d' ? 30 : dateRangeFilter === '60d' ? 60 : 90;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        if (!c.call_date || new Date(c.call_date) < cutoff) return false;
      }
      return true;
    });
  }, [filterMode, conversations, searchQuery, ownerFilter, stageFilter, linkedFilter, coachingFilter, dateRangeFilter]);

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

  const anyFilterActive = searchQuery || ownerFilter || stageFilter || linkedFilter !== 'all' || coachingFilter || dateRangeFilter !== 'all';

  function clearAllFilters() {
    setSearchQuery('');
    setOwnerFilter('');
    setStageFilter('');
    setLinkedFilter('all');
    setCoachingFilter(false);
    setDateRangeFilter('all');
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
        <TabButton
          label="Coaching Intelligence"
          active={activeTab === 'coaching'}
          onClick={() => setActiveTab('coaching')}
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

            {/* Date range */}
            <select
              value={dateRangeFilter}
              onChange={e => setDateRangeFilter(e.target.value as 'all' | '30d' | '60d' | '90d')}
              style={selectStyle}
            >
              <option value="all">All Time</option>
              <option value="30d">Last 30 days</option>
              <option value="60d">Last 60 days</option>
              <option value="90d">Last 90 days</option>
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

      {/* ── Coaching Intelligence tab ── */}
      {activeTab === 'coaching' && (() => {
        const fmt = (v: number) =>
          v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M`
          : v >= 1_000   ? `$${Math.round(v / 1_000)}k`
          : `$${Math.round(v)}`;

        const SIGNAL_COLOR: Record<string, string> = {
          critical: '#E53E3E',
          at_risk:  '#DD6B20',
          watch:    '#D69E2E',
          healthy:  '#38A169',
        };
        const SIGNAL_LABEL: Record<string, string> = {
          critical: 'Critical',
          at_risk:  'At Risk',
          watch:    'Watch',
          healthy:  'Healthy',
        };
        const SIGNAL_BUCKETS = ['critical', 'at_risk', 'watch', 'healthy'] as const;

        const MEDDIC_FIELDS = ['metrics', 'economic_buyer', 'decision_criteria', 'decision_process', 'identify_pain', 'champion'] as const;
        const MEDDIC_COLOR: Record<string, string> = {
          metrics:           '#2B6CB0',
          economic_buyer:    '#2C7A7B',
          decision_criteria: '#276749',
          decision_process:  '#744210',
          identify_pain:     '#553C9A',
          champion:          '#97266D',
        };
        const MEDDIC_LABEL: Record<string, string> = {
          metrics:           'Metrics',
          economic_buyer:    'Economic Buyer',
          decision_criteria: 'Decision Criteria',
          decision_process:  'Decision Process',
          identify_pain:     'Identify Pain',
          champion:          'Champion',
        };

        const shortenStage = (s: string) =>
          s.replace('Discovery and Alignment', 'Discovery')
           .replace('Discovery/Qualification', 'Discovery')
           .replace('Demo Conducted', 'Demo Done')
           .replace('Demo Scheduled', 'Demo Sched.')
           .replace('Contract Sent', 'Contract');

        // Stage display order from backend breakdown data
        const stageDisplayOrder = new Map<string, number>(
          coachingBreakdown
            .filter(r => r.display_order !== null)
            .map(r => [r.stage, r.display_order as number])
        );

        // Compute fiscal quarters from fiscalYearStartMonth (prev 2, current, next 2)
        type FiscalQuarter = { label: string; start: Date; end: Date; isCurrent: boolean };
        const fiscalQuarters: FiscalQuarter[] = [];
        if (fiscalYearStartMonth !== null) {
          const now = new Date();
          const fyStart0 = fiscalYearStartMonth - 1;
          const nowM = now.getMonth();
          const nowY = now.getFullYear();
          const fyBaseYear = nowM >= fyStart0 ? nowY : nowY - 1;
          const currentQIdx = Math.floor(((nowM - fyStart0 + 12) % 12) / 3);
          for (let i = currentQIdx - 2; i <= currentQIdx + 2; i++) {
            const absQ = ((i % 4) + 4) % 4;
            const fyYearOffset = Math.floor(i / 4);
            const qFyYear = fyBaseYear + fyYearOffset;
            const startCalMonth0 = (fyStart0 + absQ * 3) % 12;
            let startCalYear = qFyYear;
            if (fyStart0 + absQ * 3 >= 12) startCalYear += 1;
            const start = new Date(startCalYear, startCalMonth0, 1);
            const end = new Date(startCalYear, startCalMonth0 + 3, 1);
            fiscalQuarters.push({ label: `Q${absQ + 1} FY${qFyYear}`, start, end, isCurrent: i === currentQIdx });
          }
        }

        // Resolve selected quarter date range (null = all time)
        const quarterRange = selectedQuarter
          ? fiscalQuarters.find(q => q.label === selectedQuarter) ?? null
          : null;

        // Conversations filtered to open deals only (via coachingConvMeta), then by selected filters
        const allCoachingConvs = conversations.filter(c => coachingConvMeta.has(c.id));
        const availableOwners = [...new Set(
          allCoachingConvs.map(c => c.deal_owner).filter(Boolean) as string[]
        )].sort();

        // Owner + quarter + MEDDIC gap subset drives the chart (stage + signal filters stay as list-only)
        const ownerFilteredConvs = allCoachingConvs.filter(c => {
          if (selectedOwner && c.deal_owner !== selectedOwner) return false;
          if (quarterRange && c.call_date) {
            const d = new Date(c.call_date);
            if (d < quarterRange.start || d >= quarterRange.end) return false;
          } else if (quarterRange && !c.call_date) {
            return false;
          }
          if (selectedMeddicGap) {
            if (selectedMeddicGap === 'none') {
              if (c.deal_id && coverageData[c.deal_id]) return false;
            } else {
              const covered = c.deal_id ? (coverageData[c.deal_id]?.covered_fields ?? []) : [];
              if (covered.includes(selectedMeddicGap)) return false;
            }
          }
          return true;
        });

        // Build health chart data — pivot by stage × signal bucket (ARR)
        type StageEntry = { critical: number; at_risk: number; watch: number; healthy: number; critical_count: number; at_risk_count: number; watch_count: number; healthy_count: number; total: number; originalStage: string };
        const stageMap = new Map<string, StageEntry>();
        for (const conv of ownerFilteredConvs) {
          const meta = coachingConvMeta.get(conv.id);
          if (!meta) continue;
          const key = shortenStage(meta.stage);
          if (!stageMap.has(key)) {
            stageMap.set(key, { critical: 0, at_risk: 0, watch: 0, healthy: 0, critical_count: 0, at_risk_count: 0, watch_count: 0, healthy_count: 0, total: 0, originalStage: meta.stage });
          }
          const entry = stageMap.get(key)!;
          const val = conv.deal_amount ?? 0;
          (entry as any)[meta.signal_type] = ((entry as any)[meta.signal_type] ?? 0) + val;
          (entry as any)[`${meta.signal_type}_count`] = ((entry as any)[`${meta.signal_type}_count`] ?? 0) + 1;
          entry.total += val;
        }
        const sortEntries = (entries: [string, { originalStage: string }][]) =>
          entries.sort((a, b) => {
            const orderA = stageDisplayOrder.get(a[1].originalStage) ?? 999;
            const orderB = stageDisplayOrder.get(b[1].originalStage) ?? 999;
            return orderA !== orderB ? orderA - orderB : a[0].localeCompare(b[0]);
          });
        const chartData = sortEntries([...stageMap.entries()])
          .map(([stage, vals]) => ({ stage, ...vals }));

        // Build MEDDIC chart data — pivot by stage × field, value = deal count with field covered
        // De-duplicate by deal_id per stage so each deal is counted once per field
        type MeddicStageEntry = { originalStage: string; [field: string]: number | string };
        const meddicStageMap = new Map<string, MeddicStageEntry>();
        const seenDealStageField = new Set<string>();
        for (const conv of ownerFilteredConvs) {
          const meta = coachingConvMeta.get(conv.id);
          if (!meta || !conv.deal_id) continue;
          const key = shortenStage(meta.stage);
          if (!meddicStageMap.has(key)) {
            const init: MeddicStageEntry = { originalStage: meta.stage };
            for (const f of MEDDIC_FIELDS) init[f] = 0;
            meddicStageMap.set(key, init);
          }
          const entry = meddicStageMap.get(key)!;
          const covered = coverageData[conv.deal_id]?.covered_fields ?? [];
          for (const field of MEDDIC_FIELDS) {
            const dedupeKey = `${conv.deal_id}|${key}|${field}`;
            if (!seenDealStageField.has(dedupeKey) && covered.includes(field)) {
              seenDealStageField.add(dedupeKey);
              (entry as any)[field] = ((entry as any)[field] as number) + 1;
            }
          }
        }
        const meddicChartData = sortEntries([...meddicStageMap.entries()])
          .map(([stage, vals]) => ({ stage, ...vals }));

        // Filtered headline numbers (used when MEDDIC gap filter is active)
        const filteredAtRiskConvs = filteredCoachingConvs.filter(c => {
          const meta = coachingConvMeta.get(c.id);
          return meta && (meta.signal_type === 'critical' || meta.signal_type === 'at_risk');
        });
        const filteredAtRiskAmt = filteredAtRiskConvs.reduce((sum, c) => sum + (c.deal_amount ?? 0), 0);
        const filteredAtRiskCount = new Set(filteredAtRiskConvs.map(c => c.deal_id).filter(Boolean)).size;
        const useFilteredHeadline = selectedMeddicGap !== null;

        const filteredCoachingConvsBase = allCoachingConvs.filter(c => {
          const meta = coachingConvMeta.get(c.id);
          if (!meta) return false;
          if (selectedStage && meta.stage !== selectedStage) return false;
          if (selectedSignal && meta.signal_type !== selectedSignal) return false;
          if (selectedOwner && c.deal_owner !== selectedOwner) return false;
          if (quarterRange && c.call_date) {
            const d = new Date(c.call_date);
            if (d < quarterRange.start || d >= quarterRange.end) return false;
          } else if (quarterRange && !c.call_date) {
            return false;
          }
          if (coachingSearch) {
            const q = coachingSearch.toLowerCase();
            const matchTitle = c.title?.toLowerCase().includes(q);
            const matchAccount = c.account_name?.toLowerCase().includes(q);
            const matchOwner = c.deal_owner?.toLowerCase().includes(q);
            if (!matchTitle && !matchAccount && !matchOwner) return false;
          }
          if (selectedMeddicGap) {
            if (selectedMeddicGap === 'none') {
              if (c.deal_id && coverageData[c.deal_id]) return false;
            } else {
              const covered = c.deal_id ? (coverageData[c.deal_id]?.covered_fields ?? []) : [];
              if (covered.includes(selectedMeddicGap)) return false;
            }
          }
          return true;
        });

        const filteredCoachingConvs = [...filteredCoachingConvsBase].sort((a, b) => {
          if (coachingSort === 'coverage_asc') {
            const aN = a.deal_id ? (coverageData[a.deal_id]?.fields_covered ?? -1) : -1;
            const bN = b.deal_id ? (coverageData[b.deal_id]?.fields_covered ?? -1) : -1;
            return aN - bN;
          }
          if (coachingSort === 'coverage_desc') {
            const aN = a.deal_id ? (coverageData[a.deal_id]?.fields_covered ?? -1) : -1;
            const bN = b.deal_id ? (coverageData[b.deal_id]?.fields_covered ?? -1) : -1;
            return bN - aN;
          }
          const aD = a.call_date ? new Date(a.call_date).getTime() : 0;
          const bD = b.call_date ? new Date(b.call_date).getTime() : 0;
          return bD - aD;
        });

        const hasFilter = selectedStage !== null || selectedSignal !== null || selectedOwner !== null || selectedQuarter !== null || selectedMeddicGap !== null || coachingSearch !== '';
        const clearAllFilters = () => { setSelectedStage(null); setSelectedSignal(null); setSelectedOwner(null); setSelectedQuarter(null); setSelectedMeddicGap(null); setCoachingSearch(''); };

        const CustomTooltip = ({ active, payload, label }: any) => {
          if (!active || !payload?.length) return null;
          const visible = payload.filter((p: any) => p.value > 0);
          return (
            <div style={{
              background: colors.surfaceRaised,
              border: `1px solid ${colors.border}`,
              borderRadius: 8,
              padding: '10px 14px',
              fontSize: 12,
              fontFamily: fonts.sans,
              minWidth: 180,
            }}>
              <div style={{ fontWeight: 600, marginBottom: 8, color: colors.text }}>{label}</div>
              {visible.map((p: any) => (
                <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 4 }}>
                  <span style={{ color: p.fill, fontWeight: 600 }}>{SIGNAL_LABEL[p.name] ?? p.name}</span>
                  <span style={{ color: colors.textSecondary }}>
                    {fmt(p.value)} · {(p.payload as any)[`${p.name}_count`] ?? 0} deal{((p.payload as any)[`${p.name}_count`] ?? 0) !== 1 ? 's' : ''}
                  </span>
                </div>
              ))}
              <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 6 }}>Click segment to filter list</div>
            </div>
          );
        };

        // Custom clickable YAxis tick
        const CustomYAxisTick = ({ x, y, payload }: any) => {
          const isSelected = selectedStage === stageMap.get(payload.value)?.originalStage;
          return (
            <text
              x={x - 6} y={y} dy={4}
              textAnchor="end"
              fill={isSelected ? colors.accent : colors.textSecondary}
              fontSize={12}
              fontFamily={fonts.sans}
              style={{ cursor: 'pointer' }}
              onClick={() => {
                const orig = stageMap.get(payload.value)?.originalStage ?? null;
                setSelectedStage(s => s === orig ? null : orig);
              }}
            >
              {payload.value}
            </text>
          );
        };

        return (
          <div>
            {breakdownLoading ? (
              <div style={{ padding: 64, textAlign: 'center', fontSize: 13, color: colors.textMuted }}>
                Loading coaching data...
              </div>
            ) : coachingBreakdown.length === 0 ? (
              <div style={{ padding: 64, textAlign: 'center', fontSize: 13, color: colors.textMuted }}>
                No coaching patterns found. Run win pattern discovery to generate signals.
              </div>
            ) : (
              <>
                {/* Summary headline */}
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: colors.text, fontFamily: fonts.sans }}>
                    {fmt(useFilteredHeadline ? filteredAtRiskAmt : breakdownTotalAtRisk)}
                    <span style={{ fontSize: 14, fontWeight: 400, color: colors.textMuted, marginLeft: 8 }}>
                      critical or at-risk · {useFilteredHeadline ? filteredAtRiskCount : breakdownTotalAtRiskCount} deal{(useFilteredHeadline ? filteredAtRiskCount : breakdownTotalAtRiskCount) !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 4, fontFamily: fonts.sans }}>
                    {useFilteredHeadline
                      ? `Filtered to deals missing ${MEDDIC_LABEL[selectedMeddicGap!] ?? selectedMeddicGap} — click a bar to further filter`
                      : 'Benchmarked against time in each stage for your own closed deals — click a bar to filter'}
                  </div>
                </div>

                {/* Unified filter bar */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 20,
                  flexWrap: 'wrap',
                  padding: '12px 14px',
                  background: colors.surfaceRaised,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 8,
                }}>
                  {/* Pipeline dropdown */}
                  {availableScopes.length > 1 && (
                    <select
                      value={selectedScope ?? ''}
                      onChange={e => { setSelectedScope(e.target.value || null); setSelectedStage(null); }}
                      style={selectStyle}
                    >
                      <option value="">All Pipelines</option>
                      {availableScopes.map(s => (
                        <option key={s.scope_id} value={s.scope_id}>{s.name}</option>
                      ))}
                    </select>
                  )}

                  {/* Quarter dropdown */}
                  {fiscalQuarters.length > 0 && (
                    <select
                      value={selectedQuarter ?? ''}
                      onChange={e => setSelectedQuarter(e.target.value || null)}
                      style={selectStyle}
                    >
                      <option value="">All Time</option>
                      {fiscalQuarters.map(q => (
                        <option key={q.label} value={q.label}>
                          {q.label}{q.isCurrent ? ' (current)' : ''}
                        </option>
                      ))}
                    </select>
                  )}

                  {/* Owner dropdown */}
                  {availableOwners.length > 0 && (
                    <select
                      value={selectedOwner ?? ''}
                      onChange={e => setSelectedOwner(e.target.value || null)}
                      style={selectStyle}
                    >
                      <option value="">All Owners</option>
                      {availableOwners.map(o => (
                        <option key={o} value={o}>{anon.person(o)}</option>
                      ))}
                    </select>
                  )}

                  {/* MEDDIC gap filter */}
                  <select
                    value={selectedMeddicGap ?? ''}
                    onChange={e => setSelectedMeddicGap(e.target.value || null)}
                    style={selectStyle}
                    title="Filter to deals missing a specific MEDDIC qualification field"
                  >
                    <option value="">Any Coverage</option>
                    <option value="metrics">Missing Metrics</option>
                    <option value="economic_buyer">Missing Economic Buyer</option>
                    <option value="decision_criteria">Missing Decision Criteria</option>
                    <option value="decision_process">Missing Decision Process</option>
                    <option value="identify_pain">Missing Identify Pain</option>
                    <option value="champion">Missing Champion</option>
                    <option value="none">No Signals Yet</option>
                  </select>

                  {/* Divider */}
                  {(availableScopes.length > 1 || fiscalQuarters.length > 0 || availableOwners.length > 0) && (
                    <div style={{ width: 1, height: 20, background: colors.border, flexShrink: 0 }} />
                  )}

                  {/* Signal pills */}
                  {SIGNAL_BUCKETS.map(sig => {
                    const active = selectedSignal === sig;
                    return (
                      <button
                        key={sig}
                        onClick={() => setSelectedSignal(v => v === sig ? null : sig)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 5,
                          padding: '4px 10px', borderRadius: 20,
                          border: `1px solid ${active ? SIGNAL_COLOR[sig] : colors.border}`,
                          background: active ? `${SIGNAL_COLOR[sig]}22` : 'transparent',
                          color: active ? SIGNAL_COLOR[sig] : colors.textMuted,
                          fontSize: 12, cursor: 'pointer', fontFamily: fonts.sans,
                          transition: 'all 0.15s',
                        }}
                      >
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: SIGNAL_COLOR[sig], display: 'inline-block' }} />
                        {SIGNAL_LABEL[sig]}
                      </button>
                    );
                  })}

                  {/* Stage badge (set by clicking chart) */}
                  {selectedStage && (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '4px 10px', borderRadius: 20, fontSize: 12,
                      background: `${colors.accent}18`, color: colors.accent,
                      border: `1px solid ${colors.accent}`, fontFamily: fonts.sans,
                    }}>
                      {shortenStage(selectedStage)}
                      <span style={{ cursor: 'pointer', marginLeft: 2, fontSize: 14, lineHeight: 1 }} onClick={() => setSelectedStage(null)}>×</span>
                    </span>
                  )}

                  {/* Clear all */}
                  {hasFilter && (
                    <button
                      onClick={clearAllFilters}
                      style={{ background: 'none', border: 'none', fontSize: 12, color: colors.accent, cursor: 'pointer', padding: 0, fontFamily: fonts.sans, marginLeft: 'auto' }}
                    >
                      Clear all
                    </button>
                  )}
                </div>

                {/* Chart */}
                <div style={{
                  background: colors.surfaceRaised,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 8,
                  padding: '20px 16px 16px',
                  marginBottom: 28,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px', flex: 1 }}>
                      Pipeline by Stage · {chartMode === 'health' ? 'Urgency' : 'MEDDIC Coverage'}
                    </div>
                    {/* View mode toggle */}
                    <div style={{ display: 'flex', borderRadius: 6, border: `1px solid ${colors.border}`, overflow: 'hidden' }}>
                      {(['health', 'meddic'] as const).map(mode => (
                        <button
                          key={mode}
                          onClick={() => setChartMode(mode)}
                          style={{
                            padding: '4px 10px', fontSize: 11, fontWeight: 600,
                            fontFamily: fonts.sans, cursor: 'pointer', border: 'none',
                            background: chartMode === mode ? colors.accent : 'transparent',
                            color: chartMode === mode ? '#fff' : colors.textMuted,
                            transition: 'all 0.15s',
                          }}
                        >
                          {mode === 'health' ? 'Health' : 'MEDDIC'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={Math.max((chartMode === 'health' ? chartData : meddicChartData).length * 52, 160)}>
                    <BarChart
                      layout="vertical"
                      data={chartMode === 'health' ? chartData : meddicChartData}
                      margin={{ top: 0, right: 20, left: 0, bottom: 0 }}
                      barCategoryGap="28%"
                    >
                      <XAxis
                        type="number"
                        tickFormatter={chartMode === 'health' ? fmt : v => String(v)}
                        tick={{ fontSize: 11, fill: colors.textMuted, fontFamily: fonts.sans }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        type="category"
                        dataKey="stage"
                        width={105}
                        tick={<CustomYAxisTick />}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip content={<CustomTooltip />} cursor={{ fill: `${colors.accent}08` }} />
                      {chartMode === 'health'
                        ? SIGNAL_BUCKETS.map((sig, i) => (
                            <Bar
                              key={sig}
                              dataKey={sig}
                              stackId="s"
                              fill={SIGNAL_COLOR[sig]}
                              fillOpacity={!selectedSignal || selectedSignal === sig ? 1 : 0.25}
                              radius={i === SIGNAL_BUCKETS.length - 1 ? [0, 4, 4, 0] : [0, 0, 0, 0]}
                              cursor="pointer"
                              onClick={(data: any) => {
                                const orig = (data as any).originalStage ?? null;
                                setSelectedStage(s => s === orig ? null : orig);
                                setSelectedSignal(v => v === sig ? null : sig);
                              }}
                            />
                          ))
                        : MEDDIC_FIELDS.map((field, i) => (
                            <Bar
                              key={field}
                              dataKey={field}
                              stackId="m"
                              fill={MEDDIC_COLOR[field]}
                              fillOpacity={1}
                              radius={i === MEDDIC_FIELDS.length - 1 ? [0, 4, 4, 0] : [0, 0, 0, 0]}
                              cursor="pointer"
                              onClick={(data: any) => {
                                const orig = (data as any).originalStage ?? null;
                                setSelectedStage(s => s === orig ? null : orig);
                                setSelectedMeddicGap(v => v === field ? null : field);
                              }}
                            />
                          ))
                      }
                    </BarChart>
                  </ResponsiveContainer>

                  {/* Dynamic color legend */}
                  <div style={{ display: 'flex', gap: 16, marginTop: 12, paddingLeft: 105, flexWrap: 'wrap' }}>
                    {chartMode === 'health'
                      ? SIGNAL_BUCKETS.map(sig => (
                          <div key={sig} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: colors.textMuted, fontFamily: fonts.sans }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: SIGNAL_COLOR[sig], display: 'inline-block' }} />
                            {SIGNAL_LABEL[sig]}
                          </div>
                        ))
                      : MEDDIC_FIELDS.map(field => (
                          <div key={field} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: colors.textMuted, fontFamily: fonts.sans }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: MEDDIC_COLOR[field], display: 'inline-block' }} />
                            {MEDDIC_LABEL[field]}
                          </div>
                        ))
                    }
                  </div>
                  {chartMode === 'meddic' && (
                    <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 8, paddingLeft: 105, fontFamily: fonts.sans }}>
                      Shows deals with each field covered. Click a segment to filter list to deals <em>missing</em> that field.
                    </div>
                  )}
                </div>

                {/* Conversation list header + search + sort */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, fontFamily: fonts.sans, marginRight: 4 }}>
                    Conversations with coaching signals
                    <span style={{ fontSize: 12, fontWeight: 400, color: colors.textMuted, marginLeft: 8 }}>
                      {filteredCoachingConvs.length}{hasFilter ? ` of ${allCoachingConvs.length}` : ''} calls
                    </span>
                  </div>
                  <div style={{ flex: 1 }} />
                  {/* Search */}
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: colors.textMuted, pointerEvents: 'none' }}>🔍</span>
                    <input
                      type="text"
                      placeholder="Search calls..."
                      value={coachingSearch}
                      onChange={e => setCoachingSearch(e.target.value)}
                      style={{
                        paddingLeft: 28, paddingRight: 10, paddingTop: 5, paddingBottom: 5,
                        fontSize: 12, border: `1px solid ${colors.border}`, borderRadius: 6,
                        background: colors.surface, color: colors.text, outline: 'none',
                        fontFamily: fonts.sans, width: 190, boxSizing: 'border-box' as const,
                      }}
                    />
                  </div>
                  {/* Sort */}
                  <select
                    value={coachingSort}
                    onChange={e => setCoachingSort(e.target.value as 'recent' | 'coverage_asc' | 'coverage_desc')}
                    style={{ ...selectStyle, fontSize: 12 }}
                  >
                    <option value="recent">Most Recent</option>
                    <option value="coverage_asc">Weakest Coverage</option>
                    <option value="coverage_desc">Strongest Coverage</option>
                  </select>
                </div>

                <div style={{
                  background: colors.surfaceRaised,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 8,
                  overflow: 'hidden',
                }}>
                  {/* Table header */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 1.2fr 1fr 1fr 90px 70px 90px',
                    gap: 12,
                    padding: '10px 16px',
                    background: colors.surface,
                    borderBottom: `1px solid ${colors.border}`,
                    fontSize: 11,
                    fontWeight: 600,
                    color: colors.textMuted,
                    textTransform: 'uppercase' as const,
                    letterSpacing: '0.5px',
                  }}>
                    <div>Title</div>
                    <div>Account</div>
                    <div>Stage</div>
                    <div>Owner</div>
                    <div>Health</div>
                    <div title="MEDDIC framework fields covered by extracted CRM activity signals">Coverage</div>
                    <div>Date</div>
                  </div>

                  {allCoachingConvs.length === 0 ? (
                    <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: colors.textMuted }}>
                      No coaching conversations loaded — visit All Conversations first.
                    </div>
                  ) : filteredCoachingConvs.length === 0 ? (
                    <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: colors.textMuted }}>
                      No conversations match the selected filters.
                      <button onClick={clearAllFilters} style={{ display: 'block', margin: '8px auto 0', background: 'none', border: 'none', fontSize: 12, color: colors.accent, cursor: 'pointer', fontFamily: fonts.sans }}>
                        Clear filters
                      </button>
                    </div>
                  ) : (
                    filteredCoachingConvs.map(conv => {
                      const meta = coachingConvMeta.get(conv.id);
                      const sigType = meta?.signal_type ?? '';
                      const cov = conv.deal_id ? coverageData[conv.deal_id] : undefined;
                      const covN = cov?.fields_covered ?? null;
                      const covColor = covN === null ? colors.textMuted
                        : covN >= 5 ? '#38A169'
                        : covN >= 3 ? '#D69E2E'
                        : '#DD6B20';
                      const covTip = cov?.covered_fields?.join(', ') ?? 'No signals extracted';
                      return (
                        <div
                          key={conv.id}
                          onClick={() => navigate(`/conversations/${conv.id}`)}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '2fr 1.2fr 1fr 1fr 90px 70px 90px',
                            gap: 12,
                            padding: '12px 16px',
                            borderBottom: `1px solid ${colors.border}`,
                            cursor: 'pointer',
                            transition: 'background 0.1s',
                          }}
                          onMouseEnter={e => (e.currentTarget.style.background = colors.surface)}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >
                          <div style={{ fontSize: 13, fontWeight: 500, color: colors.text, fontFamily: fonts.sans, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {anon.text(conv.title)}
                          </div>
                          <div style={{ fontSize: 12, color: colors.textSecondary, fontFamily: fonts.sans, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {conv.account_name ? anon.company(conv.account_name) : '—'}
                          </div>
                          <div style={{ fontSize: 12, color: colors.textSecondary, fontFamily: fonts.sans, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {conv.deal_stage ?? '—'}
                          </div>
                          <div style={{ fontSize: 12, color: colors.textSecondary, fontFamily: fonts.sans, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {conv.deal_owner ? anon.person(conv.deal_owner) : '—'}
                          </div>
                          <div>
                            {sigType && (
                              <span style={{
                                display: 'inline-block',
                                padding: '2px 7px',
                                borderRadius: 10,
                                fontSize: 11,
                                fontWeight: 600,
                                background: `${SIGNAL_COLOR[sigType] ?? colors.border}22`,
                                color: SIGNAL_COLOR[sigType] ?? colors.textMuted,
                                fontFamily: fonts.sans,
                                whiteSpace: 'nowrap',
                              }}>
                                {SIGNAL_LABEL[sigType] ?? sigType}
                              </span>
                            )}
                          </div>
                          <div title={covTip}>
                            {conv.deal_id ? (
                              <span style={{
                                display: 'inline-block',
                                padding: '2px 7px',
                                borderRadius: 10,
                                fontSize: 11,
                                fontWeight: 600,
                                background: covN !== null ? `${covColor}18` : 'transparent',
                                color: covColor,
                                fontFamily: fonts.mono,
                                whiteSpace: 'nowrap',
                              }}>
                                {covN !== null ? `${covN}/6` : '—'}
                              </span>
                            ) : <span style={{ fontSize: 12, color: colors.textMuted }}>—</span>}
                          </div>
                          <div style={{ fontSize: 12, color: colors.textMuted, fontFamily: fonts.sans, whiteSpace: 'nowrap' }}>
                            {conv.call_date ? new Date(conv.call_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            )}

            {/* What Prospects Are Saying */}
            <div style={{ marginTop: 32 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: colors.text, fontFamily: fonts.sans, marginBottom: 4 }}>
                What Prospects Are Saying
              </div>
              <div style={{ fontSize: 12, color: colors.textMuted, fontFamily: fonts.sans, marginBottom: 16 }}>
                Top verbatim quotes from buyers across pipeline deals, extracted from CRM activity notes and emails.
              </div>
              {buyerQuotes.length === 0 ? (
                <div style={{ padding: '20px 0', fontSize: 13, color: colors.textMuted, fontFamily: fonts.sans }}>
                  No prospect quotes extracted yet. Signals are extracted automatically after activities sync.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {buyerQuotes.map(q => (
                    <div key={q.id} style={{
                      padding: '14px 16px',
                      background: colors.surface,
                      border: `1px solid ${colors.border}`,
                      borderLeft: `3px solid ${colors.accent}`,
                      borderRadius: 8,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}>
                      <div style={{ fontSize: 13, color: colors.text, fontStyle: 'italic', lineHeight: 1.5 }}>
                        "{q.source_quote || q.signal_value || '—'}"
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{
                          width: 7,
                          height: 7,
                          borderRadius: '50%',
                          background: q.confidence >= 0.85 ? '#38A169' : '#D69E2E',
                          flexShrink: 0,
                        }} />
                        {(q as any).deal_name && (
                          <span style={{ fontSize: 11, color: colors.textMuted, fontFamily: fonts.sans }}>
                            {(q as any).deal_name}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })()}

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
