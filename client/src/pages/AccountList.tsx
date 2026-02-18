import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { formatCurrency, formatTimeAgo } from '../lib/format';
import Skeleton from '../components/Skeleton';
import { useDemoMode } from '../contexts/DemoModeContext';

const PAGE_SIZE = 50;

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
  total_score?: number | null;
  grade?: string | null;
  signal_summary?: string | null;
  data_quality?: string | null;
  company_type?: string | null;
}

interface ScoreDetail {
  scored: boolean;
  totalScore?: number;
  grade?: string;
  firmographicScore?: number;
  engagementScore?: number;
  signalScore?: number;
  relationshipScore?: number;
  breakdown?: any;
  scoredAt?: string;
}

type SortField = 'name' | 'domain' | 'industry' | 'open_deals' | 'pipeline' | 'contacts' | 'last_activity' | 'score';
type SortDir = 'asc' | 'desc';

const GRADE_COLORS: Record<string, { bg: string; fg: string }> = {
  A: { bg: '#dcfce7', fg: '#166534' },
  B: { bg: '#dbeafe', fg: '#1e40af' },
  C: { bg: '#fef9c3', fg: '#854d0e' },
  D: { bg: '#fed7aa', fg: '#9a3412' },
  F: { bg: '#fecaca', fg: '#991b1b' },
};

const DATA_QUALITY_LABELS: Record<string, { label: string; color: string }> = {
  high: { label: 'High confidence', color: colors.green },
  standard: { label: 'Standard', color: colors.accent },
  limited: { label: 'Limited data', color: colors.yellow },
};

function ScoreBadge({ grade, score }: { grade: string | null | undefined; score: number | null | undefined }) {
  if (!grade) return <span style={{ fontSize: 11, color: colors.textDim }}>--</span>;
  const c = GRADE_COLORS[grade] || GRADE_COLORS.D;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 22, height: 22, borderRadius: 4, fontSize: 11, fontWeight: 700,
        background: c.bg, color: c.fg, fontFamily: fonts.mono,
      }}>
        {grade}
      </span>
      {score != null && (
        <span style={{ fontSize: 10, color: colors.textMuted, fontFamily: fonts.mono }}>
          {score}
        </span>
      )}
    </div>
  );
}

function SignalBadges({ dataQuality, companyType }: { dataQuality?: string | null; companyType?: string | null }) {
  const badges: React.ReactNode[] = [];

  if (dataQuality && DATA_QUALITY_LABELS[dataQuality]) {
    const dq = DATA_QUALITY_LABELS[dataQuality];
    badges.push(
      <span key="dq" style={{
        fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 3,
        background: `${dq.color}18`, color: dq.color,
      }}>
        {dataQuality === 'limited' ? '\u26A0 ' : ''}{dq.label}
      </span>
    );
  }

  if (companyType && companyType !== 'other') {
    badges.push(
      <span key="ct" style={{
        fontSize: 9, fontWeight: 500, padding: '1px 5px', borderRadius: 3,
        background: colors.surfaceRaised, color: colors.textMuted,
      }}>
        {companyType.replace(/_/g, ' ')}
      </span>
    );
  }

  if (badges.length === 0) return null;
  return <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 2 }}>{badges}</div>;
}

export default function AccountList() {
  const navigate = useNavigate();
  const { anon } = useDemoMode();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [industryFilter, setIndustryFilter] = useState('all');
  const [ownerFilter, setOwnerFilter] = useState('all');

  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(0);

  const [drawerAccountId, setDrawerAccountId] = useState<string | null>(null);
  const [drawerData, setDrawerData] = useState<ScoreDetail | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);

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
        total_score: a.total_score ?? null,
        grade: a.grade ?? null,
        signal_summary: a.signal_summary ?? null,
        data_quality: a.data_quality ?? null,
        company_type: a.company_type ?? null,
      })));
      setError('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const openScoreDrawer = async (accountId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDrawerAccountId(accountId);
    setDrawerLoading(true);
    try {
      const data = await api.get(`/accounts/${accountId}/score`);
      setDrawerData(data);
    } catch {
      setDrawerData({ scored: false });
    } finally {
      setDrawerLoading(false);
    }
  };

  const uniqueIndustries = useMemo(() =>
    Array.from(new Set(accounts.map(a => a.industry).filter(Boolean))).sort(),
  [accounts]);

  const uniqueOwners = useMemo(() =>
    Array.from(new Set(accounts.map(a => a.owner).filter(Boolean))).sort(),
  [accounts]);

  const hasIndustryData = accounts.some(a => a.industry);
  const hasDealData = accounts.some(a => a.open_deal_count > 0);
  const hasPipelineData = accounts.some(a => a.total_pipeline > 0);
  const hasContactData = accounts.some(a => a.contact_count > 0);
  const hasActivityData = accounts.some(a => a.last_activity);
  const hasScoreData = accounts.some(a => a.grade != null);

  const filtered = useMemo(() => {
    let result = accounts;
    if (industryFilter !== 'all') {
      result = result.filter(a => a.industry === industryFilter);
    }
    if (ownerFilter !== 'all') {
      result = result.filter(a => a.owner === ownerFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(a =>
        a.name.toLowerCase().includes(q) || a.domain.toLowerCase().includes(q)
      );
    }
    return result;
  }, [accounts, industryFilter, ownerFilter, search]);

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
        case 'score': cmp = (a.total_score ?? -1) - (b.total_score ?? -1); break;
        case 'last_activity': {
          const da = a.last_activity ? new Date(a.last_activity).getTime() : 0;
          const db = b.last_activity ? new Date(b.last_activity).getTime() : 0;
          cmp = da - db;
          break;
        }
      }
      if (cmp === 0) cmp = a.name.localeCompare(b.name);
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return arr;
  }, [filtered, sortField, sortDir]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageAccounts = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  useEffect(() => { setPage(0); }, [search, industryFilter, ownerFilter]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir(field === 'name' || field === 'domain' || field === 'industry' ? 'asc' : 'desc');
    }
  };

  const hasFilters = search || industryFilter !== 'all' || ownerFilter !== 'all';
  const clearFilters = () => { setSearch(''); setIndustryFilter('all'); setOwnerFilter('all'); };

  type ColDef = { field: SortField; label: string; width: string; show: boolean };
  const columns: ColDef[] = [
    { field: 'score', label: 'Score', width: '7%', show: hasScoreData },
    { field: 'name', label: 'Account Name', width: hasScoreData ? '22%' : '25%', show: true },
    { field: 'domain', label: 'Domain', width: '13%', show: true },
    { field: 'industry', label: 'Industry', width: '13%', show: hasIndustryData },
    { field: 'open_deals', label: 'Open Deals', width: '9%', show: hasDealData },
    { field: 'pipeline', label: 'Pipeline Value', width: '12%', show: hasPipelineData },
    { field: 'contacts', label: 'Contacts', width: '7%', show: hasContactData },
    { field: 'last_activity', label: 'Last Activity', width: '12%', show: hasActivityData },
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
            fontSize: 12, padding: '6px 12px', width: 200,
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
        {/* Header row */}
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
          pageAccounts.map(account => (
            <div
              key={account.id}
              onClick={() => navigate(`/accounts/${account.id}`)}
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
              {hasScoreData && (
                <div onClick={e => openScoreDrawer(account.id, e)} style={{ cursor: 'pointer' }}>
                  <ScoreBadge grade={account.grade} score={account.total_score} />
                </div>
              )}
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: colors.accent, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 8 }}>
                  {anon.company(account.name || 'Unnamed')}
                </div>
                <SignalBadges dataQuality={account.data_quality} companyType={account.company_type} />
              </div>
              <div style={{ fontSize: 12, color: colors.textSecondary, fontFamily: fonts.mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {account.domain || '\u2014'}
              </div>
              {hasIndustryData && (
                <div style={{ fontSize: 12, color: colors.textMuted }}>
                  {account.industry || '\u2014'}
                </div>
              )}
              {hasDealData && (
                <div style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.text }}>
                  {account.open_deal_count || '\u2014'}
                </div>
              )}
              {hasPipelineData && (
                <div style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.text }}>
                  {account.total_pipeline ? formatCurrency(anon.amount(account.total_pipeline)) : '\u2014'}
                </div>
              )}
              {hasContactData && (
                <div style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.textMuted }}>
                  {account.contact_count || '\u2014'}
                </div>
              )}
              {hasActivityData && (
                <div style={{ fontSize: 11, color: colors.textMuted }}>
                  {account.last_activity ? formatTimeAgo(account.last_activity) : '\u2014'}
                </div>
              )}
            </div>
          ))
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
      {drawerAccountId && (
        <ScoreDrawer
          accountId={drawerAccountId}
          accountName={accounts.find(a => a.id === drawerAccountId)?.name || ''}
          data={drawerData}
          loading={drawerLoading}
          onClose={() => { setDrawerAccountId(null); setDrawerData(null); }}
          anon={anon}
        />
      )}
    </div>
  );
}

function ScoreDrawer({ accountId, accountName, data, loading, onClose, anon }: {
  accountId: string;
  accountName: string;
  data: ScoreDetail | null;
  loading: boolean;
  onClose: () => void;
  anon: any;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.4)', zIndex: 1000,
        display: 'flex', justifyContent: 'flex-end',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 380, background: colors.surface, height: '100%',
          borderLeft: `1px solid ${colors.border}`,
          display: 'flex', flexDirection: 'column', overflow: 'auto',
          padding: 24,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, color: colors.text, margin: 0 }}>
            {anon.company(accountName)}
          </h3>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', fontSize: 18, color: colors.textMuted,
            cursor: 'pointer', lineHeight: 1,
          }}>
            \u2715
          </button>
        </div>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Skeleton height={60} />
            <Skeleton height={120} />
            <Skeleton height={120} />
          </div>
        ) : !data?.scored ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <p style={{ fontSize: 13, color: colors.textMuted }}>No score data yet.</p>
            <p style={{ fontSize: 11, color: colors.textDim, marginTop: 8 }}>
              Run account enrichment to generate scores.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Overall Score */}
            <div style={{
              background: colors.surfaceRaised, borderRadius: 8, padding: 16,
              textAlign: 'center',
            }}>
              <ScoreBadge grade={data.grade ?? null} score={data.totalScore ?? null} />
              <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 8 }}>
                Overall Score: {data.totalScore}/100
              </p>
              {data.scoredAt && (
                <p style={{ fontSize: 10, color: colors.textDim, marginTop: 4 }}>
                  Last scored {formatTimeAgo(data.scoredAt)}
                </p>
              )}
            </div>

            {/* Category Breakdown */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <ScoreBar label="Firmographic" score={data.firmographicScore ?? 0} max={25} color="#3b82f6" />
              <ScoreBar label="Engagement" score={data.engagementScore ?? 0} max={35} color="#10b981" />
              <ScoreBar label="Signals" score={data.signalScore ?? 0} max={20} color="#8b5cf6" />
              <ScoreBar label="Relationship" score={data.relationshipScore ?? 0} max={20} color="#f59e0b" />
            </div>

            {/* Detailed Breakdown */}
            {data.breakdown && (
              <div style={{ fontSize: 11, color: colors.textMuted }}>
                <p style={{ fontWeight: 600, color: colors.text, marginBottom: 8 }}>Score Details</p>
                {Object.entries(data.breakdown).map(([category, items]: [string, any]) => (
                  <div key={category} style={{ marginBottom: 10 }}>
                    <p style={{ fontWeight: 600, color: colors.textSecondary, textTransform: 'capitalize', marginBottom: 4 }}>
                      {category}
                    </p>
                    {Object.entries(items).map(([key, value]: [string, any]) => (
                      <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                        <span>{key.replace(/_/g, ' ')}</span>
                        <span style={{ fontFamily: fonts.mono, color: Number(value) > 0 ? colors.green : Number(value) < 0 ? colors.red : colors.textDim }}>
                          {Number(value) > 0 ? `+${value}` : value}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ScoreBar({ label, score, max, color }: { label: string; score: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((score / max) * 100) : 0;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: 11, color: colors.text }}>{label}</span>
        <span style={{ fontSize: 10, fontFamily: fonts.mono, color: colors.textMuted }}>{score}/{max}</span>
      </div>
      <div style={{ height: 6, background: colors.surfaceRaised, borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 0.3s' }} />
      </div>
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
