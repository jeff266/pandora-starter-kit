import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import Skeleton from '../components/Skeleton';
import SectionErrorBoundary from '../components/SectionErrorBoundary';

interface EntityInfo {
  type: string;
  count: number;
  last_synced: string | null;
}

interface SyncHistoryEntry {
  id: string;
  timestamp: string;
  records_affected: number;
  duration_ms: number | null;
  status: 'success' | 'error' | 'partial';
  error_message?: string;
  sync_type: string;
}

interface ConnectorInfo {
  id: string;
  type: string;
  status: 'connected' | 'disconnected' | 'error';
  last_synced_at: string | null;
  health_status: 'healthy' | 'warning' | 'error';
  last_error: string | null;
  created_at: string;
  metadata: any;
  entities: EntityInfo[];
  sync_history: SyncHistoryEntry[];
  freshness: {
    hours_since_sync: number | null;
    is_stale: boolean;
    is_critical: boolean;
  };
}

interface Summary {
  total_sources: number;
  total_records: number;
  last_sync: string | null;
  errors_24h: number;
}

interface HealthData {
  summary: Summary;
  connectors: ConnectorInfo[];
  totals: { deals: number; contacts: number; accounts: number; conversations: number };
}

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDateTime(date: string): string {
  return new Date(date).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function formatDuration(ms: number | null): string {
  if (!ms) return '--';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const remainder = Math.round(s % 60);
  return `${m}m ${remainder}s`;
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).replace(/-/g, ' ');
}

const healthColors: Record<string, string> = {
  healthy: colors.green,
  warning: colors.yellow,
  error: colors.red,
};

export default function ConnectorHealth() {
  const navigate = useNavigate();
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showMoreHistory, setShowMoreHistory] = useState<Record<string, boolean>>({});
  const [expandedErrors, setExpandedErrors] = useState<Record<string, boolean>>({});
  const [disconnectModal, setDisconnectModal] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date>(new Date());
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const fetchHealth = useCallback(async () => {
    try {
      const d = await api.get('/connectors/health');
      setData(d);
      setLastChecked(new Date());

      const autoExpand: Record<string, boolean> = {};
      for (const c of d.connectors) {
        if (c.health_status === 'error' || c.health_status === 'warning') {
          autoExpand[c.type] = true;
        }
      }
      setExpanded(prev => ({ ...autoExpand, ...prev }));
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchHealth(); }, [fetchHealth]);

  const triggerSync = async (connectorType: string) => {
    setSyncing(prev => ({ ...prev, [connectorType]: true }));
    try {
      await api.post('/sync', { connectorType });
      showToast(`${capitalize(connectorType)} sync completed`, 'success');
      await fetchHealth();
    } catch (err: any) {
      showToast(err.message || 'Sync failed', 'error');
    }
    setSyncing(prev => ({ ...prev, [connectorType]: false }));
  };

  const handleDisconnect = async (connectorType: string) => {
    setDisconnecting(true);
    try {
      await api.post('/connectors/disconnect', { connectorType });
      showToast(`${capitalize(connectorType)} disconnected`, 'success');
      await fetchHealth();
    } catch (err: any) {
      showToast(err.message || 'Disconnect failed', 'error');
    }
    setDisconnecting(false);
    setDisconnectModal(null);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div>
          <Skeleton width={240} height={28} borderRadius={6} />
          <div style={{ marginTop: 6 }}><Skeleton width={300} height={14} borderRadius={4} /></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} height={90} borderRadius={10} />
          ))}
        </div>
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} height={200} borderRadius={10} />
        ))}
      </div>
    );
  }

  if (!data || data.connectors.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.6 }}>&#x1F4E1;</div>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.text, marginBottom: 8 }}>
          No data sources connected yet
        </h2>
        <p style={{ fontSize: 14, color: colors.textSecondary, marginBottom: 24, maxWidth: 400, margin: '0 auto 24px' }}>
          Connect your CRM and conversation intelligence tools to start getting insights.
        </p>
        <button
          onClick={() => navigate('/connectors')}
          style={{
            fontSize: 13, fontWeight: 600, color: '#fff',
            background: colors.accent, border: 'none', borderRadius: 8,
            padding: '10px 20px', cursor: 'pointer',
          }}
        >
          Go to Connectors
        </button>
      </div>
    );
  }

  const recentErrors = data.connectors.flatMap(c =>
    c.sync_history.filter(s => s.status === 'error').map(s => ({
      ...s,
      connectorType: c.type,
    }))
  ).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 10);

  const lastSyncHours = data.summary.last_sync
    ? (Date.now() - new Date(data.summary.last_sync).getTime()) / 3600000
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {toast && (
        <div style={{
          position: 'fixed', top: 16, right: 16, zIndex: 1000,
          padding: '10px 16px', borderRadius: 8,
          background: toast.type === 'success' ? colors.greenSoft : colors.redSoft,
          border: `1px solid ${toast.type === 'success' ? colors.green : colors.red}`,
          color: toast.type === 'success' ? colors.green : colors.red,
          fontSize: 12, fontWeight: 500,
        }}>
          {toast.message}
        </div>
      )}

      {disconnectModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => !disconnecting && setDisconnectModal(null)}>
          <div style={{
            background: colors.surface, border: `1px solid ${colors.border}`,
            borderRadius: 12, padding: 28, maxWidth: 420, width: '90%',
          }} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: colors.text, marginBottom: 8 }}>
              Disconnect {capitalize(disconnectModal)}?
            </h3>
            <p style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 20, lineHeight: 1.5 }}>
              This won't delete any synced data, but new data will stop syncing.
              You can reconnect at any time from the Connectors page.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setDisconnectModal(null)}
                disabled={disconnecting}
                style={{
                  padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 500,
                  background: colors.surfaceHover, color: colors.textSecondary,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => handleDisconnect(disconnectModal)}
                disabled={disconnecting}
                style={{
                  padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600,
                  background: colors.red, color: '#fff',
                  cursor: disconnecting ? 'not-allowed' : 'pointer',
                  opacity: disconnecting ? 0.7 : 1,
                }}
              >
                {disconnecting ? 'Disconnecting...' : 'Disconnect'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: colors.text, margin: 0 }}>Connector Health</h1>
          <p style={{ fontSize: 13, color: colors.textMuted, marginTop: 4 }}>
            Real-time status of your data pipeline
          </p>
        </div>
        <span style={{ fontSize: 11, color: colors.textDim }}>
          Last checked: {timeAgo(lastChecked.toISOString())}
        </span>
      </div>

      <SectionErrorBoundary fallbackMessage="Unable to load connector summary.">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <SummaryCard
          label="Connected Sources"
          value={String(data.summary.total_sources)}
          color={colors.accent}
        />
        <SummaryCard
          label="Total Records"
          value={data.summary.total_records.toLocaleString()}
          color={colors.accent}
        />
        <SummaryCard
          label="Last Sync"
          value={data.summary.last_sync ? timeAgo(data.summary.last_sync) : 'Never'}
          color={lastSyncHours === null ? colors.textMuted
            : lastSyncHours < 6 ? colors.green
            : lastSyncHours < 24 ? colors.yellow
            : colors.red}
        />
        <SummaryCard
          label="Sync Errors (24h)"
          value={String(data.summary.errors_24h)}
          color={data.summary.errors_24h === 0 ? colors.green : colors.red}
        />
      </div>
      </SectionErrorBoundary>

      {data.summary.errors_24h > 0 && recentErrors.length > 0 && (
        <div style={{
          background: colors.redSoft, border: `1px solid ${colors.red}30`,
          borderRadius: 10, padding: 16,
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: colors.red, marginBottom: 10 }}>
            {data.summary.errors_24h} sync error{data.summary.errors_24h !== 1 ? 's' : ''} in the last 24 hours
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {recentErrors.slice(0, 5).map((err, i) => (
              <div key={err.id || i} style={{
                display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12,
              }}>
                <span style={{ color: colors.red, flexShrink: 0 }}>&#x2717;</span>
                <span style={{ color: colors.text, fontWeight: 500 }}>{capitalize(err.connectorType)}</span>
                <span style={{ color: colors.textMuted }}>{formatDateTime(err.timestamp)}</span>
                {err.error_message && (
                  <span style={{ color: colors.red, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 400 }}>
                    {err.error_message}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {data.connectors.map(connector => {
        const isExpanded = expanded[connector.type] || false;
        const hColor = healthColors[connector.health_status] || colors.textMuted;
        const showAll = showMoreHistory[connector.type] || false;
        const historyToShow = showAll ? connector.sync_history : connector.sync_history.slice(0, 5);
        const totalRecords = connector.entities.reduce((sum, e) => sum + e.count, 0);

        return (
          <SectionErrorBoundary key={connector.type} fallbackMessage={`Unable to load ${capitalize(connector.type)} connector.`}>
          <div style={{
            background: colors.surface, border: `1px solid ${colors.border}`,
            borderRadius: 10, overflow: 'hidden',
          }}>
            <div
              onClick={() => setExpanded(prev => ({ ...prev, [connector.type]: !prev[connector.type] }))}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 20px', cursor: 'pointer',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%', background: hColor,
                  boxShadow: `0 0 6px ${hColor}40`, flexShrink: 0,
                }} />
                <span style={{ fontSize: 15, fontWeight: 600, color: colors.text }}>
                  {capitalize(connector.type)}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 12 }}>
                <span style={{ color: colors.textMuted }}>
                  {totalRecords.toLocaleString()} records
                </span>
                <span style={{ color: colors.textMuted }}>
                  Last sync: {connector.last_synced_at ? timeAgo(connector.last_synced_at) : 'Never'}
                </span>
                <span style={{ color: colors.textDim, fontSize: 10 }}>
                  {isExpanded ? '\u25B4' : '\u25BE'}
                </span>
              </div>
            </div>

            {isExpanded && (
              <div style={{ padding: '0 20px 20px', borderTop: `1px solid ${colors.border}` }}>
                {connector.last_error && (
                  <div style={{
                    background: colors.redSoft, borderRadius: 6, padding: '8px 12px',
                    fontSize: 12, color: colors.red, marginTop: 12, wordBreak: 'break-word',
                  }}>
                    Error: {connector.last_error}
                  </div>
                )}

                {connector.entities.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{
                      fontSize: 11, fontWeight: 600, color: colors.textDim,
                      textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8,
                    }}>
                      Entity Freshness
                    </div>
                    <div style={{
                      background: colors.surfaceRaised, borderRadius: 8,
                      border: `1px solid ${colors.border}`, overflow: 'hidden',
                    }}>
                      {connector.entities.map((entity, i) => {
                        const entityFresh = entity.last_synced
                          ? (Date.now() - new Date(entity.last_synced).getTime()) / 3600000 < 12
                          : false;
                        return (
                          <div key={entity.type} style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '8px 14px',
                            borderBottom: i < connector.entities.length - 1 ? `1px solid ${colors.border}` : 'none',
                          }}>
                            <span style={{ fontSize: 13, color: colors.text, textTransform: 'capitalize' }}>
                              {entity.type}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                              <span style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.textSecondary }}>
                                {entity.count.toLocaleString()} records
                              </span>
                              <span style={{ fontSize: 11, color: colors.textMuted }}>
                                {entity.last_synced ? `synced ${timeAgo(entity.last_synced)}` : 'never synced'}
                              </span>
                              <span style={{
                                width: 6, height: 6, borderRadius: '50%',
                                background: entityFresh ? colors.green : colors.yellow,
                              }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div style={{ marginTop: 16 }}>
                  <div style={{
                    fontSize: 11, fontWeight: 600, color: colors.textDim,
                    textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8,
                  }}>
                    Sync History
                  </div>

                  {connector.sync_history.length === 0 ? (
                    <p style={{ fontSize: 12, color: colors.textMuted, padding: '12px 0' }}>
                      No sync history yet
                    </p>
                  ) : (
                    <div style={{
                      background: colors.surfaceRaised, borderRadius: 8,
                      border: `1px solid ${colors.border}`, overflow: 'hidden',
                    }}>
                      {historyToShow.map((entry, i) => {
                        const isError = entry.status === 'error';
                        const isPartial = entry.status === 'partial';
                        const errExpanded = expandedErrors[entry.id] || false;
                        return (
                          <React.Fragment key={entry.id || i}>
                            <div
                              style={{
                                display: 'flex', alignItems: 'center', gap: 10,
                                padding: '7px 14px',
                                borderBottom: i < historyToShow.length - 1 || (connector.sync_history.length > 5 && !showAll)
                                  ? `1px solid ${colors.border}` : 'none',
                                cursor: isError && entry.error_message ? 'pointer' : 'default',
                              }}
                              onClick={() => {
                                if (isError && entry.error_message) {
                                  setExpandedErrors(prev => ({ ...prev, [entry.id]: !prev[entry.id] }));
                                }
                              }}
                            >
                              <span style={{ fontSize: 12, flexShrink: 0 }}>
                                {isError ? '\u2717' : isPartial ? '\u26A0' : '\u2713'}
                              </span>
                              <span style={{ fontSize: 12, color: colors.textMuted, minWidth: 120 }}>
                                {formatDateTime(entry.timestamp)}
                              </span>
                              <span style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.textSecondary, minWidth: 80 }}>
                                {entry.records_affected.toLocaleString()} records
                              </span>
                              <span style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.textDim, minWidth: 50 }}>
                                {formatDuration(entry.duration_ms)}
                              </span>
                              {isError && entry.error_message && (
                                <span style={{
                                  fontSize: 11, color: colors.red, flex: 1,
                                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                }}>
                                  {entry.error_message}
                                </span>
                              )}
                            </div>
                            {errExpanded && entry.error_message && (
                              <div style={{
                                padding: '8px 14px 10px 34px', background: colors.surface,
                                borderBottom: `1px solid ${colors.border}`,
                              }}>
                                <pre style={{
                                  fontSize: 11, fontFamily: fonts.mono, color: colors.red,
                                  margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                                }}>
                                  {entry.error_message}
                                </pre>
                              </div>
                            )}
                          </React.Fragment>
                        );
                      })}
                      {connector.sync_history.length > 5 && !showAll && (
                        <div
                          onClick={() => setShowMoreHistory(prev => ({ ...prev, [connector.type]: true }))}
                          style={{
                            padding: '8px 14px', fontSize: 12, color: colors.accent,
                            cursor: 'pointer', textAlign: 'center',
                          }}
                        >
                          Show {connector.sync_history.length - 5} more...
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  marginTop: 16, paddingTop: 14, borderTop: `1px solid ${colors.border}`,
                }}>
                  <button
                    onClick={() => triggerSync(connector.type)}
                    disabled={syncing[connector.type]}
                    style={{
                      padding: '7px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                      background: syncing[connector.type] ? colors.surfaceHover : colors.accent,
                      color: syncing[connector.type] ? colors.textMuted : '#fff',
                      cursor: syncing[connector.type] ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {syncing[connector.type] ? 'Syncing...' : 'Sync Now'}
                  </button>
                  <button
                    onClick={() => setDisconnectModal(connector.type)}
                    style={{
                      padding: '7px 16px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                      background: 'transparent', color: colors.red,
                      border: `1px solid ${colors.red}30`,
                      cursor: 'pointer',
                    }}
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            )}
          </div>
          </SectionErrorBoundary>
        );
      })}
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{
      background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: 16,
    }}>
      <div style={{
        fontSize: 11, fontWeight: 600, color: colors.textDim,
        textTransform: 'uppercase', letterSpacing: '0.05em',
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 22, fontWeight: 700, fontFamily: fonts.mono,
        color, marginTop: 6,
      }}>
        {value}
      </div>
    </div>
  );
}
