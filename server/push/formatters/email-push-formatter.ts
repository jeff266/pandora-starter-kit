/**
 * Push API — Email Formatter (HTML digest)
 * Uses Resend for delivery. Simple inline-style HTML — no external CSS.
 */

import type { AssembledFinding } from '../finding-assembler.js';

function severityLabel(severity: string): string {
  switch (severity) {
    case 'act': return '🔴 Critical';
    case 'watch': return '🟡 Warning';
    case 'notable': return '🔵 Notable';
    case 'info': return '⬜ Info';
    default: return severity;
  }
}

function formatCurrency(amount: number | null): string {
  if (!amount) return '';
  return `$${Math.round(amount).toLocaleString()}`;
}

export function formatEmailHtml(
  findings: AssembledFinding[],
  workspaceName: string,
  ruleName: string
): string {
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const criticals = findings.filter(f => f.severity === 'act');
  const warnings  = findings.filter(f => f.severity === 'watch' || f.severity === 'notable');
  const infos     = findings.filter(f => f.severity === 'info');

  function renderGroup(label: string, items: AssembledFinding[]): string {
    if (items.length === 0) return '';
    return `
      <h3 style="color:#1f2937;border-bottom:1px solid #e5e7eb;padding-bottom:8px;margin-top:24px">${label} (${items.length})</h3>
      ${items.map(f => `
        <div style="background:#f9fafb;border-left:3px solid #6366f1;padding:12px 16px;margin-bottom:8px;border-radius:0 4px 4px 0">
          <div style="font-weight:600;color:#1f2937;margin-bottom:4px">${f.category.replace(/_/g, ' ')} — ${f.deal_name || ''}${f.deal_amount ? ` — ${formatCurrency(f.deal_amount)}` : ''}</div>
          <div style="color:#374151">${f.message}</div>
          ${f.deal_owner ? `<div style="color:#6b7280;font-size:13px;margin-top:4px">Owner: ${f.deal_owner}${f.ai_score !== null ? ` · Score: ${f.ai_score}/100` : ''}</div>` : ''}
        </div>
      `).join('')}
    `;
  }

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Pandora Brief</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f3f4f6;margin:0;padding:32px">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">

    <!-- Header -->
    <div style="background:#4f46e5;padding:24px 32px">
      <div style="color:#fff;font-size:20px;font-weight:700">Pandora</div>
      <div style="color:#c7d2fe;font-size:14px;margin-top:4px">${workspaceName}</div>
    </div>

    <!-- Title -->
    <div style="padding:24px 32px 0">
      <h2 style="color:#1f2937;margin:0">${ruleName}</h2>
      <p style="color:#6b7280;margin:4px 0 0">${date}</p>
    </div>

    <!-- Findings summary -->
    <div style="padding:16px 32px;background:#f9fafb;margin:16px 32px;border-radius:6px">
      <span style="color:#374151"><strong>${findings.length}</strong> findings — </span>
      ${criticals.length > 0 ? `<span style="color:#dc2626">${criticals.length} critical</span> · ` : ''}
      ${warnings.length > 0 ? `<span style="color:#d97706">${warnings.length} warnings</span> · ` : ''}
      ${infos.length > 0 ? `<span style="color:#6b7280">${infos.length} info</span>` : ''}
    </div>

    <!-- Findings by group -->
    <div style="padding:0 32px 24px">
      ${renderGroup('🔴 Critical', criticals)}
      ${renderGroup('🟡 Warnings', warnings)}
      ${renderGroup('⬜ Info', infos)}
    </div>

    <!-- Footer -->
    <div style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb">
      <p style="color:#9ca3af;font-size:12px;margin:0">Powered by Pandora · ${new Date().toISOString()}</p>
    </div>

  </div>
</body>
</html>`;
}

export function formatEmailSubject(workspaceName: string, ruleName: string, findings: AssembledFinding[]): string {
  const criticals = findings.filter(f => f.severity === 'act').length;
  const prefix = criticals > 0 ? `🔴 ${criticals} Critical — ` : '';
  return `${prefix}Pandora: ${ruleName} — ${workspaceName}`;
}
