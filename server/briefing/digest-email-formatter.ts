/**
 * Email Formatter for Investigation Weekly Digest
 *
 * Generates HTML email with inline CSS following Resend best practices
 */

import { DigestData, InvestigationSummary } from './investigation-digest.js';

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function getTrendEmoji(trend: 'improving' | 'worsening' | 'stable'): string {
  switch (trend) {
    case 'improving':
      return '📉';
    case 'worsening':
      return '📈';
    default:
      return '➡️';
  }
}

function getTrendColor(trend: 'improving' | 'worsening' | 'stable'): { bg: string; border: string; text: string } {
  switch (trend) {
    case 'improving':
      return { bg: '#D1FAE5', border: '#16A34A', text: '#15803D' };
    case 'worsening':
      return { bg: '#FEE2E2', border: '#EF4444', text: '#991B1B' };
    default:
      return { bg: '#F8FAFC', border: '#CBD5E1', text: '#1E293B' };
  }
}

function buildInvestigationCards(investigations: InvestigationSummary[]): string {
  return investigations
    .map((inv) => {
      if (inv.runsCount === 0) {
        return `
          <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 20px; margin-bottom: 16px;">
            <h3 style="margin: 0 0 8px; font-size: 16px; font-weight: 600; color: #475569;">
              ${inv.skillName}
            </h3>
            <p style="margin: 0; font-size: 14px; color: #64748B;">
              No investigations ran in the past 7 days
            </p>
          </div>
        `;
      }

      const trendColors = getTrendColor(inv.trend);
      const deltaPrefix = inv.deltaAtRisk > 0 ? '+' : '';

      return `
        <div style="background: ${trendColors.bg}; border-left: 4px solid ${trendColors.border}; border-radius: 8px; padding: 20px; margin-bottom: 16px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <h3 style="margin: 0; font-size: 16px; font-weight: 600; color: #1E293B;">
              ${inv.skillName}
            </h3>
            <span style="font-size: 20px;">${getTrendEmoji(inv.trend)}</span>
          </div>

          <div style="display: flex; gap: 24px; margin-bottom: 12px;">
            <div>
              <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748B; margin-bottom: 4px;">
                At-Risk Deals
              </div>
              <div style="font-size: 24px; font-weight: 700; color: ${trendColors.text};">
                ${inv.currentAtRisk}
              </div>
              ${
                inv.deltaAtRisk !== 0
                  ? `<div style="font-size: 13px; color: #64748B;">${deltaPrefix}${inv.deltaAtRisk} this week</div>`
                  : ''
              }
            </div>

            <div>
              <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748B; margin-bottom: 4px;">
                Trend
              </div>
              <div style="font-size: 16px; font-weight: 600; color: ${trendColors.text}; text-transform: capitalize;">
                ${inv.trend}
              </div>
              <div style="font-size: 13px; color: #64748B;">
                ${inv.runsCount} run${inv.runsCount !== 1 ? 's' : ''} this week
              </div>
            </div>
          </div>

          ${
            inv.criticalFindings.length > 0
              ? `
            <div style="margin-top: 16px; padding-top: 12px; border-top: 1px solid rgba(0,0,0,0.1);">
              <div style="font-size: 12px; font-weight: 600; color: #64748B; margin-bottom: 8px;">
                TOP CRITICAL FINDINGS
              </div>
              ${inv.criticalFindings
                .map(
                  (f) => `
                <div style="font-size: 13px; color: #1E293B; margin-bottom: 4px;">
                  • <strong>${f.dealName}</strong> (${formatCurrency(f.amount)}) — ${f.message}
                </div>
              `
                )
                .join('')}
            </div>
          `
              : ''
          }
        </div>
      `;
    })
    .join('');
}

export function formatDigestEmail(digest: DigestData): string {
  const primaryColor = '#2563EB';
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const historyUrl = `${appUrl}/investigation/history`;

  const startDate = new Date(digest.periodStart).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  const endDate = new Date(digest.periodEnd).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const periodLabel = `${startDate} — ${endDate}`;

  // Calculate summary stats
  const totalRuns = digest.investigations.reduce((sum, inv) => sum + inv.runsCount, 0);
  const totalAtRisk = digest.investigations.reduce((sum, inv) => sum + inv.currentAtRisk, 0);
  const worseningCount = digest.investigations.filter((inv) => inv.trend === 'worsening').length;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Weekly Investigation Digest — ${digest.workspaceName}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #F1F5F9;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #F1F5F9; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, ${primaryColor} 0%, ${primaryColor}DD 100%); padding: 32px 40px; text-align: center;">
              <h1 style="margin: 0; color: #FFFFFF; font-size: 28px; font-weight: 700; line-height: 1.2;">
                📊 Weekly Investigation Digest
              </h1>
              <p style="margin: 12px 0 0; color: #FFFFFF; opacity: 0.9; font-size: 14px;">
                ${digest.workspaceName}
              </p>
              <p style="margin: 4px 0 0; color: #FFFFFF; opacity: 0.8; font-size: 13px;">
                ${periodLabel}
              </p>
            </td>
          </tr>

          <!-- Summary Stats -->
          <tr>
            <td style="padding: 32px 40px 0;">
              <h2 style="margin: 0 0 16px; font-size: 18px; font-weight: 600; color: #1E293B;">
                Weekly Summary
              </h2>
              <div style="display: flex; gap: 12px; margin-bottom: 24px;">
                <div style="flex: 1; background: #F8FAFC; border-radius: 8px; padding: 16px; text-align: center;">
                  <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748B; margin-bottom: 4px;">
                    Total Investigations
                  </div>
                  <div style="font-size: 24px; font-weight: 700; color: #1E293B;">
                    ${totalRuns}
                  </div>
                </div>
                <div style="flex: 1; background: #F8FAFC; border-radius: 8px; padding: 16px; text-align: center;">
                  <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748B; margin-bottom: 4px;">
                    At-Risk Deals
                  </div>
                  <div style="font-size: 24px; font-weight: 700; color: #1E293B;">
                    ${totalAtRisk}
                  </div>
                </div>
                <div style="flex: 1; background: #F8FAFC; border-radius: 8px; padding: 16px; text-align: center;">
                  <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748B; margin-bottom: 4px;">
                    Worsening Trends
                  </div>
                  <div style="font-size: 24px; font-weight: 700; color: ${worseningCount > 0 ? '#991B1B' : '#15803D'};">
                    ${worseningCount}
                  </div>
                </div>
              </div>
            </td>
          </tr>

          <!-- Investigation Cards -->
          <tr>
            <td style="padding: 0 40px 32px;">
              <h2 style="margin: 0 0 16px; font-size: 18px; font-weight: 600; color: #1E293B;">
                Investigations
              </h2>
              ${buildInvestigationCards(digest.investigations)}
            </td>
          </tr>

          <!-- Top Critical Findings -->
          ${
            digest.topCriticalFindings.length > 0
              ? `
          <tr>
            <td style="padding: 0 40px 32px;">
              <h2 style="margin: 0 0 16px; font-size: 18px; font-weight: 600; color: #1E293B;">
                Top Critical Findings
              </h2>
              <div style="background: #FEE2E2; border-left: 4px solid #EF4444; border-radius: 8px; padding: 20px;">
                ${digest.topCriticalFindings
                  .map(
                    (f, i) => `
                  <div style="margin-bottom: ${i < digest.topCriticalFindings.length - 1 ? '12px' : '0'}; padding-bottom: ${
                      i < digest.topCriticalFindings.length - 1 ? '12px' : '0'
                    }; border-bottom: ${i < digest.topCriticalFindings.length - 1 ? '1px solid rgba(0,0,0,0.1)' : 'none'};">
                    <div style="font-size: 14px; font-weight: 600; color: #991B1B; margin-bottom: 4px;">
                      ${f.dealName} — ${formatCurrency(f.amount)}
                    </div>
                    <div style="font-size: 13px; color: #1E293B;">
                      ${f.message}
                    </div>
                  </div>
                `
                  )
                  .join('')}
              </div>
            </td>
          </tr>
          `
              : ''
          }

          <!-- CTA Button -->
          <tr>
            <td style="padding: 32px 40px; text-align: center; background-color: #F8FAFC;">
              <a href="${historyUrl}" style="display: inline-block; background-color: ${primaryColor}; color: #FFFFFF; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 15px;">
                View Full Investigation History →
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; text-align: center; border-top: 1px solid #E2E8F0;">
              <p style="margin: 0; font-size: 12px; color: #94A3B8;">
                Generated by <strong>Pandora</strong> • <a href="${appUrl}" style="color: ${primaryColor}; text-decoration: none;">Visit Dashboard</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}
