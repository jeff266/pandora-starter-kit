import React, { useState, useEffect } from 'react';
import { colors, fonts } from '../styles/theme';
import { api } from '../lib/api';

interface ExecutionDialogProps {
  workspaceId: string;
  actionId: string;
  actionTitle: string;
  actionType: string;
  open: boolean;
  onClose: () => void;
  onExecuted: () => void;
}

interface ExecutionPreview {
  action_id: string;
  action_title: string;
  action_type: string;
  connector_type: 'hubspot' | 'salesforce';
  target: {
    entity_type: string;
    entity_name: string;
    external_id: string;
    crm_url: string;
  };
  operations: Array<{
    type: 'update_field' | 'add_note';
    field_label: string;
    field_api_name: string;
    current_value: string | null;
    proposed_value: string;
    editable: boolean;
  }>;
  audit_note_preview: string;
  warnings: string[];
  can_execute: boolean;
  cannot_execute_reason: string | null;
}

export default function ExecutionDialog({
  workspaceId,
  actionId,
  actionTitle,
  actionType,
  open,
  onClose,
  onExecuted,
}: ExecutionDialogProps) {
  const [preview, setPreview] = useState<ExecutionPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [overrideValues, setOverrideValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open && actionId) {
      fetchPreview();
    }
  }, [open, actionId]);

  const fetchPreview = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.get(`/action-items/${actionId}/preview-execution`);
      setPreview(data);

      // Initialize override values
      if (data.operations) {
        const initial: Record<string, string> = {};
        for (const op of data.operations) {
          if (op.editable) {
            initial[op.field_api_name] = op.proposed_value;
          }
        }
        setOverrideValues(initial);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load preview');
    } finally {
      setLoading(false);
    }
  };

  const handleExecute = async () => {
    if (!preview) return;

    try {
      setExecuting(true);
      setExecutionError(null);

      await api.post(`/action-items/${actionId}/execute`, {
        actor: 'user',
        confirmed: true,
        override_values: Object.keys(overrideValues).length > 0 ? overrideValues : undefined,
      });

      // Success!
      onExecuted();
      onClose();
    } catch (err: any) {
      setExecutionError(err.message || 'Execution failed');
    } finally {
      setExecuting(false);
    }
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
        }}
      >
        {/* Dialog */}
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            background: colors.surface,
            borderRadius: 12,
            maxWidth: 640,
            width: '100%',
            maxHeight: '90vh',
            overflow: 'auto',
            boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '20px 24px',
              borderBottom: `1px solid ${colors.border}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.text, margin: 0 }}>
              Execute in CRM
            </h2>
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                fontSize: 20,
                color: colors.textMuted,
                cursor: 'pointer',
                padding: 4,
              }}
            >
              ×
            </button>
          </div>

          {/* Content */}
          <div style={{ padding: 24 }}>
            {/* Action Title */}
            <div style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, color: colors.text, marginBottom: 8 }}>
                {actionTitle}
              </h3>
              <p style={{ fontSize: 12, color: colors.textMuted }}>
                Type: {actionType}
              </p>
            </div>

            {/* Loading State */}
            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    border: `3px solid ${colors.border}`,
                    borderTopColor: colors.accent,
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                  }}
                />
              </div>
            )}

            {/* Error State */}
            {error && (
              <div
                style={{
                  background: 'rgba(239,68,68,0.1)',
                  border: `1px solid rgba(239,68,68,0.3)`,
                  borderRadius: 8,
                  padding: 16,
                  marginBottom: 20,
                }}
              >
                <p style={{ fontSize: 13, color: colors.red, margin: 0 }}>
                  {error}
                </p>
              </div>
            )}

            {/* Preview Content */}
            {!loading && !error && preview && (
              <>
                {/* CRM Deep Link */}
                {preview.target?.crm_url && (
                  <div style={{ marginBottom: 20 }}>
                    <a
                      href={preview.target.crm_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 13,
                        color: colors.accent,
                        textDecoration: 'none',
                      }}
                    >
                      🔗 View in {preview.connector_type === 'hubspot' ? 'HubSpot' : 'Salesforce'}
                      <span style={{ fontSize: 11 }}>↗</span>
                    </a>
                  </div>
                )}

                {/* Cannot Execute Warning */}
                {!preview.can_execute && preview.cannot_execute_reason && (
                  <div
                    style={{
                      background: 'rgba(239,68,68,0.1)',
                      border: `1px solid rgba(239,68,68,0.3)`,
                      borderRadius: 8,
                      padding: 16,
                      marginBottom: 20,
                    }}
                  >
                    <p style={{ fontSize: 13, color: colors.red, fontWeight: 500, margin: 0 }}>
                      ⚠️ {preview.cannot_execute_reason}
                    </p>
                  </div>
                )}

                {/* Changes Table */}
                {preview.operations && preview.operations.length > 0 && (
                  <div style={{ marginBottom: 20 }}>
                    <h4 style={{ fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 12 }}>
                      Changes
                    </h4>
                    <div
                      style={{
                        border: `1px solid ${colors.border}`,
                        borderRadius: 8,
                        overflow: 'hidden',
                      }}
                    >
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ background: colors.surfaceHover }}>
                            <th style={{ padding: '10px 12px', fontSize: 12, fontWeight: 600, color: colors.textSecondary, textAlign: 'left', borderBottom: `1px solid ${colors.border}` }}>
                              Field
                            </th>
                            <th style={{ padding: '10px 12px', fontSize: 12, fontWeight: 600, color: colors.textSecondary, textAlign: 'left', borderBottom: `1px solid ${colors.border}` }}>
                              Current
                            </th>
                            <th style={{ padding: '10px 12px', fontSize: 12, fontWeight: 600, color: colors.textSecondary, textAlign: 'left', borderBottom: `1px solid ${colors.border}` }}>
                              New Value
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.operations.map((op, idx) => (
                            <tr key={idx} style={{ borderBottom: idx < preview.operations.length - 1 ? `1px solid ${colors.border}` : 'none' }}>
                              <td style={{ padding: '10px 12px', fontSize: 13, color: colors.text, fontWeight: 500 }}>
                                {op.field_label}
                              </td>
                              <td style={{ padding: '10px 12px', fontSize: 12, color: colors.textMuted, fontFamily: fonts.mono }}>
                                {op.current_value || '(empty)'}
                              </td>
                              <td style={{ padding: '10px 12px' }}>
                                {op.editable ? (
                                  <input
                                    type="text"
                                    value={overrideValues[op.field_api_name] ?? op.proposed_value}
                                    onChange={(e) =>
                                      setOverrideValues((prev) => ({
                                        ...prev,
                                        [op.field_api_name]: e.target.value,
                                      }))
                                    }
                                    style={{
                                      width: '100%',
                                      padding: '6px 10px',
                                      fontSize: 12,
                                      fontFamily: fonts.mono,
                                      border: `1px solid ${colors.border}`,
                                      borderRadius: 4,
                                      background: colors.surface,
                                      color: colors.text,
                                    }}
                                  />
                                ) : (
                                  <span style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.text }}>
                                    {op.proposed_value}
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Audit Note Preview */}
                {preview.audit_note_preview && (
                  <div style={{ marginBottom: 20 }}>
                    <h4 style={{ fontSize: 13, fontWeight: 600, color: colors.text, marginBottom: 8 }}>
                      Audit Note
                    </h4>
                    <div
                      style={{
                        background: colors.surfaceHover,
                        border: `1px solid ${colors.border}`,
                        borderRadius: 8,
                        padding: 12,
                        fontSize: 12,
                        fontFamily: fonts.mono,
                        color: colors.textMuted,
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {preview.audit_note_preview}
                    </div>
                  </div>
                )}

                {/* Warnings */}
                {preview.warnings && preview.warnings.length > 0 && (
                  <div style={{ marginBottom: 20 }}>
                    {preview.warnings.map((warning, idx) => (
                      <div
                        key={idx}
                        style={{
                          background: 'rgba(245,158,11,0.1)',
                          border: `1px solid rgba(245,158,11,0.3)`,
                          borderRadius: 8,
                          padding: 12,
                          marginBottom: 8,
                        }}
                      >
                        <p style={{ fontSize: 12, color: colors.orange, margin: 0 }}>
                          ⚠️ {warning}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Execution Error */}
                {executionError && (
                  <div
                    style={{
                      background: 'rgba(239,68,68,0.1)',
                      border: `1px solid rgba(239,68,68,0.3)`,
                      borderRadius: 8,
                      padding: 16,
                      marginBottom: 20,
                    }}
                  >
                    <p style={{ fontSize: 13, color: colors.red, fontWeight: 500, marginBottom: 4 }}>
                      Execution failed
                    </p>
                    <p style={{ fontSize: 12, color: colors.red, margin: 0 }}>
                      {executionError}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          {!loading && !error && preview && (
            <div
              style={{
                padding: '16px 24px',
                borderTop: `1px solid ${colors.border}`,
                display: 'flex',
                gap: 12,
                justifyContent: 'flex-end',
              }}
            >
              <button
                onClick={onClose}
                disabled={executing}
                style={{
                  padding: '10px 20px',
                  fontSize: 13,
                  fontWeight: 500,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 8,
                  background: colors.surface,
                  color: colors.text,
                  cursor: executing ? 'not-allowed' : 'pointer',
                  opacity: executing ? 0.5 : 1,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleExecute}
                disabled={!preview.can_execute || executing}
                style={{
                  padding: '10px 20px',
                  fontSize: 13,
                  fontWeight: 600,
                  border: 'none',
                  borderRadius: 8,
                  background: preview.can_execute && !executing ? colors.green : colors.surfaceHover,
                  color: preview.can_execute && !executing ? '#fff' : colors.textMuted,
                  cursor: preview.can_execute && !executing ? 'pointer' : 'not-allowed',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                {executing ? (
                  <>
                    <div
                      style={{
                        width: 14,
                        height: 14,
                        border: '2px solid rgba(255,255,255,0.3)',
                        borderTopColor: '#fff',
                        borderRadius: '50%',
                        animation: 'spin 0.8s linear infinite',
                      }}
                    />
                    Executing...
                  </>
                ) : (
                  <>✓ Confirm & Execute</>
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Keyframes for spin animation */}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
}
