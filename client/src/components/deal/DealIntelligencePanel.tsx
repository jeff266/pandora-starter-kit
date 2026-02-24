import React, { useState, useEffect } from 'react';
import { useSignals } from '../../hooks/useSignals';
import { useScores } from '../../hooks/useScores';
import { SeverityBadge } from '../shared/SeverityBadge';
import TimeAgo from '../shared/TimeAgo';
import { EntityLink } from '../shared/EntityLink';
import { colors } from '../../styles/theme';
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
      <div style={{ padding: 16 }} className={className}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ height: 24, background: colors.surfaceHover, borderRadius: 8, width: '33%' }} />
          <div style={{ height: 128, background: colors.surfaceHover, borderRadius: 8 }} />
          <div style={{ height: 128, background: colors.surfaceHover, borderRadius: 8 }} />
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
      <div style={{ padding: 16, borderBottom: `1px solid ${colors.border}` }}>
        <h3 style={{ fontSize: 18, fontWeight: 600, color: colors.text, margin: 0 }}>
          Deal Intelligence
        </h3>
        <p style={{ fontSize: 11, color: colors.textMuted, marginTop: 4, marginBottom: 0 }}>
          Real-time market signals and stakeholder status
        </p>
      </div>

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Account Score Summary */}
        {scores && (
          <div style={{ background: colors.surface, borderRadius: 8, padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 500, color: colors.textSecondary }}>
                ACCOUNT FIT
              </span>
              <EntityLink
                type="account"
                id={accountId}
                name="View Details"
                workspaceId={workspaceId}
                className={className}
                style={{ fontSize: 11 }}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 4 }}>ICP Score</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 20, fontWeight: 700, color: colors.text }}>
                    {scores.icp_score}
                  </span>
                  <span
                    style={{
                      padding: '2px 6px',
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 700,
                      color: 'white',
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
                <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 4 }}>Lead Score</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 20, fontWeight: 700, color: colors.text }}>
                    {scores.lead_score}
                  </span>
                  <span
                    style={{
                      padding: '2px 6px',
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 700,
                      color: 'white',
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
          <div style={{ background: colors.surface, borderRadius: 8, padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 500, color: colors.textSecondary }}>
                MARKET SIGNALS
              </span>
              <div
                style={{
                  padding: '2px 8px',
                  borderRadius: 4,
                  fontSize: 11,
                  fontWeight: 700,
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, textAlign: 'center' }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: colors.text }}>
                  {signalsSummary.total_signals}
                </div>
                <div style={{ fontSize: 11, color: colors.textMuted }}>Total</div>
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: colors.orange }}>
                  {signalsSummary.high_priority}
                </div>
                <div style={{ fontSize: 11, color: colors.textMuted }}>High Priority</div>
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: colors.green }}>
                  {signalsSummary.buying_triggers}
                </div>
                <div style={{ fontSize: 11, color: colors.textMuted }}>Buying Triggers</div>
              </div>
            </div>
          </div>
        )}

        {/* Buying Triggers */}
        {buyingTriggers.length > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Zap style={{ width: 16, height: 16, color: colors.green }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>
                Buying Triggers ({buyingTriggers.length})
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {buyingTriggers.map(signal => (
                <div
                  key={signal.id}
                  style={{
                    fontSize: 13,
                    padding: 8,
                    background: colors.greenSoft,
                    border: `1px solid ${colors.green}`,
                    borderRadius: 6,
                  }}
                >
                  <div style={{ fontWeight: 500, color: colors.text, marginBottom: 4 }}>
                    {signal.headline}
                  </div>
                  <div style={{ fontSize: 11, color: colors.textMuted }}>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <TrendingUp style={{ width: 16, height: 16, color: colors.orange }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>
                High Priority Signals
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {highPrioritySignals.map(signal => (
                <div
                  key={signal.id}
                  style={{
                    fontSize: 13,
                    padding: 8,
                    background: 'rgba(249,115,22,0.1)',
                    border: `1px solid ${colors.orange}`,
                    borderRadius: 6,
                  }}
                >
                  <div style={{ fontWeight: 500, color: colors.text, marginBottom: 4 }}>
                    {signal.headline}
                  </div>
                  <div style={{ fontSize: 11, color: colors.textMuted }}>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <AlertCircle style={{ width: 16, height: 16, color: colors.red }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>
                Stakeholder Risks
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {criticalStakeholders.map((stakeholder, idx) => (
                <div
                  key={idx}
                  style={{
                    fontSize: 13,
                    padding: 8,
                    background: colors.redSoft,
                    border: `1px solid ${colors.red}`,
                    borderRadius: 6,
                  }}
                >
                  <div style={{ fontWeight: 500, color: colors.text }}>
                    {stakeholder.contact_name}
                  </div>
                  <div style={{ fontSize: 11, color: colors.textMuted }}>
                    {stakeholder.status === 'departed' && 'Left the company'}
                    {stakeholder.status === 'promoted' && 'Promoted to new role'}
                    {stakeholder.status === 'role_changed' && 'Role changed'}
                  </div>
                  {stakeholder.current_title && (
                    <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 4 }}>
                      {stakeholder.current_title}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Overall Status */}
        {!loading && (
          <div style={{ paddingTop: 12, borderTop: `1px solid ${colors.border}` }}>
            {hasOpportunities && !hasRisks && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: colors.green }}>
                <CheckCircle2 style={{ width: 16, height: 16, marginTop: 2, flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 500 }}>Strong Opportunity</div>
                  <div style={{ fontSize: 11, marginTop: 4, color: colors.textMuted }}>
                    Multiple buying triggers detected. Good time to engage.
                  </div>
                </div>
              </div>
            )}
            {hasRisks && !hasOpportunities && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: colors.red }}>
                <AlertCircle style={{ width: 16, height: 16, marginTop: 2, flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 500 }}>Attention Required</div>
                  <div style={{ fontSize: 11, marginTop: 4, color: colors.textMuted }}>
                    Stakeholder changes or low scores detected. Review deal status.
                  </div>
                </div>
              </div>
            )}
            {hasRisks && hasOpportunities && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: colors.orange }}>
                <Target style={{ width: 16, height: 16, marginTop: 2, flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 500 }}>Mixed Signals</div>
                  <div style={{ fontSize: 11, marginTop: 4, color: colors.textMuted }}>
                    Both opportunities and risks present. Strategic engagement recommended.
                  </div>
                </div>
              </div>
            )}
            {!hasRisks && !hasOpportunities && signals.length === 0 && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: colors.textMuted }}>
                <CheckCircle2 style={{ width: 16, height: 16, marginTop: 2, flexShrink: 0 }} />
                <div>
                  <div style={{ fontWeight: 500 }}>Status Quo</div>
                  <div style={{ fontSize: 11, marginTop: 4 }}>
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
