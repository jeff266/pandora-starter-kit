import React, { useState } from 'react';
import { api } from '../../lib/api';

interface BriefEmptyStateProps {
  workspaceId: string;
  onAssembled?: () => void;
}

export default function BriefEmptyState({ workspaceId, onAssembled }: BriefEmptyStateProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleAssemble() {
    setLoading(true);
    setError('');
    try {
      await api.post(`/${workspaceId}/brief/assemble`, { force: true });
      onAssembled?.();
    } catch (err: any) {
      setError(err.message || 'Assembly failed — check operator runs');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: '24px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#1A1A1A', border: '1px solid #1F2937', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
        ✦
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 14, color: '#9CA3AF', marginBottom: 4 }}>No brief for today yet</div>
        <div style={{ fontSize: 12, color: '#6B7280' }}>Briefs are assembled at 7 AM daily. Run one now to see your situation.</div>
      </div>

      {error && <div style={{ fontSize: 12, color: '#F87171', textAlign: 'center' }}>{error}</div>}

      <button
        onClick={handleAssemble}
        disabled={loading}
        style={{ padding: '9px 20px', background: '#6488EA', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: 8 }}
      >
        {loading ? (
          <>
            <span style={{ width: 14, height: 14, border: '2px solid #ffffff40', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.8s linear infinite' }} />
            Assembling…
          </>
        ) : 'Run brief now'}
      </button>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
