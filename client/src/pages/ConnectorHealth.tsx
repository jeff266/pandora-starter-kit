import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';

interface ConnectorInfo {
  type: string;
  status: 'connected' | 'error' | 'stale' | 'disconnected';
  raw_status: string;
  last_sync_at: string | null;
  last_error: string | null;
  created_at: string;
  metadata: any;
  records: Record<string, number>;
  freshness: {
    hours_since_sync: number | null;
    is_stale: boolean;
    is_critical: boolean;
  };
}

interface SyncEntry {
  id: string;
  connectorType: string;
  syncType: string;
  status: string;
  recordsSynced: number;
  durationMs: number | null;
  startedAt: string;
  completedAt: string | null;
  errors: any;
}

interface HealthData {
  connectors: ConnectorInfo[];
  totals: { deals: number; contacts: number; accounts: number; conversations: number };
  syncHistory: SyncEntry[];
}

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function statusDotColor(c: ConnectorInfo): string {
  if (c.status === 'error') return colors.red;
  if (c.status === 'disconnected') return colors.red;
  const h = c.freshness.hours_since_sync;
  if (h === null) return colors.red;
  if (h < 24) return colors.green;
  if (h <= 72) return colors.yellow;
  return colors.red;
}

function statusText(c: ConnectorInfo): string {
  if (c.status === 'connected') return 'Connected';
  if (c.status === 'stale') return 'Stale';
  if (c.status === 'disconnected') return 'Disconnected';
  if (c.status === 'error') return `Error: ${c.last_error || 'Unknown'}`;
  return c.raw_status;
}

function SkeletonBlock({ height, width }: { height: number; width?: string | number }) {
  return (
    <div style={{
      height,
      width: width || '100%',
      background: colors.surfaceHover,
      borderRadius: 8,
      animation: 'skeleton-pulse 1.5s ease-in-out infinite',
    }} />
  );
}

export default function ConnectorHealth() {
  const navigate = useNavigate();
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [expandedErrors, setExpandedErrors] = useState<Record<string, boolean>>({});

  useEffect(() => {
    api.get('/connectors/health')
      .then((d: any) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  const triggerSync = async (connectorType: string) => {
    setSyncing(prev => ({ ...prev, [connectorType]: true }));
    try {
      await api.post('/sync', { connectorType });
      const refreshed: any = await api.get('/connectors/health');
      setData(refreshed);
    } catch {}
    setSyncing(prev => ({ ...prev, [connectorType]: false }));
  };

  if (loading) {
    return (
      <div style={{ fontFamily: fonts.sans, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonBlock key={i} height={140} width={280} />
          ))}
        </div>
        <SkeletonBlock height={200} />
        <SkeletonBlock height={300} />
      </div>
    );
  }

  if (!data || data.connectors.length === 0) {
    return (
      <div style={{ fontFamily: fonts.sans, textAlign: 'center', padding: 80 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>📡</div>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.text, marginBottom: 8 }}>
          No data sources connected
        </h2>
        <p style={{ fontSize: 14, color: colors.textSecondary, marginBottom: 24, maxWidth: 400, margin: '0 auto 24px' }}>
          Connect your CRM and conversation intelligence tools to start getting insights.
        </p>
        <button
          onClick={() => navigate('/connectors')}
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: colors.accent,
            background: colors.accentSoft,
            border: 'none',
            borderRadius: 8,
            padding: '10px 20px',
            cursor: 'pointer',
            fontFamily: fonts.sans,
          }}
        >
          Go to Connectors →
        </button>
      </div>
    );
  }

  const staleConnectors = data.connectors.filter(c => c.freshness.is_stale && c.status !== 'error');
  const errorConnectors = data.connectors.filter(c => c.status === 'error');

  return (
    <div style={{ fontFamily: fonts.sans, display: 'flex', flexDirection: 'column', gap: 24 }}>
      {staleConnectors.map(c => {
        const days = c.freshness.hours_since_sync != null ? Math.floor(c.freshness.hours_since_sync / 24) : 0;
        return (
          <div key={`stale-${c.type}`} style={{
            background: colors.yellowSoft,
            border: `1px solid ${colors.yellow}30`,
            borderRadius: 8,
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}>
            <span style={{ fontSize: 13, color: colors.yellow }}>
              ⚠ {capitalize(c.type)} data is {days} day{days !== 1 ? 's' : ''} old. Insights may be outdated.
            </span>
            <button
              onClick={() => triggerSync(c.type)}
              disabled={syncing[c.type]}
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: colors.yellow,
                background: 'none',
                border: `1px solid ${colors.yellow}40`,
                borderRadius: 6,
                padding: '4px 12px',
                cursor: syncing[c.type] ? 'not-allowed' : 'pointer',
                opacity: syncing[c.type] ? 0.6 : 1,
                fontFamily: fonts.sans,
                whiteSpace: 'nowrap',
              }}
            >
              {syncing[c.type] ? '⟳ Syncing...' : 'Sync Now'}
            </button>
          </div>
        );
      })}

      {errorConnectors.map(c => (
        <div key={`error-${c.type}`} style={{
          background: colors.redSoft,
          border: `1px solid ${colors.red}30`,
          borderRadius: 8,
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <span style={{ color: colors.red, fontSize: 10 }}>●</span>
          <span style={{ fontSize: 13, color: colors.red }}>
            {capitalize(c.type)} connection error: {c.last_error || 'Unknown error'}
          </span>
        </div>
      ))}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {data.connectors.map(c => {
          const dotColor = statusDotColor(c);
          const isExpanded = expanded[c.type] || false;
          return (
            <div
              key={c.type}
              style={{
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: 10,
                padding: 20,
                minWidth: 260,
                flex: '1 1 260px',
                maxWidth: 400,
                cursor: 'pointer',
                transition: 'border-color 0.15s',
              }}
              onClick={() => setExpanded(prev => ({ ...prev, [c.type]: !prev[c.type] }))}
              onMouseEnter={e => (e.currentTarget.style.borderColor = colors.accent)}
              onMouseLeave={e => (e.currentTarget.style.borderColor = colors.border)}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: dotColor,
                    boxShadow: `0 0 6px ${dotColor}40`,
                    flexShrink: 0,
                  }} />
                  <span style={{ fontSize: 15, fontWeight: 600, color: colors.text }}>
                    {capitalize(c.type)}
                  </span>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); triggerSync(c.type); }}
                  disabled={syncing[c.type]}
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: colors.accent,
                    background: colors.accentSoft,
                    border: 'none',
                    borderRadius: 6,
                    padding: '5px 12px',
                    cursor: syncing[c.type] ? 'not-allowed' : 'pointer',
                    opacity: syncing[c.type] ? 0.6 : 1,
                    fontFamily: fonts.sans,
                  }}
                >
                  {syncing[c.type] ? '⟳' : 'Sync Now'}
                </button>
              </div>

              <div style={{ fontSize: 12, color: dotColor === colors.green ? colors.green : dotColor === colors.yellow ? colors.yellow : colors.red, marginBottom: 6 }}>
                {statusText(c)}
              </div>

              <div style={{ fontSize: 12, color: colors.textMuted }}>
                Last sync: {c.last_sync_at ? timeAgo(c.last_sync_at) : 'Never'}
              </div>

              {isExpanded && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${colors.border}` }}>
                  {Object.keys(c.records).length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                        Records
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {Object.entries(c.records).map(([entity, count]) => (
                          <span key={entity} style={{
                            fontSize: 11,
                            fontFamily: fonts.mono,
                            color: colors.textSecondary,
                            background: colors.surfaceRaised,
                            padding: '3px 8px',
                            borderRadius: 4,
                          }}>
                            {count.toLocaleString()} {entity}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: colors.textMuted }}>
                    Connected since: {timeAgo(c.created_at)}
                  </div>
                  {c.last_error && (
                    <div style={{ fontSize: 11, color: colors.red, marginTop: 6, wordBreak: 'break-word' }}>
                      Last error: {c.last_error}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: 20,
      }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 16 }}>
          Record Inventory
        </h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Entity', 'Count', 'Source'].map(h => (
                <th key={h} style={{
                  textAlign: 'left',
                  fontSize: 11,
                  fontWeight: 600,
                  color: colors.textMuted,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  padding: '8px 12px',
                  borderBottom: `1px solid ${colors.border}`,
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {([
              { entity: 'Deals', count: data.totals.deals },
              { entity: 'Contacts', count: data.totals.contacts },
              { entity: 'Accounts', count: data.totals.accounts },
              { entity: 'Conversations', count: data.totals.conversations },
            ]).map(row => {
              const sources = data.connectors
                .filter(c => c.records[row.entity.toLowerCase()] > 0)
                .map(c => capitalize(c.type));
              return (
                <tr key={row.entity}>
                  <td style={{ fontSize: 13, color: colors.text, padding: '10px 12px', borderBottom: `1px solid ${colors.border}` }}>
                    {row.entity}
                  </td>
                  <td style={{ fontSize: 13, fontFamily: fonts.mono, color: colors.text, padding: '10px 12px', borderBottom: `1px solid ${colors.border}` }}>
                    {row.count.toLocaleString()}
                  </td>
                  <td style={{ fontSize: 12, color: colors.textSecondary, padding: '10px 12px', borderBottom: `1px solid ${colors.border}` }}>
                    {sources.length > 0 ? sources.join(', ') : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: 20,
      }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 16 }}>
          Sync History
        </h3>
        {data.syncHistory.length === 0 ? (
          <p style={{ fontSize: 13, color: colors.textMuted, textAlign: 'center', padding: 24 }}>
            No sync history yet
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
              <thead>
                <tr>
                  {['Timestamp', 'Connector', 'Type', 'Records', 'Duration', 'Status'].map(h => (
                    <th key={h} style={{
                      textAlign: 'left',
                      fontSize: 11,
                      fontWeight: 600,
                      color: colors.textMuted,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      padding: '8px 12px',
                      borderBottom: `1px solid ${colors.border}`,
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.syncHistory.slice(0, 20).map(entry => {
                  const isSuccess = entry.status === 'completed' || entry.status === 'success';
                  const isFailed = entry.status === 'failed' || entry.status === 'error';
                  const isErrorExpanded = expandedErrors[entry.id] || false;
                  return (
                    <React.Fragment key={entry.id}>
                      <tr
                        style={{ cursor: isFailed && entry.errors ? 'pointer' : 'default' }}
                        onClick={() => {
                          if (isFailed && entry.errors) {
                            setExpandedErrors(prev => ({ ...prev, [entry.id]: !prev[entry.id] }));
                          }
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <td style={{ fontSize: 12, color: colors.textSecondary, padding: '10px 12px', borderBottom: `1px solid ${colors.border}`, whiteSpace: 'nowrap' }}>
                          {timeAgo(entry.startedAt)}
                        </td>
                        <td style={{ fontSize: 13, color: colors.text, padding: '10px 12px', borderBottom: `1px solid ${colors.border}` }}>
                          {capitalize(entry.connectorType)}
                        </td>
                        <td style={{ fontSize: 12, color: colors.textSecondary, padding: '10px 12px', borderBottom: `1px solid ${colors.border}` }}>
                          {entry.syncType}
                        </td>
                        <td style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.text, padding: '10px 12px', borderBottom: `1px solid ${colors.border}` }}>
                          {entry.recordsSynced.toLocaleString()}
                        </td>
                        <td style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.textMuted, padding: '10px 12px', borderBottom: `1px solid ${colors.border}` }}>
                          {entry.durationMs != null ? `${(entry.durationMs / 1000).toFixed(1)}s` : '—'}
                        </td>
                        <td style={{ fontSize: 13, padding: '10px 12px', borderBottom: `1px solid ${colors.border}` }}>
                          {isSuccess && <span style={{ color: colors.green }}>✓</span>}
                          {isFailed && <span style={{ color: colors.red }}>✗</span>}
                          {!isSuccess && !isFailed && <span style={{ color: colors.textMuted }}>{entry.status}</span>}
                        </td>
                      </tr>
                      {isErrorExpanded && entry.errors && (
                        <tr>
                          <td colSpan={6} style={{ padding: '8px 12px 12px 24px', borderBottom: `1px solid ${colors.border}`, background: colors.surfaceRaised }}>
                            <pre style={{
                              fontSize: 11,
                              fontFamily: fonts.mono,
                              color: colors.red,
                              margin: 0,
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                            }}>
                              {typeof entry.errors === 'string' ? entry.errors : JSON.stringify(entry.errors, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
