import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { formatCurrency, formatNumber } from '../lib/format';
import { LoadingState, EmptyState, SeverityDot } from '../components/shared';

interface Deal {
  id: string;
  name: string;
  amount: number;
  stage: string;
  stage_normalized: string;
  owner_name?: string;
  owner_email?: string;
  days_in_stage?: number;
  finding_count?: number;
  critical_findings?: number;
}

type SortField = 'amount' | 'stage' | 'days_in_stage' | 'finding_count';

export default function DealList() {
  const navigate = useNavigate();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortBy, setSortBy] = useState<SortField>('amount');

  useEffect(() => {
    fetchDeals();
  }, []);

  const fetchDeals = async () => {
    setLoading(true);
    try {
      const dealsData = await api.get('/deals?limit=500');
      const raw = Array.isArray(dealsData) ? dealsData : dealsData.data || dealsData.deals || [];
      const openDeals = raw.filter((d: any) =>
        d.stage_normalized && !['closed_won', 'closed_lost'].includes(d.stage_normalized)
      );
      setDeals(openDeals);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const sortedDeals = [...deals].sort((a, b) => {
    switch (sortBy) {
      case 'amount':
        return (b.amount || 0) - (a.amount || 0);
      case 'days_in_stage':
        return (b.days_in_stage || 0) - (a.days_in_stage || 0);
      case 'finding_count':
        return (b.finding_count || 0) - (a.finding_count || 0);
      default:
        return 0;
    }
  });

  if (loading) return <LoadingState message="Loading deals..." />;

  if (error) {
    return (
      <EmptyState
        title="Failed to load deals"
        description={error}
        action={{
          label: 'Retry',
          onClick: fetchDeals,
        }}
      />
    );
  }

  if (deals.length === 0) {
    return (
      <EmptyState
        title="No deals found"
        description="Connect your CRM to see pipeline deals"
        action={{
          label: 'Go to Connectors',
          onClick: () => navigate('/connectors'),
        }}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header with sort controls */}
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
            Open Deals
          </h2>
          <p style={{ fontSize: 12, color: colors.textMuted, margin: '4px 0 0' }}>
            {formatNumber(deals.length)} deals • {formatCurrency(deals.reduce((sum, d) => sum + (d.amount || 0), 0))} total
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: colors.textMuted }}>Sort by:</span>
          {(['amount', 'days_in_stage', 'finding_count'] as SortField[]).map((field) => (
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
              {field.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Deals table */}
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
            gridTemplateColumns: '2fr 1fr 1fr 1fr 80px 80px',
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
          <div>Deal Name</div>
          <div>Amount</div>
          <div>Stage</div>
          <div>Owner</div>
          <div>Days</div>
          <div>Findings</div>
        </div>

        {/* Table rows */}
        {sortedDeals.map((deal) => (
          <div
            key={deal.id}
            onClick={() => navigate(`/deals/${deal.id}`)}
            style={{
              display: 'grid',
              gridTemplateColumns: '2fr 1fr 1fr 1fr 80px 80px',
              gap: 16,
              padding: '14px 20px',
              borderBottom: `1px solid ${colors.border}`,
              borderLeft: deal.critical_findings && deal.critical_findings > 0
                ? `2px solid ${colors.red}40`
                : '2px solid transparent',
              cursor: 'pointer',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = colors.surfaceHover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <div style={{ fontSize: 13, fontWeight: 500, color: colors.text }}>
              {deal.name}
            </div>
            <div style={{ fontSize: 13, fontFamily: fonts.mono, color: colors.text }}>
              {formatCurrency(deal.amount || 0)}
            </div>
            <div>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: 4,
                  background: colors.accentSoft,
                  color: colors.accent,
                  textTransform: 'capitalize',
                }}
              >
                {deal.stage_normalized?.replace(/_/g, ' ') || deal.stage || '--'}
              </span>
            </div>
            <div style={{ fontSize: 12, color: colors.textSecondary }}>
              {deal.owner_name || deal.owner_email || '--'}
            </div>
            <div style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.textMuted }}>
              {deal.days_in_stage || 0}d
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {deal.finding_count && deal.finding_count > 0 ? (
                <>
                  {deal.critical_findings && deal.critical_findings > 0 && (
                    <SeverityDot severity="act" size={6} />
                  )}
                  <span style={{ fontSize: 11, fontFamily: fonts.mono, color: colors.textMuted }}>
                    {deal.finding_count}
                  </span>
                </>
              ) : (
                <span style={{ fontSize: 11, color: colors.textDim }}>--</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
