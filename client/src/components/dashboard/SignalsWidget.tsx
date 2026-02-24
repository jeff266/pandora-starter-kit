import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Newspaper, Users, Target, TrendingUp, ArrowRight, Flame } from 'lucide-react';
import { colors, fonts } from '../../styles/theme';

interface SignalsSummary {
  total_this_week: number;
  by_type: Record<string, number>;
  hot_accounts?: Array<{
    account_id: string;
    account_name: string;
    signal_count: number;
    signal_types: string[];
    composite_heat: 'hot' | 'warm' | 'neutral' | 'cold';
  }>;
}

interface SignalsWidgetProps {
  summary?: SignalsSummary;
  loading?: boolean;
  workspaceId: string;
}

export function SignalsWidget({ summary, loading = false, workspaceId }: SignalsWidgetProps) {
  const navigate = useNavigate();

  const handleAccountClick = (accountId: string) => {
    navigate(`/workspaces/${workspaceId}/accounts/${accountId}`);
  };

  const handleViewAll = () => {
    navigate(`/workspaces/${workspaceId}/accounts?sort=signals_recent`);
  };

  const getHeatIcon = (heat: string) => {
    if (heat === 'hot') return { icon: <Flame size={16} />, color: colors.green };
    if (heat === 'cold') return { icon: <Flame size={16} />, color: colors.red };
    return { icon: <Flame size={16} />, color: colors.yellow };
  };

  const signalTypeIcons: Record<string, React.ReactNode> = {
    market_news: <Newspaper size={16} />,
    stakeholder_change: <Users size={16} />,
    icp_match: <Target size={16} />,
    activity: <TrendingUp size={16} />,
  };

  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: 16,
      }}
    >
      {/* Header */}
      <h4 style={{ margin: '0 0 16px 0', fontSize: 16, fontWeight: 600, color: colors.text, fontFamily: fonts.body }}>
        Signals This Week
      </h4>

      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: colors.textSecondary }}>Loading...</div>
      ) : (
        <>
          {/* Signal Type Counts */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 12,
              marginBottom: 16,
            }}
          >
            {Object.entries(summary?.by_type || {}).map(([type, count]) => (
              <div
                key={type}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  borderRadius: 8,
                  background: colors.bg,
                  border: `1px solid ${colors.border}`,
                }}
              >
                <div style={{ color: colors.accent }}>{signalTypeIcons[type] || <TrendingUp size={16} />}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 18, fontWeight: 600, color: colors.text, fontFamily: fonts.body }}>
                    {count}
                  </div>
                  <div style={{ fontSize: 11, color: colors.textSecondary, fontFamily: fonts.body }}>
                    {type.replace(/_/g, ' ')}
                  </div>
                </div>
              </div>
            ))}

            {/* Total Count */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                borderRadius: 8,
                background: colors.bg,
                border: `1px solid ${colors.border}`,
                gridColumn: '1 / -1',
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 18, fontWeight: 600, color: colors.text, fontFamily: fonts.body }}>
                  {summary?.total_this_week || 0}
                </div>
                <div style={{ fontSize: 11, color: colors.textSecondary, fontFamily: fonts.body }}>
                  Total signals
                </div>
              </div>
            </div>
          </div>

          {/* Hot Accounts */}
          {summary?.hot_accounts && summary.hot_accounts.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: colors.textSecondary,
                  marginBottom: 8,
                  fontFamily: fonts.body,
                }}
              >
                Hot Accounts
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {summary.hot_accounts.slice(0, 3).map((account) => {
                  const heatInfo = getHeatIcon(account.composite_heat);
                  return (
                    <button
                      key={account.account_id}
                      onClick={() => handleAccountClick(account.account_id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        borderRadius: 8,
                        border: 'none',
                        background: colors.bg,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        textAlign: 'left',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = colors.surfaceHover)}
                      onMouseLeave={(e) => (e.currentTarget.style.background = colors.bg)}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: colors.text, fontFamily: fonts.body }}>
                          {account.account_name}
                        </div>
                        <div style={{ fontSize: 11, color: colors.textSecondary, fontFamily: fonts.body }}>
                          {account.signal_count} signal{account.signal_count !== 1 ? 's' : ''}
                        </div>
                      </div>
                      <div style={{ color: heatInfo.color }}>{heatInfo.icon}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* View All Button */}
          <button
            onClick={handleViewAll}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              width: '100%',
              padding: '10px 16px',
              borderRadius: 8,
              border: `1px solid ${colors.border}`,
              background: colors.bg,
              color: colors.accent,
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              fontFamily: fonts.body,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = colors.surfaceHover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = colors.bg)}
          >
            View All Signals
            <ArrowRight size={16} />
          </button>
        </>
      )}
    </div>
  );
}
