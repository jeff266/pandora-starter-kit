import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { formatTimeAgo } from '../lib/format';
import Skeleton from '../components/Skeleton';
import Toast from '../components/Toast';

const sourceIcons: Record<string, { color: string; letter: string }> = {
  hubspot: { color: '#ff7a59', letter: 'H' },
  salesforce: { color: '#00a1e0', letter: 'S' },
  gong: { color: '#7c3aed', letter: 'G' },
  fireflies: { color: '#f59e0b', letter: 'F' },
  monday: { color: '#6161ff', letter: 'M' },
  'google-drive': { color: '#4285f4', letter: 'D' },
  'file-import': { color: '#64748b', letter: 'I' },
};

interface Connector {
  type: string;
  status: string;
  last_sync_at: string | null;
  health: 'green' | 'yellow' | 'red';
  last_error: string | null;
  record_counts: {
    deals: number;
    contacts: number;
    accounts: number;
    conversations: number;
  };
}

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

export default function ConnectorsPage() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingConnector, setSyncingConnector] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = React.useRef(0);

  const fetchConnectors = async () => {
    try {
      const data = await api.get('/connectors/status');
      setConnectors(Array.isArray(data.connectors) ? data.connectors : []);
    } catch (error) {
      // Fallback to /connectors endpoint
      try {
        const fallbackData = await api.get('/connectors');
        const mappedConnectors = (Array.isArray(fallbackData) ? fallbackData : fallbackData.connectors || []).map((c: any) => ({
          type: c.source_type || c.name || 'unknown',
          status: c.status || 'unknown',
          last_sync_at: c.last_sync_at || c.last_sync || null,
          health: 'green' as const,
          last_error: c.error_message || null,
          record_counts: {
            deals: c.record_counts?.deals || 0,
            contacts: c.record_counts?.contacts || 0,
            accounts: c.record_counts?.accounts || 0,
            conversations: c.record_counts?.conversations || 0,
          },
        }));
        setConnectors(mappedConnectors);
      } catch (fallbackError) {
        console.error('Failed to fetch connectors:', fallbackError);
        setConnectors([]);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConnectors();
  }, []);

  const addToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
  };

  const removeToast = (id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const handleSyncNow = async (connectorType: string) => {
    setSyncingConnector(connectorType);
    try {
      await api.post('/sync/trigger', { source_type: connectorType });
      addToast(`${connectorType} sync triggered successfully`, 'success');
      // Re-fetch connector status after sync
      setTimeout(() => fetchConnectors(), 1000);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to trigger sync';
      addToast(`Sync failed: ${errorMsg}`, 'error');
    } finally {
      setSyncingConnector(null);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} height={280} borderRadius={10} />
        ))}
      </div>
    );
  }

  if (connectors.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 60 }}>
        <p style={{ fontSize: 15, color: colors.textSecondary }}>Connect your first data source to get started.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginTop: 24 }}>
          {Object.entries(sourceIcons).map(([key, { color, letter }]) => (
            <div key={key} style={{
              background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: 20,
              textAlign: 'center', opacity: 0.6,
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: 8, background: `${color}20`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 18, fontWeight: 700, color, margin: '0 auto 8px',
              }}>
                {letter}
              </div>
              <div style={{ fontSize: 13, fontWeight: 500, color: colors.text, textTransform: 'capitalize' }}>
                {key.replace('-', ' ')}
              </div>
              <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 4 }}>Not connected</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        {connectors.map((connector) => {
          const icon = sourceIcons[connector.type] || { color: colors.textMuted, letter: connector.type.charAt(0).toUpperCase() };
          
          const healthColor = {
            green: colors.green,
            yellow: colors.yellow,
            red: colors.red,
          }[connector.health];

          const healthText = {
            green: 'Healthy',
            yellow: 'Stale',
            red: 'Error',
          }[connector.health];

          const recordEntries = Object.entries(connector.record_counts)
            .filter(([_, count]) => count > 0)
            .slice(0, 4); // Limit to 4 items

          return (
            <div key={connector.type} style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 10,
              padding: 20,
            }}>
              {/* Header with icon and title */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 8, background: `${icon.color}20`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16, fontWeight: 700, color: icon.color, flexShrink: 0,
                }}>
                  {icon.letter}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, textTransform: 'capitalize' }}>
                    {connector.type.replace('-', ' ')}
                  </div>
                  <div style={{ fontSize: 11, color: colors.textSecondary, marginTop: 2 }}>
                    {connector.status}
                  </div>
                </div>
              </div>

              {/* Health status with error message */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%', background: healthColor,
                    boxShadow: `0 0 6px ${healthColor}40`,
                  }} />
                  <span style={{ fontSize: 12, fontWeight: 500, color: healthColor }}>{healthText}</span>
                </div>
                {connector.last_error && (
                  <div style={{ fontSize: 11, color: colors.textMuted, marginLeft: 12 }}>
                    {connector.last_error.substring(0, 60)}{connector.last_error.length > 60 ? '...' : ''}
                  </div>
                )}
              </div>

              {/* Last sync */}
              <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 16 }}>
                Last sync: {connector.last_sync_at ? formatTimeAgo(connector.last_sync_at) : 'Never'}
              </div>

              {/* Record counts grid */}
              {recordEntries.length > 0 && (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: 8,
                  marginBottom: 16,
                }}>
                  {recordEntries.map(([entity, count]) => (
                    <div key={entity} style={{
                      background: colors.surfaceHover,
                      border: `1px solid ${colors.border}`,
                      borderRadius: 8,
                      padding: 12,
                      textAlign: 'center',
                    }}>
                      <div style={{
                        fontSize: 16,
                        fontWeight: 600,
                        color: colors.text,
                        fontFamily: fonts.mono,
                        marginBottom: 4,
                      }}>
                        {count}
                      </div>
                      <div style={{
                        fontSize: 11,
                        color: colors.textSecondary,
                        textTransform: 'capitalize',
                      }}>
                        {entity}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Sync Now button */}
              <button
                onClick={() => handleSyncNow(connector.type)}
                disabled={syncingConnector === connector.type}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: `1px solid ${colors.accent}`,
                  background: 'transparent',
                  color: colors.accent,
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: syncingConnector === connector.type ? 'not-allowed' : 'pointer',
                  opacity: syncingConnector === connector.type ? 0.6 : 1,
                  transition: 'all 0.2s',
                }}
              >
                {syncingConnector === connector.type ? 'Syncing...' : 'Sync Now'}
              </button>
            </div>
          );
        })}
      </div>

      {/* Toasts */}
      {toasts.map(toast => (
        <Toast
          key={toast.id}
          message={toast.message}
          type={toast.type}
          onClose={() => removeToast(toast.id)}
        />
      ))}
    </>
  );
}
