import { useState, useEffect } from 'react';
import { colors, fonts } from '../../styles/theme';
import { api, getWorkspaceId } from '../../lib/api';
import StatusDot from '../shared/StatusDot';
import { formatTimeAgo } from '../../lib/format';

interface WebhookConnectorProps {
  onToast: (toast: { message: string; type: 'success' | 'error' }) => void;
}

interface OutboundConfig {
  configured: boolean;
  endpoint_url?: string;
  is_active?: boolean;
  last_test?: { at: string; success: boolean; error?: string };
}

interface InboundUrl {
  webhook_url: string;
  created_at: string;
}

interface InboundHistory {
  batch_id: string;
  records_received: number;
  records_matched: number;
  records_failed: number;
  received_at: string;
}

interface DLQItem {
  id: string;
  batch_id: string;
  failed_at: string;
  replayed: boolean;
}

export default function WebhookConnector({ onToast }: WebhookConnectorProps) {
  const [outboundUrl, setOutboundUrl] = useState('');
  const [outboundConfig, setOutboundConfig] = useState<OutboundConfig | null>(null);
  const [inboundUrl, setInboundUrl] = useState<InboundUrl | null>(null);
  const [inboundHistory, setInboundHistory] = useState<InboundHistory[]>([]);
  const [dlqItems, setDLQItems] = useState<DLQItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [rotating, setRotating] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [outbound, inbound, history, dlq] = await Promise.all([
        api.get<OutboundConfig>(`/enrichment/webhook/outbound/config`),
        api.get<InboundUrl>(`/enrichment/webhook/inbound/url`),
        api.get<{ history: InboundHistory[] }>(`/enrichment/webhook/inbound/history?limit=5`),
        api.get<{ items: DLQItem[] }>(`/enrichment/webhook/dlq`),
      ]);

      setOutboundConfig(outbound);
      if (outbound.configured && outbound.endpoint_url) {
        setOutboundUrl(outbound.endpoint_url);
      }
      setInboundUrl(inbound);
      setInboundHistory(history.history);
      setDLQItems(dlq.items.filter(item => !item.replayed));
    } catch (error) {
      console.error('Failed to load webhook data:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveOutbound() {
    if (!outboundUrl.trim()) {
      onToast({ message: 'Please enter a webhook URL', type: 'error' });
      return;
    }

    setSaving(true);
    try {
      await api.post(`/enrichment/webhook/outbound/config`, {
        endpoint_url: outboundUrl,
      });
      onToast({ message: 'Outbound webhook saved', type: 'success' });
      await loadData();
    } catch (error: any) {
      onToast({ message: error.message || 'Failed to save', type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    setTesting(true);
    try {
      await api.post(`/enrichment/webhook/outbound/test`);
      onToast({ message: 'Connection test successful', type: 'success' });
      await loadData();
    } catch (error: any) {
      onToast({ message: error.message || 'Connection test failed', type: 'error' });
    } finally {
      setTesting(false);
    }
  }

  async function handleTriggerOutbound() {
    try {
      await api.post(`/enrichment/webhook/outbound/trigger`);
      onToast({ message: 'Enrichment triggered', type: 'success' });
    } catch (error: any) {
      onToast({ message: error.message || 'Failed to trigger', type: 'error' });
    }
  }

  async function handleRotateToken() {
    if (!confirm('Rotate webhook token? You must update your workflow with the new URL.')) return;

    setRotating(true);
    try {
      const result = await api.post<InboundUrl>(`/enrichment/webhook/inbound/rotate`);
      setInboundUrl(result);
      onToast({ message: 'Token rotated. Update your workflow!', type: 'success' });
    } catch (error: any) {
      onToast({ message: error.message || 'Failed to rotate', type: 'error' });
    } finally {
      setRotating(false);
    }
  }

  function handleCopyUrl() {
    if (!inboundUrl) return;
    navigator.clipboard.writeText(inboundUrl.webhook_url);
    onToast({ message: 'URL copied to clipboard', type: 'success' });
  }

  const statusColor =
    outboundConfig?.configured && inboundHistory.length > 0 ? colors.green : colors.textMuted;

  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.text, margin: 0 }}>
              Webhook
            </h2>
            <StatusDot color={statusColor} size={8} />
          </div>
          <p style={{ fontSize: 13, color: colors.textSecondary, margin: 0 }}>
            Bidirectional (Clay, Zapier, Make)
          </p>
        </div>
        {dlqItems.length > 0 && (
          <div
            style={{
              padding: '6px 12px',
              background: colors.redSoft,
              border: `1px solid ${colors.red}`,
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              color: colors.red,
            }}
          >
            {dlqItems.length} failed
          </div>
        )}
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <div
            style={{
              width: 32,
              height: 32,
              border: `3px solid ${colors.border}`,
              borderTopColor: colors.accent,
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
              margin: '0 auto',
            }}
          />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Outbound Panel */}
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 12 }}>
              Outbound (Pandora → Your Tool)
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <input
                type="text"
                value={outboundUrl}
                onChange={e => setOutboundUrl(e.target.value)}
                placeholder="https://hooks.clay.com/..."
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  fontSize: 13,
                  fontFamily: fonts.mono,
                  color: colors.text,
                  background: colors.surfaceRaised,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  outline: 'none',
                }}
                onFocus={e => (e.target.style.borderColor = colors.borderFocus)}
                onBlur={e => (e.target.style.borderColor = colors.border)}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handleTestConnection}
                  disabled={testing || !outboundConfig?.configured}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    fontSize: 13,
                    fontWeight: 500,
                    fontFamily: fonts.sans,
                    color: testing || !outboundConfig?.configured ? colors.textMuted : colors.text,
                    background: 'transparent',
                    border: `1px solid ${colors.border}`,
                    borderRadius: 6,
                    cursor: testing || !outboundConfig?.configured ? 'not-allowed' : 'pointer',
                  }}
                >
                  {testing ? 'Testing...' : 'Test Connection'}
                </button>
                <button
                  onClick={handleSaveOutbound}
                  disabled={saving}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    fontSize: 13,
                    fontWeight: 500,
                    fontFamily: fonts.sans,
                    color: saving ? colors.textMuted : '#fff',
                    background: saving ? colors.surfaceHover : colors.accent,
                    border: 'none',
                    borderRadius: 6,
                    cursor: saving ? 'not-allowed' : 'pointer',
                  }}
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
              {outboundConfig?.configured && (
                <button
                  onClick={handleTriggerOutbound}
                  style={{
                    padding: '8px 12px',
                    fontSize: 13,
                    fontWeight: 500,
                    fontFamily: fonts.sans,
                    color: '#fff',
                    background: colors.accent,
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                  }}
                >
                  Trigger Enrichment
                </button>
              )}
            </div>
          </div>

          {/* Inbound Panel */}
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 12 }}>
              Inbound (Your Tool → Pandora)
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div
                style={{
                  padding: '10px 12px',
                  fontSize: 11,
                  fontFamily: fonts.mono,
                  color: colors.text,
                  background: colors.surfaceRaised,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  wordBreak: 'break-all',
                }}
              >
                {inboundUrl?.webhook_url || 'Loading...'}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handleCopyUrl}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    fontSize: 13,
                    fontWeight: 500,
                    fontFamily: fonts.sans,
                    color: colors.text,
                    background: 'transparent',
                    border: `1px solid ${colors.border}`,
                    borderRadius: 6,
                    cursor: 'pointer',
                  }}
                >
                  Copy URL
                </button>
                <button
                  onClick={handleRotateToken}
                  disabled={rotating}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    fontSize: 13,
                    fontWeight: 500,
                    fontFamily: fonts.sans,
                    color: rotating ? colors.textMuted : colors.text,
                    background: 'transparent',
                    border: `1px solid ${colors.border}`,
                    borderRadius: 6,
                    cursor: rotating ? 'not-allowed' : 'pointer',
                  }}
                >
                  {rotating ? 'Rotating...' : 'Rotate Token'}
                </button>
              </div>
            </div>
          </div>

          {/* Last Inbound */}
          {inboundHistory.length > 0 && (
            <div style={{ fontSize: 12, color: colors.textSecondary }}>
              Last inbound: {formatTimeAgo(new Date(inboundHistory[0].received_at))} (
              {inboundHistory[0].records_matched} matched)
            </div>
          )}

          {/* DLQ Replay */}
          {dlqItems.length > 0 && (
            <div
              style={{
                padding: 12,
                background: colors.redSoft,
                border: `1px solid ${colors.red}`,
                borderRadius: 6,
                fontSize: 12,
                color: colors.text,
              }}
            >
              {dlqItems.length} failed delivery{dlqItems.length > 1 ? 'ies' : 'y'} in dead letter
              queue. Review and replay from history.
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
