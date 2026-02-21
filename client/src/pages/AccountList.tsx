import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { formatCurrency, formatTimeAgo } from '../lib/format';
import Skeleton from '../components/Skeleton';
import { useDemoMode } from '../contexts/DemoModeContext';
import { useIsMobile } from '../hooks/useIsMobile';

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
      <span style={{ fontSize: 16 }}>🔒</span>
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
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 16 }}>✨</span>
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
        <span style={{ fontSize: 16 }}>⏳</span>
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
      padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
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
}

const GRADE_COLORS: Record<string, { bg: string; text: string }> = {
  A: { bg: '#dcfce7', text: '#16a34a' },
  B: { bg: '#ccfbf1', text: '#0d9488' },
  C: { bg: '#fef9c3', text: '#ca8a04' },
  D: { bg: '#ffedd5', text: '#ea580c' },
  F: { bg: '#f3f4f6', text: '#9ca3af' },
};

function ScoreBadge({ grade, score, scoreDelta, dataConfidence }: {
  grade?: string; score?: number; scoreDelta?: number; dataConfidence?: number;
}) {
  if (!grade) return <span style={{ color: '#9ca3af', fontSize: 12 }}>—</span>;
  const c = GRADE_COLORS[grade] || GRADE_COLORS.F;
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
  if ((confidence ?? 100) < 40 && signals !== undefined) badges.push({ label: 'Limited data', color: '#9ca3af' });
  if (!signals && confidence === undefined) return <span style={{ fontSize: 11, color: '#9ca3af' }}>Unscored</span>;
  if (badges.length === 0) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {badges.slice(0, 3).map((b, i) => (
        <span key={i} style={{
          fontSize: 11, color: b.color, border: `1px solid ${b.color}`,
          borderRadius: 10, padding: '0px 6px', whiteSpace: 'nowrap',
        }}>{b.label}</span>
      ))}
    </span>
  );
}

type SortField = 'name' | 'domain' | 'industry' | 'open_deals' | 'pipeline' | 'contacts' | 'last_activity' | 'score' | 'signals' | 'icp_fit';
type SortDir = 'asc' | 'desc';

export default function AccountList() {
  const navigate = useNavigate();
  const { anon } = useDemoMode();
  const isMobile = useIsMobile();
  const { scoringState, activating, activateScoring, refreshIcp } = useScoringState();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [industryFilter, setIndustryFilter] = useState('all');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [domainFilter, setDomainFilter] = useState('all');
  const [scoreFilter, setScoreFilter] = useState('all');

  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(0);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [drawerWhy, setDrawerWhy] = useState<string | null>(null);
  const [drawerWhyLoading, setDrawerWhyLoading] = useState(false);
  const [enrichingId, setEnrichingId] = useState<string | null>(null);

  useEffect(() => {
    fetchAccounts();
  }, []);

  const fetchAccounts = async () => {
    setLoading(true);
    try {
      const data = await api.get('/accounts?limit=500');
      const raw = Array.isArray(data) ? data : data.data || data.accounts || [];
      setAccounts(raw.map((a: any) => ({
        id: a.id,
        name: a.name || '',
        domain: a.domain || '',
        industry: a.industry || '',
        open_deal_count: a.open_deal_count || a.deal_count || 0,
        total_pipeline: a.total_pipeline || 0,
        contact_count: a.contact_count || 0,
        finding_count: a.finding_count || 0,
        last_activity: a.last_activity || a.updated_at || '',
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
      })));
      setError('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
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

  const hasIndustryData = accounts.some(a => a.industry);
  const hasDealData = accounts.some(a => a.open_deal_count > 0);
  const hasPipelineData = accounts.some(a => a.total_pipeline > 0);
  const hasContactData = accounts.some(a => a.contact_count > 0);
  const hasActivityData = accounts.some(a => a.last_activity);

  const filtered = useMemo(() => {
    let result = accounts;
    if (industryFilter !== 'all') {
      result = result.filter(a => a.industry === industryFilter);
    }
    if (ownerFilter !== 'all') {
      result = result.filter(a => a.owner === ownerFilter);
    }
    if (domainFilter !== 'all') {
      result = result.filter(a => a.domain === domainFilter);
    }
    if (scoreFilter !== 'all') {
      result = result.filter(a => a.grade === scoreFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(a =>
        a.name.toLowerCase().includes(q) || a.domain.toLowerCase().includes(q)
      );
    }
    return result;
  }, [accounts, industryFilter, ownerFilter, domainFilter, scoreFilter, search]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'domain': cmp = a.domain.localeCompare(b.domain); break;
        case 'industry': cmp = a.industry.localeCompare(b.industry); break;
        case 'open_deals': cmp = a.open_deal_count - b.open_deal_count; break;
        case 'pipeline': cmp = a.total_pipeline - b.total_pipeline; break;
        case 'contacts': cmp = a.contact_count - b.contact_count; break;
        case 'last_activity': {
          const da = a.last_activity ? new Date(a.last_activity).getTime() : 0;
          const db = b.last_activity ? new Date(b.last_activity).getTime() : 0;
          cmp = da - db;
          break;
        }
        case 'score': cmp = (a.total_score ?? -1) - (b.total_score ?? -1); break;
        case 'signals': cmp = (a.signals?.length ?? 0) - (b.signals?.length ?? 0); break;
        case 'icp_fit': cmp = (a.icp_fit_score ?? -1) - (b.icp_fit_score ?? -1); break;
      }
      if (cmp === 0) cmp = a.name.localeCompare(b.name);
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return arr;
  }, [filtered, sortField, sortDir]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageAccounts = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  useEffect(() => { setPage(0); }, [search, industryFilter, ownerFilter, domainFilter, scoreFilter]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir(field === 'name' || field === 'domain' || field === 'industry' || field === 'signals' ? 'asc' : 'desc');
    }
  };

  const hasFilters = search || industryFilter !== 'all' || ownerFilter !== 'all' || domainFilter !== 'all' || scoreFilter !== 'all';
  const clearFilters = () => {
    setSearch('');
    setIndustryFilter('all');
    setOwnerFilter('all');
    setDomainFilter('all');
    setScoreFilter('all');
  };

  type ColDef = { field: SortField; label: string; width: string; show: boolean };
  const scoringActive = scoringState?.state === 'active';
  const columns: ColDef[] = [
    { field: 'name', label: 'Account Name', width: '22%', show: true },
    { field: 'domain', label: 'Domain', width: '13%', show: true },
    { field: 'score', label: 'Score', width: '8%', show: scoringActive },
    { field: 'signals', label: 'Signals', width: '12%', show: scoringActive },
    { field: 'icp_fit', label: 'ICP Fit', width: '7%', show: scoringActive },
    { field: 'industry', label: 'Industry', width: '12%', show: hasIndustryData },
    { field: 'open_deals', label: 'Open Deals', width: '8%', show: hasDealData },
    { field: 'pipeline', label: 'Pipeline', width: '10%', show: hasPipelineData },
    { field: 'contacts', label: 'Contacts', width: '7%', show: hasContactData },
    { field: 'last_activity', label: 'Last Activity', width: '13%', show: hasActivityData },
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
        <button onClick={fetchAccounts} style={{ fontSize: 12, color: colors.accent, background: 'none', border: 'none', cursor: 'pointer', marginTop: 12 }}>
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
          Showing {filtered.length} of {accounts.length} accounts
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

      {/* Filter Bar */}
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
        {hasIndustryData && uniqueIndustries.length > 0 && (
          <FilterSelect label="Industry" value={industryFilter} onChange={setIndustryFilter}
            options={[{ value: 'all', label: 'All' }, ...uniqueIndustries.map(i => ({ value: i, label: i }))]} />
        )}
        {uniqueOwners.length > 0 && (
          <FilterSelect label="Owner" value={ownerFilter} onChange={setOwnerFilter}
            options={[{ value: 'all', label: 'All' }, ...uniqueOwners.map(o => ({ value: o, label: anon.person(o) }))]} />
        )}
        {uniqueDomains.length > 0 && (
          <FilterSelect label="Domain" value={domainFilter} onChange={setDomainFilter}
            options={[{ value: 'all', label: 'All' }, ...uniqueDomains.map(d => ({ value: d, label: d }))]} />
        )}
        {accounts.some(a => a.grade) && (
          <FilterSelect label="Score" value={scoreFilter} onChange={setScoreFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'A', label: 'A' },
              { value: 'B', label: 'B' },
              { value: 'C', label: 'C' },
              { value: 'D', label: 'D' },
              { value: 'F', label: 'F' },
            ]} />
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
        {pageAccounts.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center' }}>
            <p style={{ fontSize: 13, color: colors.textMuted }}>No accounts match your filters.</p>
            <button onClick={clearFilters} style={{
              fontSize: 12, color: colors.accent, background: 'none', border: 'none', cursor: 'pointer', marginTop: 8,
            }}>
              Clear filters
            </button>
          </div>
        ) : (
          pageAccounts.map(account => {
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

            return (
              <div
                key={account.id}
                onClick={openDrawer}
                style={{
                  display: 'grid', gridTemplateColumns: gridTemplate,
                  padding: '12px 20px',
                  borderBottom: `1px solid ${colors.border}`,
                  cursor: 'pointer', transition: 'background 0.12s',
                  alignItems: 'center',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ fontSize: 13, fontWeight: 500, color: colors.accent, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 8 }}>
                  {anon.company(account.name || 'Unnamed')}
                </div>
                <div style={{ fontSize: 12, color: colors.textSecondary, fontFamily: fonts.mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {account.domain || '—'}
                </div>
                {/* Score column — only shown when scoring is active */}
                {scoringActive && (
                  <div>
                    <ScoreBadge grade={account.grade} score={account.total_score} scoreDelta={account.score_delta} dataConfidence={account.data_confidence} />
                  </div>
                )}
                {/* Signals column */}
                {scoringActive && (
                  <div>
                    <SignalBadges signals={account.signals} confidence={account.classification_confidence} />
                  </div>
                )}
                {/* ICP Fit column */}
                {scoringActive && (
                  <div style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.text }}>
                    {account.icp_fit_score !== undefined ? `${account.icp_fit_score}%` : '—'}
                  </div>
                )}
                {hasIndustryData && (
                  <div style={{ fontSize: 12, color: colors.textMuted }}>
                    {account.industry || '—'}
                  </div>
                )}
                {hasDealData && (
                  <div style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.text }}>
                    {account.open_deal_count || '—'}
                  </div>
                )}
                {hasPipelineData && (
                  <div style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.text }}>
                    {account.total_pipeline ? formatCurrency(anon.amount(account.total_pipeline)) : '—'}
                  </div>
                )}
                {hasContactData && (
                  <div style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.textMuted }}>
                    {account.contact_count || '—'}
                  </div>
                )}
                {hasActivityData && (
                  <div style={{ fontSize: 11, color: colors.textMuted }}>
                    {account.last_activity ? (
                      <div>
                        <div>{formatTimeAgo(account.last_activity)}</div>
                        {account.enriched_at && (
                          <div style={{ fontSize: 10, color: colors.textDim, marginTop: 2 }}>
                            Enriched {formatTimeAgo(account.enriched_at)}
                          </div>
                        )}
                      </div>
                    ) : '—'}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '8px 16px', background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10,
        }}>
          <span style={{ fontSize: 12, color: colors.textMuted }}>
            Showing {page * PAGE_SIZE + 1}\u2013{Math.min((page + 1) * PAGE_SIZE, sorted.length)} of {sorted.length}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              disabled={page === 0}
              onClick={() => setPage(p => p - 1)}
              style={{
                fontSize: 12, padding: '4px 12px', borderRadius: 4,
                background: page === 0 ? colors.surfaceRaised : colors.accentSoft,
                color: page === 0 ? colors.textDim : colors.accent,
                border: 'none', cursor: page === 0 ? 'default' : 'pointer',
              }}
            >
              Previous
            </button>
            <button
              disabled={page >= totalPages - 1}
              onClick={() => setPage(p => p + 1)}
              style={{
                fontSize: 12, padding: '4px 12px', borderRadius: 4,
                background: page >= totalPages - 1 ? colors.surfaceRaised : colors.accentSoft,
                color: page >= totalPages - 1 ? colors.textDim : colors.accent,
                border: 'none', cursor: page >= totalPages - 1 ? 'default' : 'pointer',
              }}
            >
              Next
            </button>
          </div>
        </div>
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
