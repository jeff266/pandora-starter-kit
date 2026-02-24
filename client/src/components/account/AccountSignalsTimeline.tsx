import React, { useState } from 'react';
import { useSignals, Signal, SignalCategory } from '../../hooks/useSignals';
import { SeverityBadge } from '../shared/SeverityBadge';
import TimeAgo from '../shared/TimeAgo';
import EmptyState from '../shared/EmptyState';
import { colors, fonts } from '../../styles/theme';
import {
  TrendingUp, Building2, Users, Briefcase, AlertTriangle,
  Rocket, Handshake, ArrowUpCircle, ArrowDownCircle, UserMinus, UserPlus,
  RefreshCw, ChevronDown, ChevronUp, ExternalLink, Filter
} from 'lucide-react';

interface AccountSignalsTimelineProps {
  accountId: string;
  accountName: string;
  workspaceId: string;
  className?: string;
}

const categoryIcons: Record<SignalCategory, React.ElementType> = {
  funding: TrendingUp,
  acquisition: Building2,
  expansion: Rocket,
  executive_change: Users,
  layoff: AlertTriangle,
  product_launch: Rocket,
  partnership: Handshake,
  hiring: UserPlus,
  stakeholder_departure: UserMinus,
  stakeholder_promotion: ArrowUpCircle,
  stakeholder_role_change: Users,
};

const categoryColors: Record<SignalCategory, string> = {
  funding: '#10b981',
  acquisition: '#8b5cf6',
  expansion: '#3b82f6',
  executive_change: '#f59e0b',
  layoff: '#ef4444',
  product_launch: '#06b6d4',
  partnership: '#6366f1',
  hiring: '#22c55e',
  stakeholder_departure: '#dc2626',
  stakeholder_promotion: '#22c55e',
  stakeholder_role_change: '#f59e0b',
};

const categoryLabels: Record<SignalCategory, string> = {
  funding: 'Funding',
  acquisition: 'Acquisition',
  expansion: 'Expansion',
  executive_change: 'Executive Change',
  layoff: 'Layoff',
  product_launch: 'Product Launch',
  partnership: 'Partnership',
  hiring: 'Hiring',
  stakeholder_departure: 'Stakeholder Left',
  stakeholder_promotion: 'Promotion',
  stakeholder_role_change: 'Role Change',
};

export function AccountSignalsTimeline({
  accountId,
  accountName,
  workspaceId,
  className,
}: AccountSignalsTimelineProps) {
  const { signals, summary, loading, error, refreshSignals } = useSignals({ accountId });
  const [expanded, setExpanded] = useState<string[]>([]);
  const [filterCategory, setFilterCategory] = useState<SignalCategory | 'all'>('all');
  const [filterPriority, setFilterPriority] = useState<'all' | 'high' | 'buying_triggers'>('all');
  const [refreshing, setRefreshing] = useState(false);

  const toggleExpanded = (signalId: string) => {
    setExpanded(prev =>
      prev.includes(signalId)
        ? prev.filter(id => id !== signalId)
        : [...prev, signalId]
    );
  };

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      await refreshSignals(false);
    } catch (err) {
      console.error('Failed to refresh signals:', err);
    } finally {
      setRefreshing(false);
    }
  };

  const filteredSignals = signals.filter(signal => {
    if (filterCategory !== 'all' && signal.signal_category !== filterCategory) return false;
    if (filterPriority === 'high' && !['critical', 'high'].includes(signal.priority)) return false;
    if (filterPriority === 'buying_triggers' && !signal.buying_trigger) return false;
    return true;
  });

  const categories = Array.from(new Set(signals.map(s => s.signal_category)));

  if (loading) {
    return (
      <div style={{ padding: 24 }} className={className}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{ height: 80, background: colors.surfaceHover, borderRadius: 8 }} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24 }} className={className}>
        <div style={{ color: colors.red, fontSize: 13 }}>Error loading signals: {error}</div>
      </div>
    );
  }

  const strengthColors = {
    HOT: { bg: '#fee2e2', text: '#dc2626' },
    WARM: { bg: '#fef3c7', text: '#d97706' },
    NEUTRAL: { bg: '#dbeafe', text: '#2563eb' },
    COLD: { bg: '#f3f4f6', text: '#6b7280' },
  };

  return (
    <div className={className}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 16,
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h3 style={{ fontSize: 18, fontWeight: 600, color: colors.text, margin: 0 }}>
            Market Signals
          </h3>
          {summary && (
            <div
              style={{
                padding: '4px 8px',
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 500,
                backgroundColor: strengthColors[summary.signal_strength]?.bg || strengthColors.COLD.bg,
                color: strengthColors[summary.signal_strength]?.text || strengthColors.COLD.text,
              }}
            >
              {summary.signal_strength}
            </div>
          )}
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          style={{
            padding: 8,
            background: 'transparent',
            border: 'none',
            borderRadius: 8,
            cursor: refreshing ? 'not-allowed' : 'pointer',
            opacity: refreshing ? 0.5 : 1,
            transition: 'background 0.2s',
          }}
          onMouseEnter={(e) => !refreshing && (e.currentTarget.style.background = colors.surfaceHover)}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          title="Refresh signals"
        >
          <RefreshCw
            style={{
              width: 16,
              height: 16,
              color: colors.text,
              animation: refreshing ? 'spin 1s linear infinite' : 'none',
            }}
          />
        </button>
      </div>

      {/* Summary Stats */}
      {summary && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 16,
            padding: 16,
            background: colors.surface,
            borderBottom: `1px solid ${colors.border}`,
          }}
        >
          <div>
            <div style={{ fontSize: 24, fontWeight: 700, color: colors.text }}>{summary.total_signals}</div>
            <div style={{ fontSize: 11, color: colors.textMuted }}>Total Signals</div>
          </div>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700, color: colors.orange }}>{summary.high_priority}</div>
            <div style={{ fontSize: 11, color: colors.textMuted }}>High Priority</div>
          </div>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700, color: colors.green }}>{summary.buying_triggers}</div>
            <div style={{ fontSize: 11, color: colors.textMuted }}>Buying Triggers</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: 16,
          background: colors.surface,
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        <Filter style={{ width: 16, height: 16, color: colors.textMuted }} />
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value as any)}
          style={{
            fontSize: 13,
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            padding: '6px 10px',
            background: colors.surface,
            color: colors.text,
          }}
        >
          <option value="all">All Categories</option>
          {categories.map(cat => (
            <option key={cat} value={cat}>{categoryLabels[cat]}</option>
          ))}
        </select>
        <select
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value as any)}
          style={{
            fontSize: 13,
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            padding: '6px 10px',
            background: colors.surface,
            color: colors.text,
          }}
        >
          <option value="all">All Priorities</option>
          <option value="high">High Priority Only</option>
          <option value="buying_triggers">Buying Triggers Only</option>
        </select>
      </div>

      {/* Signals Timeline */}
      <div style={{ padding: 16, maxHeight: 384, overflowY: 'auto' }}>
        {filteredSignals.length === 0 ? (
          <EmptyState
            title="No signals found"
            description="No market signals detected for this account in the last 90 days."
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filteredSignals.map(signal => {
              const Icon = categoryIcons[signal.signal_category] || Briefcase;
              const color = categoryColors[signal.signal_category] || '#6b7280';
              const isExpanded = expanded.includes(signal.id);

              return (
                <div
                  key={signal.id}
                  style={{
                    border: `1px solid ${colors.border}`,
                    borderRadius: 8,
                    transition: 'border-color 0.2s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = colors.borderLight)}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = colors.border)}
                >
                  <div style={{ padding: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                      <div
                        style={{
                          padding: 8,
                          borderRadius: 8,
                          background: `${color}15`,
                        }}
                      >
                        <Icon style={{ width: 16, height: 16, color }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                          <div style={{ flex: 1 }}>
                            <h4 style={{ fontWeight: 500, fontSize: 13, color: colors.text, margin: 0 }}>
                              {signal.headline}
                            </h4>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                              <span style={{ fontSize: 11, color: colors.textMuted }}>
                                {categoryLabels[signal.signal_category]}
                              </span>
                              <span style={{ fontSize: 11, color: colors.textDim }}>•</span>
                              <TimeAgo date={signal.signal_date} />
                              {signal.buying_trigger && (
                                <>
                                  <span style={{ fontSize: 11, color: colors.textDim }}>•</span>
                                  <span style={{ fontSize: 11, color: colors.green, fontWeight: 500 }}>
                                    Buying Trigger
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                          <SeverityBadge severity={signal.priority} />
                        </div>

                        {signal.description && isExpanded && (
                          <p style={{ fontSize: 13, color: colors.textSecondary, marginTop: 8, marginBottom: 0 }}>
                            {signal.description}
                          </p>
                        )}

                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                          {signal.source && (
                            <span style={{ fontSize: 11, color: colors.textMuted }}>{signal.source}</span>
                          )}
                          {signal.source_url && (
                            <a
                              href={signal.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                fontSize: 11,
                                color: colors.accent,
                                textDecoration: 'none',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.textDecoration = 'underline')}
                              onMouseLeave={(e) => (e.currentTarget.style.textDecoration = 'none')}
                            >
                              View <ExternalLink style={{ width: 12, height: 12 }} />
                            </a>
                          )}
                        </div>
                      </div>

                      {signal.description && (
                        <button
                          onClick={() => toggleExpanded(signal.id)}
                          style={{
                            padding: 4,
                            background: 'transparent',
                            border: 'none',
                            borderRadius: 4,
                            cursor: 'pointer',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = colors.surfaceHover)}
                          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                        >
                          {isExpanded ? (
                            <ChevronUp style={{ width: 16, height: 16, color: colors.textMuted }} />
                          ) : (
                            <ChevronDown style={{ width: 16, height: 16, color: colors.textMuted }} />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
