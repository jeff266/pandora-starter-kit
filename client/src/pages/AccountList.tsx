import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { formatCurrency, formatNumber, formatTimeAgo } from '../lib/format';
import { LoadingState, EmptyState } from '../components/shared';

interface Account {
  id: string;
  name: string;
  domain?: string;
  industry?: string;
  deal_count: number;
  total_pipeline: number;
  finding_count: number;
  last_activity?: string;
  owner_email?: string;
}

type SortField = 'pipeline' | 'findings' | 'activity' | 'name' | 'deals';

export default function AccountList() {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortBy, setSortBy] = useState<SortField>('pipeline');
  const [industryFilter, setIndustryFilter] = useState('');

  useEffect(() => {
    fetchAccounts();
  }, [sortBy]);

  const fetchAccounts = async () => {
    setLoading(true);
    try {
      const data = await api.get(`/accounts?sort=${sortBy}&limit=100`);
      setAccounts(Array.isArray(data) ? data : data.accounts || []);
      setError('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const industries = Array.from(new Set(accounts.map((a) => a.industry).filter(Boolean)));

  const filteredAccounts = industryFilter
    ? accounts.filter((a) => a.industry === industryFilter)
    : accounts;

  if (loading) return <LoadingState message="Loading accounts..." />;

  if (error) {
    return (
      <EmptyState
        title="Failed to load accounts"
        description={error}
        action={{
          label: 'Retry',
          onClick: fetchAccounts,
        }}
      />
    );
  }

  if (accounts.length === 0) {
    return (
      <EmptyState
        title="No accounts found"
        description="Connect your CRM to see account data"
        action={{
          label: 'Go to Connectors',
          onClick: () => navigate('/connectors'),
        }}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header with filters */}
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          padding: 16,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: colors.text, margin: 0 }}>
            Accounts
          </h2>
          <p style={{ fontSize: 12, color: colors.textMuted, margin: '4px 0 0' }}>
            {formatNumber(filteredAccounts.length)} accounts
            {industryFilter && ` in ${industryFilter}`}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {/* Industry filter */}
          {industries.length > 0 && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: colors.textMuted }}>Industry:</span>
              <select
                value={industryFilter}
                onChange={(e) => setIndustryFilter(e.target.value)}
                style={{
                  fontSize: 11,
                  padding: '4px 8px',
                  borderRadius: 4,
                  background: colors.surfaceRaised,
                  color: colors.text,
                  border: `1px solid ${colors.border}`,
                }}
              >
                <option value="">All</option>
                {industries.map((ind) => (
                  <option key={ind} value={ind}>
                    {ind}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Sort controls */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: colors.textMuted }}>Sort:</span>
            {(['pipeline', 'findings', 'activity', 'deals', 'name'] as SortField[]).map((field) => (
              <button
                key={field}
                onClick={() => setSortBy(field)}
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  padding: '4px 10px',
                  borderRadius: 4,
                  background: sortBy === field ? colors.surfaceActive : 'transparent',
                  color: sortBy === field ? colors.text : colors.textMuted,
                  border: 'none',
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                }}
              >
                {field}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Accounts table */}
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 10,
          overflow: 'hidden',
        }}
      >
        {/* Table header */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '2fr 1.5fr 1fr 1fr 1fr 1.2fr',
            gap: 16,
            padding: '12px 20px',
            background: colors.surfaceRaised,
            borderBottom: `1px solid ${colors.border}`,
            fontSize: 10,
            fontWeight: 600,
            color: colors.textMuted,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          <div>Account Name</div>
          <div>Domain</div>
          <div>Industry</div>
          <div>Deals</div>
          <div>Pipeline</div>
          <div>Findings</div>
          <div>Last Activity</div>
        </div>

        {/* Table rows */}
        {filteredAccounts.map((account) => (
          <div
            key={account.id}
            onClick={() => navigate(`/accounts/${account.id}`)}
            style={{
              display: 'grid',
              gridTemplateColumns: '2fr 1.5fr 1fr 1fr 1fr 1.2fr',
              gap: 16,
              padding: '14px 20px',
              borderBottom: `1px solid ${colors.border}`,
              cursor: 'pointer',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = colors.surfaceHover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <div style={{ fontSize: 13, fontWeight: 500, color: colors.text }}>
              {account.name}
            </div>
            <div style={{ fontSize: 12, color: colors.textSecondary, fontFamily: fonts.mono }}>
              {account.domain || '--'}
            </div>
            <div style={{ fontSize: 12, color: colors.textMuted }}>
              {account.industry || '--'}
            </div>
            <div style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.text }}>
              {formatNumber(account.deal_count || 0)}
            </div>
            <div style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.text }}>
              {formatCurrency(account.total_pipeline || 0)}
            </div>
            <div style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.textMuted }}>
              {account.finding_count || 0}
            </div>
            <div style={{ fontSize: 11, color: colors.textMuted }}>
              {account.last_activity ? formatTimeAgo(account.last_activity) : '--'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
