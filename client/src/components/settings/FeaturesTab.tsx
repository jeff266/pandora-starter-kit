import React, { useState, useEffect } from 'react';
import { colors, fonts } from '../../styles/theme';
import { api } from '../../lib/api';
import Toast from '../Toast';

interface Feature {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  plan_required?: string;
  requires_connector?: string;
  type: 'feature' | 'capability';
}

export default function FeaturesTab() {
  const [features, setFeatures] = useState<Feature[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [currentPlan, setCurrentPlan] = useState('Starter');
  const [forceAnonymize, setForceAnonymize] = useState(false);

  useEffect(() => {
    fetchFeatures();
  }, []);

  const fetchFeatures = async () => {
    try {
      setLoading(true);
      // TODO: Replace with actual API call when endpoint exists
      // const data = await api.get('/flags');

      // Mock data for now
      const mockFeatures: Feature[] = [
        {
          key: 'custom_roles',
          name: 'Custom Roles',
          description: 'Create custom workspace roles with granular permissions',
          enabled: false,
          plan_required: 'Growth',
          type: 'feature',
        },
        {
          key: 'conversation_intelligence',
          name: 'Conversation Intelligence',
          description: 'Analyze sales calls for insights and coaching opportunities',
          enabled: false,
          requires_connector: 'Gong or Fireflies',
          type: 'feature',
        },
        {
          key: 'advanced_analytics',
          name: 'Advanced Analytics',
          description: 'Deep-dive pipeline analytics and forecasting models',
          enabled: true,
          type: 'feature',
        },
        {
          key: 'api_access',
          name: 'API Access',
          description: 'Programmatic access to your workspace data',
          enabled: false,
          plan_required: 'Enterprise',
          type: 'feature',
        },
        {
          key: 'sso',
          name: 'Single Sign-On',
          description: 'SAML-based SSO for enterprise authentication',
          enabled: false,
          plan_required: 'Enterprise',
          type: 'feature',
        },
        {
          key: 'export_data',
          name: 'Data Export',
          description: 'Export workspace data to CSV and Excel formats',
          enabled: true,
          type: 'capability',
        },
        {
          key: 'slack_notifications',
          name: 'Slack Notifications',
          description: 'Receive finding and action notifications in Slack',
          enabled: true,
          type: 'capability',
        },
        {
          key: 'email_digests',
          name: 'Email Digests',
          description: 'Daily or weekly summary emails of key metrics',
          enabled: false,
          type: 'capability',
        },
      ];

      setFeatures(mockFeatures);
      setCurrentPlan('Starter'); // TODO: Fetch from workspace data
      setForceAnonymize(false); // TODO: Fetch from workspace settings
    } catch (err) {
      console.error('Failed to fetch features:', err);
      setToast({ message: 'Failed to load features', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleToggleFeature = async (featureKey: string, newValue: boolean) => {
    const feature = features.find(f => f.key === featureKey);
    if (!feature) return;

    // Optimistic update
    setFeatures(prev => prev.map(f => f.key === featureKey ? { ...f, enabled: newValue } : f));

    try {
      // await api.patch(`/flags/${featureKey}`, { value: newValue });
      setToast({ message: `${feature.name} ${newValue ? 'enabled' : 'disabled'}`, type: 'success' });
    } catch (err) {
      // Revert on error
      setFeatures(prev => prev.map(f => f.key === featureKey ? { ...f, enabled: !newValue } : f));
      console.error('Failed to toggle feature:', err);
      setToast({ message: 'Failed to update feature', type: 'error' });
    }
  };

  const handleToggleForceAnonymize = async (newValue: boolean) => {
    setForceAnonymize(newValue);
    try {
      // await api.patch('/workspace/settings', { force_anonymize: newValue });
      setToast({ message: `Force anonymize ${newValue ? 'enabled' : 'disabled'}`, type: 'success' });
    } catch (err) {
      setForceAnonymize(!newValue);
      console.error('Failed to toggle force anonymize:', err);
      setToast({ message: 'Failed to update setting', type: 'error' });
    }
  };

  const handleUpgrade = () => {
    window.open('https://billing.pandora.example.com', '_blank', 'noopener,noreferrer');
  };

  const featuresList = features.filter(f => f.type === 'feature');
  const capabilitiesList = features.filter(f => f.type === 'capability');

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <div style={{
          width: 32,
          height: 32,
          border: `3px solid ${colors.border}`,
          borderTopColor: colors.accent,
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
          margin: '0 auto',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 900, fontFamily: fonts.sans }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, color: colors.text, marginBottom: 8 }}>
        Features
      </h1>
      <p style={{ fontSize: 14, color: colors.textSecondary, marginBottom: 32 }}>
        Enable and configure workspace features
      </p>

      {/* Plan Summary Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 16,
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          marginBottom: 32,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 14, color: colors.textSecondary }}>Current plan:</span>
          <span
            style={{
              fontSize: 14,
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
        <button
          onClick={handleUpgrade}
          style={{
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 500,
            fontFamily: fonts.sans,
            color: colors.accent,
            background: 'transparent',
            border: `1px solid ${colors.accent}`,
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          Upgrade Plan
        </button>
      </div>

      {/* Force Anonymize Banner */}
      {forceAnonymize && (
        <div
          style={{
            padding: 16,
            background: colors.accentSoft,
            border: `1px solid ${colors.accent}`,
            borderRadius: 6,
            marginBottom: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <p style={{ fontSize: 14, color: colors.text, fontWeight: 500, marginBottom: 4 }}>
              Force Anonymize is ON
            </p>
            <p style={{ fontSize: 13, color: colors.textSecondary }}>
              All output is anonymized for everyone in this workspace.
            </p>
          </div>
          <div
            onClick={() => handleToggleForceAnonymize(false)}
            style={{
              width: 48,
              height: 26,
              borderRadius: 13,
              background: colors.accent,
              position: 'relative',
              cursor: 'pointer',
              transition: 'background 0.2s',
              flexShrink: 0,
            }}
          >
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: '#fff',
                position: 'absolute',
                top: 3,
                left: 25,
                transition: 'left 0.2s',
                boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
              }}
            />
          </div>
        </div>
      )}

      {/* Features Section */}
      <div style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.text, marginBottom: 20 }}>
          Features
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))',
            gap: 16,
          }}
        >
          {featuresList.map(feature => (
            <FeatureCard
              key={feature.key}
              feature={feature}
              currentPlan={currentPlan}
              onToggle={handleToggleFeature}
              onUpgrade={handleUpgrade}
            />
          ))}
        </div>
      </div>

      {/* Capabilities Section */}
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.text, marginBottom: 20 }}>
          Capabilities
        </h2>
        <div
          style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            overflow: 'hidden',
          }}
        >
          {capabilitiesList.map((capability, index) => (
            <CapabilityRow
              key={capability.key}
              capability={capability}
              isLast={index === capabilitiesList.length - 1}
              onToggle={handleToggleFeature}
            />
          ))}
        </div>
      </div>

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  );
}

function FeatureCard({
  feature,
  currentPlan,
  onToggle,
  onUpgrade,
}: {
  feature: Feature;
  currentPlan: string;
  onToggle: (key: string, value: boolean) => void;
  onUpgrade: () => void;
}) {
  const needsUpgrade = feature.plan_required && feature.plan_required !== currentPlan;
  const isLocked = needsUpgrade || false;

  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: 20,
        opacity: isLocked ? 0.7 : 1,
      }}
    >
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: colors.text, marginBottom: 6 }}>
          {feature.name}
        </h3>
        <p style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.5 }}>
          {feature.description}
        </p>
      </div>

      {feature.requires_connector && (
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: colors.textMuted,
            background: colors.surfaceHover,
            padding: '3px 8px',
            borderRadius: 4,
            display: 'inline-block',
            marginBottom: 12,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Requires {feature.requires_connector}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
        {needsUpgrade ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 16 }}>🔒</span>
              <span style={{ fontSize: 13, color: colors.textMuted }}>{feature.plan_required} plan</span>
            </div>
            <button
              onClick={onUpgrade}
              style={{
                padding: '6px 12px',
                fontSize: 12,
                fontWeight: 500,
                fontFamily: fonts.sans,
                color: colors.accent,
                background: 'transparent',
                border: `1px solid ${colors.accent}`,
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              Upgrade
            </button>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: feature.enabled ? colors.green : colors.textDim,
                }}
              />
              <span style={{ fontSize: 13, color: feature.enabled ? colors.green : colors.textMuted, fontWeight: 500 }}>
                {feature.enabled ? 'Active' : 'Inactive'}
              </span>
            </div>
            <div
              onClick={() => onToggle(feature.key, !feature.enabled)}
              style={{
                width: 48,
                height: 26,
                borderRadius: 13,
                background: feature.enabled ? colors.accent : colors.surfaceHover,
                position: 'relative',
                cursor: 'pointer',
                transition: 'background 0.2s',
              }}
            >
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  background: '#fff',
                  position: 'absolute',
                  top: 3,
                  left: feature.enabled ? 25 : 3,
                  transition: 'left 0.2s',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CapabilityRow({
  capability,
  isLast,
  onToggle,
}: {
  capability: Feature;
  isLast: boolean;
  onToggle: (key: string, value: boolean) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 20,
        borderBottom: isLast ? 'none' : `1px solid ${colors.border}`,
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: colors.text, marginBottom: 4 }}>
          {capability.name}
        </div>
        <div style={{ fontSize: 13, color: colors.textSecondary }}>
          {capability.description}
        </div>
      </div>
      <div
        onClick={() => onToggle(capability.key, !capability.enabled)}
        style={{
          width: 48,
          height: 26,
          borderRadius: 13,
          background: capability.enabled ? colors.accent : colors.surfaceHover,
          position: 'relative',
          cursor: 'pointer',
          transition: 'background 0.2s',
          flexShrink: 0,
          marginLeft: 20,
        }}
      >
        <div
          style={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: '#fff',
            position: 'absolute',
            top: 3,
            left: capability.enabled ? 25 : 3,
            transition: 'left 0.2s',
            boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
          }}
        />
      </div>
    </div>
  );
}
