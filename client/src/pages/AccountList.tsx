import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { formatCurrency, formatTimeAgo } from '../lib/format';
import Skeleton from '../components/Skeleton';
import { useDemoMode } from '../contexts/DemoModeContext';
import { useIsMobile } from '../hooks/useIsMobile';
import { buildAccountCrmUrl, useCrmInfo } from '../lib/deeplinks';
import { useLens } from '../contexts/LensContext';
import { AccountSignalsTimeline } from '../components/account';
import { Icon } from '../components/icons';

const PAGE_SIZE = 50;

// ============================================================================
// Scoring State Types + Hook
// ============================================================================

type ScoringStateValue = 'locked' | 'ready' | 'processing' | 'active';

interface ScoringStatePoll {
  state: ScoringStateValue;
  processingStep: string | null;
  accountsScored: number;
  accountsTotal: number;
}

function useScoringState(): {
  scoringState: ScoringStatePoll | null;
  activating: boolean;
  activateScoring: () => Promise<void>;
  refreshIcp: () => Promise<void>;
} {
  const [scoringState, setScoringState] = useState<ScoringStatePoll | null>(null);
  const [activating, setActivating] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchState = useCallback(async () => {
    try {
      const data = await api.get('/scoring/state/poll');
      setScoringState(data as ScoringStatePoll);
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    fetchState();
    // Poll every 5s during processing, every 60s otherwise
    const schedule = () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        await fetchState();
      }, 5000);
    };
    schedule();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchState]);

  // Slow down polling when not processing
  useEffect(() => {
    if (!scoringState) return;
    if (pollRef.current) clearInterval(pollRef.current);
    const interval = scoringState.state === 'processing' ? 5000 : 60000;
    pollRef.current = setInterval(fetchState, interval);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [scoringState?.state, fetchState]);

  const activateScoring = useCallback(async () => {
    setActivating(true);
    try {
      await api.post('/scoring/activate', {});
      await fetchState();
    } finally {
      setActivating(false);
    }
  }, [fetchState]);

  const refreshIcp = useCallback(async () => {
    setActivating(true);
    try {
      await api.post('/scoring/refresh-icp', {});
      await fetchState();
    } finally {
      setActivating(false);
    }
  }, [fetchState]);

  return { scoringState, activating, activateScoring, refreshIcp };
}

// ============================================================================
// Scoring State Banners
// ============================================================================

function ScoringLockedBanner() {
  return (
    <div style={{
      background: '#fefce8', border: '1px solid #fde68a', borderRadius: 10, padding: '14px 20px',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <Icon name="filter" size={18} style={{ filter: 'brightness(0) saturate(100%) invert(26%) sepia(45%) saturate(1850%) hue-rotate(358deg) brightness(93%) contrast(93%)' }} />
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#92400e' }}>Account Scoring Locked</div>
        <div style={{ fontSize: 12, color: '#a16207', marginTop: 2 }}>
          Connect your CRM and close at least 5 deals to unlock ICP-based account scoring.
        </div>
      </div>
    </div>
  );
}

function ScoringReadyBanner({ onActivate, activating }: { onActivate: () => void; activating: boolean }) {
  return (
    <div style={{
      background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '14px 20px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Icon name="lightbulb" size={18} style={{ filter: 'brightness(0) saturate(100%) invert(29%) sepia(52%) saturate(1841%) hue-rotate(102deg) brightness(95%) contrast(88%)' }} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#166534' }}>Account Scoring Ready</div>
          <div style={{ fontSize: 12, color: '#15803d', marginTop: 2 }}>
            You have enough closed deals. Activate ICP Discovery to start scoring your accounts.
          </div>
        </div>
      </div>
      <button
        onClick={onActivate}
        disabled={activating}
        style={{
          fontSize: 12, padding: '8px 18px', borderRadius: 6, cursor: activating ? 'default' : 'pointer',
          background: '#16a34a', color: '#fff', border: 'none', fontWeight: 600,
          opacity: activating ? 0.7 : 1, whiteSpace: 'nowrap', flexShrink: 0,
        }}
      >
        {activating ? 'Starting...' : 'Activate Scoring'}
      </button>
    </div>
  );
}

function ScoringProcessingBanner({ step, scored, total }: { step: string | null; scored: number; total: number }) {
  const stepLabel: Record<string, string> = {
    icp_discovery: 'Analyzing closed deals to build your ICP...',
    enriching: 'Enriching account data...',
    scoring: 'Scoring accounts...',
  };
  const label = step ? (stepLabel[step] || step) : 'Processing...';
  const pct = total > 0 ? Math.round((scored / total) * 100) : 0;

  return (
    <div style={{
      background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '14px 20px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icon name="refresh" size={18} style={{ filter: 'brightness(0) saturate(100%) invert(25%) sepia(67%) saturate(2709%) hue-rotate(211deg) brightness(96%) contrast(91%)' }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#1e40af' }}>Scoring in Progress</div>
          <div style={{ fontSize: 12, color: '#2563eb', marginTop: 2 }}>{label}</div>
        </div>
        {total > 0 && (
          <span style={{ fontSize: 12, color: '#2563eb', whiteSpace: 'nowrap' }}>
            {scored}/{total} accounts
          </span>
        )}
      </div>
      {total > 0 && (
        <div style={{ marginTop: 10, height: 4, background: '#dbeafe', borderRadius: 2 }}>
          <div style={{ width: `${pct}%`, height: '100%', background: '#2563eb', borderRadius: 2, transition: 'width 0.5s ease' }} />
        </div>
      )}
    </div>
  );
}

function ScoringActiveBanner({ onRefresh, activating }: { onRefresh: () => void; activating: boolean }) {
  return (
    <div style={{
      background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10,
      padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, color: '#16a34a' }}>●</span>
        <span style={{ fontSize: 12, color: colors.textSecondary }}>ICP-based scoring active</span>
      </div>
      <button
        onClick={onRefresh}
        disabled={activating}
        style={{
          fontSize: 11, padding: '4px 12px', borderRadius: 4, cursor: activating ? 'default' : 'pointer',
          background: 'none', color: colors.textSecondary, border: `1px solid ${colors.border}`,
          opacity: activating ? 0.6 : 1,
        }}
      >
        {activating ? 'Refreshing...' : 'Refresh ICP'}
      </button>
    </div>
  );
}

function MultiSelectFilter({
  label,
  values,
  onChange,
  options,
  anon,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  options: { value: string; label: string }[];
  anon?: any;
}) {
  const [open, setOpen] = useState(false);
  const displayText = values.length === 0
    ? 'All'
    : values.length === 1
      ? (anon ? anon.company(values[0]) : values[0])
      : `${values.length} selected`;

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <label style={{ fontSize: 11, color: colors.textMuted, marginRight: 6 }}>{label}:</label>
      <button
        onClick={() => setOpen(!open)}
        style={{
          fontSize: 12,
          padding: '6px 24px 6px 12px',
          background: colors.surfaceRaised,
          border: `1px solid ${colors.border}`,
          borderRadius: 6,
          color: colors.text,
          cursor: 'pointer',
          position: 'relative',
          minWidth: 120,
          textAlign: 'left',
        }}
      >
        {displayText}
        <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)' }}>▼</span>
      </button>
      {open && (
        <>
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 10,
            }}
            onClick={() => setOpen(false)}
          />
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              marginTop: 4,
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              zIndex: 20,
              minWidth: 200,
              maxHeight: 300,
              overflowY: 'auto',
            }}
          >
            <div
              onClick={() => onChange([])}
              style={{
                padding: '8px 12px',
                fontSize: 12,
                cursor: 'pointer',
                borderBottom: `1px solid ${colors.border}`,
                color: values.length === 0 ? colors.accent : colors.text,
                fontWeight: values.length === 0 ? 600 : 400,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = colors.surfaceRaised)}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              All
            </div>
            {options.map((opt) => {
              const isSelected = values.includes(opt.value);
              return (
                <div
                  key={opt.value}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isSelected) {
                      onChange(values.filter(v => v !== opt.value));
                    } else {
                      onChange([...values, opt.value]);
                    }
                  }}
                  style={{
                    padding: '8px 12px',
                    fontSize: 12,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    color: colors.text,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = colors.surfaceRaised)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    readOnly
                    style={{ cursor: 'pointer' }}
                  />
                  {anon ? anon.company(opt.label) : opt.label}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

interface Signal {
  type: string;
  signal: string;
  source_url: string;
  relevance: number;
  date: string | null;
}

interface Account {
  id: string;
  name: string;
  domain: string;
  industry: string;
  open_deal_count: number;
  total_pipeline: number;
  contact_count: number;
  finding_count: number;
  last_activity: string;
  owner: string;
  // Score fields
  total_score?: number;
  grade?: string;
  score_delta?: number;
  data_confidence?: number;
  signals?: Signal[];
  signal_score?: number;
  classification_confidence?: number;
  enriched_at?: string;  // from account_signals table
  icp_fit_score?: number;  // from score_breakdown if available
  source?: string;
  source_id?: string;
}

const GRADE_COLORS: Record<string, { bg: string; text: string }> = {
  A: { bg: '#dcfce7', text: '#16a34a' },
  B: { bg: '#ccfbf1', text: '#0d9488' },
  C: { bg: '#fef9c3', text: '#ca8a04' },
  D: { bg: '#ffedd5', text: '#ea580c' },
  F: { bg: '#f3f4f6', text: '#9ca3af' },
};

function ScoreBadge({ grade, score, scoreDelta, dataConfidence, compact = false }: {
  grade?: string; score?: number; scoreDelta?: number; dataConfidence?: number; compact?: boolean;
}) {
  if (!grade) return <span style={{ color: '#9ca3af', fontSize: 12 }}>—</span>;
  const c = GRADE_COLORS[grade] || GRADE_COLORS.F;

  // Compact mode: just the letter grade badge (for table view)
  if (compact) {
    return (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: c.bg,
        color: c.text,
        fontWeight: 700,
        fontSize: 14,
        borderRadius: 6,
        width: 28,
        height: 28,
      }}>
        {grade}
      </span>
    );
  }

  // Full mode: with score, delta, warning (for drawer/detail view)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{
        background: c.bg, color: c.text, fontWeight: 700, fontSize: 13,
        borderRadius: 4, padding: '1px 7px',
      }}>{grade}</span>
      <span style={{ fontSize: 11, color: '#6b7280' }}>{score}</span>
      {scoreDelta !== undefined && scoreDelta >= 10 && (
        <span style={{ fontSize: 11, color: '#16a34a' }}>↑+{scoreDelta}</span>
      )}
      {(dataConfidence ?? 100) < 40 && (
        <span title="Limited data available" style={{ color: '#ca8a04', fontSize: 11 }}>⚠</span>
      )}
    </span>
  );
}

function SignalBadges({ signals, confidence }: { signals?: Signal[]; confidence?: number }) {
  const badges: { label: string; color: string }[] = [];
  if (signals) {
    if (signals.some(s => s.type === 'hiring')) badges.push({ label: 'Hiring', color: '#16a34a' });
    if (signals.some(s => s.type === 'funding')) badges.push({ label: 'Funded', color: '#2563eb' });
    if (signals.some(s => s.type === 'expansion')) badges.push({ label: 'Expanding', color: '#ca8a04' });
    if (signals.some(s => s.type === 'layoff')) badges.push({ label: 'Layoffs', color: '#dc2626' });
  }
  // NOTE: Removed "Limited data" badge per spec - it adds noise when 80%+ rows have it

  if (!signals && confidence === undefined) return <span style={{ fontSize: 11, color: '#9ca3af' }}>—</span>;
  if (badges.length === 0) return <span style={{ fontSize: 11, color: '#9ca3af' }}>—</span>;

  // Display inline (horizontal), max 2 visible
  const visible = badges.slice(0, 2);
  const remaining = badges.length - 2;

  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      {visible.map((b, i) => (
        <span key={i} style={{
          fontSize: 11, color: b.color, border: `1px solid ${b.color}`,
          borderRadius: 10, padding: '0px 6px', whiteSpace: 'nowrap',
        }}>{b.label}</span>
      ))}
      {remaining > 0 && (
        <span style={{ fontSize: 11, color: colors.textMuted }}>+{remaining}</span>
      )}
    </span>
  );
}

type SortField = 'name' | 'domain' | 'industry' | 'open_deals' | 'pipeline' | 'contacts' | 'last_activity' | 'score' | 'signals' | 'icp_fit';
type SortDir = 'asc' | 'desc';

export default function AccountList() {
  const navigate = useNavigate();
  const { anon } = useDemoMode();
  const isMobile = useIsMobile();
  const { activeLens } = useLens();
  const { scoringState, activating, activateScoring, refreshIcp } = useScoringState();
  const { crmInfo } = useCrmInfo();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [summary, setSummary] = useState<{ total_accounts: number; with_open_deals: number; with_conversations: number } | null>(null);

  const [search, setSearch] = useState('');
  const [industryFilter, setIndustryFilter] = useState<string[]>([]);
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [domainFilter, setDomainFilter] = useState('all');
  const [scoreFilter, setScoreFilter] = useState<string[]>([]);
  const [signalsFilter, setSignalsFilter] = useState<string[]>([]);
  const [hasOpenDealsFilter, setHasOpenDealsFilter] = useState(true); // Default to showing only accounts with open deals

  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [drawerWhy, setDrawerWhy] = useState<string | null>(null);
  const [drawerWhyLoading, setDrawerWhyLoading] = useState(false);
  const [enrichingId, setEnrichingId] = useState<string | null>(null);
  const [expandedAccountId, setExpandedAccountId] = useState<string | null>(null);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  useEffect(() => {
    fetchAccounts(true);
  }, [activeLens, hasOpenDealsFilter, search, industryFilter, scoreFilter, signalsFilter, ownerFilter, domainFilter, sortField, sortDir]);

  const fetchAccounts = async (reset = false) => {
    if (reset) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }

    try {
      const offset = reset ? 0 : accounts.length;
      const params = new URLSearchParams();
      params.set('limit', '50');
      params.set('offset', offset.toString());
      if (hasOpenDealsFilter) params.set('hasOpenDeals', 'true');
      if (search) params.set('search', search);
      if (sortField) params.set('sortBy', sortField);
      if (sortDir) params.set('sortDir', sortDir);
      // Note: industryFilter, scoreFilter, signalsFilter, ownerFilter, domainFilter are client-side only for now

      const data = await api.get(`/accounts?${params.toString()}`);
      const raw = Array.isArray(data) ? data : data.data || data.accounts || [];
      const newAccounts = raw.map((a: any) => ({
        id: a.id,
        name: a.name || '',
        domain: a.domain || '',
        industry: a.industry || '',
        open_deal_count: a.open_deal_count || a.deal_count || 0,
        total_pipeline: a.total_pipeline_value || a.total_pipeline || 0,
        contact_count: a.contact_count || 0,
        finding_count: a.finding_count || 0,
        last_activity: a.last_conversation_date || a.last_activity || a.updated_at || '',
        owner: a.owner || a.owner_email || '',
        total_score: a.total_score ?? undefined,
        grade: a.grade ?? undefined,
        score_delta: a.score_delta ?? undefined,
        data_confidence: a.data_confidence ?? undefined,
        signals: Array.isArray(a.signals) ? a.signals : undefined,
        signal_score: a.signal_score ?? undefined,
        classification_confidence: a.classification_confidence ?? undefined,
        enriched_at: a.enriched_at ?? undefined,
        icp_fit_score: a.icp_fit_score ?? undefined,
        source: a.source ?? undefined,
        source_id: a.source_id ?? undefined,
      }));

      if (reset) {
        setAccounts(newAccounts);
      } else {
        setAccounts(prev => [...prev, ...newAccounts]);
      }

      setTotalCount(data.pagination?.total ?? data.total ?? newAccounts.length);
      setHasMore(data.pagination?.has_more ?? false);
      setSummary(data.summary ?? null);
      setError('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const loadMore = () => {
    if (!loadingMore && hasMore) {
      fetchAccounts(false);
    }
  };

  const uniqueIndustries = useMemo(() =>
    Array.from(new Set(accounts.map(a => a.industry).filter(Boolean))).sort(),
  [accounts]);

  const uniqueOwners = useMemo(() =>
    Array.from(new Set(accounts.map(a => a.owner).filter(Boolean))).sort(),
  [accounts]);

  const uniqueDomains = useMemo(() =>
    Array.from(new Set(accounts.map(a => a.domain).filter(Boolean))).sort(),
  [accounts]);

  const uniqueSignalTypes = useMemo(() => {
    const types = new Set<string>();
    accounts.forEach(a => {
      if (a.signals) {
        a.signals.forEach(s => {
          if (s.type) types.add(s.type);
        });
      }
    });
    return Array.from(types).sort();
  }, [accounts]);

  const SIGNAL_LABELS: Record<string, string> = {
    hiring: 'Hiring',
    funding: 'Funded',
    expansion: 'Expanding',
    layoff: 'Layoffs',
  };

  const hasIndustryData = accounts.some(a => a.industry);
  const hasDealData = accounts.some(a => a.open_deal_count > 0);
  const hasPipelineData = accounts.some(a => a.total_pipeline > 0);
  const hasContactData = accounts.some(a => a.contact_count > 0);
  const hasActivityData = accounts.some(a => a.last_activity);

  // Client-side filtering for fields not yet supported by API
  const filtered = useMemo(() => {
    let result = accounts;

    // Industry filter - array contains check
    if (industryFilter.length > 0) {
      result = result.filter(a => industryFilter.includes(a.industry));
    }

    // Score filter - array contains check
    if (scoreFilter.length > 0) {
      result = result.filter(a => a.grade && scoreFilter.includes(a.grade));
    }

    // Signals filter - check if account has ANY of the selected signal types
    if (signalsFilter.length > 0) {
      result = result.filter(a => {
        if (!a.signals || a.signals.length === 0) return false;
        return a.signals.some(s => signalsFilter.includes(s.type));
      });
    }

    // Owner and domain filters (client-side for now)
    if (ownerFilter !== 'all') {
      result = result.filter(a => a.owner === ownerFilter);
    }
    if (domainFilter !== 'all') {
      result = result.filter(a => a.domain === domainFilter);
    }

    return result;
  }, [accounts, industryFilter, scoreFilter, signalsFilter, ownerFilter, domainFilter]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir(field === 'name' || field === 'domain' || field === 'industry' || field === 'signals' ? 'asc' : 'desc');
    }
  };

  const hasFilters = search || industryFilter.length > 0 || scoreFilter.length > 0 || signalsFilter.length > 0 || ownerFilter !== 'all' || domainFilter !== 'all' || !hasOpenDealsFilter;
  const clearFilters = () => {
    setSearch('');
    setIndustryFilter([]);
    setScoreFilter([]);
    setSignalsFilter([]);
    setOwnerFilter('all');
    setDomainFilter('all');
    setHasOpenDealsFilter(true);
  };

  // New 5-column layout: Account | Score | Signals | Activity | Pipeline
  type ColDef = { field: SortField; label: string; width: string; show: boolean };
  const scoringActive = scoringState?.state === 'active';
  const columns: ColDef[] = [
    { field: 'name', label: 'Account', width: '35%', show: true },  // Wide - includes domain below
    { field: 'score', label: 'Score', width: '10%', show: scoringActive },
    { field: 'signals', label: 'Signals', width: '20%', show: scoringActive },
    { field: 'last_activity', label: 'Activity', width: '15%', show: hasActivityData },
    { field: 'pipeline', label: 'Pipeline', width: '20%', show: hasPipelineData },
  ];
  const visibleColumns = columns.filter(c => c.show);
  const gridTemplate = visibleColumns.map(c => c.width).join(' ');

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Skeleton height={56} />
        <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: 'hidden' }}>
          <Skeleton height={40} />
          {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} height={48} />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <p style={{ fontSize: 15, color: colors.red }}>{error}</p>
        <button onClick={() => fetchAccounts()} style={{ fontSize: 12, color: colors.accent, background: 'none', border: 'none', cursor: 'pointer', marginTop: 12 }}>
          Retry
        </button>
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <p style={{ fontSize: 15, color: colors.textSecondary }}>No accounts found</p>
        <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 8 }}>Connect your CRM to see account data.</p>
        <button onClick={() => navigate('/connectors')} style={{ fontSize: 12, color: colors.accent, background: 'none', border: 'none', cursor: 'pointer', marginTop: 12 }}>
          Go to Connectors
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{
        background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: 16,
      }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, color: colors.text, margin: 0 }}>Accounts</h2>
        <p style={{ fontSize: 12, color: colors.textMuted, margin: '4px 0 0' }}>
          Showing {accounts.length} of {totalCount} accounts
          {hasOpenDealsFilter && summary && ` (${summary.with_open_deals} with open deals)`}
        </p>
      </div>

      {/* Scoring State Banners */}
      {scoringState?.state === 'locked' && <ScoringLockedBanner />}
      {scoringState?.state === 'ready' && (
        <ScoringReadyBanner onActivate={activateScoring} activating={activating} />
      )}
      {scoringState?.state === 'processing' && (
        <ScoringProcessingBanner
          step={scoringState.processingStep}
          scored={scoringState.accountsScored}
          total={scoringState.accountsTotal}
        />
      )}
      {scoringState?.state === 'active' && (
        <ScoringActiveBanner onRefresh={refreshIcp} activating={activating} />
      )}

      {/* Filter Bar - Simplified: Has Open Deals + Score + Signals */}
      <div style={{
        display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap',
        background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: '10px 16px',
      }}>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search accounts..."
          style={{
            fontSize: 12, padding: '6px 12px', width: isMobile ? '100%' : 200, minWidth: 0,
            background: colors.surfaceRaised, border: `1px solid ${colors.border}`,
            borderRadius: 6, color: colors.text, outline: 'none',
          }}
        />

        {/* Has Open Deals Toggle */}
        {summary && summary.with_open_deals > 0 && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: colors.textMuted }}>Show:</span>
            <div style={{ display: 'flex', gap: 4, background: colors.surfaceRaised, borderRadius: 6, padding: 2 }}>
              <button
                onClick={() => setHasOpenDealsFilter(true)}
                style={{
                  fontSize: 11,
                  padding: '4px 10px',
                  borderRadius: 4,
                  cursor: 'pointer',
                  border: 'none',
                  background: hasOpenDealsFilter ? colors.accent : 'transparent',
                  color: hasOpenDealsFilter ? '#fff' : colors.textSecondary,
                  fontWeight: hasOpenDealsFilter ? 600 : 400,
                  transition: 'all 0.15s',
                }}
              >
                With open deals ({summary.with_open_deals})
              </button>
              <button
                onClick={() => setHasOpenDealsFilter(false)}
                style={{
                  fontSize: 11,
                  padding: '4px 10px',
                  borderRadius: 4,
                  cursor: 'pointer',
                  border: 'none',
                  background: !hasOpenDealsFilter ? colors.accent : 'transparent',
                  color: !hasOpenDealsFilter ? '#fff' : colors.textSecondary,
                  fontWeight: !hasOpenDealsFilter ? 600 : 400,
                  transition: 'all 0.15s',
                }}
              >
                All accounts
              </button>
            </div>
          </div>
        )}

        {/* Default filters: Score + Signals */}
        {accounts.some(a => a.grade) && (
          <MultiSelectFilter
            label="Score"
            values={scoreFilter}
            onChange={setScoreFilter}
            options={[
              { value: 'A', label: 'A' },
              { value: 'B', label: 'B' },
              { value: 'C', label: 'C' },
              { value: 'D', label: 'D' },
              { value: 'F', label: 'F' },
            ]}
          />
        )}
        {uniqueSignalTypes.length > 0 && (
          <MultiSelectFilter
            label="Signals"
            values={signalsFilter}
            onChange={setSignalsFilter}
            options={uniqueSignalTypes.map(t => ({ value: t, label: SIGNAL_LABELS[t] || t }))}
          />
        )}

        {/* Advanced filters (hidden by default) */}
        {showAdvancedFilters && (
          <>
            {hasIndustryData && uniqueIndustries.length > 0 && (
              <MultiSelectFilter
                label="Industry"
                values={industryFilter}
                onChange={setIndustryFilter}
                options={uniqueIndustries.map(i => ({ value: i, label: i }))}
              />
            )}
            {uniqueDomains.length > 0 && (
              <FilterSelect label="Domain" value={domainFilter} onChange={setDomainFilter}
                options={[{ value: 'all', label: 'All' }, ...uniqueDomains.map(d => ({ value: d, label: d }))]} />
            )}
          </>
        )}

        {/* "+ Add filter" button */}
        {!showAdvancedFilters && (hasIndustryData || uniqueDomains.length > 0) && (
          <button
            onClick={() => setShowAdvancedFilters(true)}
            style={{
              fontSize: 11,
              color: colors.accent,
              background: 'none',
              border: `1px solid ${colors.border}`,
              borderRadius: 4,
              padding: '4px 10px',
              cursor: 'pointer',
            }}
          >
            + Add filter
          </button>
        )}

        {hasFilters && (
          <button onClick={clearFilters} style={{
            fontSize: 11, color: colors.accent, background: 'none', border: 'none', cursor: 'pointer',
          }}>
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div style={{
        background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, overflow: 'hidden',
      }}>
        {/* Header row — hidden on mobile */}
        {!isMobile && (
          <div style={{
            display: 'grid', gridTemplateColumns: gridTemplate,
            padding: '10px 20px', background: colors.surfaceRaised,
            borderBottom: `1px solid ${colors.border}`,
          }}>
            {visibleColumns.map(col => (
              <div
                key={col.field}
                onClick={() => handleSort(col.field)}
                style={{
                  fontSize: 10, fontWeight: 600,
                  color: sortField === col.field ? colors.accent : colors.textMuted,
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                  cursor: 'pointer', userSelect: 'none',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                {col.label}
                {sortField === col.field && (
                  <span style={{ fontSize: 8 }}>{sortDir === 'asc' ? '\u25B2' : '\u25BC'}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Data rows */}
        {filtered.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center' }}>
            <p style={{ fontSize: 13, color: colors.textMuted }}>No accounts match your filters.</p>
            <button onClick={clearFilters} style={{
              fontSize: 12, color: colors.accent, background: 'none', border: 'none', cursor: 'pointer', marginTop: 8,
            }}>
              Clear filters
            </button>
          </div>
        ) : (
          filtered.map(account => {
            const openDrawer = () => {
              if (!scoringActive) return;
              setSelectedAccount(account);
              setDrawerWhy(null);
              setDrawerWhyLoading(true);
              api.get(`/accounts/${account.id}/score/why`)
                .then((r: any) => setDrawerWhy(r.why || ''))
                .catch(() => setDrawerWhy('Unable to load analysis.'))
                .finally(() => setDrawerWhyLoading(false));
            };

            if (isMobile) {
              return (
                <div
                  key={account.id}
                  onClick={openDrawer}
                  style={{
                    padding: '12px 14px',
                    borderBottom: `1px solid ${colors.border}`,
                    cursor: 'pointer',
                  }}
                >
                  {/* Row 1: Account name + score badge */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 500, color: colors.accent, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {anon.company(account.name || 'Unnamed')}
                    </span>
                    {scoringActive && account.grade && (
                      <span style={{ flexShrink: 0 }}>
                        <ScoreBadge grade={account.grade} score={account.total_score} scoreDelta={account.score_delta} dataConfidence={account.data_confidence} />
                      </span>
                    )}
                  </div>
                  {/* Enrichment timestamp for mobile */}
                  {scoringActive && account.enriched_at && (
                    <div style={{ fontSize: 10, color: colors.textDim, marginBottom: 4 }}>
                      Enriched {formatTimeAgo(account.enriched_at)}
                    </div>
                  )}
                  {/* Row 2: domain, pipeline amount, last activity */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 12, color: colors.textSecondary }}>
                    {account.domain && (
                      <span style={{ fontFamily: fonts.mono }}>{account.domain}</span>
                    )}
                    {account.total_pipeline > 0 && (
                      <span style={{ fontFamily: fonts.mono, color: colors.text }}>{formatCurrency(anon.amount(account.total_pipeline))}</span>
                    )}
                    {account.last_activity && (
                      <span style={{ color: colors.textMuted }}>{formatTimeAgo(account.last_activity)}</span>
                    )}
                  </div>
                </div>
              );
            }

            const isExpanded = expandedAccountId === account.id;
            const crmUrl = buildAccountCrmUrl(
              crmInfo.crm,
              crmInfo.portalId || null,
              crmInfo.instanceUrl || null,
              account.source_id || null,
              account.source || null
            );

            return (
              <React.Fragment key={account.id}>
                {/* Main row */}
                <div
                  onClick={() => setExpandedAccountId(isExpanded ? null : account.id)}
                  style={{
                    display: 'grid', gridTemplateColumns: gridTemplate,
                    padding: '14px 20px',
                    borderBottom: isExpanded ? 'none' : `1px solid ${colors.border}`,
                    cursor: 'pointer', transition: 'background 0.12s',
                    alignItems: 'center',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {/* Account column: name + domain below */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 500, color: colors.accent }}>
                        {anon.company(account.name || 'Unnamed')}
                      </span>
                      {crmUrl && (
                        <a
                          href={crmUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title={`Open in ${crmInfo.crm}`}
                          style={{ color: colors.textMuted, lineHeight: 0, flexShrink: 0 }}
                        >
                          <ExternalLink size={13} />
                        </a>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: colors.textSecondary, fontFamily: fonts.mono }}>
                      {account.domain || '—'}
                    </div>
                  </div>

                  {/* Score column: badge only (compact mode) */}
                  {scoringActive && (
                    <div>
                      <ScoreBadge grade={account.grade} compact />
                    </div>
                  )}

                  {/* Signals column: inline, max 2 */}
                  {scoringActive && (
                    <div>
                      <SignalBadges signals={account.signals} confidence={account.classification_confidence} />
                    </div>
                  )}

                  {/* Activity column */}
                  {hasActivityData && (
                    <div style={{ fontSize: 12, color: colors.textMuted }}>
                      {account.last_activity ? formatTimeAgo(account.last_activity) : '—'}
                    </div>
                  )}

                  {/* Pipeline column: amount + deal count */}
                  {hasPipelineData && (
                    <div style={{ textAlign: 'right' }}>
                      {account.total_pipeline > 0 ? (
                        <>
                          <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, fontFamily: fonts.mono }}>
                            {formatCurrency(anon.amount(account.total_pipeline)).replace(',000', 'K').replace('.00', '')}
                          </div>
                          <div style={{ fontSize: 11, color: colors.textMuted }}>
                            {account.open_deal_count} {account.open_deal_count === 1 ? 'deal' : 'deals'}
                          </div>
                        </>
                      ) : (
                        <span style={{ fontSize: 12, color: colors.textMuted }}>—</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Expanded detail row */}
                {isExpanded && (
                  <div style={{
                    padding: '16px 20px',
                    background: colors.surfaceRaised,
                    borderBottom: `1px solid ${colors.border}`,
                  }}>
                    {/* 4-column grid: Score | ICP Fit | Industry | Data Quality */}
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(4, 1fr)',
                      gap: 16,
                      marginBottom: 12,
                    }}>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                          SCORE
                        </div>
                        <div style={{ fontSize: 13, color: colors.text, fontFamily: fonts.mono }}>
                          {account.total_score !== undefined ? `${account.total_score} / 100` : '—'}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                          ICP FIT
                        </div>
                        <div style={{ fontSize: 13, color: account.icp_fit_score ? colors.text : colors.textMuted }}>
                          {account.icp_fit_score !== undefined ? `${account.icp_fit_score}%` : <span style={{ fontStyle: 'italic' }}>Not scored</span>}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                          INDUSTRY
                        </div>
                        <div style={{ fontSize: 13, color: account.industry ? colors.text : colors.textMuted }}>
                          {account.industry || <span style={{ fontStyle: 'italic' }}>Unknown</span>}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                          DATA QUALITY
                        </div>
                        <div style={{ fontSize: 13 }}>
                          {(account.data_confidence ?? 100) >= 40 ? (
                            <span style={{ color: colors.green }}>Rich</span>
                          ) : (
                            <span style={{ color: colors.yellow }}>Limited</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Limited data warning */}
                    {(account.data_confidence ?? 100) < 40 && (
                      <div style={{
                        background: colors.yellowSoft,
                        border: `1px solid ${colors.yellow}`,
                        borderRadius: 6,
                        padding: '8px 12px',
                        fontSize: 12,
                        color: colors.yellow,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        flexWrap: 'wrap',
                      }}>
                        <Icon name="target" size={14} style={{ filter: 'brightness(0) saturate(100%) invert(79%) sepia(51%) saturate(1757%) hue-rotate(358deg) brightness(93%) contrast(91%)' }} />
                        <span style={{ flex: 1 }}>
                          Limited enrichment data — ICP fit and industry may be inaccurate.
                        </span>
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            setEnrichingId(account.id);
                            try {
                              await api.post(`/accounts/${account.id}/enrich`, {});
                              await fetchAccounts();
                            } catch {}
                            setEnrichingId(null);
                          }}
                          disabled={enrichingId === account.id}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: colors.accent,
                            fontSize: 12,
                            cursor: enrichingId === account.id ? 'default' : 'pointer',
                            opacity: enrichingId === account.id ? 0.6 : 1,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {enrichingId === account.id ? 'Enriching...' : 'Trigger enrichment →'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </React.Fragment>
            );
          })
        )}
      </div>

      {/* Load More Button */}
      {hasMore && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          style={{
            width: '100%',
            padding: '12px',
            fontSize: 13,
            fontWeight: 500,
            color: loadingMore ? colors.textMuted : colors.accent,
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 10,
            cursor: loadingMore ? 'default' : 'pointer',
            transition: 'all 0.15s',
            opacity: loadingMore ? 0.7 : 1,
          }}
          onMouseEnter={(e) => {
            if (!loadingMore) e.currentTarget.style.background = colors.surfaceHover;
          }}
          onMouseLeave={(e) => {
            if (!loadingMore) e.currentTarget.style.background = colors.surface;
          }}
        >
          {loadingMore ? 'Loading...' : `Load more (${totalCount - accounts.length} remaining)`}
        </button>
      )}

      {/* Score Drawer */}
      {selectedAccount && (
        <>
          {/* Overlay */}
          <div
            onClick={() => setSelectedAccount(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 100 }}
          />
          {/* Panel */}
          <div style={{
            position: 'fixed', top: 0, right: 0, bottom: 0, width: isMobile ? '100%' : 400, maxWidth: '100vw',
            background: colors.surface, borderLeft: `1px solid ${colors.border}`,
            zIndex: 101, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 16,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 600, color: colors.text, margin: 0 }}>
                  {anon.company(selectedAccount.name)}
                </h3>
                {selectedAccount.domain && (
                  <span style={{ fontSize: 11, color: colors.textMuted }}>{selectedAccount.domain}</span>
                )}
              </div>
              <button onClick={() => setSelectedAccount(null)} style={{
                background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: colors.textMuted, lineHeight: 1,
              }}>×</button>
            </div>

            {/* Score summary */}
            <div style={{ background: colors.surfaceRaised, borderRadius: 8, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <ScoreBadge grade={selectedAccount.grade} score={selectedAccount.total_score} scoreDelta={selectedAccount.score_delta} dataConfidence={selectedAccount.data_confidence} />
                {selectedAccount.total_score !== undefined && (
                  <span style={{ fontSize: 20, fontWeight: 700, color: colors.text }}>{selectedAccount.total_score}/100</span>
                )}
              </div>
              {selectedAccount.data_confidence !== undefined && (
                <div style={{ fontSize: 11, color: colors.textMuted }}>Data confidence: {selectedAccount.data_confidence}%</div>
              )}
              <div style={{ marginTop: 8 }}>
                <SignalBadges signals={selectedAccount.signals} confidence={selectedAccount.classification_confidence} />
              </div>
            </div>

            {/* Score breakdown */}
            {selectedAccount.grade && (
              <div>
                <h4 style={{ fontSize: 12, fontWeight: 600, color: colors.textSecondary, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Score Breakdown</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {[
                    { label: 'Firmographic fit', max: 30 },
                    { label: 'Signals', max: 30 },
                    { label: 'Engagement', max: 20 },
                    { label: 'Deal history', max: 15 },
                  ].map(item => (
                    <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, color: colors.textSecondary, width: 130, flexShrink: 0 }}>{item.label}</span>
                      <div style={{ flex: 1, height: 6, background: colors.border, borderRadius: 3 }}>
                        <div style={{
                          width: `${Math.min(100, ((selectedAccount.total_score || 0) / 100) * 100)}%`,
                          height: '100%', background: colors.accent, borderRadius: 3,
                        }} />
                      </div>
                      <span style={{ fontSize: 11, color: colors.textMuted, width: 40, textAlign: 'right' }}>/{item.max}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Signals */}
            {selectedAccount.signals && selectedAccount.signals.length > 0 && (
              <div>
                <h4 style={{ fontSize: 12, fontWeight: 600, color: colors.textSecondary, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Signals Detected</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {selectedAccount.signals.slice(0, 5).map((s, i) => (
                    <div key={i} style={{ fontSize: 12, color: colors.text, background: colors.surfaceRaised, borderRadius: 6, padding: '6px 10px' }}>
                      <span style={{ fontWeight: 500, textTransform: 'capitalize' }}>{s.type.replace('_', ' ')}</span>
                      {' — '}{s.signal}
                      {s.date && <span style={{ color: colors.textMuted }}> · {s.date}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Signals Timeline */}
            {selectedAccount.id && (
              <AccountSignalsTimeline
                accountId={selectedAccount.id}
                accountName={selectedAccount.name || 'Account'}
                workspaceId={api.getWorkspaceId()}
              />
            )}

            {/* Why this matters */}
            <div>
              <h4 style={{ fontSize: 12, fontWeight: 600, color: colors.textSecondary, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Why This Matters</h4>
              {drawerWhyLoading ? (
                <div style={{ fontSize: 12, color: colors.textMuted, fontStyle: 'italic' }}>Analyzing...</div>
              ) : (
                <p style={{ fontSize: 12, color: colors.text, lineHeight: 1.6, margin: 0 }}>{drawerWhy || '—'}</p>
              )}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 10, marginTop: 'auto', paddingTop: 16, borderTop: `1px solid ${colors.border}` }}>
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  setEnrichingId(selectedAccount.id);
                  try {
                    await api.post(`/accounts/${selectedAccount.id}/enrich`, {});
                    await fetchAccounts();
                  } catch {}
                  setEnrichingId(null);
                }}
                disabled={enrichingId === selectedAccount.id}
                style={{
                  fontSize: 12, padding: '7px 14px', borderRadius: 6, cursor: 'pointer',
                  background: colors.accentSoft, color: colors.accent, border: `1px solid ${colors.accent}`,
                  opacity: enrichingId === selectedAccount.id ? 0.6 : 1,
                }}
              >
                {enrichingId === selectedAccount.id ? 'Enriching...' : 'Enrich Now'}
              </button>
              <button
                onClick={() => navigate(`/accounts/${selectedAccount.id}`)}
                style={{
                  fontSize: 12, padding: '7px 14px', borderRadius: 6, cursor: 'pointer',
                  background: 'none', color: colors.textSecondary, border: `1px solid ${colors.border}`,
                }}
              >
                View Deals
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 11, color: colors.textMuted }}>{label}:</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          fontSize: 11, padding: '5px 8px', borderRadius: 4,
          background: colors.surfaceRaised, color: colors.text,
          border: `1px solid ${colors.border}`,
        }}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}
