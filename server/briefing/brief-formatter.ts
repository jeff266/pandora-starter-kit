import { AssembledBrief, DealToWatch, RepPerformance } from './brief-types.js';

export interface SlackBlock {
  type: string;
  text?: {
    type: string;
    text: string;
    emoji?: boolean;
  };
  fields?: Array<{
    type: string;
    text: string;
  }>;
  elements?: any[];
  accessory?: any;
}

export function formatCurrency(n: number): string {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function formatDelta(delta?: number): string {
  if (delta === undefined || delta === 0) return '';
  const sign = delta > 0 ? '+' : '';
  return ` (${sign}${formatCurrency(delta)})`;
}

export function formatBriefForSlack(brief: AssembledBrief, format: 'full' | 'summary' = 'full'): SlackBlock[] {
  const blocks: SlackBlock[] = [];

  // Header
  const dateStr = new Date(brief.generated_date).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric'
  });

  let title = '';
  switch (brief.brief_type) {
    case 'monday_setup': title = `📅 *Monday Brief: ${dateStr}*`; break;
    case 'pulse': title = `⚡ *Pulse Update: ${dateStr}*`; break;
    case 'friday_recap': title = `📋 *Friday Recap: ${dateStr}*`; break;
    case 'quarter_close': title = `🏁 *Quarter Close Countdown: ${brief.days_remaining} Days Left*`; break;
  }

  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: title.replace(/\*/g, ''),
      emoji: true
    }
  });

  // AI Summary
  const summary = brief.ai_blurbs.overall_summary || 
                  brief.ai_blurbs.pulse_summary || 
                  brief.ai_blurbs.week_summary || 
                  brief.ai_blurbs.quarter_situation;
  
  if (summary) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `> ${summary}`
      }
    });
  }

  // Key Metrics (The Number)
  const num = brief.the_number;
  const metrics = [
    `*Pipeline:* ${formatCurrency(num.pipeline_total)}${formatDelta(num.delta_since_monday)}`,
    `*Attainment:* ${num.attainment_pct}%${formatDelta(num.attainment_delta)}`,
    `*Gap:* ${formatCurrency(num.gap)}`,
    `*Coverage:* ${num.coverage_on_gap.toFixed(1)}x`
  ];

  blocks.push({
    type: 'section',
    fields: metrics.map(m => ({ type: 'mrkdwn', text: m }))
  });

  if (format === 'summary') {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: 'Check the app for full details.' }]
    });
    return blocks;
  }

  // What Changed
  if (!brief.what_changed.nothing_moved) {
    const wc = brief.what_changed;
    let wcText = `*What Changed ${brief.brief_type === 'pulse' ? 'Since Monday' : 'This Week'}:*\n`;
    wcText += `• Created: ${wc.created.count} deals (${formatCurrency(wc.created.amount)})\n`;
    wcText += `• Won: ${wc.won.count} deals (${formatCurrency(wc.won.amount)})\n`;
    wcText += `• Lost: ${wc.lost.count} deals (${formatCurrency(wc.lost.amount)})\n`;
    wcText += `• Pushed: ${wc.pushed.count} deals (${formatCurrency(wc.pushed.amount)})`;
    
    if (wc.streak) wcText += `\n_${wc.streak}_`;

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: wcText }
    });
  }

  // Reps
  if (!brief.reps.omitted && brief.reps.items.length > 0) {
    let repText = `*Rep Performance:*\n`;
    brief.reps.items.slice(0, 5).forEach((r: RepPerformance) => {
      repText += `• *${r.name}:* ${r.attainment}% of quota | ${formatCurrency(r.closed)} closed\n`;
    });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: repText }
    });
  }

  // Deals to Watch
  if (!brief.deals_to_watch.omitted && brief.deals_to_watch.items.length > 0) {
    let dealText = `*Deals to Watch:*\n`;
    brief.deals_to_watch.items.slice(0, 5).forEach((d: DealToWatch) => {
      const icon = d.severity === 'critical' ? '🔴' : d.severity === 'warning' ? '🟡' : '⚪';
      dealText += `${icon} *${d.name}:* ${formatCurrency(d.amount)} | ${d.owner} | ${d.stage}\n`;
    });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: dealText }
    });
  }

  return blocks;
}

export function formatBriefForEmail(brief: AssembledBrief): string {
  const dateStr = new Date(brief.generated_date).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric'
  });

  const num = brief.the_number;
  const wc = brief.what_changed;
  const summary = brief.ai_blurbs.overall_summary || 
                  brief.ai_blurbs.pulse_summary || 
                  brief.ai_blurbs.week_summary || 
                  brief.ai_blurbs.quarter_situation;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1f2937;">
      <h1 style="font-size: 24px; font-weight: bold; margin-bottom: 8px;">${brief.brief_type.replace('_', ' ').toUpperCase()}</h1>
      <p style="color: #6b7280; margin-bottom: 24px;">${dateStr}</p>
      
      <div style="background-color: #f3f4f6; padding: 16px; border-radius: 8px; margin-bottom: 24px; font-style: italic;">
        "${summary || 'No summary available.'}"
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px;">
        <div style="padding: 12px; border: 1px solid #e5e7eb; border-radius: 8px;">
          <div style="font-size: 12px; color: #6b7280; text-transform: uppercase;">Pipeline</div>
          <div style="font-size: 18px; font-weight: bold;">${formatCurrency(num.pipeline_total)}${formatDelta(num.delta_since_monday)}</div>
        </div>
        <div style="padding: 12px; border: 1px solid #e5e7eb; border-radius: 8px;">
          <div style="font-size: 12px; color: #6b7280; text-transform: uppercase;">Attainment</div>
          <div style="font-size: 18px; font-weight: bold;">${num.attainment_pct}%${formatDelta(num.attainment_delta)}</div>
        </div>
        <div style="padding: 12px; border: 1px solid #e5e7eb; border-radius: 8px;">
          <div style="font-size: 12px; color: #6b7280; text-transform: uppercase;">Gap to Quota</div>
          <div style="font-size: 18px; font-weight: bold;">${formatCurrency(num.gap)}</div>
        </div>
        <div style="padding: 12px; border: 1px solid #e5e7eb; border-radius: 8px;">
          <div style="font-size: 12px; color: #6b7280; text-transform: uppercase;">Coverage</div>
          <div style="font-size: 18px; font-weight: bold;">${num.coverage_on_gap.toFixed(1)}x</div>
        </div>
      </div>

      ${!wc.nothing_moved ? `
        <h2 style="font-size: 18px; margin-bottom: 12px;">What Changed</h2>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
          <tr style="border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 8px 0;">Created</td>
            <td style="padding: 8px 0; text-align: right; font-weight: bold;">${wc.created.count} (${formatCurrency(wc.created.amount)})</td>
          </tr>
          <tr style="border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 8px 0;">Won</td>
            <td style="padding: 8px 0; text-align: right; font-weight: bold; color: #10b981;">${wc.won.count} (${formatCurrency(wc.won.amount)})</td>
          </tr>
          <tr style="border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 8px 0;">Lost</td>
            <td style="padding: 8px 0; text-align: right; font-weight: bold; color: #ef4444;">${wc.lost.count} (${formatCurrency(wc.lost.amount)})</td>
          </tr>
          <tr>
            <td style="padding: 8px 0;">Pushed</td>
            <td style="padding: 8px 0; text-align: right; font-weight: bold; color: #f59e0b;">${wc.pushed.count} (${formatCurrency(wc.pushed.amount)})</td>
          </tr>
        </table>
      ` : ''}

      ${!brief.reps.omitted ? `
        <h2 style="font-size: 18px; margin-bottom: 12px;">Rep Performance</h2>
        <ul style="padding-left: 20px; margin-bottom: 24px;">
          ${brief.reps.items.slice(0, 5).map((r: RepPerformance) => `
            <li style="margin-bottom: 8px;"><strong>${r.name}:</strong> ${r.attainment}% of quota | ${formatCurrency(r.closed)} closed</li>
          `).join('')}
        </ul>
      ` : ''}

      ${!brief.deals_to_watch.omitted ? `
        <h2 style="font-size: 18px; margin-bottom: 12px;">Deals to Watch</h2>
        <div style="margin-bottom: 24px;">
          ${brief.deals_to_watch.items.slice(0, 5).map((d: DealToWatch) => `
            <div style="padding: 12px; border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 8px; border-left: 4px solid ${d.severity === 'critical' ? '#ef4444' : d.severity === 'warning' ? '#f59e0b' : '#3b82f6'};">
              <div style="font-weight: bold;">${d.name}</div>
              <div style="font-size: 14px; color: #6b7280;">${formatCurrency(d.amount)} • ${d.owner} • ${d.stage}</div>
              <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">${d.signal}</div>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <div style="text-align: center; color: #6b7280; font-size: 12px; margin-top: 48px; border-top: 1px solid #e5e7eb; padding-top: 24px;">
        Sent by Pandora • <a href="#" style="color: #3b82f6;">View in Browser</a>
      </div>
    </div>
  `;

  return html;
}

