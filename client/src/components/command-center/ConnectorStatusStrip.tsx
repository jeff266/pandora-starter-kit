import React from 'react';
import { useNavigate } from 'react-router-dom';
import { colors, fonts } from '../../styles/theme';
import { formatTimeAgo } from '../../lib/format';

interface ConnectorStatus {
  name?: string;
  connector_name?: string;
  type?: string;
  status?: string;
  health?: string;
  last_sync_at?: string;
  last_synced_at?: string;
  record_counts?: Record<string, number>;
  deal_count?: number;
  contact_count?: number;
  account_count?: number;
}

interface ConnectorStatusStripProps {
  connectors: ConnectorStatus[];
}

function deriveStatus(c: ConnectorStatus): 'healthy' | 'warning' | 'error' {
  const s = c.status || c.health || '';
  if (s === 'healthy' || s === 'active' || s === 'connected') return 'healthy';
  if (s === 'warning' || s === 'degraded') return 'warning';
  if (s === 'error' || s === 'failed' || s === 'disconnected') return 'error';

  const lastSync = c.last_sync_at || c.last_synced_at;
  if (!lastSync) return 'warning';
  const ageMs = Date.now() - new Date(lastSync).getTime();
  if (ageMs < 3 * 3600 * 1000) return 'healthy';
  if (ageMs < 24 * 3600 * 1000) return 'warning';
  return 'error';
}

function statusColor(s: 'healthy' | 'warning' | 'error'): string {
  if (s === 'healthy') return colors.green;
  if (s === 'warning') return colors.yellow;
  return colors.red;
}

function buildRecordSummary(c: ConnectorStatus): string {
  const counts: string[] = [];
  const rc = c.record_counts || {};
  const deals = c.deal_count ?? rc.deals ?? rc.deal_count;
  const contacts = c.contact_count ?? rc.contacts ?? rc.contact_count;
  const accounts = c.account_count ?? rc.accounts ?? rc.account_count;
  if (contacts != null) counts.push(`${contacts.toLocaleString()} contacts`);
  if (deals != null) counts.push(`${deals.toLocaleString()} deals`);
  if (accounts != null) counts.push(`${accounts.toLocaleString()} accounts`);
  return counts.join(' · ');
}

export default function ConnectorStatusStrip({ connectors }: ConnectorStatusStripProps) {
  const navigate = useNavigate();

  if (!connectors || connectors.length === 0) return null;

  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 10,
      padding: '12px 16px',
    }}>
      <div style={{
        fontSize: 11,
        fontWeight: 600,
        color: colors.textMuted,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        marginBottom: 10,
      }}>
        Connected Sources
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {connectors.map((c, i) => {
          const st = deriveStatus(c);
          const col = statusColor(st);
          const name = c.name || c.connector_name || c.type || 'Connector';
          const lastSync = c.last_sync_at || c.last_synced_at;
          const records = buildRecordSummary(c);

          return (
            <div
              key={i}
              onClick={() => navigate('/connectors')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                background: colors.bg,
                border: `1px solid ${colors.border}`,
                borderRadius: 8,
                cursor: 'pointer',
                flex: '1 1 160px',
                minWidth: 140,
                transition: 'border-color 0.12s',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = colors.borderLight)}
              onMouseLeave={e => (e.currentTarget.style.borderColor = colors.border)}
            >
              <span style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: col,
                boxShadow: `0 0 6px ${col}88`,
                flexShrink: 0,
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: colors.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {name}
                </div>
                {records && (
                  <div style={{ fontSize: 10, color: colors.textMuted, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {records}
                  </div>
                )}
              </div>
              {lastSync && (
                <div style={{ fontSize: 10, color: colors.textMuted, flexShrink: 0 }}>
                  {formatTimeAgo(lastSync)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
