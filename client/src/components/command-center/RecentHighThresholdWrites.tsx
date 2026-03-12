import { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { colors, fonts } from '../../styles/theme';
import { useWorkspace } from '../../context/WorkspaceContext';

interface HighThresholdWrite {
  id: string;
  created_at: string;
  crm_property_name: string;
  value_written: string;
  previous_value: string;
  deal_name?: string;
  crm_record_id: string;
  reversed_at: string | null;
  undo_window_hours: number;
}

export default function RecentHighThresholdWrites() {
  const { currentWorkspace } = useWorkspace();
  const [writes, setWrites] = useState<HighThresholdWrite[]>([]);
  const [loading, setLoading] = useState(true);
  const [undoing, setUndoing] = useState<string | null>(null);

  useEffect(() => {
    if (currentWorkspace?.id) {
      fetchRecentWrites();
    }
  }, [currentWorkspace?.id]);

  const fetchRecentWrites = async () => {
    setLoading(true);
    try {
      const response = await api.get(
        `/${currentWorkspace?.id}/crm-writeback/log?initiated_by=workflow_rule&action_threshold_at_write=high&limit=10&offset=0`
      );

      // Filter for unreversed writes within undo window
      const now = Date.now();
      const undoableWrites = (response.log_entries || []).filter((write: HighThresholdWrite) => {
        if (write.reversed_at) return false; // Already reversed
        const writeTime = new Date(write.created_at).getTime();
        const undoWindowMs = (write.undo_window_hours || 24) * 60 * 60 * 1000;
        return (now - writeTime) < undoWindowMs;
      });

      setWrites(undoableWrites);
    } catch (err) {
      console.error('[RecentHighThresholdWrites] Failed to fetch:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleUndo = async (writeLogId: string) => {
    setUndoing(writeLogId);
    try {
      await api.post(`/${currentWorkspace?.id}/crm-writeback/log/${writeLogId}/reverse`);

      const event = new CustomEvent('toast', {
        detail: {
          message: 'Write reversed successfully',
          type: 'success',
        },
      });
      window.dispatchEvent(event);

      // Remove from list
      setWrites(prev => prev.filter(w => w.id !== writeLogId));
    } catch (err: any) {
      const event = new CustomEvent('toast', {
        detail: {
          message: `Failed to undo: ${err.message || 'Unknown error'}`,
          type: 'error',
        },
      });
      window.dispatchEvent(event);
    } finally {
      setUndoing(null);
    }
  };

  const getTimeRemaining = (write: HighThresholdWrite): string => {
    const writeTime = new Date(write.created_at).getTime();
    const undoWindowMs = (write.undo_window_hours || 24) * 60 * 60 * 1000;
    const expiresAt = writeTime + undoWindowMs;
    const remaining = expiresAt - Date.now();

    if (remaining <= 0) return 'Expired';

    const hours = Math.floor(remaining / (60 * 60 * 1000));
    const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));

    if (hours > 0) {
      return `${hours}h ${minutes}m remaining`;
    }
    return `${minutes}m remaining`;
  };

  if (loading) {
    return null;
  }

  if (writes.length === 0) {
    return null; // Hide panel if no writes
  }

  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 10,
      overflow: 'hidden',
      marginBottom: 24,
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: `1px solid ${colors.border}`,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: colors.text, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>↩️</span>
            Recent Auto-Writes
          </h3>
          <p style={{ fontSize: 11, color: colors.textMuted, margin: '2px 0 0' }}>
            {writes.length} high-threshold write{writes.length !== 1 ? 's' : ''} can be undone
          </p>
        </div>
      </div>

      {/* Writes List */}
      <div style={{ maxHeight: 300, overflowY: 'auto' }}>
        {writes.map((write) => {
          const previousVal = write.previous_value ? JSON.parse(write.previous_value) : null;
          const newVal = write.value_written ? JSON.parse(write.value_written) : null;

          return (
            <div
              key={write.id}
              style={{
                padding: '12px 16px',
                borderBottom: `1px solid ${colors.border}`,
              }}
            >
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: colors.text, marginBottom: 4 }}>
                    Set {write.crm_property_name}
                    <span style={{
                      marginLeft: 8,
                      fontSize: 9,
                      fontWeight: 700,
                      padding: '2px 6px',
                      borderRadius: 3,
                      background: '#10B981' + '20',
                      color: '#10B981',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}>
                      HIGH
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 4 }}>
                    {write.deal_name || write.crm_record_id}
                  </div>
                  <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 8 }}>
                    <span style={{ fontWeight: 500 }}>From:</span> {String(previousVal)} → <span style={{ fontWeight: 500 }}>To:</span> {String(newVal)}
                  </div>
                  <div style={{ fontSize: 10, color: colors.textDim, marginBottom: 8 }}>
                    {getTimeRemaining(write)}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => handleUndo(write.id)}
                      disabled={undoing === write.id}
                      style={{
                        fontSize: 11,
                        fontWeight: 500,
                        padding: '4px 8px',
                        borderRadius: 4,
                        background: colors.dangerSoft,
                        color: colors.danger,
                        border: 'none',
                        cursor: undoing === write.id ? 'not-allowed' : 'pointer',
                        opacity: undoing === write.id ? 0.5 : 1,
                        fontFamily: fonts.sans,
                      }}
                    >
                      {undoing === write.id ? 'Undoing...' : 'Undo Write ↩'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
