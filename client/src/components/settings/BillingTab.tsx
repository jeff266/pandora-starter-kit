import React from 'react';
import { colors, fonts } from '../../styles/theme';

export default function BillingTab() {
  const currentPlan = 'Starter'; // TODO: Fetch from API
  const billingUrl = (import.meta as any).env?.VITE_BILLING_URL || 'https://billing.pandora.example.com';
  const supportEmail = 'support@pandora.com';

  const handleManageBilling = () => {
    window.open(billingUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div style={{ maxWidth: 700, fontFamily: fonts.sans }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, color: colors.text, marginBottom: 8 }}>
        Billing
      </h1>
      <p style={{ fontSize: 14, color: colors.textSecondary, marginBottom: 32 }}>
        Manage your subscription and billing
      </p>

      {/* Current Plan Card */}
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 32,
          marginBottom: 24,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.text }}>
            Current Plan
          </h2>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: colors.accent,
              background: colors.accentSoft,
              padding: '4px 12px',
              borderRadius: 6,
            }}
          >
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
          style={{
            padding: '10px 20px',
            fontSize: 14,
            fontWeight: 500,
            fontFamily: fonts.sans,
            color: '#fff',
            background: colors.accent,
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          Manage Billing
        </button>
      </div>

      {/* Usage Section */}
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 32,
          marginBottom: 24,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600, color: colors.text, marginBottom: 20 }}>
          Usage
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Members */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 14, color: colors.textSecondary }}>Members</span>
            <span style={{ fontSize: 14, color: colors.text, fontWeight: 500, fontFamily: fonts.mono }}>
              8 / unlimited
            </span>
          </div>

          {/* Skill Runs */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 14, color: colors.textSecondary }}>Skill runs this month</span>
            <span style={{ fontSize: 14, color: colors.textMuted, fontFamily: fonts.mono }}>
              --
            </span>
          </div>

          {/* Storage */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 14, color: colors.textSecondary }}>Storage used</span>
            <span style={{ fontSize: 14, color: colors.textMuted, fontFamily: fonts.mono }}>
              --
            </span>
          </div>
        </div>
      </div>

      {/* Support Info */}
      <div
        style={{
          padding: 16,
          background: colors.accentSoft,
          border: `1px solid ${colors.accent}`,
          borderRadius: 6,
          fontSize: 13,
          color: colors.text,
        }}
      >
        For billing questions, contact{' '}
        <a
          href={`mailto:${supportEmail}`}
          style={{
            color: colors.accent,
            textDecoration: 'underline',
            fontWeight: 500,
          }}
        >
          {supportEmail}
        </a>
      </div>
    </div>
  );
}
