import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { formatCurrency, formatTimeAgo } from '../lib/format';
import Skeleton from '../components/Skeleton';
import { useDemoMode } from '../contexts/DemoModeContext';
import { useIsMobile } from '../hooks/useIsMobile';
import { useWorkspace } from '../context/WorkspaceContext';

type TargetType = 'individual' | 'company' | 'team' | 'board';

const TARGET_TYPE_LABELS: Record<TargetType, string> = {
  individual: 'Individual',
  company: 'Company',
  team: 'Team',
  board: 'Board',
};

const TARGET_TYPE_COLORS: Record<TargetType, { bg: string; text: string }> = {
  company: { bg: 'rgba(99,102,241,0.15)', text: '#818cf8' },
  board: { bg: 'rgba(168,85,247,0.15)', text: '#c084fc' },
  team: { bg: 'rgba(59,130,246,0.15)', text: '#60a5fa' },
  individual: { bg: 'rgba(34,197,94,0.15)', text: '#4ade80' },
};

interface Target {
  id: string;
  workspace_id: string;
  metric: string;
  period_type: string;
  period_start: string;
  period_end: string;
  period_label: string;
  amount: number;
  pipeline_id: string | null;
  pipeline_name: string | null;
  set_by: string | null;
  set_at: string;
  notes: string | null;
  is_active: boolean;
  supersedes_id: string | null;
  created_at: string;
  target_type: TargetType;
  assigned_to_user_id: string | null;
  assigned_to_email: string | null;
}

interface GapCalculation {
  target_amount: string | number;
  target_metric: string;
  period_label: string;
  period_start: string;
  period_end: string;
  days_remaining: number;
  pipeline_name?: string | null;
  closed_amount: number;
  closed_deal_count: number;
  attainment_pct: number;
  monte_carlo_p50: number | null;
  monte_carlo_p10: number | null;
  monte_carlo_p90: number | null;
  hit_probability: number | null;
  gap_to_target: number;
  gap_status: 'on_track' | 'at_risk' | 'critical' | 'achieved';
  workspace_win_rate: number;
  avg_deal_size: number;
  avg_sales_cycle_days: number;
  required_pipeline: number;
  required_deals: number;
  pipeline_deadline: string;
  days_to_pipeline_deadline: number;
  current_open_pipeline: number;
  current_open_deal_count: number;
  pipeline_vs_required: number;
  current_deals_per_week: number;
  required_deals_per_week: number;
  rep_attainment?: {
    rep_email: string;
    rep_name: string;
    quota: number;
    closed: number;
    attainment_pct: number;
    gap: number;
    status: 'on_track' | 'at_risk' | 'critical';
  }[];
}

interface Quota {
  id: string;
  workspace_id: string;
  rep_email: string;
  rep_name: string | null;
  period_type: string;
  period_start: string;
  period_end: string;
  period_label: string;
  amount: number;
  metric: string;
  set_by: string | null;
  set_at: string;
  is_active: boolean;
  created_at: string;
}

interface RevenueModel {
  detected_metric: string;
  confidence: number;
  signals: string[];
  display_label: string;
}

const statusColors = {
  achieved: { bg: colors.greenSoft, border: colors.green, text: colors.green },
  on_track: { bg: colors.greenSoft, border: colors.green, text: colors.green },
  at_risk: { bg: 'rgba(249,115,22,0.1)', border: colors.orange, text: colors.orange },
  critical: { bg: colors.redSoft, border: colors.red, text: colors.red },
};

export default function Targets() {
  const { anon } = useDemoMode();
  const { currentWorkspace } = useWorkspace();
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(true);
  const [revenueModel, setRevenueModel] = useState<RevenueModel | null>(null);
  const [targets, setTargets] = useState<Target[]>([]);
  const [gap, setGap] = useState<GapCalculation | null>(null);
  const [quotas, setQuotas] = useState<Quota[]>([]);
  const [showSetTargetModal, setShowSetTargetModal] = useState(false);
  const [showQuotaModal, setShowQuotaModal] = useState(false);
  const [editingTarget, setEditingTarget] = useState<Target | null>(null);
  const [repEmailToName, setRepEmailToName] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchAll();
    if (currentWorkspace?.id) {
      api.get(`/workspaces/${currentWorkspace.id}/sales-reps/roster`).then((res: any) => {
        const map: Record<string, string> = {};
        (res.reps || []).forEach((r: any) => { if (r.rep_email && r.rep_name) map[r.rep_email] = r.rep_name; });
        setRepEmailToName(map);
      }).catch(() => {});
    }
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [modelRes, targetsRes] = await Promise.all([
        api.get('/targets/revenue-model'),
        api.get('/targets?active_only=true'),
      ]);

      setRevenueModel(modelRes);
      setTargets(targetsRes.targets || []);

      // Try to fetch gap if active target exists
      if (targetsRes.targets?.length > 0) {
        try {
          const gapRes = await api.get('/targets/gap');
          setGap(gapRes);

          // Fetch quotas for the active period
          const activeTarget = targetsRes.targets[0];
          const quotasRes = await api.get(`/quotas?period_start=${activeTarget.period_start}`);
          setQuotas(quotasRes.quotas || []);
        } catch (err) {
          console.log('No gap data available');
        }
      }
    } catch (err) {
      console.error('Failed to fetch targets:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '24px 32px' }}>
        <div style={{ fontSize: 24, fontWeight: 700, color: colors.text, marginBottom: 24 }}>
          Targets
        </div>
        <Skeleton height={200} />
      </div>
    );
  }

  const activeTarget = targets[0];
  const hasTarget = !!activeTarget;

  return (
    <div style={{ padding: isMobile ? '16px 12px' : '24px 32px', maxWidth: 1400 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div style={{ fontSize: 24, fontWeight: 700, color: colors.text }}>Targets</div>
        <button
          onClick={() => setShowSetTargetModal(true)}
          style={{
            padding: '8px 16px',
            fontSize: 14,
            fontWeight: 600,
            fontFamily: fonts.sans,
            background: colors.accent,
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          + Set Target
        </button>
      </div>

      {/* Revenue Metric */}
      {revenueModel && (
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: '16px 20px',
          marginBottom: 24,
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
            Revenue Metric
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: colors.text, marginBottom: 4 }}>
            {revenueModel.display_label}
          </div>
          <div style={{ fontSize: 12, color: colors.textMuted }}>
            {revenueModel.signals[0]} • confidence: {Math.round(revenueModel.confidence * 100)}%
          </div>
        </div>
      )}

      {/* Gap Card */}
      {hasTarget && gap ? (
        <GapCard gap={gap} anon={anon} onEdit={() => setShowSetTargetModal(true)} />
      ) : (
        <EmptyState onSetTarget={() => setShowSetTargetModal(true)} />
      )}

      {/* Quarterly Breakdown */}
      {hasTarget && (
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: '20px 24px',
          marginTop: 24,
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 16 }}>
            Quarterly Breakdown
          </div>
          <QuarterlyBreakdown
            targets={targets}
            anon={anon}
            onEdit={(t) => { setEditingTarget(t); setShowSetTargetModal(true); }}
            onDelete={async (t) => {
              if (!window.confirm(`Remove ${t.period_label} target of ${formatCurrency(t.amount)}?`)) return;
              try {
                await api.delete(`/targets/${t.id}`);
                fetchAll();
              } catch {
                alert('Failed to remove target');
              }
            }}
          />
        </div>
      )}

      {/* Rep Quotas */}
      {hasTarget && gap?.rep_attainment && gap.rep_attainment.length > 0 && (
        <div style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: '20px 24px',
          marginTop: 24,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>Rep Quotas</div>
            <button
              onClick={() => setShowQuotaModal(true)}
              style={{
                padding: '6px 12px',
                fontSize: 12,
                fontWeight: 600,
                fontFamily: fonts.sans,
                background: colors.surfaceRaised,
                color: colors.text,
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              Edit quotas
            </button>
          </div>
          <RepQuotasTable repAttainment={gap.rep_attainment} gap={gap} anon={anon} />
        </div>
      )}

      {/* Modals */}
      {showSetTargetModal && (
        <SetTargetModal
          existingTarget={editingTarget ?? activeTarget}
          revenueModel={revenueModel}
          isEditing={!!editingTarget}
          workspaceId={currentWorkspace?.id}
          onClose={() => { setShowSetTargetModal(false); setEditingTarget(null); }}
          onSave={() => {
            setShowSetTargetModal(false);
            setEditingTarget(null);
            fetchAll();
          }}
        />
      )}

      {showQuotaModal && activeTarget && (
        <QuotaModal
          target={activeTarget}
          onClose={() => setShowQuotaModal(false)}
          onSave={() => {
            setShowQuotaModal(false);
            fetchAll();
          }}
        />
      )}
    </div>
  );
}

function GapCard({ gap, anon, onEdit }: { gap: GapCalculation; anon: any; onEdit: () => void }) {
  const isMobile = useIsMobile();
  const targetAmount = typeof gap.target_amount === 'string' ? parseFloat(gap.target_amount) : gap.target_amount;
  const statusStyle = statusColors[gap.gap_status];
  const deadlinePassed = gap.days_to_pipeline_deadline < 0;

  return (
    <div style={{
      background: colors.surface,
      border: `2px solid ${statusStyle.border}`,
      borderRadius: 8,
      padding: '20px 24px',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: colors.text, marginBottom: 4 }}>
            {gap.period_label} Target
            {gap.pipeline_name && (
              <span style={{ fontSize: 14, fontWeight: 500, color: colors.textMuted, marginLeft: 8 }}>
                • {anon.pipeline(gap.pipeline_name)}
              </span>
            )}
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, fontFamily: fonts.mono, color: colors.text, marginBottom: 12 }}>
            {formatCurrency(anon.amount(targetAmount))}
          </div>
          <div style={{
            display: 'inline-block',
            padding: '4px 12px',
            borderRadius: 12,
            background: statusStyle.bg,
            border: `1px solid ${statusStyle.border}`,
            fontSize: 12,
            fontWeight: 600,
            color: statusStyle.text,
            textTransform: 'capitalize',
          }}>
            {gap.gap_status.replace('_', ' ')}
          </div>
        </div>
        <button
          onClick={onEdit}
          style={{
            padding: '6px 12px',
            fontSize: 12,
            fontWeight: 600,
            fontFamily: fonts.sans,
            background: colors.surfaceRaised,
            color: colors.text,
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          Edit ✎
        </button>
      </div>

      {/* Stats Row */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)', gap: isMobile ? 12 : 20, marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 4 }}>Closed to date</div>
          <div style={{ fontSize: 20, fontWeight: 700, fontFamily: fonts.mono, color: colors.text }}>
            {formatCurrency(anon.amount(gap.closed_amount))}
          </div>
          <div style={{ fontSize: 12, color: colors.textMuted }}>
            {Math.round(gap.attainment_pct * 100)}% attained
          </div>
        </div>
        {gap.monte_carlo_p50 && (
          <div>
            <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 4 }}>Monte Carlo P50</div>
            <div style={{ fontSize: 20, fontWeight: 700, fontFamily: fonts.mono, color: colors.text }}>
              {formatCurrency(anon.amount(gap.monte_carlo_p50))}
            </div>
            <div style={{ fontSize: 12, color: colors.textMuted }}>
              {Math.round((gap.monte_carlo_p50 / targetAmount) * 100)}% of target
            </div>
          </div>
        )}
        <div>
          <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 4 }}>Gap to target</div>
          <div style={{ fontSize: 20, fontWeight: 700, fontFamily: fonts.mono, color: gap.gap_to_target > 0 ? colors.orange : colors.green }}>
            {formatCurrency(anon.amount(Math.abs(gap.gap_to_target)))}
          </div>
          {gap.hit_probability !== null && (
            <div style={{ fontSize: 12, color: colors.textMuted }}>
              {Math.round(gap.hit_probability * 100)}% hit probability
            </div>
          )}
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: colors.border, margin: '20px 0' }} />

      {/* Required Pipeline Section */}
      <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
        {deadlinePassed ? 'Pipeline Window Closed' : 'Required Pipeline to Close Gap'}
      </div>

      {deadlinePassed ? (
        <div style={{ fontSize: 14, color: colors.textMuted, marginBottom: 12 }}>
          Pipeline window has closed ({Math.abs(gap.days_to_pipeline_deadline)} days ago) — focus on late-stage acceleration
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)', gap: 16 }}>
          <div>
            <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 8 }}>
              <span style={{ fontWeight: 600, fontFamily: fonts.mono, color: colors.text }}>
                {formatCurrency(anon.amount(gap.required_pipeline))}
              </span>
              {' '}pipeline needed
            </div>
            <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 8 }}>
              <span style={{ fontWeight: 600, fontFamily: fonts.mono, color: colors.text }}>
                {gap.required_deals}
              </span>
              {' '}deals at avg {formatCurrency(anon.amount(gap.avg_deal_size))} size
            </div>
            <div style={{ fontSize: 13, color: colors.textSecondary }}>
              Enter funnel by{' '}
              <span style={{ fontWeight: 600, color: colors.text }}>
                {new Date(gap.pipeline_deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
              {' '}({gap.days_to_pipeline_deadline} days away)
            </div>
          </div>
          <div>
            <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 8 }}>
              Need{' '}
              <span style={{ fontWeight: 600, fontFamily: fonts.mono, color: gap.required_deals_per_week > gap.current_deals_per_week ? colors.orange : colors.green }}>
                {gap.required_deals_per_week.toFixed(1)}
              </span>
              {' '}deals/week
            </div>
            <div style={{ fontSize: 13, color: colors.textSecondary }}>
              Currently generating{' '}
              <span style={{ fontWeight: 600, fontFamily: fonts.mono, color: colors.text }}>
                {gap.current_deals_per_week.toFixed(1)}
              </span>
              {' '}deals/week
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ onSetTarget }: { onSetTarget: () => void }) {
  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 8,
      padding: '40px 24px',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>🎯</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: colors.text, marginBottom: 8 }}>
        No target set
      </div>
      <div style={{ fontSize: 14, color: colors.textMuted, marginBottom: 20 }}>
        Set your revenue target to unlock gap analysis and hit probability
      </div>
      <button
        onClick={onSetTarget}
        style={{
          padding: '10px 20px',
          fontSize: 14,
          fontWeight: 600,
          fontFamily: fonts.sans,
          background: colors.accent,
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
        }}
      >
        Set target
      </button>
    </div>
  );
}

function QuarterlyBreakdown({ targets, anon, onEdit, onDelete }: {
  targets: Target[];
  anon: any;
  onEdit: (t: Target) => void;
  onDelete: (t: Target) => void;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
            <th style={{ padding: '12px 0', textAlign: 'left', fontSize: 12, fontWeight: 600, color: colors.textMuted }}>Period</th>
            <th style={{ padding: '12px 0', textAlign: 'left', fontSize: 12, fontWeight: 600, color: colors.textMuted }}>Type</th>
            <th style={{ padding: '12px 0', textAlign: 'left', fontSize: 12, fontWeight: 600, color: colors.textMuted }}>Pipeline</th>
            <th style={{ padding: '12px 0', textAlign: 'right', fontSize: 12, fontWeight: 600, color: colors.textMuted }}>Target</th>
            <th style={{ padding: '12px 0', textAlign: 'right', fontSize: 12, fontWeight: 600, color: colors.textMuted }}>Status</th>
            <th style={{ padding: '12px 0', textAlign: 'right', fontSize: 12, fontWeight: 600, color: colors.textMuted, width: 80 }}></th>
          </tr>
        </thead>
        <tbody>
          {targets.map((target, i) => (
            <tr
              key={target.id}
              style={{ borderBottom: i < targets.length - 1 ? `1px solid ${colors.border}` : 'none' }}
              onMouseEnter={() => setHoveredId(target.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <td style={{ padding: '12px 0', fontSize: 14, color: colors.text }}>{target.period_label}</td>
              <td style={{ padding: '12px 4px' }}>
                {(() => {
                  const tt = (target.target_type || 'company') as TargetType;
                  const tc = TARGET_TYPE_COLORS[tt];
                  return (
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 7px',
                      borderRadius: 4,
                      background: tc.bg,
                      fontSize: 11,
                      fontWeight: 600,
                      color: tc.text,
                      textTransform: 'capitalize',
                    }}>
                      {TARGET_TYPE_LABELS[tt]}
                      {target.assigned_to_email
                        ? ` · ${repEmailToName[target.assigned_to_email] || target.assigned_to_email}`
                        : ''}
                    </span>
                  );
                })()}
              </td>
              <td style={{ padding: '12px 0', fontSize: 14, color: colors.textSecondary }}>
                {target.pipeline_name ? anon.pipeline(target.pipeline_name) : <span style={{ fontStyle: 'italic', color: colors.textMuted }}>All pipelines</span>}
              </td>
              <td style={{ padding: '12px 0', textAlign: 'right', fontSize: 14, fontFamily: fonts.mono, color: colors.text }}>
                {formatCurrency(anon.amount(target.amount))}
              </td>
              <td style={{ padding: '12px 0', textAlign: 'right' }}>
                <span style={{
                  display: 'inline-block',
                  padding: '2px 8px',
                  borderRadius: 4,
                  background: target.is_active ? colors.greenSoft : colors.surfaceRaised,
                  fontSize: 11,
                  fontWeight: 600,
                  color: target.is_active ? colors.green : colors.textMuted,
                }}>
                  {target.is_active ? 'Active' : 'Inactive'}
                </span>
              </td>
              <td style={{ padding: '12px 0', textAlign: 'right' }}>
                <div style={{
                  display: 'flex',
                  gap: 4,
                  justifyContent: 'flex-end',
                  opacity: hoveredId === target.id ? 1 : 0,
                  transition: 'opacity 0.15s',
                }}>
                  <button
                    onClick={() => onEdit(target)}
                    title="Edit target"
                    style={{
                      padding: '3px 8px',
                      fontSize: 12,
                      fontFamily: fonts.sans,
                      fontWeight: 500,
                      background: colors.surfaceRaised,
                      color: colors.text,
                      border: `1px solid ${colors.border}`,
                      borderRadius: 4,
                      cursor: 'pointer',
                    }}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => onDelete(target)}
                    title="Remove target"
                    style={{
                      padding: '3px 8px',
                      fontSize: 12,
                      fontFamily: fonts.sans,
                      fontWeight: 500,
                      background: 'transparent',
                      color: colors.red,
                      border: `1px solid ${colors.red}`,
                      borderRadius: 4,
                      cursor: 'pointer',
                    }}
                  >
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RepQuotasTable({ repAttainment, gap, anon }: {
  repAttainment: NonNullable<GapCalculation['rep_attainment']>;
  gap: GapCalculation;
  anon: any;
}) {
  const totalQuota = repAttainment.reduce((sum, rep) => sum + rep.quota, 0);
  const totalClosed = repAttainment.reduce((sum, rep) => sum + rep.closed, 0);
  const totalGap = repAttainment.reduce((sum, rep) => sum + rep.gap, 0);
  const targetAmount = typeof gap.target_amount === 'string' ? parseFloat(gap.target_amount) : gap.target_amount;
  const buffer = targetAmount - totalQuota;

  return (
    <>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
              <th style={{ padding: '12px 0', textAlign: 'left', fontSize: 12, fontWeight: 600, color: colors.textMuted }}>Rep</th>
              <th style={{ padding: '12px 0', textAlign: 'right', fontSize: 12, fontWeight: 600, color: colors.textMuted }}>Quota</th>
              <th style={{ padding: '12px 0', textAlign: 'right', fontSize: 12, fontWeight: 600, color: colors.textMuted }}>Closed</th>
              <th style={{ padding: '12px 0', textAlign: 'right', fontSize: 12, fontWeight: 600, color: colors.textMuted }}>Attainment</th>
              <th style={{ padding: '12px 0', textAlign: 'right', fontSize: 12, fontWeight: 600, color: colors.textMuted }}>Gap</th>
              <th style={{ padding: '12px 0', textAlign: 'right', fontSize: 12, fontWeight: 600, color: colors.textMuted }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {repAttainment.map((rep, i) => {
              const statusStyle = statusColors[rep.status];
              return (
                <tr key={rep.rep_email} style={{ borderBottom: i < repAttainment.length - 1 ? `1px solid ${colors.border}` : 'none' }}>
                  <td style={{ padding: '12px 0', fontSize: 14, color: colors.text }}>{anon.person(rep.rep_name)}</td>
                  <td style={{ padding: '12px 0', textAlign: 'right', fontSize: 14, fontFamily: fonts.mono, color: colors.text }}>
                    {formatCurrency(anon.amount(rep.quota))}
                  </td>
                  <td style={{ padding: '12px 0', textAlign: 'right', fontSize: 14, fontFamily: fonts.mono, color: colors.text }}>
                    {formatCurrency(anon.amount(rep.closed))}
                  </td>
                  <td style={{ padding: '12px 0', textAlign: 'right', fontSize: 14, fontFamily: fonts.mono, color: colors.text }}>
                    {Math.round(rep.attainment_pct * 100)}%
                  </td>
                  <td style={{ padding: '12px 0', textAlign: 'right', fontSize: 14, fontFamily: fonts.mono, color: rep.gap > 0 ? colors.orange : colors.green }}>
                    {formatCurrency(anon.amount(Math.abs(rep.gap)))}
                  </td>
                  <td style={{ padding: '12px 0', textAlign: 'right' }}>
                    <span style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: 4,
                      background: statusStyle.bg,
                      fontSize: 11,
                      fontWeight: 600,
                      color: statusStyle.text,
                      textTransform: 'capitalize',
                    }}>
                      {rep.status.replace('_', ' ')}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Summary Row */}
      <div style={{ marginTop: 16, padding: '12px 0', borderTop: `2px solid ${colors.border}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>Total</span>
          <span style={{ fontSize: 14, fontFamily: fonts.mono, color: colors.text }}>
            {formatCurrency(anon.amount(totalQuota))} quota • {formatCurrency(anon.amount(totalClosed))} closed • {formatCurrency(anon.amount(totalGap))} gap
          </span>
        </div>
        {buffer !== 0 && (
          <div style={{ fontSize: 12, color: colors.textMuted }}>
            Note: Sum of rep quotas ({formatCurrency(anon.amount(totalQuota))}) ≠ company target ({formatCurrency(anon.amount(targetAmount))}).
            The difference ({formatCurrency(anon.amount(Math.abs(buffer)))}) represents your {buffer > 0 ? 'buffer / unallocated quota' : 'over-allocation'}.
          </div>
        )}
      </div>
    </>
  );
}

function SetTargetModal({ existingTarget, revenueModel, onClose, onSave, isEditing, workspaceId }: {
  existingTarget: Target | null;
  revenueModel: RevenueModel | null;
  onClose: () => void;
  onSave: () => void;
  isEditing?: boolean;
  workspaceId?: string;
}) {
  const { anon } = useDemoMode();
  const { user, currentWorkspace } = useWorkspace();
  const userRole = currentWorkspace?.role;
  const isMember = userRole === 'member';
  const isViewer = userRole === 'viewer';
  const isAnalyst = userRole === 'analyst';

  const editing = isEditing && !!existingTarget?.id;
  const [amount, setAmount] = useState(existingTarget?.amount.toString() || '');
  const [periodType, setPeriodType] = useState<'annual' | 'quarterly' | 'monthly'>(
    existingTarget?.period_type as any || 'quarterly'
  );
  const [periodLabel, setPeriodLabel] = useState(existingTarget?.period_label || 'Q1 2026');
  const [periodStart, setPeriodStart] = useState(existingTarget?.period_start || '2026-01-01');
  const [periodEnd, setPeriodEnd] = useState(existingTarget?.period_end || '2026-03-31');
  const [notes, setNotes] = useState(existingTarget?.notes || '');
  const [pipelineId, setPipelineId] = useState<string>(existingTarget?.pipeline_id || '');
  const [pipelineName, setPipelineName] = useState<string>(existingTarget?.pipeline_name || '');
  const [targetType, setTargetType] = useState<TargetType>(
    existingTarget?.target_type || (isMember ? 'individual' : 'company')
  );
  const [assignedToEmail, setAssignedToEmail] = useState(
    existingTarget?.assigned_to_email || (isMember ? user?.email || '' : '')
  );
  const [pipelines, setPipelines] = useState<{ id: string; name: string }[]>([]);
  const [rosterReps, setRosterReps] = useState<{ id: string; rep_name: string; rep_email: string; pandora_role: string | null; is_manager: boolean }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) fetchPipelines();
    fetchRosterReps();
  }, []);

  const fetchPipelines = async () => {
    try {
      const res = await api.get('/deals/pipelines');
      const pipelineData: { id: string; name: string }[] = res.data || [];
      setPipelines(pipelineData.map(p => typeof p === 'string' ? { id: p, name: p } : p));
    } catch (err) {
      console.error('Failed to fetch pipelines:', err);
    }
  };

  const fetchRosterReps = async () => {
    if (!workspaceId) return;
    try {
      const res = await api.get(`/workspaces/${workspaceId}/sales-reps/roster`);
      const reps = (res.reps || []).filter((r: any) => r.rep_email);
      setRosterReps(reps);
    } catch {
      // Non-fatal — combobox falls back to free text
    }
  };

  const handlePipelineChange = (value: string) => {
    setPipelineId(value);
    if (value === '') {
      setPipelineName('');
    } else {
      const selected = pipelines.find(p => p.id === value);
      setPipelineName(selected?.name || '');
    }
  };

  const showAssignment = targetType === 'team' || targetType === 'individual';

  const filteredRosterReps = rosterReps.filter(r => {
    if (targetType === 'team') return r.pandora_role === 'manager' || r.is_manager;
    if (targetType === 'individual') {
      const isAe = r.pandora_role === 'ae' || (!r.pandora_role && !r.is_manager);
      return isAe;
    }
    return false;
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/targets/${existingTarget!.id}`, {
          amount: parseFloat(amount),
          notes: notes || null,
          period_start: periodStart,
          period_end: periodEnd,
          target_type: targetType,
          assigned_to_email: assignedToEmail || null,
        });
      } else {
        await api.post('/targets', {
          metric: revenueModel?.detected_metric || 'revenue',
          period_type: periodType,
          period_start: periodStart,
          period_end: periodEnd,
          period_label: periodLabel,
          amount: parseFloat(amount),
          pipeline_id: pipelineId || null,
          pipeline_name: pipelineName || null,
          notes,
          target_type: targetType,
          assigned_to_email: assignedToEmail || null,
        });
      }
      onSave();
    } catch (err) {
      console.error('Failed to save target:', err);
      alert('Failed to save target');
    } finally {
      setSaving(false);
    }
  };

  const readonlyInput = {
    width: '100%',
    padding: '8px 12px',
    fontSize: 14,
    background: 'transparent',
    border: `1px solid ${colors.border}`,
    borderRadius: 6,
    color: colors.textMuted,
    fontFamily: fonts.sans,
    cursor: 'default',
  };

  const editableInput = {
    width: '100%',
    padding: '8px 12px',
    fontSize: 14,
    background: colors.surfaceRaised,
    border: `1px solid ${colors.border}`,
    borderRadius: 6,
    color: colors.text,
    fontFamily: fonts.sans,
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div style={{
        background: colors.surface,
        borderRadius: 8,
        padding: '24px 28px',
        maxWidth: 500,
        width: '100%',
        maxHeight: '80vh',
        overflowY: 'auto',
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: colors.text, marginBottom: editing ? 6 : 20 }}>
          {editing ? `Edit ${existingTarget!.period_label} Target` : 'Set Target'}
        </div>
        {editing && (
          <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 20 }}>
            Period and pipeline cannot be changed after creation. To change them, delete this target and create a new one.
          </div>
        )}

        {/* Period Label — read-only when editing */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: colors.textMuted, marginBottom: 6 }}>
            Period Label
          </label>
          <input
            type="text"
            value={periodLabel}
            onChange={(e) => !editing && setPeriodLabel(e.target.value)}
            readOnly={editing}
            placeholder="Q1 2026"
            style={editing ? readonlyInput : editableInput}
          />
        </div>

        {/* Pipeline — read-only when editing */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: colors.textMuted, marginBottom: 6 }}>
            Pipeline
          </label>
          {editing ? (
            <input
              type="text"
              value={existingTarget?.pipeline_name || 'All pipelines'}
              readOnly
              style={readonlyInput}
            />
          ) : (
            <>
              <select
                value={pipelineId}
                onChange={(e) => handlePipelineChange(e.target.value)}
                style={editableInput}
              >
                <option value="">All pipelines (workspace-wide)</option>
                {pipelines.map(p => (
                  <option key={p.id} value={p.id}>{anon.pipeline(p.name)}</option>
                ))}
              </select>
              <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 4 }}>
                Leave blank for a workspace-wide target across all pipelines
              </div>
            </>
          )}
        </div>

        {/* Target Type */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: colors.textMuted, marginBottom: 6 }}>
            Target Type
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${isMember ? '1' : '4'}, 1fr)`, gap: 6 }}>
            {(['company', 'board', 'team', 'individual'] as TargetType[])
              .filter(t => !isMember || t === 'individual') // Members can only create Individual targets
              .map(t => {
                const tc = TARGET_TYPE_COLORS[t];
                const isSelected = targetType === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => { setTargetType(t); if (t === 'company' || t === 'board') setAssignedToEmail(''); }}
                    disabled={isMember && t !== 'individual'}
                    style={{
                      padding: '7px 4px',
                      fontSize: 12,
                      fontWeight: 600,
                      fontFamily: fonts.sans,
                      borderRadius: 5,
                      border: isSelected ? `2px solid ${tc.text}` : `1px solid ${colors.border}`,
                      background: isSelected ? tc.bg : 'transparent',
                      color: isSelected ? tc.text : colors.textMuted,
                      cursor: 'pointer',
                      textTransform: 'capitalize',
                      transition: 'all 0.15s',
                    }}
                  >
                    {TARGET_TYPE_LABELS[t]}
                  </button>
                );
              })}
          </div>
          <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 4 }}>
            {isMember
              ? 'You can only create individual targets for yourself'
              : 'Company/Board = workspace-wide • Team = manager\'s pipeline • Individual = specific rep'}
          </div>
        </div>

        {/* Assignment — name dropdown from roster, or email fallback (shown for team and individual) */}
        {showAssignment && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: colors.textMuted, marginBottom: 6 }}>
              Assigned To {targetType === 'team' ? 'Manager' : 'Rep'}
              {isMember && <span style={{ fontSize: 10, marginLeft: 6, color: colors.textMuted }}>(read-only)</span>}
            </label>
            {filteredRosterReps.length > 0 && !isMember ? (
              <select
                value={assignedToEmail}
                onChange={e => setAssignedToEmail(e.target.value)}
                style={{ ...editableInput, appearance: 'auto' as any }}
              >
                <option value="">— select a {targetType === 'team' ? 'manager' : 'rep'} —</option>
                {filteredRosterReps.map(r => (
                  <option key={r.id} value={r.rep_email}>
                    {r.rep_name || r.rep_email}{r.pandora_role === 'manager' || r.is_manager ? ' (Manager)' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={assignedToEmail}
                readOnly={isMember}
                onChange={e => !isMember && setAssignedToEmail(e.target.value)}
                placeholder={
                  isMember
                    ? user?.email || 'your-email@company.com'
                    : targetType === 'team' ? 'manager@company.com' : 'rep@company.com'
                }
                style={isMember ? { ...readonlyInput, background: colors.surfaceRaised } : editableInput}
              />
            )}
            <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 4 }}>
              {filteredRosterReps.length > 0
                ? `${filteredRosterReps.length} ${targetType === 'team' ? 'manager(s)' : 'rep(s)'} on your roster`
                : 'Email address from your CRM — controls whose pipeline this target applies to'}
            </div>
          </div>
        )}

        {/* Dates — editable in both create and edit mode */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: colors.textMuted, marginBottom: 6 }}>
              Period Start
            </label>
            <input
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              style={editableInput}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: colors.textMuted, marginBottom: 6 }}>
              Period End
            </label>
            <input
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              style={editableInput}
            />
          </div>
        </div>

        {/* Amount — always editable */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: colors.textMuted, marginBottom: 6 }}>
            Target Amount
          </label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="1000000"
            style={editableInput}
          />
        </div>

        {/* Notes — always editable */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: colors.textMuted, marginBottom: 6 }}>
            Notes (optional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Board-approved plan, Jan 2026"
            rows={3}
            style={{ ...editableInput, resize: 'none' as const }}
          />
        </div>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px',
              fontSize: 14,
              fontWeight: 600,
              fontFamily: fonts.sans,
              background: colors.surfaceRaised,
              color: colors.text,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !amount}
            style={{
              padding: '8px 16px',
              fontSize: 14,
              fontWeight: 600,
              fontFamily: fonts.sans,
              background: saving || !amount ? colors.surfaceRaised : colors.accent,
              color: saving || !amount ? colors.textMuted : '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: saving || !amount ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Saving...' : editing ? 'Update Target' : 'Save Target'}
          </button>
        </div>
      </div>
    </div>
  );
}

function QuotaModal({ target, onClose, onSave }: {
  target: Target;
  onClose: () => void;
  onSave: () => void;
}) {
  const [pasteValue, setPasteValue] = useState('');
  const [parsedQuotas, setParsedQuotas] = useState<{ rep_email: string; amount: number }[]>([]);
  const [saving, setSaving] = useState(false);

  const handleParse = () => {
    const lines = pasteValue.trim().split('\n');
    const quotas = lines
      .map(line => {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 2) return null;
        const email = parts[0];
        const amount = parseFloat(parts[parts.length - 1].replace(/[,$]/g, ''));
        if (!email.includes('@') || isNaN(amount)) return null;
        return { rep_email: email, amount };
      })
      .filter(Boolean) as { rep_email: string; amount: number }[];

    setParsedQuotas(quotas);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.post('/quotas/bulk', {
        quotas: parsedQuotas.map(q => ({
          rep_email: q.rep_email,
          amount: q.amount,
          period_type: target.period_type,
          period_start: target.period_start,
          period_end: target.period_end,
          period_label: target.period_label,
          metric: target.metric,
        })),
        set_by: 'user@example.com', // TODO: get from auth context
      });
      onSave();
    } catch (err) {
      console.error('Failed to save quotas:', err);
      alert('Failed to save quotas');
    } finally {
      setSaving(false);
    }
  };

  const totalQuotas = parsedQuotas.reduce((sum, q) => sum + q.amount, 0);

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div style={{
        background: colors.surface,
        borderRadius: 8,
        padding: '24px 28px',
        maxWidth: 600,
        width: '100%',
        maxHeight: '80vh',
        overflowY: 'auto',
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: colors.text, marginBottom: 20 }}>
          Rep Quotas — {target.period_label}
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: colors.textMuted, marginBottom: 6 }}>
            Paste from spreadsheet (two columns: email, amount)
          </label>
          <textarea
            value={pasteValue}
            onChange={(e) => setPasteValue(e.target.value)}
            placeholder="alex@company.com        180000&#10;jamie@company.com       160000"
            rows={6}
            style={{
              width: '100%',
              padding: '12px',
              fontSize: 13,
              fontFamily: fonts.mono,
              background: colors.surfaceRaised,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              color: colors.text,
              resize: 'none',
            }}
          />
          <button
            onClick={handleParse}
            style={{
              marginTop: 8,
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 600,
              fontFamily: fonts.sans,
              background: colors.accent,
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Parse & Preview
          </button>
        </div>

        {parsedQuotas.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, marginBottom: 8 }}>
              Preview ({parsedQuotas.length} reps)
            </div>
            <div style={{
              background: colors.surfaceRaised,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              padding: 12,
              maxHeight: 200,
              overflowY: 'auto',
            }}>
              {parsedQuotas.map((q, i) => (
                <div key={i} style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 4, fontFamily: fonts.mono }}>
                  ✓ {q.rep_email} — ${q.amount.toLocaleString()}
                </div>
              ))}
            </div>
            <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 8 }}>
              Sum: ${totalQuotas.toLocaleString()} • Company target: ${target.amount.toLocaleString()}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px',
              fontSize: 14,
              fontWeight: 600,
              fontFamily: fonts.sans,
              background: colors.surfaceRaised,
              color: colors.text,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || parsedQuotas.length === 0}
            style={{
              padding: '8px 16px',
              fontSize: 14,
              fontWeight: 600,
              fontFamily: fonts.sans,
              background: saving || parsedQuotas.length === 0 ? colors.surfaceRaised : colors.accent,
              color: saving || parsedQuotas.length === 0 ? colors.textMuted : '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: saving || parsedQuotas.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Saving...' : 'Save Quotas'}
          </button>
        </div>
      </div>
    </div>
  );
}
