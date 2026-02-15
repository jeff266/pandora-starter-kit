import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import { formatTimeAgo } from '../lib/format';
import Skeleton from '../components/Skeleton';

const sourceIcons: Record<string, { color: string; letter: string }> = {
  hubspot: { color: '#ff7a59', letter: 'H' },
  salesforce: { color: '#00a1e0', letter: 'S' },
  gong: { color: '#7c3aed', letter: 'G' },
  fireflies: { color: '#f59e0b', letter: 'F' },
  monday: { color: '#6161ff', letter: 'M' },
  'google-drive': { color: '#4285f4', letter: 'D' },
  'file-import': { color: '#64748b', letter: 'I' },
};

export default function ConnectorsPage() {
  const [connectors, setConnectors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/connectors')
      .then(data => setConnectors(Array.isArray(data) ? data : data.connectors || []))
      .catch(() => setConnectors([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} height={140} borderRadius={10} />
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
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
      {connectors.map((c, i) => {
        const source = c.source_type || c.name || 'unknown';
        const icon = sourceIcons[source] || { color: colors.textMuted, letter: source.charAt(0).toUpperCase() };
        const lastSync = c.last_sync_at || c.last_sync;
        const syncAge = lastSync ? (Date.now() - new Date(lastSync).getTime()) / 3600000 : 999;
        const statusDot = syncAge < 24 ? colors.green : syncAge < 168 ? colors.yellow : colors.red;
        const statusText = syncAge < 24 ? 'Connected' : syncAge < 168 ? 'Stale' : 'Error';

        return (
          <div key={i} style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 10,
            padding: 20,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 8, background: `${icon.color}20`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, fontWeight: 700, color: icon.color, flexShrink: 0,
              }}>
                {icon.letter}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: colors.text, textTransform: 'capitalize' }}>
                  {source.replace('-', ' ')}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%', background: statusDot,
                    boxShadow: `0 0 6px ${statusDot}40`,
                  }} />
                  <span style={{ fontSize: 11, color: colors.textSecondary }}>{statusText}</span>
                </div>
              </div>
            </div>

            <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 4 }}>
              Last sync: {lastSync ? formatTimeAgo(lastSync) : 'Never'}
            </div>
            {c.record_counts && (
              <div style={{ fontSize: 11, color: colors.textDim, fontFamily: fonts.mono }}>
                {typeof c.record_counts === 'object'
                  ? Object.entries(c.record_counts).map(([k, v]) => `${v} ${k}`).join(' · ')
                  : c.record_counts
                }
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
