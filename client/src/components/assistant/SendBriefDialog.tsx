import React, { useState } from 'react';
import { api } from '../../lib/api';

const BRIEF_TYPE_LABELS: Record<string, string> = {
  monday_setup: 'Monday Setup',
  pulse: 'Pulse Update',
  friday_recap: 'Friday Recap',
  quarter_close: 'Quarter Close',
};

interface SendBriefDialogProps {
  brief: any;
  workspaceId: string;
  onClose: () => void;
}

export default function SendBriefDialog({ brief, workspaceId, onClose }: SendBriefDialogProps) {
  const [channel, setChannel] = useState('#revenue-ops');
  const [format, setFormat] = useState<'summary' | 'full'>('summary');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const typeLabel = BRIEF_TYPE_LABELS[brief?.brief_type] || 'Brief';

  async function handleSend() {
    if (!channel.trim()) return;
    setSending(true);
    setError('');
    try {
      await api.post(`/${workspaceId}/brief/${brief.id}/send`, { channel: channel.trim(), format });
      setSent(true);
    } catch (err: any) {
      setError(err.message || 'Failed to send');
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
      <div style={{ background: '#141414', border: '1px solid #1F2937', borderRadius: 12, padding: 24, width: 380, maxWidth: '90vw' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#E5E7EB' }}>Send to Slack</div>
            <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>{typeLabel} · {brief?.generated_date}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6B7280', cursor: 'pointer', fontSize: 18, padding: 4 }}>✕</button>
        </div>

        {sent ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
            <div style={{ color: '#34D399', fontSize: 14, fontWeight: 500 }}>Brief sent to {channel}</div>
            <button onClick={onClose} style={{ marginTop: 16, padding: '8px 20px', background: '#1F2937', border: 'none', borderRadius: 6, color: '#E5E7EB', cursor: 'pointer', fontSize: 13 }}>Close</button>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 12, color: '#9CA3AF', display: 'block', marginBottom: 6 }}>Channel</label>
              <input
                value={channel}
                onChange={e => setChannel(e.target.value)}
                placeholder="#revenue-ops"
                style={{ width: '100%', background: '#1A1A1A', border: '1px solid #1F2937', borderRadius: 6, padding: '8px 10px', color: '#E5E7EB', fontSize: 13, boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, color: '#9CA3AF', display: 'block', marginBottom: 8 }}>Format</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['summary', 'full'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setFormat(f)}
                    style={{ flex: 1, padding: '8px 0', borderRadius: 6, border: `1px solid ${format === f ? '#6488EA' : '#1F2937'}`, background: format === f ? '#6488EA20' : '#1A1A1A', color: format === f ? '#6488EA' : '#9CA3AF', cursor: 'pointer', fontSize: 13, fontWeight: format === f ? 600 : 400 }}
                  >
                    {f === 'summary' ? 'Summary' : 'Full brief'}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 11, color: '#6B7280', marginTop: 6 }}>
                {format === 'summary' ? 'Header + 3–4 key metrics' : 'All sections, adapted to brief type'}
              </div>
            </div>

            {error && <div style={{ marginBottom: 12, color: '#F87171', fontSize: 12 }}>{error}</div>}

            <button
              onClick={handleSend}
              disabled={sending || !channel.trim()}
              style={{ width: '100%', padding: '10px 0', background: '#6488EA', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 600, fontSize: 14, cursor: sending ? 'not-allowed' : 'pointer', opacity: sending ? 0.7 : 1 }}
            >
              {sending ? 'Sending…' : `Send ${typeLabel}`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
