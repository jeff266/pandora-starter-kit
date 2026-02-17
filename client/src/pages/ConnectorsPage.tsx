import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { formatTimeAgo } from '../lib/format';
import Skeleton from '../components/Skeleton';
import Toast from '../components/Toast';
import { useWorkspace } from '../context/WorkspaceContext';

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

interface ConsultantConnector {
  id: string;
  source: string;
  status: string;
  last_synced_at: string | null;
  calls: { total: number; assigned: number; unassigned: number; skipped: number };
}

interface ToastItem {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

function ConsultantConnectorSection({ addToast }: { addToast: (message: string, type: 'success' | 'error' | 'info') => void }) {
  const { workspaces, token } = useWorkspace();
  const isConsultant = workspaces && workspaces.length > 1;

  const [consultantConnectors, setConsultantConnectors] = useState<ConsultantConnector[]>([]);
  const [loadingConsultant, setLoadingConsultant] = useState(true);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [showDisconnectModal, setShowDisconnectModal] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [connectError, setConnectError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);

  const fetchConsultantConnectors = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/consultant/connectors', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setConsultantConnectors(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to fetch consultant connectors:', err);
    } finally {
      setLoadingConsultant(false);
    }
  }, [token]);

  useEffect(() => {
    if (isConsultant) {
      fetchConsultantConnectors();
    } else {
      setLoadingConsultant(false);
    }
  }, [isConsultant, fetchConsultantConnectors]);

  if (!isConsultant) return null;

  const handleConnect = async () => {
    if (!apiKeyInput.trim() || !token) return;
    setConnecting(true);
    setConnectError('');
    try {
      const res = await fetch('/api/consultant/connectors', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ source: 'fireflies', credentials: { api_key: apiKeyInput.trim() } }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Fireflies connection failed: Invalid API key');
      }
      setShowConnectModal(false);
      setApiKeyInput('');
      addToast('Connected! Syncing calls in background...', 'success');
      fetchConsultantConnectors();
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setConnecting(false);
    }
  };

  const handleSyncNow = async (id: string) => {
    if (!token) return;
    setSyncingId(id);
    try {
      const res = await fetch(`/api/consultant/connectors/${id}/sync`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Sync failed');
      addToast('Sync triggered successfully', 'success');
      fetchConsultantConnectors();
    } catch (err) {
      addToast('Sync failed', 'error');
    } finally {
      setSyncingId(null);
    }
  };

  const handleDisconnect = async (id: string) => {
    if (!token) return;
    try {
      const res = await fetch(`/api/consultant/connectors/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Disconnect failed');
      setConsultantConnectors(prev => prev.filter(c => c.id !== id));
      setShowDisconnectModal(null);
      addToast('Disconnected successfully', 'success');
    } catch (err) {
      addToast('Failed to disconnect', 'error');
    }
  };

  if (loadingConsultant) {
    return (
      <div style={{ marginBottom: 24 }}>
        <Skeleton height={120} borderRadius={10} />
      </div>
    );
  }

  const connector = consultantConnectors.length > 0 ? consultantConnectors[0] : null;

  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        background: colors.surface,
        padding: 24,
      }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: colors.text, marginBottom: 4 }}>
          Your Accounts
        </div>
        <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 16 }}>
          Connect your personal recording account to automatically distribute calls across your client workspaces.
        </div>

        {!connector ? (
          <button
            onClick={() => { setShowConnectModal(true); setConnectError(''); setApiKeyInput(''); }}
            style={{
              padding: '10px 20px',
              background: colors.accent,
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            + Connect Fireflies
          </button>
        ) : (
          <div style={{
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            background: colors.surfaceRaised,
            padding: 16,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 6, background: 'rgba(245,158,11,0.15)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 700, color: '#f59e0b', flexShrink: 0,
                }}>
                  F
                </div>
                <div>
                  <span style={{ fontSize: 14, fontWeight: 600, color: colors.text }}>
                    Fireflies (Personal)
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ color: colors.green, fontSize: 13 }}>✓</span>
                  <span style={{ fontSize: 12, color: colors.green, fontWeight: 500 }}>Connected</span>
                </div>
              </div>
            </div>

            <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 8 }}>
              Last sync: {connector.last_synced_at ? formatTimeAgo(connector.last_synced_at) : 'Never'}
              {' • '}
              {connector.calls.total} calls synced
            </div>

            <div style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 14 }}>
              Auto-assigned: {connector.calls.assigned}
              {connector.calls.total > 0 && ` (${Math.round((connector.calls.assigned / connector.calls.total) * 100)}%)`}
              {' • '}
              Unassigned: {connector.calls.unassigned}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => handleSyncNow(connector.id)}
                disabled={syncingId === connector.id}
                style={{
                  padding: '8px 16px',
                  border: `1px solid ${colors.accent}`,
                  background: 'transparent',
                  color: colors.accent,
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: syncingId === connector.id ? 'not-allowed' : 'pointer',
                  opacity: syncingId === connector.id ? 0.6 : 1,
                }}
              >
                {syncingId === connector.id ? '⟳ Syncing...' : 'Sync Now'}
              </button>
              <button
                onClick={() => setShowDisconnectModal(connector.id)}
                style={{
                  padding: '8px 16px',
                  border: `1px solid ${colors.border}`,
                  background: 'transparent',
                  color: colors.textSecondary,
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Disconnect
              </button>
            </div>
          </div>
        )}
      </div>

      {showConnectModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 10000,
        }} onClick={() => setShowConnectModal(false)}>
          <div style={{
            background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12,
            padding: 28, width: 440, maxWidth: '90vw',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 600, color: colors.text, marginBottom: 8 }}>
              Connect Personal Fireflies Account
            </div>
            <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 20, lineHeight: 1.5 }}>
              This syncs YOUR calls and automatically assigns them to the correct client workspace using participant emails, calendar matching, and transcript analysis.
            </div>
            <label style={{ fontSize: 12, fontWeight: 500, color: colors.textSecondary, marginBottom: 6, display: 'block' }}>
              Fireflies API Key
            </label>
            <input
              type="password"
              value={apiKeyInput}
              onChange={e => setApiKeyInput(e.target.value)}
              placeholder="Enter your Fireflies API key"
              style={{
                width: '100%', padding: '10px 12px', background: colors.surfaceRaised,
                border: `1px solid ${colors.border}`, borderRadius: 6, color: colors.text,
                fontSize: 13, outline: 'none', boxSizing: 'border-box',
              }}
              onFocus={e => e.target.style.borderColor = colors.borderFocus}
              onBlur={e => e.target.style.borderColor = colors.border}
              onKeyDown={e => { if (e.key === 'Enter' && apiKeyInput.trim()) handleConnect(); }}
            />
            <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 6 }}>
              Find your API key at: app.fireflies.ai → Settings → Integrations
            </div>
            {connectError && (
              <div style={{ fontSize: 12, color: colors.red, marginTop: 10 }}>
                {connectError}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button
                onClick={() => setShowConnectModal(false)}
                style={{
                  padding: '9px 16px', border: `1px solid ${colors.border}`, background: 'transparent',
                  color: colors.textSecondary, borderRadius: 6, fontSize: 13, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleConnect}
                disabled={connecting || !apiKeyInput.trim()}
                style={{
                  padding: '9px 20px', border: 'none', background: colors.accent,
                  color: '#fff', borderRadius: 6, fontSize: 13, fontWeight: 500,
                  cursor: connecting || !apiKeyInput.trim() ? 'not-allowed' : 'pointer',
                  opacity: connecting || !apiKeyInput.trim() ? 0.6 : 1,
                }}
              >
                {connecting ? 'Connecting...' : 'Connect & Sync'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDisconnectModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 10000,
        }} onClick={() => setShowDisconnectModal(null)}>
          <div style={{
            background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12,
            padding: 24, width: 380, maxWidth: '90vw',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 600, color: colors.text, marginBottom: 10 }}>
              Disconnect Fireflies?
            </div>
            <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 20, lineHeight: 1.5 }}>
              Disconnect your personal Fireflies? Previously synced calls will remain in their assigned workspaces.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={() => setShowDisconnectModal(null)}
                style={{
                  padding: '9px 16px', border: `1px solid ${colors.border}`, background: 'transparent',
                  color: colors.textSecondary, borderRadius: 6, fontSize: 13, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => handleDisconnect(showDisconnectModal)}
                style={{
                  padding: '9px 20px', border: 'none', background: colors.red,
                  color: '#fff', borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer',
                }}
              >
                Disconnect
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ConnectorsPage() {
  const { workspaces, token } = useWorkspace();
  const isConsultant = workspaces && workspaces.length > 1;

  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncingConnector, setSyncingConnector] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastIdRef = React.useRef(0);

  const fetchConnectors = async () => {
    try {
      const data = await api.get('/connectors/status');
      setConnectors(Array.isArray(data.connectors) ? data.connectors : []);
    } catch (error) {
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
      await api.post(`/connectors/${connectorType}/sync`, { mode: 'initial' });
      addToast(`${connectorType} sync triggered successfully`, 'success');
      setTimeout(() => fetchConnectors(), 3000);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to trigger sync';
      addToast(`Sync failed: ${errorMsg}`, 'error');
    } finally {
      setSyncingConnector(null);
    }
  };

  const renderWorkspaceConnectors = () => {
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
            .slice(0, 4);

          return (
            <div key={connector.type} style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 10,
              padding: 20,
            }}>
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

              <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 16 }}>
                Last sync: {connector.last_sync_at ? formatTimeAgo(connector.last_sync_at) : 'Never'}
              </div>

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
    );
  };

  return (
    <>
      {isConsultant && <ConsultantConnectorSection addToast={addToast} />}

      {renderWorkspaceConnectors()}

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
