import React, { useEffect, useState, useCallback, useRef } from 'react';
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

const CONNECTORS_WITH_TRACKED_USERS = ['gong'];

interface TrackedUser {
  source_id: string;
  name: string;
  email?: string;
  title?: string;
  active?: boolean;
}

interface SyncResult {
  success: boolean;
  recordsFetched?: number;
  recordsStored?: number;
  duration?: number;
  errors?: string[];
  trackedUsers?: number;
  byUser?: Array<{ name: string; calls: number }>;
}

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
  const [syncElapsed, setSyncElapsed] = useState(0);
  const [syncResults, setSyncResults] = useState<Record<string, SyncResult | null>>({});
  const syncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastIdRef = React.useRef(0);

  const [showUsersModal, setShowUsersModal] = useState<string | null>(null);
  const [allUsers, setAllUsers] = useState<TrackedUser[]>([]);
  const [trackedUserIds, setTrackedUserIds] = useState<Set<string>>(new Set());
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [savingUsers, setSavingUsers] = useState(false);

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

  useEffect(() => {
    return () => {
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
    };
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
    setSyncElapsed(0);
    setSyncResults(prev => ({ ...prev, [connectorType]: null }));

    syncTimerRef.current = setInterval(() => {
      setSyncElapsed(prev => prev + 1);
    }, 1000);

    try {
      const result = await api.post(`/connectors/${connectorType}/sync`, { mode: 'initial' });
      const syncResult: SyncResult = {
        success: result.success !== false && (!result.errors || result.errors.length === 0),
        recordsFetched: result.recordsFetched,
        recordsStored: result.recordsStored,
        duration: result.duration,
        errors: result.errors,
        trackedUsers: result.trackedUsers,
        byUser: result.byUser,
      };
      setSyncResults(prev => ({ ...prev, [connectorType]: syncResult }));

      if (syncResult.success) {
        addToast(`${connectorType} sync complete: ${syncResult.recordsStored ?? 0} records synced`, 'success');
      } else {
        addToast(`Sync completed with issues: ${syncResult.errors?.[0] || 'Unknown error'}`, 'error');
      }
      fetchConnectors();
    } catch (error: any) {
      const displayError = error?.error || error?.message || 'Failed to trigger sync';
      setSyncResults(prev => ({ ...prev, [connectorType]: { success: false, errors: [displayError] } }));
      addToast(`Sync failed: ${displayError}`, 'error');
    } finally {
      if (syncTimerRef.current) {
        clearInterval(syncTimerRef.current);
        syncTimerRef.current = null;
      }
      setSyncingConnector(null);
    }
  };

  const handleOpenUsersModal = async (connectorType: string) => {
    setShowUsersModal(connectorType);
    setLoadingUsers(true);
    setAllUsers([]);
    setTrackedUserIds(new Set());
    try {
      const data = await api.get(`/connectors/${connectorType}/users`);
      setAllUsers(data.users || []);
      const tracked = (data.tracked_users || []).map((u: TrackedUser) => u.source_id);
      setTrackedUserIds(new Set(tracked));
    } catch (error) {
      addToast('Failed to load users', 'error');
      setShowUsersModal(null);
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleSaveTrackedUsers = async () => {
    if (!showUsersModal) return;
    setSavingUsers(true);
    try {
      const userIds = Array.from(trackedUserIds);
      if (userIds.length === 0) {
        addToast('Select at least one user to track', 'error');
        setSavingUsers(false);
        return;
      }
      await api.post(`/connectors/${showUsersModal}/users/track`, { user_ids: userIds });
      addToast(`Tracking ${userIds.length} user${userIds.length > 1 ? 's' : ''} updated`, 'success');
      setShowUsersModal(null);
    } catch (error) {
      addToast('Failed to update tracked users', 'error');
    } finally {
      setSavingUsers(false);
    }
  };

  const toggleUser = (sourceId: string) => {
    setTrackedUserIds(prev => {
      const next = new Set(prev);
      if (next.has(sourceId)) {
        next.delete(sourceId);
      } else {
        next.add(sourceId);
      }
      return next;
    });
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

              {syncResults[connector.type] && !syncingConnector && (
                <div style={{
                  padding: '10px 12px',
                  background: syncResults[connector.type]!.success ? `${colors.green}10` : `${colors.red}10`,
                  border: `1px solid ${syncResults[connector.type]!.success ? `${colors.green}30` : `${colors.red}30`}`,
                  borderRadius: 6,
                  marginBottom: 10,
                  fontSize: 12,
                  color: colors.textSecondary,
                  lineHeight: 1.6,
                }}>
                  {syncResults[connector.type]!.success ? (
                    <>
                      <div style={{ color: colors.green, fontWeight: 600, marginBottom: 2 }}>Sync Complete</div>
                      <div>{syncResults[connector.type]!.recordsStored ?? 0} records synced in {((syncResults[connector.type]!.duration ?? 0) / 1000).toFixed(1)}s</div>
                      {syncResults[connector.type]!.byUser && syncResults[connector.type]!.byUser!.length > 0 && (
                        <div style={{ marginTop: 4 }}>
                          {syncResults[connector.type]!.byUser!.map(u => (
                            <span key={u.name} style={{ marginRight: 10 }}>{u.name}: {u.calls}</span>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div style={{ color: colors.red, fontWeight: 600, marginBottom: 2 }}>Sync Failed</div>
                      <div>{syncResults[connector.type]!.errors?.[0] || 'Unknown error'}</div>
                    </>
                  )}
                  <button
                    onClick={() => setSyncResults(prev => ({ ...prev, [connector.type]: null }))}
                    style={{
                      background: 'none', border: 'none', color: colors.textMuted,
                      fontSize: 11, cursor: 'pointer', padding: 0, marginTop: 4,
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => handleSyncNow(connector.type)}
                  disabled={syncingConnector === connector.type}
                  style={{
                    flex: 1,
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
                  {syncingConnector === connector.type
                    ? `Syncing... ${syncElapsed}s`
                    : 'Sync Now'}
                </button>

                {CONNECTORS_WITH_TRACKED_USERS.includes(connector.type) && (
                  <button
                    onClick={() => handleOpenUsersModal(connector.type)}
                    disabled={syncingConnector === connector.type}
                    style={{
                      padding: '10px 12px',
                      border: `1px solid ${colors.border}`,
                      background: 'transparent',
                      color: colors.textSecondary,
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Manage Users
                  </button>
                )}
              </div>
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

      {showUsersModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 10000,
        }} onClick={() => setShowUsersModal(null)}>
          <div style={{
            background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12,
            padding: 28, width: 500, maxWidth: '90vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 600, color: colors.text, marginBottom: 4 }}>
              Manage Tracked Users
            </div>
            <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 16, lineHeight: 1.5 }}>
              Select which {showUsersModal.replace('-', ' ')} users to sync calls from. Only calls involving these users will be imported.
            </div>

            {loadingUsers ? (
              <div style={{ padding: 40, textAlign: 'center' }}>
                <div style={{ fontSize: 13, color: colors.textMuted }}>Loading users...</div>
              </div>
            ) : allUsers.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center' }}>
                <div style={{ fontSize: 13, color: colors.textMuted }}>No users found in {showUsersModal}.</div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 10 }}>
                  {trackedUserIds.size} of {allUsers.length} users selected
                </div>
                <div style={{
                  flex: 1, overflowY: 'auto', border: `1px solid ${colors.border}`,
                  borderRadius: 8, marginBottom: 16,
                }}>
                  {allUsers.map(user => (
                    <label
                      key={user.source_id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '12px 14px', cursor: 'pointer',
                        borderBottom: `1px solid ${colors.border}`,
                        background: trackedUserIds.has(user.source_id) ? `${colors.accent}08` : 'transparent',
                        transition: 'background 0.15s',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={trackedUserIds.has(user.source_id)}
                        onChange={() => toggleUser(user.source_id)}
                        style={{ accentColor: colors.accent, width: 16, height: 16, cursor: 'pointer' }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: colors.text }}>
                          {user.name}
                        </div>
                        <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 1 }}>
                          {[user.email, user.title].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={() => setShowUsersModal(null)}
                style={{
                  padding: '9px 16px', border: `1px solid ${colors.border}`, background: 'transparent',
                  color: colors.textSecondary, borderRadius: 6, fontSize: 13, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveTrackedUsers}
                disabled={savingUsers || trackedUserIds.size === 0}
                style={{
                  padding: '9px 20px', border: 'none', background: colors.accent,
                  color: '#fff', borderRadius: 6, fontSize: 13, fontWeight: 500,
                  cursor: savingUsers || trackedUserIds.size === 0 ? 'not-allowed' : 'pointer',
                  opacity: savingUsers || trackedUserIds.size === 0 ? 0.6 : 1,
                }}
              >
                {savingUsers ? 'Saving...' : `Save (${trackedUserIds.size} selected)`}
              </button>
            </div>
          </div>
        </div>
      )}

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
