import React, { useState, useEffect, useCallback } from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';
import { colors, fonts } from '../../styles/theme';
import Toast from '../Toast';
import { api } from '../../lib/api';
import WebhookEventReference from './WebhookEventReference';

interface WebhookEndpoint {
  id: string;
  url: string;
  enabled: boolean;
  event_types: string[] | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  consecutive_failures: number;
  disabled_reason: string | null;
  created_at: string;
}

interface WebhookDelivery {
  id: string;
  event_type: string;
  event_id: string;
  success: boolean;
  status_code: number | null;
  attempt: number;
  error: string | null;
  duration_ms: number | null;
  delivered_at: string;
}

const EVENT_TYPE_OPTIONS = [
  'prospect.scored',
  'deal.stage_changed',
  'deal.flagged',
  'action.created',
  'action.completed',
  'action.expired',
];

export default function WebhooksTab() {
  const { currentWorkspace } = useWorkspace();
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const [newUrl, setNewUrl] = useState('');
  const [newEventTypes, setNewEventTypes] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const [secretModal, setSecretModal] = useState<{ secret: string; url: string } | null>(null);
  const [secretCopied, setSecretCopied] = useState(false);
  const [closeWarning, setCloseWarning] = useState(false);

  const [selectedEndpointId, setSelectedEndpointId] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [deliveriesLoading, setDeliveriesLoading] = useState(false);

  const [testingId, setTestingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const loadEndpoints = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/webhook-endpoints');
      setEndpoints(Array.isArray(data) ? data : []);
    } catch {
      setToast({ message: 'Failed to load webhook endpoints', type: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (currentWorkspace?.id) loadEndpoints();
  }, [currentWorkspace?.id, loadEndpoints]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUrl.trim()) return;
    setSubmitting(true);
    try {
      const data = await api.post('/webhook-endpoints', {
        url: newUrl.trim(),
        eventTypes: newEventTypes.length > 0 ? newEventTypes : undefined,
      });
      setSecretModal({ secret: data.secret, url: data.url });
      setSecretCopied(false);
      setCloseWarning(false);
      setNewUrl('');
      setNewEventTypes([]);
      await loadEndpoints();
    } catch (err: any) {
      const msg = err?.message || 'Failed to create webhook endpoint';
      setToast({ message: msg, type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleTest = async (endpointId: string) => {
    setTestingId(endpointId);
    try {
      const result = await api.post(`/webhook-endpoints/${endpointId}/test`);
      const code = result?.statusCode ?? result?.status_code;
      if (result?.success) {
        setToast({ message: `Test delivered — HTTP ${code}`, type: 'success' });
      } else {
        setToast({ message: `Test failed — ${result?.error || `HTTP ${code}`}`, type: 'error' });
      }
    } catch {
      setToast({ message: 'Test delivery failed', type: 'error' });
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async (endpointId: string) => {
    setDeletingId(endpointId);
    try {
      await api.delete(`/webhook-endpoints/${endpointId}`);
      setEndpoints(prev => prev.filter(e => e.id !== endpointId));
      if (selectedEndpointId === endpointId) setSelectedEndpointId(null);
      setToast({ message: 'Endpoint deleted', type: 'success' });
    } catch {
      setToast({ message: 'Failed to delete endpoint', type: 'error' });
    } finally {
      setDeletingId(null);
      setDeleteConfirmId(null);
    }
  };

  const handleSelectEndpoint = async (endpointId: string) => {
    if (selectedEndpointId === endpointId) {
      setSelectedEndpointId(null);
      return;
    }
    setSelectedEndpointId(endpointId);
    setDeliveriesLoading(true);
    try {
      const data = await api.get(`/webhook-endpoints/${endpointId}/deliveries`);
      setDeliveries(Array.isArray(data) ? data : []);
    } catch {
      setDeliveries([]);
    } finally {
      setDeliveriesLoading(false);
    }
  };

  const handleCopySecret = async () => {
    if (!secretModal) return;
    await navigator.clipboard.writeText(secretModal.secret);
    setSecretCopied(true);
  };

  const handleCloseSecretModal = () => {
    if (!secretCopied) {
      setCloseWarning(true);
    } else {
      setSecretModal(null);
      setCloseWarning(false);
    }
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString();
  };

  const cell: React.CSSProperties = {
    padding: '10px 12px',
    fontSize: 13,
    color: colors.text,
    borderBottom: `1px solid ${colors.border}`,
    fontFamily: fonts.sans,
    verticalAlign: 'middle',
  };

  const th: React.CSSProperties = {
    ...cell,
    fontWeight: 600,
    color: colors.muted,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    background: colors.surface,
  };

  const btn = (variant: 'primary' | 'danger' | 'ghost'): React.CSSProperties => ({
    padding: '6px 14px',
    borderRadius: 6,
    border: 'none',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
    fontFamily: fonts.sans,
    background:
      variant === 'primary' ? colors.accent :
      variant === 'danger' ? '#dc2626' :
      'transparent',
    color:
      variant === 'ghost' ? colors.muted : '#fff',
    transition: 'opacity 0.15s',
  });

  return (
    <div style={{ maxWidth: 800 }}>
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: colors.text, fontFamily: fonts.sans }}>
          Outbound Webhooks
        </h2>
        <p style={{ margin: '6px 0 0', fontSize: 14, color: colors.muted, fontFamily: fonts.sans }}>
          Register HTTPS endpoints to receive real-time prospect score events. Payloads are HMAC-signed with a per-endpoint secret.
        </p>
      </div>

      {/* Endpoint List */}
      <section style={{ marginBottom: 36 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 600, color: colors.text, fontFamily: fonts.sans }}>
          Registered Endpoints
        </h3>

        {loading ? (
          <p style={{ color: colors.muted, fontSize: 13, fontFamily: fonts.sans }}>Loading…</p>
        ) : endpoints.length === 0 ? (
          <div style={{
            border: `1px dashed ${colors.border}`,
            borderRadius: 8,
            padding: '24px',
            textAlign: 'center',
            color: colors.muted,
            fontSize: 13,
            fontFamily: fonts.sans,
          }}>
            No endpoints configured. Add one below.
          </div>
        ) : (
          <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>URL</th>
                  <th style={{ ...th, width: 90 }}>Status</th>
                  <th style={{ ...th, width: 160 }}>Last Success</th>
                  <th style={{ ...th, width: 80 }}>Failures</th>
                  <th style={{ ...th, width: 140 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {endpoints.map(ep => (
                  <React.Fragment key={ep.id}>
                    <tr
                      style={{ cursor: 'pointer', background: selectedEndpointId === ep.id ? `${colors.accent}10` : 'transparent' }}
                      onClick={() => handleSelectEndpoint(ep.id)}
                    >
                      <td style={cell}>
                        <span style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>
                          {ep.url}
                        </span>
                        {ep.event_types && ep.event_types.length > 0 && (
                          <div style={{ marginTop: 4 }}>
                            {ep.event_types.map(et => (
                              <span key={et} style={{
                                display: 'inline-block', fontSize: 10, background: `${colors.accent}20`,
                                color: colors.accent, borderRadius: 4, padding: '1px 6px', marginRight: 4,
                              }}>
                                {et}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td style={cell} onClick={e => e.stopPropagation()}>
                        <span style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: 4,
                          fontSize: 12,
                          fontWeight: 600,
                          background: ep.enabled ? '#dcfce7' : '#fee2e2',
                          color: ep.enabled ? '#16a34a' : '#dc2626',
                        }}>
                          {ep.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </td>
                      <td style={{ ...cell, fontSize: 12, color: colors.muted }} onClick={e => e.stopPropagation()}>
                        {formatDate(ep.last_success_at)}
                      </td>
                      <td style={{ ...cell, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                        <span style={{ color: ep.consecutive_failures > 0 ? '#dc2626' : colors.muted, fontWeight: ep.consecutive_failures > 0 ? 700 : 400 }}>
                          {ep.consecutive_failures}
                        </span>
                      </td>
                      <td style={cell} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            style={{ ...btn('ghost'), border: `1px solid ${colors.border}`, padding: '4px 10px', fontSize: 12 }}
                            onClick={() => handleTest(ep.id)}
                            disabled={testingId === ep.id}
                            title="Send a test delivery"
                          >
                            {testingId === ep.id ? '…' : 'Test'}
                          </button>
                          {deleteConfirmId === ep.id ? (
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                              <button
                                style={{ ...btn('danger'), padding: '4px 10px', fontSize: 12 }}
                                onClick={() => handleDelete(ep.id)}
                                disabled={deletingId === ep.id}
                              >
                                {deletingId === ep.id ? '…' : 'Confirm'}
                              </button>
                              <button
                                style={{ ...btn('ghost'), border: `1px solid ${colors.border}`, padding: '4px 10px', fontSize: 12 }}
                                onClick={() => setDeleteConfirmId(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              style={{ ...btn('ghost'), border: `1px solid ${colors.border}`, padding: '4px 10px', fontSize: 12 }}
                              onClick={() => setDeleteConfirmId(ep.id)}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* Deliveries panel */}
                    {selectedEndpointId === ep.id && (
                      <tr>
                        <td colSpan={5} style={{ padding: 0, background: colors.surface }}>
                          <div style={{ padding: '12px 16px', borderTop: `1px solid ${colors.border}` }}>
                            <div style={{ fontWeight: 600, fontSize: 13, color: colors.text, marginBottom: 10, fontFamily: fonts.sans }}>
                              Recent Deliveries
                            </div>
                            {deliveriesLoading ? (
                              <p style={{ color: colors.muted, fontSize: 12, fontFamily: fonts.sans }}>Loading deliveries…</p>
                            ) : deliveries.length === 0 ? (
                              <p style={{ color: colors.muted, fontSize: 12, fontFamily: fonts.sans }}>No deliveries recorded yet.</p>
                            ) : (
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: fonts.sans }}>
                                <thead>
                                  <tr>
                                    {['Event', 'Result', 'Status', 'Attempt', 'Duration', 'Delivered At'].map(h => (
                                      <th key={h} style={{ ...th, fontSize: 10, padding: '6px 10px' }}>{h}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {deliveries.map(d => (
                                    <tr key={d.id}>
                                      <td style={{ ...cell, fontSize: 11, padding: '7px 10px', fontFamily: 'monospace' }}>{d.event_type}</td>
                                      <td style={{ ...cell, fontSize: 11, padding: '7px 10px' }}>
                                        <span style={{
                                          padding: '2px 7px', borderRadius: 4, fontWeight: 600,
                                          background: d.success ? '#dcfce7' : '#fee2e2',
                                          color: d.success ? '#16a34a' : '#dc2626',
                                        }}>
                                          {d.success ? 'OK' : 'Failed'}
                                        </span>
                                      </td>
                                      <td style={{ ...cell, fontSize: 11, padding: '7px 10px' }}>{d.status_code ?? '—'}</td>
                                      <td style={{ ...cell, fontSize: 11, padding: '7px 10px', textAlign: 'center' }}>{d.attempt}</td>
                                      <td style={{ ...cell, fontSize: 11, padding: '7px 10px' }}>{d.duration_ms != null ? `${d.duration_ms}ms` : '—'}</td>
                                      <td style={{ ...cell, fontSize: 11, padding: '7px 10px', color: colors.muted }}>{formatDate(d.delivered_at)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Add Endpoint Form */}
      <section style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: '20px 24px',
      }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600, color: colors.text, fontFamily: fonts.sans }}>
          Add Endpoint
        </h3>
        <form onSubmit={handleCreate}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: colors.text, fontFamily: fonts.sans, marginBottom: 6 }}>
              Endpoint URL
            </label>
            <input
              type="url"
              value={newUrl}
              onChange={e => setNewUrl(e.target.value)}
              placeholder="https://your-server.example.com/pandora-webhook"
              required
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 6,
                border: `1px solid ${colors.border}`,
                fontSize: 13,
                fontFamily: fonts.sans,
                background: colors.bg,
                color: colors.text,
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginBottom: 18 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: colors.text, fontFamily: fonts.sans, marginBottom: 6 }}>
              Event Types <span style={{ fontWeight: 400, color: colors.muted }}>(leave empty to receive all)</span>
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {EVENT_TYPE_OPTIONS.map(et => (
                <label key={et} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontFamily: fonts.sans, cursor: 'pointer', color: colors.text }}>
                  <input
                    type="checkbox"
                    checked={newEventTypes.includes(et)}
                    onChange={e => {
                      if (e.target.checked) setNewEventTypes(prev => [...prev, et]);
                      else setNewEventTypes(prev => prev.filter(x => x !== et));
                    }}
                  />
                  {et}
                </label>
              ))}
            </div>
          </div>

          <button
            type="submit"
            style={btn('primary')}
            disabled={submitting || !newUrl.trim()}
          >
            {submitting ? 'Creating…' : 'Create Endpoint'}
          </button>
        </form>
      </section>

      {/* Event Reference */}
      <div style={{ position: 'relative', margin: '48px 0 36px' }}>
        <hr style={{ border: 'none', borderTop: `1px solid ${colors.border}`, margin: 0 }} />
        <span style={{
          position: 'absolute',
          top: -10,
          left: '50%',
          transform: 'translateX(-50%)',
          background: colors.bg,
          padding: '0 14px',
          fontSize: 11,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: colors.muted,
          fontFamily: fonts.sans,
          fontWeight: 600,
          whiteSpace: 'nowrap',
        }}>
          Event Reference
        </span>
      </div>
      <WebhookEventReference />

      {/* Secret Reveal Modal */}
      {secretModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: colors.surface,
            borderRadius: 12,
            padding: '32px 36px',
            maxWidth: 520,
            width: '90%',
            boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
            fontFamily: fonts.sans,
          }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 700, color: colors.text }}>
              Endpoint Created
            </h3>
            <p style={{ margin: '0 0 4px', fontSize: 13, color: colors.muted }}>
              {secretModal.url}
            </p>

            <div style={{
              marginTop: 20,
              padding: '12px 16px',
              background: '#fef9c3',
              border: '1px solid #fbbf24',
              borderRadius: 8,
              marginBottom: 16,
            }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#92400e' }}>
                ⚠ This signing secret will not be shown again. Copy it now.
              </p>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: '#92400e' }}>
                Store it securely. Use it to verify the <code>X-Pandora-Signature</code> header on incoming requests.
              </p>
            </div>

            <div style={{
              background: colors.bg,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              padding: '10px 14px',
              fontFamily: 'monospace',
              fontSize: 13,
              wordBreak: 'break-all',
              color: colors.text,
              marginBottom: 16,
              userSelect: 'all',
            }}>
              {secretModal.secret}
            </div>

            {closeWarning && (
              <div style={{
                marginBottom: 14,
                padding: '10px 14px',
                background: '#fee2e2',
                border: '1px solid #fca5a5',
                borderRadius: 6,
                fontSize: 13,
                color: '#991b1b',
                fontWeight: 600,
              }}>
                Are you sure? The secret cannot be recovered after closing this dialog.
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                style={{
                  ...btn('ghost'),
                  border: `1px solid ${colors.border}`,
                  color: secretCopied ? '#16a34a' : colors.text,
                }}
                onClick={handleCopySecret}
              >
                {secretCopied ? 'Copied ✓' : 'Copy Secret'}
              </button>
              <button
                style={{
                  ...btn(secretCopied ? 'primary' : 'danger'),
                  opacity: secretCopied ? 1 : 0.85,
                }}
                onClick={handleCloseSecretModal}
              >
                {secretCopied ? 'Done' : (closeWarning ? 'Yes, close anyway' : 'Close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
