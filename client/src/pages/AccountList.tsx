import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { formatCurrency, formatTimeAgo } from '../lib/format';
import Skeleton from '../components/Skeleton';

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
}

type SortField = 'name' | 'domain' | 'industry' | 'open_deals' | 'pipeline' | 'contacts' | 'last_activity';
type SortDir = 'asc' | 'desc';

export default function AccountList() {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [industryFilter, setIndustryFilter] = useState('all');
  const [ownerFilter, setOwnerFilter] = useState('all');

  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(0);

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
    { field: 'name', label: 'Account Name', width: '25%', show: true },
    { field: 'domain', label: 'Domain', width: '15%', show: true },
    { field: 'industry', label: 'Industry', width: '15%', show: hasIndustryData },
    { field: 'open_deals', label: 'Open Deals', width: '10%', show: hasDealData },
    { field: 'pipeline', label: 'Pipeline Value', width: '12%', show: hasPipelineData },
    { field: 'contacts', label: 'Contacts', width: '8%', show: hasContactData },
    { field: 'last_activity', label: 'Last Activity', width: '15%', show: hasActivityData },
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
            options={[{ value: 'all', label: 'All' }, ...uniqueOwners.map(o => ({ value: o, label: o }))]} />
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
              <div style={{ fontSize: 13, fontWeight: 500, color: colors.accent, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 8 }}>
                {account.name || 'Unnamed'}
              </div>
              <div style={{ fontSize: 12, color: colors.textSecondary, fontFamily: fonts.mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {account.domain || '—'}
              </div>
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
                  {account.total_pipeline ? formatCurrency(account.total_pipeline) : '—'}
                </div>
              )}
              {hasContactData && (
                <div style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.textMuted }}>
                  {account.contact_count || '—'}
                </div>
              )}
              {hasActivityData && (
                <div style={{ fontSize: 11, color: colors.textMuted }}>
                  {account.last_activity ? formatTimeAgo(account.last_activity) : '—'}
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
