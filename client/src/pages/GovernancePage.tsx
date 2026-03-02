import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';
import { colors, fonts } from '../styles/theme';
import Skeleton, { SkeletonCard } from '../components/Skeleton';
import IntelligenceNav from '../components/IntelligenceNav';
import { MetricCard, EmptyState } from '../components/shared';
import { formatTimeAgo, formatDateTime } from '../lib/format';

interface GovernanceRecord {
  id: string;
  workspace_id: string;
  skill_id: string;
  change_type: string;
  status: 'pending_approval' | 'deployed' | 'monitoring' | 'stable' | 'rejected' | 'rolled_back';
  change_description: string;
  explanation_summary?: string;
  explanation_detail?: string;
  explanation_impact?: string;
  rollback_note?: string;
  review_score?: number;
  review_result?: any;
  review_concerns?: string[];
  dimension_scores?: Record<string, number>;
  comparison_test_cases?: any;
  status_history?: any[];
  change_payload?: any;
  trial_expires_at?: string;
  created_at: string;
  deployed_at?: string;
  deployed_by?: string;
  rolled_back_at?: string;
  rolled_back_by?: string;
  rollback_reason?: string;
  source_type?: string;
  source_feedback_ids?: string[];
}

const GovernancePage: React.FC = () => {
  const [records, setRecords] = useState<GovernanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'monitoring' | 'stable' | 'rejected' | 'rolled_back'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<GovernanceRecord | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  
  const [rejectState, setRejectState] = useState<{ id: string | null; reason: string; open: boolean }>({
    id: null,
    reason: '',
    open: false
  });
  
  const [rollbackState, setRollbackState] = useState<{ id: string | null; reason: string; open: boolean }>({
    id: null,
    reason: '',
    open: false
  });

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchRecords = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.get('/governance?status=all');
      setRecords(data.records ?? []);
    } catch (err: any) {
      showToast(err.message || 'Failed to fetch governance records', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const fetchDetail = async (id: string) => {
    try {
      setLoadingDetail(true);
      const data = await api.get(`/governance/${id}`);
      setSelectedRecord(data.record || data);
      setDrawerOpen(true);
    } catch (err: any) {
      showToast(err.message || 'Failed to fetch record details', 'error');
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleApprove = async (id: string) => {
    try {
      setActionLoading(id);
      await api.post(`/governance/${id}/approve`, { approved_by: 'admin' });
      showToast('Record approved successfully', 'success');
      fetchRecords();
    } catch (err: any) {
      showToast(err.message || 'Failed to approve record', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async () => {
    if (!rejectState.id || !rejectState.reason.trim()) return;
    try {
      setActionLoading(rejectState.id);
      await api.post(`/governance/${rejectState.id}/reject`, { 
        rejected_by: 'admin', 
        reason: rejectState.reason 
      });
      showToast('Record rejected', 'success');
      setRejectState({ id: null, reason: '', open: false });
      fetchRecords();
    } catch (err: any) {
      showToast(err.message || 'Failed to reject record', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRollback = async () => {
    if (!rollbackState.id || !rollbackState.reason.trim()) return;
    try {
      setActionLoading(rollbackState.id);
      await api.post(`/governance/${rollbackState.id}/rollback`, { 
        rolled_back_by: 'admin', 
        reason: rollbackState.reason 
      });
      showToast('Record rolled back', 'success');
      setRollbackState({ id: null, reason: '', open: false });
      fetchRecords();
    } catch (err: any) {
      showToast(err.message || 'Failed to rollback record', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      setActionLoading(id);
      await api.delete(`/governance/${id}`);
      showToast('Record deleted', 'success');
      fetchRecords();
    } catch (err: any) {
      showToast(err.message || 'Failed to delete record', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const filteredRecords = records.filter(r => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'pending') return r.status === 'pending_approval';
    if (statusFilter === 'monitoring') return r.status === 'deployed' || r.status === 'monitoring';
    if (statusFilter === 'stable') return r.status === 'stable';
    if (statusFilter === 'rejected') return r.status === 'rejected';
    if (statusFilter === 'rolled_back') return r.status === 'rolled_back';
    return true;
  });

  const stats = {
    pending: records.filter(r => r.status === 'pending_approval').length,
    monitoring: records.filter(r => r.status === 'deployed' || r.status === 'monitoring').length,
    stable: records.filter(r => r.status === 'stable').length,
    rolledBack: records.filter(r => r.status === 'rolled_back').length,
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending_approval': return colors.yellow;
      case 'deployed':
      case 'monitoring': return colors.accent;
      case 'stable': return colors.green;
      case 'rejected':
      case 'rolled_back': return colors.red;
      default: return colors.textMuted;
    }
  };

  const renderStatusBadge = (status: string) => {
    const label = status.replace('_', ' ').toUpperCase();
    return (
      <span style={{
        fontSize: '10px',
        fontWeight: 'bold',
        padding: '2px 6px',
        borderRadius: '4px',
        background: `${getStatusColor(status)}20`,
        color: getStatusColor(status),
        border: `1px solid ${getStatusColor(status)}40`,
        textTransform: 'uppercase',
      }}>
        {label}
      </span>
    );
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto', color: colors.text }}>
      <IntelligenceNav activeTab="governance" pendingCount={stats.pending} />
      {/* Metrics Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px', marginTop: '12px' }}>
        <MetricCard 
          label="Pending Review" 
          value={stats.pending.toString()} 
          subtitle={stats.pending > 0 ? "Needs Action" : undefined}
          color={stats.pending > 0 ? colors.yellow : undefined}
        />
        <MetricCard label="Monitoring" value={stats.monitoring.toString()} color={colors.accent} />
        <MetricCard label="Stable" value={stats.stable.toString()} color={colors.green} />
        <MetricCard label="Auto-Rolled Back" value={stats.rolledBack.toString()} color={colors.red} />
      </div>

      {/* Filter Bar */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', overflowX: 'auto', paddingBottom: '8px' }}>
        {(['all', 'pending', 'monitoring', 'stable', 'rejected', 'rolled_back'] as const).map(f => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            style={{
              padding: '6px 16px',
              borderRadius: '20px',
              border: 'none',
              background: statusFilter === f ? colors.accent : colors.surfaceRaised,
              color: statusFilter === f ? '#fff' : colors.textSecondary,
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 500,
              whiteSpace: 'nowrap',
              transition: 'all 0.2s'
            }}
          >
            {f.charAt(0).toUpperCase() + f.slice(1).replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Records Grid */}
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: '20px' }}>
          {[1, 2, 3, 4].map(i => <SkeletonCard key={i} height={200} />)}
        </div>
      ) : filteredRecords.length === 0 ? (
        <EmptyState 
          title="No governance records" 
          description={`No records found matching "${statusFilter}"`} 
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: '20px' }}>
          {filteredRecords.map(record => (
            <div 
              key={record.id}
              style={{
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: '12px',
                padding: '20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                position: 'relative'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '18px' }}>⚙️</span>
                  {renderStatusBadge(record.status)}
                  <span style={{ fontSize: '12px', fontWeight: 'bold', color: colors.textSecondary }}>{record.change_type}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {record.review_score && (
                    <div style={{ 
                      fontSize: '12px', 
                      fontWeight: 'bold', 
                      color: record.review_score > 0.8 ? colors.green : record.review_score > 0.6 ? colors.yellow : colors.red,
                      background: colors.surfaceRaised,
                      padding: '2px 6px',
                      borderRadius: '4px'
                    }}>
                      {Math.round((record.review_score || 0) * 100)}%
                    </div>
                  )}
                </div>
              </div>

              <div style={{ fontSize: '14px', fontWeight: 500, lineHeight: 1.4, color: colors.text }}>
                {record.explanation_summary || record.change_description.slice(0, 200) + (record.change_description.length > 200 ? '...' : '')}
              </div>

              {/* Status Specific Content */}
              <div style={{ marginTop: 'auto', paddingTop: '12px', borderTop: `1px solid ${colors.borderLight}` }}>
                {record.status === 'pending_approval' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {record.review_concerns && record.review_concerns.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {record.review_concerns.slice(0, 2).map((c, i) => (
                          <div key={i} style={{ fontSize: '12px', color: colors.yellow, display: 'flex', gap: '4px' }}>
                            <span>⚠</span>
                            <span>{c}</span>
                          </div>
                        ))}
                        {record.review_concerns.length > 2 && (
                          <button 
                            onClick={() => fetchDetail(record.id)}
                            style={{ background: 'none', border: 'none', color: colors.accent, fontSize: '11px', textAlign: 'left', padding: 0, cursor: 'pointer' }}
                          >
                            + {record.review_concerns.length - 2} more concerns
                          </button>
                        )}
                      </div>
                    )}
                    
                    {rejectState.open && rejectState.id === record.id ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <textarea
                          placeholder="Reason for rejection..."
                          value={rejectState.reason}
                          onChange={e => setRejectState(s => ({ ...s, reason: e.target.value }))}
                          style={{
                            width: '100%',
                            background: colors.bg,
                            border: `1px solid ${colors.border}`,
                            borderRadius: '4px',
                            color: colors.text,
                            padding: '8px',
                            fontSize: '13px',
                            minHeight: '60px',
                            fontFamily: fonts.sans
                          }}
                        />
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button 
                            onClick={handleReject}
                            disabled={actionLoading === record.id || !rejectState.reason.trim()}
                            style={{
                              flex: 1,
                              padding: '6px',
                              background: colors.red,
                              color: '#fff',
                              border: 'none',
                              borderRadius: '4px',
                              fontSize: '12px',
                              fontWeight: 'bold',
                              cursor: 'pointer',
                              opacity: actionLoading === record.id ? 0.6 : 1
                            }}
                          >
                            Confirm Reject
                          </button>
                          <button 
                            onClick={() => setRejectState({ id: null, reason: '', open: false })}
                            style={{
                              flex: 1,
                              padding: '6px',
                              background: colors.surfaceRaised,
                              color: colors.text,
                              border: 'none',
                              borderRadius: '4px',
                              fontSize: '12px',
                              cursor: 'pointer'
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <button 
                          onClick={() => handleApprove(record.id)}
                          disabled={actionLoading === record.id}
                          style={{
                            padding: '6px 12px',
                            background: colors.green,
                            color: '#fff',
                            border: 'none',
                            borderRadius: '4px',
                            fontSize: '12px',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            opacity: actionLoading === record.id ? 0.6 : 1
                          }}
                        >
                          {actionLoading === record.id ? '...' : '✓ Approve'}
                        </button>
                        <button 
                          onClick={() => setRejectState({ id: record.id, reason: '', open: true })}
                          disabled={actionLoading === record.id}
                          style={{
                            padding: '6px 12px',
                            background: colors.surfaceRaised,
                            color: colors.text,
                            border: `1px solid ${colors.border}`,
                            borderRadius: '4px',
                            fontSize: '12px',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            opacity: actionLoading === record.id ? 0.6 : 1
                          }}
                        >
                          ✕ Reject
                        </button>
                        <button 
                          onClick={() => fetchDetail(record.id)}
                          style={{
                            marginLeft: 'auto',
                            background: 'none',
                            border: 'none',
                            color: colors.accent,
                            fontSize: '12px',
                            fontWeight: 'bold',
                            cursor: 'pointer'
                          }}
                        >
                          Details →
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {(record.status === 'deployed' || record.status === 'monitoring') && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ fontSize: '12px', color: colors.textSecondary }}>
                      Deployed {formatTimeAgo(record.deployed_at || record.created_at)} — {record.trial_expires_at ? `${Math.max(0, Math.ceil((new Date(record.trial_expires_at).getTime() - Date.now()) / 86400000))} days remaining` : 'monitoring'}
                    </div>
                    {rollbackState.open && rollbackState.id === record.id ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <textarea
                          placeholder="Reason for rollback..."
                          value={rollbackState.reason}
                          onChange={e => setRollbackState(s => ({ ...s, reason: e.target.value }))}
                          style={{
                            width: '100%',
                            background: colors.bg,
                            border: `1px solid ${colors.border}`,
                            borderRadius: '4px',
                            color: colors.text,
                            padding: '8px',
                            fontSize: '13px',
                            minHeight: '60px',
                            fontFamily: fonts.sans
                          }}
                        />
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button 
                            onClick={handleRollback}
                            disabled={actionLoading === record.id || !rollbackState.reason.trim()}
                            style={{
                              flex: 1,
                              padding: '6px',
                              background: colors.red,
                              color: '#fff',
                              border: 'none',
                              borderRadius: '4px',
                              fontSize: '12px',
                              fontWeight: 'bold',
                              cursor: 'pointer',
                              opacity: actionLoading === record.id ? 0.6 : 1
                            }}
                          >
                            Confirm Rollback
                          </button>
                          <button 
                            onClick={() => setRollbackState({ id: null, reason: '', open: false })}
                            style={{
                              flex: 1,
                              padding: '6px',
                              background: colors.surfaceRaised,
                              color: colors.text,
                              border: 'none',
                              borderRadius: '4px',
                              fontSize: '12px',
                              cursor: 'pointer'
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <button 
                          onClick={() => setRollbackState({ id: record.id, reason: '', open: true })}
                          disabled={actionLoading === record.id}
                          style={{
                            padding: '6px 12px',
                            background: `${colors.red}20`,
                            color: colors.red,
                            border: `1px solid ${colors.red}40`,
                            borderRadius: '4px',
                            fontSize: '12px',
                            fontWeight: 'bold',
                            cursor: 'pointer'
                          }}
                        >
                          ⟲ Rollback
                        </button>
                        <button 
                          onClick={() => fetchDetail(record.id)}
                          style={{
                            marginLeft: 'auto',
                            background: 'none',
                            border: 'none',
                            color: colors.accent,
                            fontSize: '12px',
                            fontWeight: 'bold',
                            cursor: 'pointer'
                          }}
                        >
                          Details →
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {record.status === 'stable' && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: '12px', color: colors.green, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span>★</span> Proven improvement · deployed {formatTimeAgo(record.deployed_at || record.created_at)}
                    </div>
                    <button 
                      onClick={() => fetchDetail(record.id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: colors.accent,
                        fontSize: '12px',
                        fontWeight: 'bold',
                        cursor: 'pointer'
                      }}
                    >
                      Details →
                    </button>
                  </div>
                )}

                {record.status === 'rejected' && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: '12px', color: colors.red, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>
                      {record.review_concerns?.[0] || 'Rejected by reviewer'}
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button 
                        onClick={() => fetchDetail(record.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: colors.accent,
                          fontSize: '12px',
                          fontWeight: 'bold',
                          cursor: 'pointer'
                        }}
                      >
                        Details →
                      </button>
                      <button 
                        onClick={() => handleDelete(record.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: colors.textMuted,
                          fontSize: '12px',
                          cursor: 'pointer'
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}

                {record.status === 'rolled_back' && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: '12px', color: colors.red }}>
                      Rolled back {formatTimeAgo(record.rolled_back_at || record.created_at)}
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button 
                        onClick={() => fetchDetail(record.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: colors.accent,
                          fontSize: '12px',
                          fontWeight: 'bold',
                          cursor: 'pointer'
                        }}
                      >
                        Details →
                      </button>
                      <button 
                        onClick={() => handleDelete(record.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: colors.textMuted,
                          fontSize: '12px',
                          cursor: 'pointer'
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail Drawer */}
      {drawerOpen && selectedRecord && (
        <>
          <div 
            onClick={() => setDrawerOpen(false)}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0,0,0,0.5)',
              zIndex: 49
            }}
          />
          <div style={{
            position: 'fixed',
            top: 0,
            right: 0,
            width: '500px',
            height: '100%',
            background: colors.bg,
            borderLeft: `1px solid ${colors.border}`,
            zIndex: 50,
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '-4px 0 20px rgba(0,0,0,0.3)',
            animation: 'slideInRight 0.3s ease-out'
          }}>
            <div style={{ 
              padding: '20px', 
              borderBottom: `1px solid ${colors.border}`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div style={{ fontWeight: 'bold', fontSize: '16px' }}>Record Details</div>
              <button 
                onClick={() => setDrawerOpen(false)}
                style={{ background: 'none', border: 'none', color: colors.textMuted, cursor: 'pointer', fontSize: '20px' }}
              >
                ×
              </button>
            </div>
            
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <section>
                <div style={{ fontSize: '12px', fontWeight: 'bold', color: colors.textMuted, textTransform: 'uppercase', marginBottom: '8px' }}>Description</div>
                <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '8px' }}>{selectedRecord.explanation_summary || 'Summary'}</div>
                <div style={{ fontSize: '14px', color: colors.textSecondary, lineHeight: 1.5 }}>{selectedRecord.change_description}</div>
                {selectedRecord.explanation_detail && (
                  <div style={{ marginTop: '12px', fontSize: '13px', color: colors.textSecondary }}>{selectedRecord.explanation_detail}</div>
                )}
                {selectedRecord.explanation_impact && (
                  <div style={{ marginTop: '12px', padding: '12px', background: colors.surfaceRaised, borderRadius: '8px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 'bold', color: colors.accent, textTransform: 'uppercase', marginBottom: '4px' }}>Impact Assessment</div>
                    <div style={{ fontSize: '13px' }}>{selectedRecord.explanation_impact}</div>
                  </div>
                )}
              </section>

              {selectedRecord.review_score !== undefined && (
                <section>
                  <div style={{ fontSize: '12px', fontWeight: 'bold', color: colors.textMuted, textTransform: 'uppercase', marginBottom: '8px' }}>Review</div>
                  <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
                    <div style={{ flex: 1, textAlign: 'center', padding: '12px', background: colors.surfaceRaised, borderRadius: '8px' }}>
                      <div style={{ fontSize: '24px', fontWeight: 'bold', color: selectedRecord.review_score > 0.8 ? colors.green : colors.yellow }}>{Math.round((selectedRecord.review_score || 0) * 100)}%</div>
                      <div style={{ fontSize: '10px', color: colors.textMuted }}>Overall Score</div>
                    </div>
                    {selectedRecord.dimension_scores && Object.entries(selectedRecord.dimension_scores).map(([k, v]) => (
                      <div key={k} style={{ flex: 1, textAlign: 'center', padding: '12px', background: colors.surfaceRaised, borderRadius: '8px' }}>
                        <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{v}</div>
                        <div style={{ fontSize: '10px', color: colors.textMuted, textTransform: 'capitalize' }}>{k}</div>
                      </div>
                    ))}
                  </div>
                  
                  {selectedRecord.review_concerns && selectedRecord.review_concerns.length > 0 && (
                    <div style={{ marginBottom: '12px' }}>
                      <div style={{ fontSize: '11px', fontWeight: 'bold', color: colors.yellow, marginBottom: '4px' }}>CONCERNS</div>
                      {selectedRecord.review_concerns.map((c, i) => (
                        <div key={i} style={{ fontSize: '13px', marginBottom: '4px', display: 'flex', gap: '6px' }}>
                          <span style={{ color: colors.yellow }}>⚠</span> {c}
                        </div>
                      ))}
                    </div>
                  )}

                  {selectedRecord.review_result?.strengths && selectedRecord.review_result.strengths.length > 0 && (
                    <div>
                      <div style={{ fontSize: '11px', fontWeight: 'bold', color: colors.green, marginBottom: '4px' }}>STRENGTHS</div>
                      {selectedRecord.review_result.strengths.map((s: string, i: number) => (
                        <div key={i} style={{ fontSize: '13px', marginBottom: '4px', display: 'flex', gap: '6px' }}>
                          <span style={{ color: colors.green }}>✓</span> {s}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {selectedRecord.comparison_test_cases?.test_cases?.length > 0 && (
                <section>
                  <div style={{ fontSize: '12px', fontWeight: 'bold', color: colors.textMuted, textTransform: 'uppercase', marginBottom: '8px' }}>Test Comparison</div>
                  <div style={{ overflowX: 'auto', border: `1px solid ${colors.border}`, borderRadius: '8px' }}>
                    <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: colors.surfaceRaised }}>
                          <th style={{ padding: '8px', textAlign: 'left', borderBottom: `1px solid ${colors.border}` }}>Input</th>
                          <th style={{ padding: '8px', textAlign: 'left', borderBottom: `1px solid ${colors.border}` }}>Before</th>
                          <th style={{ padding: '8px', textAlign: 'left', borderBottom: `1px solid ${colors.border}` }}>After</th>
                          <th style={{ padding: '8px', textAlign: 'center', borderBottom: `1px solid ${colors.border}` }}>V</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(selectedRecord.comparison_test_cases?.test_cases || []).map((t: any, i: number) => (
                          <tr key={i}>
                            <td style={{ padding: '8px', borderBottom: `1px solid ${colors.borderLight}` }}>{t.input}</td>
                            <td style={{ padding: '8px', borderBottom: `1px solid ${colors.borderLight}`, color: colors.textSecondary }}>{t.before}</td>
                            <td style={{ padding: '8px', borderBottom: `1px solid ${colors.borderLight}` }}>{t.after}</td>
                            <td style={{ padding: '8px', borderBottom: `1px solid ${colors.borderLight}`, textAlign: 'center' }}>
                              {t.verdict === 'better' ? '✅' : t.verdict === 'worse' ? '❌' : '➖'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {selectedRecord.status_history && selectedRecord.status_history.length > 0 && (
                <section>
                  <div style={{ fontSize: '12px', fontWeight: 'bold', color: colors.textMuted, textTransform: 'uppercase', marginBottom: '12px' }}>Timeline</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', position: 'relative', paddingLeft: '20px' }}>
                    <div style={{ position: 'absolute', left: '4px', top: '5px', bottom: '5px', width: '2px', background: colors.border }} />
                    {selectedRecord.status_history.map((h, i) => (
                      <div key={i} style={{ position: 'relative' }}>
                        <div style={{ 
                          position: 'absolute', 
                          left: '-20px', 
                          top: '4px', 
                          width: '10px', 
                          height: '10px', 
                          borderRadius: '50%', 
                          background: i === 0 ? colors.accent : colors.border,
                          border: `2px solid ${colors.bg}`
                        }} />
                        <div style={{ fontSize: '13px', fontWeight: 'bold' }}>{h.status.replace('_', ' ').toUpperCase()}</div>
                        <div style={{ fontSize: '11px', color: colors.textMuted }}>{formatDateTime(h.timestamp)} {h.by ? `by ${h.by}` : ''}</div>
                        {h.reason && <div style={{ fontSize: '12px', marginTop: '4px', fontStyle: 'italic' }}>"{h.reason}"</div>}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section>
                <div style={{ fontSize: '12px', fontWeight: 'bold', color: colors.textMuted, textTransform: 'uppercase', marginBottom: '8px' }}>Change Payload</div>
                <details style={{ background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: '4px' }}>
                  <summary style={{ padding: '8px', fontSize: '12px', cursor: 'pointer', userSelect: 'none' }}>View JSON</summary>
                  <pre style={{ 
                    padding: '12px', 
                    fontSize: '11px', 
                    overflowX: 'auto', 
                    margin: 0, 
                    fontFamily: fonts.mono,
                    background: '#00000030'
                  }}>
                    {JSON.stringify(selectedRecord.change_payload, null, 2)}
                  </pre>
                </details>
              </section>
            </div>
          </div>
        </>
      )}

      {/* Toast Notification */}
      {toast && (
        <div style={{
          position: 'fixed',
          top: '24px',
          right: '24px',
          padding: '12px 24px',
          borderRadius: '8px',
          background: toast.type === 'success' ? colors.green : colors.red,
          color: '#fff',
          fontWeight: 'bold',
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          zIndex: 100,
          animation: 'fadeInUp 0.3s ease-out'
        }}>
          {toast.message}
        </div>
      )}

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes skeleton-pulse {
          0% { opacity: 0.6; }
          50% { opacity: 1; }
          100% { opacity: 0.6; }
        }
      `}</style>
    </div>
  );
};

export default GovernancePage;
