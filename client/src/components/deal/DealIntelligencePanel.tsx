import React, { useState, useEffect } from 'react';
import { useSignals } from '../../hooks/useSignals';
import { useScores } from '../../hooks/useScores';
import { SeverityBadge } from '../shared/SeverityBadge';
import TimeAgo from '../shared/TimeAgo';
import { EntityLink } from '../shared/EntityLink';
import { api } from '../../lib/api';
import {
  TrendingUp, Target, AlertCircle, CheckCircle2, Users,
  ExternalLink, RefreshCw, ChevronRight, Zap
} from 'lucide-react';

interface DealIntelligencePanelProps {
  dealId: string;
  accountId: string;
  accountName: string;
  workspaceId: string;
  className?: string;
}

interface StakeholderStatus {
  contact_name: string;
  contact_id: string;
  role: string;
  status: 'active' | 'departed' | 'promoted' | 'role_changed';
  current_title?: string;
  previous_title?: string;
  current_company?: string;
  confidence: number;
  checked_at: string;
}

export function DealIntelligencePanel({
  dealId,
  accountId,
  accountName,
  workspaceId,
  className,
}: DealIntelligencePanelProps) {
  const { signals, summary: signalsSummary, loading: signalsLoading } = useSignals({
    accountId,
    lookbackDays: 90,
  });
  const { scores, loading: scoresLoading } = useScores({ accountId });
  const [stakeholders, setStakeholders] = useState<StakeholderStatus[]>([]);
  const [loadingStakeholders, setLoadingStakeholders] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  useEffect(() => {
    fetchStakeholderStatus();
  }, [dealId]);

  const fetchStakeholderStatus = async () => {
    try {
      setLoadingStakeholders(true);
      // This would call the LinkedIn stakeholder checking API
      // For now, we'll just return empty array
      setStakeholders([]);
      setLastChecked(new Date());
    } catch (err) {
      console.error('Failed to fetch stakeholder status:', err);
    } finally {
      setLoadingStakeholders(false);
    }
  };

  const loading = signalsLoading || scoresLoading || loadingStakeholders;

  if (loading) {
    return (
      <div className={`p-4 ${className || ''}`}>
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-100 rounded w-1/3" />
          <div className="h-32 bg-gray-100 rounded" />
          <div className="h-32 bg-gray-100 rounded" />
        </div>
      </div>
    );
  }

  const highPrioritySignals = signals.filter(s =>
    ['critical', 'high'].includes(s.priority)
  ).slice(0, 3);

  const buyingTriggers = signals.filter(s => s.buying_trigger).slice(0, 3);

  const criticalStakeholders = stakeholders.filter(s =>
    s.status !== 'active'
  );

  const hasRisks = criticalStakeholders.length > 0 || scores?.icp_tier === 'D' || scores?.lead_tier === 'COLD';
  const hasOpportunities = buyingTriggers.length > 0 || scores?.lead_tier === 'HOT';

  return (
    <div className={className}>
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <h3 className="text-lg font-semibold">Deal Intelligence</h3>
        <p className="text-xs text-gray-500 mt-1">
          Real-time market signals and stakeholder status
        </p>
      </div>

      <div className="p-4 space-y-4">
        {/* Account Score Summary */}
        {scores && (
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-700">ACCOUNT FIT</span>
              <EntityLink
                type="account"
                id={accountId}
                name="View Details"
                workspaceId={workspaceId}
                className="text-xs"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-gray-600 mb-1">ICP Score</div>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-bold">{scores.icp_score}</span>
                  <span
                    className="px-1.5 py-0.5 rounded text-xs font-bold text-white"
                    style={{
                      backgroundColor:
                        scores.icp_tier === 'A' ? '#10b981' :
                        scores.icp_tier === 'B' ? '#3b82f6' :
                        scores.icp_tier === 'C' ? '#f59e0b' : '#ef4444',
                    }}
                  >
                    {scores.icp_tier}
                  </span>
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-600 mb-1">Lead Score</div>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-bold">{scores.lead_score}</span>
                  <span
                    className="px-1.5 py-0.5 rounded text-xs font-bold text-white"
                    style={{
                      backgroundColor:
                        scores.lead_tier === 'HOT' ? '#ef4444' :
                        scores.lead_tier === 'WARM' ? '#f59e0b' : '#6b7280',
                    }}
                  >
                    {scores.lead_tier}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Signal Strength */}
        {signalsSummary && (
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-700">MARKET SIGNALS</span>
              <div
                className="px-2 py-0.5 rounded text-xs font-bold"
                style={{
                  backgroundColor:
                    signalsSummary.signal_strength === 'HOT' ? '#fee2e2' :
                    signalsSummary.signal_strength === 'WARM' ? '#fef3c7' :
                    signalsSummary.signal_strength === 'NEUTRAL' ? '#dbeafe' : '#f3f4f6',
                  color:
                    signalsSummary.signal_strength === 'HOT' ? '#dc2626' :
                    signalsSummary.signal_strength === 'WARM' ? '#d97706' :
                    signalsSummary.signal_strength === 'NEUTRAL' ? '#2563eb' : '#6b7280',
                }}
              >
                {signalsSummary.signal_strength}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-lg font-bold">{signalsSummary.total_signals}</div>
                <div className="text-xs text-gray-600">Total</div>
              </div>
              <div>
                <div className="text-lg font-bold text-orange-600">
                  {signalsSummary.high_priority}
                </div>
                <div className="text-xs text-gray-600">High Priority</div>
              </div>
              <div>
                <div className="text-lg font-bold text-green-600">
                  {signalsSummary.buying_triggers}
                </div>
                <div className="text-xs text-gray-600">Buying Triggers</div>
              </div>
            </div>
          </div>
        )}

        {/* Buying Triggers */}
        {buyingTriggers.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Zap className="h-4 w-4 text-green-600" />
              <span className="text-sm font-semibold">Buying Triggers ({buyingTriggers.length})</span>
            </div>
            <div className="space-y-2">
              {buyingTriggers.map(signal => (
                <div
                  key={signal.id}
                  className="text-sm p-2 bg-green-50 border border-green-200 rounded"
                >
                  <div className="font-medium text-green-900">{signal.headline}</div>
                  <div className="text-xs text-green-700 mt-1">
                    <TimeAgo date={signal.signal_date} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* High Priority Signals */}
        {highPrioritySignals.length > 0 && buyingTriggers.length === 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-4 w-4 text-orange-600" />
              <span className="text-sm font-semibold">High Priority Signals</span>
            </div>
            <div className="space-y-2">
              {highPrioritySignals.map(signal => (
                <div
                  key={signal.id}
                  className="text-sm p-2 bg-orange-50 border border-orange-200 rounded"
                >
                  <div className="font-medium text-orange-900">{signal.headline}</div>
                  <div className="text-xs text-orange-700 mt-1">
                    <TimeAgo date={signal.signal_date} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stakeholder Risks */}
        {criticalStakeholders.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <span className="text-sm font-semibold">Stakeholder Risks</span>
            </div>
            <div className="space-y-2">
              {criticalStakeholders.map((stakeholder, idx) => (
                <div
                  key={idx}
                  className="text-sm p-2 bg-red-50 border border-red-200 rounded"
                >
                  <div className="font-medium text-red-900">{stakeholder.contact_name}</div>
                  <div className="text-xs text-red-700">
                    {stakeholder.status === 'departed' && 'Left the company'}
                    {stakeholder.status === 'promoted' && 'Promoted to new role'}
                    {stakeholder.status === 'role_changed' && 'Role changed'}
                  </div>
                  {stakeholder.current_title && (
                    <div className="text-xs text-red-600 mt-1">{stakeholder.current_title}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Overall Status */}
        {!loading && (
          <div className="pt-3 border-t border-gray-200">
            {hasOpportunities && !hasRisks && (
              <div className="flex items-start gap-2 text-sm text-green-700">
                <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="font-medium">Strong Opportunity</div>
                  <div className="text-xs mt-1">
                    Multiple buying triggers detected. Good time to engage.
                  </div>
                </div>
              </div>
            )}
            {hasRisks && !hasOpportunities && (
              <div className="flex items-start gap-2 text-sm text-red-700">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="font-medium">Attention Required</div>
                  <div className="text-xs mt-1">
                    Stakeholder changes or low scores detected. Review deal status.
                  </div>
                </div>
              </div>
            )}
            {hasRisks && hasOpportunities && (
              <div className="flex items-start gap-2 text-sm text-orange-700">
                <Target className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="font-medium">Mixed Signals</div>
                  <div className="text-xs mt-1">
                    Both opportunities and risks present. Strategic engagement recommended.
                  </div>
                </div>
              </div>
            )}
            {!hasRisks && !hasOpportunities && signals.length === 0 && (
              <div className="flex items-start gap-2 text-sm text-gray-600">
                <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="font-medium">Status Quo</div>
                  <div className="text-xs mt-1">
                    No recent signals detected. Standard engagement cadence.
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
