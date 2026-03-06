import React, { useState, useEffect, useCallback } from 'react';
import { colors, fonts } from '../../styles/theme';
import { api } from '../../lib/api';
import { useWorkspace } from '../../context/WorkspaceContext';

interface BillingRow {
  workspace_id: string;
  workspace_name: string;
  workspace_slug: string;
  billing_period: string;
  pandora_input_tokens: number;
  pandora_output_tokens: number;
  pandora_cost_usd: number;
  byok_input_tokens: number;
  byok_output_tokens: number;
  byok_cost_usd: number;
  total_calls: number;
  markup_multiplier: number;
  customer_charge_usd: number;
  invoice_status: string;
  invoice_reference: string | null;
  invoiced_at: string | null;
  notes: string | null;
}

interface BillingSummary {
  period: string;
  total_workspaces: number;
  total_pandora_cost: number;
  total_customer_charge: number;
  total_byok_tokens: number;
  total_calls: number;
  pending_count: number;
  invoiced_count: number;
  paid_count: number;
}

interface BillingResponse {
  summary: BillingSummary;
  rows: BillingRow[];
}

const STATUS_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  pending:  { bg: colors.surfaceRaised, color: colors.textMuted,    label: 'Pending' },
  invoiced: { bg: colors.accentSoft,    color: colors.accent,       label: 'Invoiced' },
  paid:     { bg: colors.greenSoft,     color: colors.green,        label: 'Paid' },
  waived:   { bg: colors.yellowSoft,    color: colors.yellow,       label: 'Waived' },
};

function fmtUSD(n: number): string {
  return `$${n.toFixed(4)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function periodOptions(): string[] {
  const opts: string[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    opts.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return opts;
}

interface InvoiceModal {
  workspaceId: string;
  workspaceName: string;
}

export default function BillingMeterPage() {
  const { currentWorkspace } = useWorkspace();
  const [period, setPeriod] = useState(currentPeriod());
  const [data, setData] = useState<BillingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [invoiceModal, setInvoiceModal] = useState<InvoiceModal | null>(null);
  const [invoiceRef, setInvoiceRef] = useState('');
  const [invoiceNotes, setInvoiceNotes] = useState('');
  const [markupEdit, setMarkupEdit] = useState<{ workspaceId: string; value: string } | null>(null);

  const load = useCallback(async (p: string) => {
    try {
      setLoading(true);
      setError(null);
      const res: BillingResponse = await api.get(`/admin/billing?period=${p}`);
      setData(res);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load billing data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(period); }, [period, load]);

  const flash = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  const doAction = async (workspaceId: string, action: 'paid' | 'waive', workspaceName: string) => {
    setActionLoading(`${workspaceId}-${action}`);
    try {
      await api.post(`/admin/billing/${workspaceId}/${action}?period=${period}`, {});
      flash(`${workspaceName} marked as ${action === 'paid' ? 'paid' : 'waived'}`);
      await load(period);
    } catch (e: any) {
      setError(e?.message ?? `Failed to ${action}`);
    } finally {
      setActionLoading(null);
    }
  };

  const submitInvoice = async () => {
    if (!invoiceModal) return;
    setActionLoading(`${invoiceModal.workspaceId}-invoice`);
    try {
      await api.post(`/admin/billing/${invoiceModal.workspaceId}/invoice?period=${period}`, {
        invoice_reference: invoiceRef || undefined,
        notes: invoiceNotes || undefined,
      });
      flash(`${invoiceModal.workspaceName} marked as invoiced`);
      setInvoiceModal(null);
      setInvoiceRef('');
      setInvoiceNotes('');
      await load(period);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to mark invoiced');
    } finally {
      setActionLoading(null);
    }
  };

  const doRollup = async () => {
    setActionLoading('rollup');
    try {
      const res = await api.post(`/admin/billing/rollup?period=${period}`, {});
      flash(`Rollup complete: ${(res as any).succeeded} workspaces`);
      await load(period);
    } catch (e: any) {
      setError(e?.message ?? 'Rollup failed');
    } finally {
      setActionLoading(null);
    }
  };

  const doUpdateMarkup = async (workspaceId: string) => {
    if (!markupEdit) return;
    const val = parseFloat(markupEdit.value);
    if (isNaN(val) || val < 1) { setError('Markup must be ≥ 1.0'); return; }
    setActionLoading(`${workspaceId}-markup`);
    try {
      await api.post(`/admin/billing/${workspaceId}/markup?period=${period}`, { markup_multiplier: val });
      flash('Markup updated');
      setMarkupEdit(null);
      await load(period);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to update markup');
    } finally {
      setActionLoading(null);
    }
  };

  const doExport = () => {
    const wsId = currentWorkspace?.id;
    if (!wsId) return;
    window.open(`/api/workspaces/${wsId}/admin/billing/export?period=${period}`, '_blank');
  };

  const { summary, rows } = data ?? { summary: null, rows: [] };

  return (
    <div style={{ fontFamily: fonts.sans, color: colors.text, padding: '28px 32px', maxWidth: 1200 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, marginBottom: 4 }}>Billing Meter</h1>
          <p style={{ fontSize: 13, color: colors.textMuted, margin: 0 }}>
            Monthly usage aggregates per workspace, for arrears invoicing.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={period}
            onChange={e => setPeriod(e.target.value)}
            style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 5, color: colors.text, fontSize: 13, padding: '6px 10px', fontFamily: fonts.sans, cursor: 'pointer' }}
          >
            {periodOptions().map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <button
            onClick={doRollup}
            disabled={actionLoading === 'rollup'}
            style={{ padding: '7px 14px', background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 5, color: colors.textSecondary, fontSize: 12, cursor: actionLoading === 'rollup' ? 'default' : 'pointer', fontFamily: fonts.sans }}
          >
            {actionLoading === 'rollup' ? 'Rolling up…' : 'Refresh Rollup'}
          </button>
          <button
            onClick={doExport}
            style={{ padding: '7px 14px', background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 5, color: colors.textSecondary, fontSize: 12, cursor: 'pointer', fontFamily: fonts.sans }}
          >
            Export CSV
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: colors.redSoft, border: `1px solid ${colors.red}`, borderRadius: 6, padding: '10px 14px', fontSize: 13, color: colors.red, marginBottom: 20 }}>
          {error}
          <span style={{ float: 'right', cursor: 'pointer', opacity: 0.7 }} onClick={() => setError(null)}>×</span>
        </div>
      )}
      {successMsg && (
        <div style={{ background: colors.greenSoft, border: `1px solid ${colors.green}`, borderRadius: 6, padding: '10px 14px', fontSize: 13, color: colors.green, marginBottom: 20 }}>
          {successMsg}
        </div>
      )}

      {/* Summary bar */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 28 }}>
          {[
            { label: 'Customer Charges', value: fmtUSD(summary.total_customer_charge), accent: true },
            { label: 'Raw Cost (Pandora)', value: fmtUSD(summary.total_pandora_cost) },
            { label: 'Workspaces', value: String(summary.total_workspaces) },
            { label: 'Total Calls', value: fmtTokens(summary.total_calls) },
            { label: 'BYOK Tokens', value: fmtTokens(summary.total_byok_tokens) },
            { label: 'Pending', value: String(summary.pending_count) },
            { label: 'Invoiced', value: String(summary.invoiced_count) },
            { label: 'Paid', value: String(summary.paid_count) },
          ].map(item => (
            <div key={item.label} style={{ background: colors.surface, border: `1px solid ${item.accent ? colors.accent : colors.border}`, borderRadius: 7, padding: '12px 14px' }}>
              <div style={{ fontSize: 10, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{item.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: item.accent ? colors.accent : colors.text, fontFamily: fonts.mono }}>{item.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div style={{ color: colors.textMuted, fontSize: 13, textAlign: 'center', paddingTop: 40 }}>Loading billing data…</div>
      ) : rows.length === 0 ? (
        <div style={{ color: colors.textMuted, fontSize: 13, textAlign: 'center', paddingTop: 40 }}>
          No billing data for {period}. Click "Refresh Rollup" to aggregate usage.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 900 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${colors.border}` }}>
                {['Workspace', 'Pandora Tokens', 'Raw Cost', 'Markup', 'Customer Charge', 'BYOK Tokens', 'Calls', 'Status', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: colors.textMuted, fontWeight: 500, fontSize: 11, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const statusCfg = STATUS_COLORS[row.invoice_status] ?? STATUS_COLORS.pending;
                const pandoraTotal = row.pandora_input_tokens + row.pandora_output_tokens;
                const byokTotal = row.byok_input_tokens + row.byok_output_tokens;
                const isEditing = markupEdit?.workspaceId === row.workspace_id;

                return (
                  <tr
                    key={row.workspace_id}
                    style={{ borderBottom: `1px solid ${colors.border}` }}
                    onMouseEnter={e => (e.currentTarget.style.background = colors.surfaceHover)}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    {/* Workspace */}
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ fontWeight: 600, color: colors.text }}>{row.workspace_name}</div>
                      <div style={{ fontSize: 10, color: colors.textMuted, fontFamily: fonts.mono }}>{row.workspace_slug}</div>
                    </td>

                    {/* Pandora Tokens */}
                    <td style={{ padding: '10px 12px', fontFamily: fonts.mono, color: colors.text }}>
                      {fmtTokens(pandoraTotal)}
                      <div style={{ fontSize: 9, color: colors.textMuted }}>
                        {fmtTokens(row.pandora_input_tokens)}↑ {fmtTokens(row.pandora_output_tokens)}↓
                      </div>
                    </td>

                    {/* Raw Cost */}
                    <td style={{ padding: '10px 12px', fontFamily: fonts.mono, color: colors.text }}>
                      {fmtUSD(row.pandora_cost_usd)}
                    </td>

                    {/* Markup */}
                    <td style={{ padding: '10px 12px' }}>
                      {isEditing ? (
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <input
                            type="number"
                            step="0.1"
                            min="1"
                            value={markupEdit.value}
                            onChange={e => setMarkupEdit({ workspaceId: row.workspace_id, value: e.target.value })}
                            style={{ width: 52, padding: '3px 6px', background: colors.bg, border: `1px solid ${colors.accent}`, borderRadius: 4, color: colors.text, fontSize: 12, fontFamily: fonts.mono }}
                          />
                          <button
                            onClick={() => doUpdateMarkup(row.workspace_id)}
                            disabled={actionLoading === `${row.workspace_id}-markup`}
                            style={{ padding: '3px 8px', background: colors.accent, border: 'none', borderRadius: 4, color: '#fff', fontSize: 11, cursor: 'pointer', fontFamily: fonts.sans }}
                          >✓</button>
                          <button
                            onClick={() => setMarkupEdit(null)}
                            style={{ padding: '3px 6px', background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 4, color: colors.textMuted, fontSize: 11, cursor: 'pointer', fontFamily: fonts.sans }}
                          >✕</button>
                        </div>
                      ) : (
                        <span
                          onClick={() => setMarkupEdit({ workspaceId: row.workspace_id, value: String(row.markup_multiplier) })}
                          title="Click to edit markup"
                          style={{ fontFamily: fonts.mono, color: colors.textSecondary, cursor: 'pointer', borderBottom: `1px dashed ${colors.border}` }}
                        >
                          {row.markup_multiplier.toFixed(2)}×
                        </span>
                      )}
                    </td>

                    {/* Customer Charge */}
                    <td style={{ padding: '10px 12px', fontFamily: fonts.mono, fontWeight: 600, color: colors.accent }}>
                      {fmtUSD(row.customer_charge_usd)}
                    </td>

                    {/* BYOK Tokens */}
                    <td style={{ padding: '10px 12px', fontFamily: fonts.mono, color: colors.textMuted }}>
                      {byokTotal > 0 ? fmtTokens(byokTotal) : '—'}
                    </td>

                    {/* Calls */}
                    <td style={{ padding: '10px 12px', fontFamily: fonts.mono, color: colors.textSecondary }}>
                      {row.total_calls.toLocaleString()}
                    </td>

                    {/* Status */}
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ fontSize: 10, background: statusCfg.bg, color: statusCfg.color, padding: '3px 8px', borderRadius: 4, fontWeight: 600, letterSpacing: '0.07em', whiteSpace: 'nowrap' }}>
                        {statusCfg.label}
                      </span>
                      {row.invoice_reference && (
                        <div style={{ fontSize: 9, color: colors.textMuted, marginTop: 2, fontFamily: fonts.mono }}>{row.invoice_reference}</div>
                      )}
                    </td>

                    {/* Actions */}
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {(row.invoice_status === 'pending') && (
                          <button
                            onClick={() => setInvoiceModal({ workspaceId: row.workspace_id, workspaceName: row.workspace_name })}
                            style={{ padding: '4px 8px', background: colors.accentSoft, border: `1px solid ${colors.accent}`, borderRadius: 4, color: colors.accent, fontSize: 10, cursor: 'pointer', fontFamily: fonts.sans, whiteSpace: 'nowrap' }}
                          >
                            Invoice
                          </button>
                        )}
                        {(row.invoice_status === 'invoiced') && (
                          <button
                            onClick={() => doAction(row.workspace_id, 'paid', row.workspace_name)}
                            disabled={actionLoading === `${row.workspace_id}-paid`}
                            style={{ padding: '4px 8px', background: colors.greenSoft, border: `1px solid ${colors.green}`, borderRadius: 4, color: colors.green, fontSize: 10, cursor: 'pointer', fontFamily: fonts.sans, whiteSpace: 'nowrap' }}
                          >
                            Mark Paid
                          </button>
                        )}
                        {(row.invoice_status === 'pending' || row.invoice_status === 'invoiced') && (
                          <button
                            onClick={() => doAction(row.workspace_id, 'waive', row.workspace_name)}
                            disabled={actionLoading === `${row.workspace_id}-waive`}
                            style={{ padding: '4px 8px', background: colors.surfaceRaised, border: `1px solid ${colors.border}`, borderRadius: 4, color: colors.textMuted, fontSize: 10, cursor: 'pointer', fontFamily: fonts.sans }}
                          >
                            Waive
                          </button>
                        )}
                        {(row.invoice_status === 'paid' || row.invoice_status === 'waived') && (
                          <span style={{ fontSize: 10, color: colors.textMuted }}>—</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Invoice Modal */}
      {invoiceModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 10, padding: 28, width: 420, maxWidth: '90vw' }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0, marginBottom: 4 }}>Mark as Invoiced</h3>
            <p style={{ fontSize: 12, color: colors.textMuted, marginBottom: 20 }}>
              {invoiceModal.workspaceName} — {period}
            </p>

            <label style={{ fontSize: 12, color: colors.textSecondary, display: 'block', marginBottom: 4 }}>Invoice Reference</label>
            <input
              type="text"
              value={invoiceRef}
              onChange={e => setInvoiceRef(e.target.value)}
              placeholder="e.g. INV-2026-042"
              style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 5, color: colors.text, fontSize: 13, fontFamily: fonts.mono, marginBottom: 14 }}
            />

            <label style={{ fontSize: 12, color: colors.textSecondary, display: 'block', marginBottom: 4 }}>Notes (optional)</label>
            <textarea
              value={invoiceNotes}
              onChange={e => setInvoiceNotes(e.target.value)}
              placeholder="Any notes for this invoice…"
              rows={3}
              style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 5, color: colors.text, fontSize: 13, fontFamily: fonts.sans, resize: 'vertical', marginBottom: 20 }}
            />

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setInvoiceModal(null); setInvoiceRef(''); setInvoiceNotes(''); }}
                style={{ padding: '8px 16px', background: colors.surfaceRaised, border: `1px solid ${colors.border}`, borderRadius: 5, color: colors.textSecondary, fontSize: 13, cursor: 'pointer', fontFamily: fonts.sans }}
              >
                Cancel
              </button>
              <button
                onClick={submitInvoice}
                disabled={actionLoading === `${invoiceModal.workspaceId}-invoice`}
                style={{ padding: '8px 16px', background: colors.accent, border: 'none', borderRadius: 5, color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: fonts.sans }}
              >
                {actionLoading === `${invoiceModal.workspaceId}-invoice` ? 'Saving…' : 'Mark Invoiced'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
