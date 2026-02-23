import { useState, useEffect } from 'react';
import { colors, fonts } from '../../styles/theme';
import { api, getWorkspaceId } from '../../lib/api';
import StatusDot from '../shared/StatusDot';
import { formatTimeAgo } from '../../lib/format';

interface ApolloConnectorProps {
  onToast: (toast: { message: string; type: 'success' | 'error' }) => void;
}

interface ApolloStats {
  total_enriched: number;
  apollo_count: number;
  webhook_count: number;
  csv_count: number;
  average_confidence: number;
  last_enrichment?: string;
  apollo_connected: boolean;
}

export default function ApolloConnector({ onToast }: ApolloConnectorProps) {
  const [apiKey, setApiKey] = useState('');
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [running, setRunning] = useState(false);
  const [stats, setStats] = useState<ApolloStats | null>(null);

  useEffect(() => {
    loadStats();
  }, []);

  async function loadStats() {
    try {
      const data = await api.get<ApolloStats>(`/enrichment/apollo/stats`);
      setStats(data);
      setConnected(data.apollo_connected);
    } catch (error) {
      console.error('Failed to load Apollo stats:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleConnect() {
    if (!apiKey.trim()) {
      onToast({ message: 'Please enter an API key', type: 'error' });
      return;
    }

    setConnecting(true);
    try {
      await api.post(`/enrichment/apollo/connect`, { api_key: apiKey });
      onToast({ message: 'Apollo connected successfully', type: 'success' });
      setApiKey('');
      setConnected(true);
      await loadStats();
    } catch (error: any) {
      onToast({ message: error.message || 'Failed to connect Apollo', type: 'error' });
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm('Disconnect Apollo? Your enriched data will remain.')) return;

    try {
      await api.post(`/enrichment/apollo/disconnect`);
      onToast({ message: 'Apollo disconnected', type: 'success' });
      setConnected(false);
      await loadStats();
    } catch (error: any) {
      onToast({ message: error.message || 'Failed to disconnect', type: 'error' });
    }
  }

  async function handleRunEnrichment() {
    setRunning(true);
    try {
      const result = await api.post<{
        success: boolean;
        total_accounts: number;
        enriched_count: number;
        failed_count: number;
        average_confidence: number;
      }>(`/enrichment/apollo/run`);

      if (result.success) {
        onToast({
          message: `Enriched ${result.enriched_count} accounts (avg confidence: ${result.average_confidence.toFixed(2)})`,
          type: 'success',
        });
      } else {
        onToast({ message: 'Enrichment completed with errors', type: 'error' });
      }
      await loadStats();
    } catch (error: any) {
      onToast({ message: error.message || 'Enrichment failed', type: 'error' });
    } finally {
      setRunning(false);
    }
  }

  const statusColor = connected
    ? stats?.apollo_count && stats.apollo_count > 0
      ? colors.green
      : colors.yellow
    : colors.textMuted;

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
              Apollo
            </h2>
            <StatusDot color={statusColor} size={8} />
          </div>
          <p style={{ fontSize: 13, color: colors.textSecondary, margin: 0 }}>
            Direct API integration
          </p>
        </div>
        {connected && stats && (
          <div
            style={{
              padding: '6px 12px',
              background: colors.greenSoft,
              border: `1px solid ${colors.green}`,
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              color: colors.green,
            }}
          >
            {stats.apollo_count} enriched
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
      ) : !connected ? (
        /* Not Connected State */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: 13,
                fontWeight: 500,
                color: colors.text,
                marginBottom: 8,
              }}
            >
              API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="Enter your Apollo API key"
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: 14,
                fontFamily: fonts.sans,
                color: colors.text,
                background: colors.surfaceRaised,
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                outline: 'none',
              }}
              onFocus={e => (e.target.style.borderColor = colors.borderFocus)}
              onBlur={e => (e.target.style.borderColor = colors.border)}
            />
          </div>

          <button
            onClick={handleConnect}
            disabled={connecting || !apiKey.trim()}
            style={{
              padding: '10px 20px',
              fontSize: 14,
              fontWeight: 500,
              fontFamily: fonts.sans,
              color: connecting || !apiKey.trim() ? colors.textMuted : '#fff',
              background: connecting || !apiKey.trim() ? colors.surfaceHover : colors.accent,
              border: 'none',
              borderRadius: 6,
              cursor: connecting || !apiKey.trim() ? 'not-allowed' : 'pointer',
              transition: 'background 0.2s',
            }}
          >
            {connecting ? 'Connecting...' : 'Connect Apollo'}
          </button>

          <div
            style={{
              padding: 12,
              background: colors.accentSoft,
              border: `1px solid ${colors.accent}`,
              borderRadius: 6,
              fontSize: 12,
              color: colors.textSecondary,
              lineHeight: 1.5,
            }}
          >
            Your API key is encrypted and stored securely. Once connected, Pandora will enrich your
            closed-won accounts with firmographic data from Apollo.
          </div>
        </div>
      ) : (
        /* Connected State */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Stats */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 12,
            }}
          >
            <div>
              <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 4 }}>
                Accounts Enriched
              </div>
              <div style={{ fontSize: 20, fontWeight: 600, color: colors.text }}>
                {stats?.apollo_count || 0}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 4 }}>
                Avg Confidence
              </div>
              <div style={{ fontSize: 20, fontWeight: 600, color: colors.text }}>
                {stats?.average_confidence ? (stats.average_confidence * 100).toFixed(0) + '%' : '—'}
              </div>
            </div>
          </div>

          {stats?.last_enrichment && (
            <div style={{ fontSize: 12, color: colors.textSecondary }}>
              Last enrichment: {formatTimeAgo(new Date(stats.last_enrichment))}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleRunEnrichment}
              disabled={running}
              style={{
                flex: 1,
                padding: '10px 16px',
                fontSize: 14,
                fontWeight: 500,
                fontFamily: fonts.sans,
                color: running ? colors.textMuted : '#fff',
                background: running ? colors.surfaceHover : colors.accent,
                border: 'none',
                borderRadius: 6,
                cursor: running ? 'not-allowed' : 'pointer',
                transition: 'background 0.2s',
              }}
            >
              {running ? 'Running...' : 'Run Enrichment Now'}
            </button>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleDisconnect}
              style={{
                flex: 1,
                padding: '8px 12px',
                fontSize: 13,
                fontWeight: 500,
                fontFamily: fonts.sans,
                color: colors.textSecondary,
                background: 'transparent',
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = colors.surfaceHover;
                e.currentTarget.style.color = colors.text;
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = colors.textSecondary;
              }}
            >
              Disconnect
            </button>
          </div>
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
