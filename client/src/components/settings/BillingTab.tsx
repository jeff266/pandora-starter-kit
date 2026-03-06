import React, { useState, useEffect } from 'react';
import { colors, fonts } from '../../styles/theme';
import { api } from '../../lib/api';
import { useWorkspace } from '../../context/WorkspaceContext';

interface UsageStats {
  skill_runs_this_month: number;
  member_count: number;
  storage_docs: number;
  storage_docs_breakdown: { synced: number; generated: number };
  token_usage_this_month: {
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
  };
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export default function BillingTab() {
  const { currentWorkspace } = useWorkspace();
  const [usage, setUsage] = useState<UsageStats | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(true);

  const currentPlan = 'Starter';
  const billingUrl = (import.meta as any).env?.VITE_BILLING_URL || 'https://billing.pandora.example.com';
  const supportEmail = 'support@pandora.com';

  useEffect(() => {
    if (!currentWorkspace?.id) return;
    setLoadingUsage(true);
    api.get(`/workspaces/${currentWorkspace.id}/usage`)
      .then((data: any) => setUsage(data))
      .catch(() => setUsage(null))
      .finally(() => setLoadingUsage(false));
  }, [currentWorkspace?.id]);

  const handleManageBilling = () => {
    window.open(billingUrl, '_blank', 'noopener,noreferrer');
  };

  const monthName = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });

  return (
    <div style={{ maxWidth: 700, fontFamily: fonts.sans }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, color: colors.text, marginBottom: 8 }}>
        Billing
      </h1>
      <p style={{ fontSize: 14, color: colors.textSecondary, marginBottom: 32 }}>
        Manage your subscription and billing
      </p>

      {/* Current Plan Card */}
      <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8, padding: 32, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.text, margin: 0 }}>Current Plan</h2>
          <span style={{ fontSize: 13, fontWeight: 600, color: colors.accent, background: colors.accentSoft, padding: '4px 12px', borderRadius: 6 }}>
            {currentPlan}
          </span>
        </div>

        <p style={{ fontSize: 14, color: colors.textSecondary, marginBottom: 20, lineHeight: 1.6 }}>
          {currentPlan === 'Starter' ? 'Basic revenue operations tools for small teams.' :
           currentPlan === 'Growth' ? 'Advanced automation and analytics for growing teams.' :
           currentPlan === 'Enterprise' ? 'Full-featured platform with custom integrations and dedicated support.' :
           'Custom plan for your organization.'}
        </p>

        <div style={{ fontSize: 13, color: colors.textMuted, marginBottom: 24 }}>
          <span style={{ color: colors.text, fontWeight: 500 }}>12 of 20</span> features active
        </div>

        <button
          onClick={handleManageBilling}
          style={{ padding: '10px 20px', fontSize: 14, fontWeight: 500, fontFamily: fonts.sans, color: '#fff', background: colors.accent, border: 'none', borderRadius: 6, cursor: 'pointer' }}
        >
          Manage Billing
        </button>
      </div>

      {/* Usage Section */}
      <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8, padding: 32, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: colors.text, margin: 0 }}>Usage</h2>
          <span style={{ fontSize: 11, color: colors.textMuted }}>{monthName}</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Members */}
          <UsageRow
            label="Members"
            value={loadingUsage ? null : (usage ? `${usage.member_count} / unlimited` : '--')}
            mono
          />

          {/* Skill Runs */}
          <UsageRow
            label="Skill runs this month"
            value={loadingUsage ? null : (usage ? usage.skill_runs_this_month.toLocaleString() : '--')}
            tooltip="Counts all skill executions (scheduled and manual) since the 1st of this month."
            mono
          />

          {/* Storage */}
          <UsageRow
            label="Storage used"
            value={loadingUsage ? null : (usage ? `${usage.storage_docs.toLocaleString()} docs` : '--')}
            tooltip={usage ? `${usage.storage_docs_breakdown.synced.toLocaleString()} synced from connectors · ${usage.storage_docs_breakdown.generated.toLocaleString()} AI-generated` : undefined}
            mono
          />

          {/* AI Tokens */}
          <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 12, color: colors.textMuted, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              AI Usage this month
            </div>
            <UsageRow
              label="Tokens used"
              value={loadingUsage ? null : (usage ? fmtTokens(usage.token_usage_this_month.input_tokens + usage.token_usage_this_month.output_tokens) : '--')}
              tooltip={usage ? `${fmtTokens(usage.token_usage_this_month.input_tokens)} input · ${fmtTokens(usage.token_usage_this_month.output_tokens)} output` : undefined}
              mono
            />
            <UsageRow
              label="Estimated AI cost"
              value={loadingUsage ? null : (usage ? `$${usage.token_usage_this_month.cost_usd.toFixed(4)}` : '--')}
              tooltip="Pandora platform cost before markup. See Token Usage tab for full breakdown."
              mono
              linkTo="/settings/token-usage"
              linkLabel="View breakdown →"
            />
          </div>
        </div>
      </div>

      {/* Support Info */}
      <div style={{ padding: 16, background: colors.accentSoft, border: `1px solid ${colors.accent}`, borderRadius: 6, fontSize: 13, color: colors.text }}>
        For billing questions, contact{' '}
        <a href={`mailto:${supportEmail}`} style={{ color: colors.accent, textDecoration: 'underline', fontWeight: 500 }}>
          {supportEmail}
        </a>
      </div>
    </div>
  );
}

interface UsageRowProps {
  label: string;
  value: string | number | null;
  tooltip?: string;
  mono?: boolean;
  linkTo?: string;
  linkLabel?: string;
}

function UsageRow({ label, value, tooltip, mono, linkTo, linkLabel }: UsageRowProps) {
  const [showTip, setShowTip] = useState(false);

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 14, color: colors.textSecondary }}>{label}</span>
        {tooltip && (
          <span
            onMouseEnter={() => setShowTip(true)}
            onMouseLeave={() => setShowTip(false)}
            style={{ position: 'relative', display: 'inline-flex', cursor: 'default' }}
          >
            <span style={{ fontSize: 11, color: colors.textMuted, background: colors.surfaceRaised, border: `1px solid ${colors.border}`, borderRadius: '50%', width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, userSelect: 'none' }}>?</span>
            {showTip && (
              <span style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 6, background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 5, padding: '6px 10px', fontSize: 11, color: colors.textSecondary, whiteSpace: 'nowrap', zIndex: 100, boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}>
                {tooltip}
              </span>
            )}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {linkTo && linkLabel && (
          <a href={linkTo} style={{ fontSize: 12, color: colors.accent, textDecoration: 'none' }}>{linkLabel}</a>
        )}
        <span style={{ fontSize: 14, color: value === null ? colors.textMuted : colors.text, fontWeight: 500, fontFamily: mono ? fonts.mono : fonts.sans }}>
          {value === null ? '…' : (value || '--')}
        </span>
      </div>
    </div>
  );
}
