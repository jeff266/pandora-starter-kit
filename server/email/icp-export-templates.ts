/**
 * Email templates for ICP Profile export
 * Provides both HTML (pretty) and text (business-minded) versions
 */

interface IndustryEntry {
  name: string;
  win_rate?: number;
}

interface PainCluster {
  label: string;
  total?: number;
  won?: number;
  lift?: number;
}

interface BuyingCombo {
  personaNames?: string[];
  roles?: string[];
  winRate?: number;
  win_rate?: number;
  lift?: number;
  wonCount?: number;
  totalCount?: number;
}

interface IcpProfile {
  version: number;
  created_at: string;
  won_deals?: number;
  deals_analyzed?: number;
  company_profile?: {
    industries?: Array<IndustryEntry | string>;
    industryWinRates?: Array<{ industry: string; winRate: number; count: number; avgDeal: number }>;
    sizeWinRates?: Array<{ bucket: string; winRate: number; count: number; avgDeal: number }>;
    disqualifiers?: string[];
  };
  conversation_insights?: {
    pain_point_clusters?: PainCluster[];
  };
  buying_committees?: BuyingCombo[];
  scoring_weights?: Record<string, unknown>;
}

// ─── HTML Template (Pretty) ──────────────────────────────────────────────────

export function generateHtmlTemplate(profile: IcpProfile): string {
  const versionDate = new Date(profile.created_at).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const wonDeals = profile.won_deals ?? 0;
  const tier = wonDeals >= 200 ? 3 : wonDeals >= 100 ? 2 : 1;

  const iwRates = profile.company_profile?.industryWinRates ?? [];
  const oldIndustries = profile.company_profile?.industries ?? [];
  const industryEntries: IndustryEntry[] =
    iwRates.length > 0
      ? iwRates.map(iw => ({ name: iw.industry, win_rate: iw.winRate }))
      : oldIndustries.map(ind => (typeof ind === 'string' ? { name: ind } : (ind as IndustryEntry)));

  const rates = industryEntries.map(e => e.win_rate ?? 0).filter(r => r > 0);
  const baseline = rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;

  const sizeRates = profile.company_profile?.sizeWinRates ?? [];
  const clusters = profile.conversation_insights?.pain_point_clusters ?? [];
  const committees = profile.buying_committees ?? [];
  const topCombos = [...committees]
    .sort((a, b) => (b.winRate ?? b.win_rate ?? 0) - (a.winRate ?? a.win_rate ?? 0))
    .slice(0, 5);
  const disqualifiers = profile.company_profile?.disqualifiers ?? [];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ICP Profile Export</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0A0E14;
      color: #CBD5E1;
      padding: 40px 20px;
      line-height: 1.6;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
      background: #0F1319;
      border: 1px solid #1E293B;
      border-radius: 12px;
      padding: 40px;
    }
    .header {
      text-align: center;
      border-bottom: 2px solid #1E293B;
      padding-bottom: 24px;
      margin-bottom: 32px;
    }
    .header h1 {
      font-size: 32px;
      font-weight: 700;
      color: #F1F5F9;
      margin-bottom: 8px;
    }
    .header .meta {
      font-size: 14px;
      color: #64748B;
    }
    .section {
      margin-bottom: 40px;
    }
    .section-title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #64748B;
      margin-bottom: 16px;
    }
    .card {
      background: #0A0E14;
      border: 1px solid #1E293B;
      border-radius: 10px;
      padding: 20px;
      margin-bottom: 12px;
    }
    .industry-grid {
      display: grid;
      grid-template-columns: 1fr 100px 80px;
      gap: 16px;
      align-items: center;
      padding: 12px 0;
      border-bottom: 1px solid #1E293B;
    }
    .industry-grid:last-child { border-bottom: none; }
    .industry-name { color: #F1F5F9; font-weight: 500; }
    .metric {
      font-family: 'Courier New', monospace;
      color: #94A3B8;
      text-align: right;
    }
    .lift-high { color: #22C55E; font-weight: 600; }
    .badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 600;
      padding: 4px 12px;
      border-radius: 12px;
      margin-right: 8px;
      margin-bottom: 8px;
    }
    .badge-size {
      background: #0F1319;
      border: 1px solid #1E293B;
      color: #CBD5E1;
    }
    .trigger-item {
      background: #0A0E14;
      border: 1px solid #1E293B;
      border-radius: 8px;
      padding: 14px 18px;
      margin-bottom: 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .trigger-text {
      font-style: italic;
      color: #F1F5F9;
    }
    .committee-item {
      background: #0A0E14;
      border: 1px solid #1E293B;
      border-radius: 8px;
      padding: 14px 18px;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .committee-rank {
      font-size: 12px;
      font-weight: 700;
      color: #64748B;
    }
    .committee-personas {
      flex: 1;
      color: #F1F5F9;
    }
    .disqualifier {
      background: rgba(239,68,68,0.08);
      border: 1px solid rgba(239,68,68,0.2);
      border-radius: 8px;
      padding: 10px 14px;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .disqualifier-icon { color: #EF4444; }
    .footer {
      text-align: center;
      font-size: 12px;
      color: #64748B;
      padding-top: 32px;
      border-top: 1px solid #1E293B;
      margin-top: 40px;
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div class="header">
      <h1>ICP Profile Export</h1>
      <div class="meta">Version ${profile.version} • ${versionDate} • Tier ${tier} of 3</div>
    </div>

    <!-- Ideal Company -->
    <div class="section">
      <div class="section-title">Ideal Company</div>
      ${
        industryEntries.length > 0
          ? industryEntries
              .map(ind => {
                const wr = ind.win_rate ?? 0;
                const lift = baseline > 0 ? wr / baseline : 0;
                return `
        <div class="industry-grid">
          <div class="industry-name">${ind.name}</div>
          <div class="metric">${wr > 0 ? `${Math.round(wr * 100)}% win` : '—'}</div>
          <div class="metric ${lift >= 1.5 ? 'lift-high' : ''}">${lift > 0 ? `${lift.toFixed(1)}× lift` : '—'}</div>
        </div>`;
              })
              .join('')
          : '<div class="card">No industry data available.</div>'
      }
    </div>

    ${
      sizeRates.filter(s => s.count > 0).length > 0
        ? `
    <!-- Company Size -->
    <div class="section">
      <div class="section-title">Company Size</div>
      <div>
        ${sizeRates
          .filter(s => s.count > 0)
          .map(
            sz => `
        <span class="badge badge-size">${sz.bucket} employees • ${Math.round(sz.winRate * 100)}% win • ${sz.count} deals</span>
        `
          )
          .join('')}
      </div>
    </div>`
        : ''
    }

    ${
      clusters.length > 0
        ? `
    <!-- Buying Triggers -->
    <div class="section">
      <div class="section-title">Buying Triggers</div>
      ${clusters
        .map(
          c => `
      <div class="trigger-item">
        <div class="trigger-text">"${c.label}"</div>
        <div>
          ${c.total != null && c.won != null ? `<span class="metric">${c.won}/${c.total} calls</span> ` : ''}
          ${c.lift != null ? `<span class="metric lift-high">${c.lift.toFixed(1)}× lift</span>` : ''}
        </div>
      </div>`
        )
        .join('')}
    </div>`
        : ''
    }

    ${
      topCombos.length > 0
        ? `
    <!-- Buying Committee -->
    <div class="section">
      <div class="section-title">Buying Committee</div>
      ${topCombos
        .map(
          (combo, i) => {
            const names = combo.personaNames ?? combo.roles ?? [];
            const wr = combo.winRate ?? combo.win_rate;
            const lift = combo.lift;
            return `
      <div class="committee-item">
        <span class="committee-rank">#${i + 1}</span>
        <span class="committee-personas">${names.join(' + ')}</span>
        ${wr != null ? `<span class="metric lift-high">${Math.round(wr * 100)}% win</span>` : ''}
        ${lift != null && lift > 1 ? `<span class="metric">${lift.toFixed(1)}× lift</span>` : ''}
        ${combo.wonCount != null && combo.totalCount != null ? `<span class="metric">${combo.wonCount}/${combo.totalCount}</span>` : ''}
      </div>`;
          }
        )
        .join('')}
    </div>`
        : ''
    }

    ${
      disqualifiers.length > 0
        ? `
    <!-- Do Not Pursue -->
    <div class="section">
      <div class="section-title">Do Not Pursue</div>
      ${disqualifiers
        .map(
          d => `
      <div class="disqualifier">
        <span class="disqualifier-icon">✕</span>
        <span>${d}</span>
      </div>`
        )
        .join('')}
    </div>`
        : ''
    }

    <!-- Footer -->
    <div class="footer">
      Generated by Pandora ICP Discovery on ${versionDate}<br>
      This export contains proprietary RevOps intelligence. Handle with care.
    </div>
  </div>
</body>
</html>`;
}

// ─── Text Template (Business-minded) ─────────────────────────────────────────

export function generateTextTemplate(profile: IcpProfile): string {
  const versionDate = new Date(profile.created_at).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const wonDeals = profile.won_deals ?? 0;
  const tier = wonDeals >= 200 ? 3 : wonDeals >= 100 ? 2 : 1;

  const iwRates = profile.company_profile?.industryWinRates ?? [];
  const oldIndustries = profile.company_profile?.industries ?? [];
  const industryEntries: IndustryEntry[] =
    iwRates.length > 0
      ? iwRates.map(iw => ({ name: iw.industry, win_rate: iw.winRate }))
      : oldIndustries.map(ind => (typeof ind === 'string' ? { name: ind } : (ind as IndustryEntry)));

  const rates = industryEntries.map(e => e.win_rate ?? 0).filter(r => r > 0);
  const baseline = rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;

  const sizeRates = profile.company_profile?.sizeWinRates ?? [];
  const clusters = profile.conversation_insights?.pain_point_clusters ?? [];
  const committees = profile.buying_committees ?? [];
  const topCombos = [...committees]
    .sort((a, b) => (b.winRate ?? b.win_rate ?? 0) - (a.winRate ?? a.win_rate ?? 0))
    .slice(0, 5);
  const disqualifiers = profile.company_profile?.disqualifiers ?? [];

  let text = `═══════════════════════════════════════════════════════════════════════════════
                         ICP PROFILE EXPORT
                    Version ${profile.version} • ${versionDate}
                          Data Tier: ${tier} of 3
═══════════════════════════════════════════════════════════════════════════════

EXECUTIVE SUMMARY
─────────────────────────────────────────────────────────────────────────────

This ICP profile represents data-driven intelligence extracted from ${wonDeals} won deals${
    profile.deals_analyzed ? ` (${profile.deals_analyzed} total analyzed)` : ''
  }.

The following insights should guide territory planning, lead scoring, account prioritization, and outbound targeting.


IDEAL COMPANY PROFILE
─────────────────────────────────────────────────────────────────────────────

Industry Win Rates:
${
  industryEntries.length > 0
    ? industryEntries
        .map(ind => {
          const wr = ind.win_rate ?? 0;
          const lift = baseline > 0 ? wr / baseline : 0;
          return `  • ${ind.name.padEnd(30)} ${wr > 0 ? `${Math.round(wr * 100)}% win`.padEnd(12) : '—'.padEnd(12)} ${
            lift > 0 ? `${lift.toFixed(1)}× lift` : ''
          }${lift >= 1.5 ? ' ★' : ''}`;
        })
        .join('\n')
    : '  No industry data available.'
}

${
  sizeRates.filter(s => s.count > 0).length > 0
    ? `Company Size Patterns:
${sizeRates
  .filter(s => s.count > 0)
  .map(sz => `  • ${sz.bucket} employees: ${Math.round(sz.winRate * 100)}% win rate (${sz.count} deals)`)
  .join('\n')}
`
    : ''
}

${
  clusters.length > 0
    ? `BUYING TRIGGERS
─────────────────────────────────────────────────────────────────────────────

Pain points and themes that correlate with closed-won deals:

${clusters
  .map(c => {
    let line = `  • "${c.label}"`;
    if (c.total != null && c.won != null) line += ` — ${c.won}/${c.total} calls`;
    if (c.lift != null) line += ` (${c.lift.toFixed(1)}× lift)`;
    return line;
  })
  .join('\n')}
`
    : ''
}

${
  topCombos.length > 0
    ? `WINNING BUYING COMMITTEES
─────────────────────────────────────────────────────────────────────────────

Multi-persona patterns with highest win rates:

${topCombos
  .map((combo, i) => {
    const names = combo.personaNames ?? combo.roles ?? [];
    const wr = combo.winRate ?? combo.win_rate;
    const lift = combo.lift;
    let line = `  ${i + 1}. ${names.join(' + ')}`;
    if (wr != null) line += ` — ${Math.round(wr * 100)}% win`;
    if (lift != null && lift > 1) line += ` (${lift.toFixed(1)}× lift)`;
    if (combo.wonCount != null && combo.totalCount != null) line += ` [${combo.wonCount}/${combo.totalCount}]`;
    return line;
  })
  .join('\n')}
`
    : ''
}

${
  disqualifiers.length > 0
    ? `DISQUALIFICATION CRITERIA
─────────────────────────────────────────────────────────────────────────────

Avoid pursuing deals with these characteristics:

${disqualifiers.map(d => `  ✕ ${d}`).join('\n')}
`
    : ''
}

RECOMMENDED ACTIONS
─────────────────────────────────────────────────────────────────────────────

Based on this profile:

  1. Update lead scoring weights to prioritize high-lift industries
  2. Train reps on winning buying committee patterns
  3. Incorporate buying triggers into discovery call frameworks
  4. Apply disqualification criteria in MQL → SQL handoff
  5. Re-segment territory assignments based on industry fit

═══════════════════════════════════════════════════════════════════════════════

Generated by Pandora ICP Discovery on ${versionDate}
This export contains proprietary RevOps intelligence. Distribute internally only.

═══════════════════════════════════════════════════════════════════════════════`;

  return text;
}
