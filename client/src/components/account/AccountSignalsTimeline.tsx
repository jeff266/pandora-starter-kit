import React, { useState } from 'react';
import { useSignals, Signal, SignalCategory } from '../../hooks/useSignals';
import { SeverityBadge } from '../shared/SeverityBadge';
import TimeAgo from '../shared/TimeAgo';
import EmptyState from '../shared/EmptyState';
import { colors, fonts } from '../../styles/theme';
import {
  TrendingUp, Building2, Users, Briefcase, AlertTriangle,
  Rocket, Handshake, ArrowUpCircle, ArrowDownCircle, UserMinus,
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
      <div className={`p-6 ${className || ''}`}>
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-20 bg-gray-100 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`p-6 ${className || ''}`}>
        <div className="text-red-600 text-sm">Error loading signals: {error}</div>
      </div>
    );
  }

  return (
    <div className={className}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold">Market Signals</h3>
          {summary && (
            <div
              className="px-2 py-1 rounded text-xs font-medium"
              style={{
                backgroundColor: summary.signal_strength === 'HOT' ? '#fee2e2' :
                  summary.signal_strength === 'WARM' ? '#fef3c7' :
                  summary.signal_strength === 'NEUTRAL' ? '#dbeafe' : '#f3f4f6',
                color: summary.signal_strength === 'HOT' ? '#dc2626' :
                  summary.signal_strength === 'WARM' ? '#d97706' :
                  summary.signal_strength === 'NEUTRAL' ? '#2563eb' : '#6b7280',
              }}
            >
              {summary.signal_strength}
            </div>
          )}
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
          title="Refresh signals"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Summary Stats */}
      {summary && (
        <div className="grid grid-cols-3 gap-4 p-4 bg-gray-50 border-b border-gray-200">
          <div>
            <div className="text-2xl font-bold">{summary.total_signals}</div>
            <div className="text-xs text-gray-600">Total Signals</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-orange-600">{summary.high_priority}</div>
            <div className="text-xs text-gray-600">High Priority</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-green-600">{summary.buying_triggers}</div>
            <div className="text-xs text-gray-600">Buying Triggers</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 p-4 bg-white border-b border-gray-200">
        <Filter className="h-4 w-4 text-gray-400" />
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value as any)}
          className="text-sm border border-gray-300 rounded px-2 py-1"
        >
          <option value="all">All Categories</option>
          {categories.map(cat => (
            <option key={cat} value={cat}>{categoryLabels[cat]}</option>
          ))}
        </select>
        <select
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value as any)}
          className="text-sm border border-gray-300 rounded px-2 py-1"
        >
          <option value="all">All Priorities</option>
          <option value="high">High Priority Only</option>
          <option value="buying_triggers">Buying Triggers Only</option>
        </select>
      </div>

      {/* Signals Timeline */}
      <div className="p-4 space-y-3 max-h-96 overflow-y-auto">
        {filteredSignals.length === 0 ? (
          <EmptyState
            title="No signals found"
            description="No market signals detected for this account in the last 90 days."
          />
        ) : (
          filteredSignals.map(signal => {
            const Icon = categoryIcons[signal.signal_category];
            const color = categoryColors[signal.signal_category];
            const isExpanded = expanded.includes(signal.id);

            return (
              <div
                key={signal.id}
                className="border border-gray-200 rounded-lg hover:border-gray-300 transition-colors"
              >
                <div className="p-3">
                  <div className="flex items-start gap-3">
                    <div
                      className="p-2 rounded-lg"
                      style={{ backgroundColor: `${color}15` }}
                    >
                      <Icon className="h-4 w-4" style={{ color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <h4 className="font-medium text-sm">{signal.headline}</h4>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-gray-500">
                              {categoryLabels[signal.signal_category]}
                            </span>
                            <span className="text-xs text-gray-400">•</span>
                            <TimeAgo date={signal.signal_date} className="text-xs text-gray-500" />
                            {signal.buying_trigger && (
                              <>
                                <span className="text-xs text-gray-400">•</span>
                                <span className="text-xs text-green-600 font-medium">
                                  Buying Trigger
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        <SeverityBadge severity={signal.priority} />
                      </div>

                      {signal.description && isExpanded && (
                        <p className="text-sm text-gray-600 mt-2">{signal.description}</p>
                      )}

                      <div className="flex items-center gap-2 mt-2">
                        {signal.source && (
                          <span className="text-xs text-gray-500">{signal.source}</span>
                        )}
                        {signal.source_url && (
                          <a
                            href={signal.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                          >
                            View <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>

                    {signal.description && (
                      <button
                        onClick={() => toggleExpanded(signal.id)}
                        className="p-1 hover:bg-gray-100 rounded"
                      >
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4 text-gray-400" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-gray-400" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
