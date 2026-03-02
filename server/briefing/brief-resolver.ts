import { query } from '../db.js';
import type { AssembledBrief, RepPerformance, DealToWatch } from './brief-types.js';
import { formatCompact } from './brief-utils.js';

export interface BriefResolverResult {
  section: string;
  display_hint: 'value' | 'table' | 'card' | 'section';
  answer: string;
  tokens_used: 0;
}

// ─── Main resolver ────────────────────────────────────────────────────────────

export async function resolveFromBrief(workspaceId: string, message: string): Promise<BriefResolverResult | null> {
  const lower = message.toLowerCase().trim();

  // Hard pass: causal, predictive, or open-ended questions always need investigation
  if (/\bwhy\b|\bbecause\b|\bgoing to\b|\bwill we\b|\bshould we\b|\bwhat if\b|\bcompare\b|\bvs\b|\bversus\b|\bwhere will\b|\bwill (she|he|they)\b|\bend (the|this) quarter\b|\bon track (to|for)\b|\bby (end of|quarter end)\b|\bproject(ed)?\b|\bclosed.?won\b|\bhow (many|much) did\b|\bdid.*close\b|\bwin rate\b|\brev(enue)? from\b|\brep.*history\b/.test(lower)) return null;
  if (lower.split(' ').length > 20) return null;

  const brief = await getLatestReadyBrief(workspaceId);
  if (!brief) return null;

  const reps: RepPerformance[] = brief.reps?.items || [];
  const deals: DealToWatch[] = brief.deals_to_watch?.items || [];
  const segments = brief.segments?.items || [];
  const dimension = brief.segments?.dimension || '';

  // ── 0. Gap-to-target / "what do I need to close" ───────────────────────────
  if (/(reach|hit|make).*(target|quota)|(need|must).*(close|hit)|(close|deals?).*(reach|hit|make|gap)|what.*need.*(close|hit)|close the gap|deals? (needed|to close)/.test(lower)) {
    return { section: 'the_number', display_hint: 'section', answer: formatGapToTarget(brief, deals), tokens_used: 0 };
  }

  // ── 1. Specific rep name match ──────────────────────────────────────────────
  const repMatch = reps.find(r => {
    const firstName = r.name.split(' ')[0].toLowerCase();
    return firstName.length > 2 && lower.includes(firstName);
  });
  if (repMatch) {
    return { section: 'reps', display_hint: 'card', answer: formatRepCard(repMatch), tokens_used: 0 };
  }

  // ── 2. Specific deal name match ─────────────────────────────────────────────
  const dealMatch = deals.find(d => {
    const words = d.name.split(' ').filter(w => w.length > 3);
    return words.some(w => lower.includes(w.toLowerCase()));
  });
  if (dealMatch) {
    return { section: 'deals_to_watch', display_hint: 'card', answer: formatDealCard(dealMatch), tokens_used: 0 };
  }

  // ── 3. Segment-specific pipeline question ───────────────────────────────────
  const segMatch = segments.find(s => lower.includes(s.label.toLowerCase()));
  if (segMatch && /pipeline|deals?|how much/.test(lower)) {
    return {
      section: 'segments',
      display_hint: 'value',
      answer: `**${segMatch.label}**: ${formatCompact(segMatch.pipeline)} across ${segMatch.count} deal${segMatch.count !== 1 ? 's' : ''} (avg ${formatCompact(segMatch.avg_deal)})`,
      tokens_used: 0,
    };
  }

  // ── 4. General pipeline question ────────────────────────────────────────────
  if (/how much pipeline|what.s (our |the )?pipeline|total pipeline|pipeline total/.test(lower)) {
    const n = brief.the_number;
    let answer = `**Pipeline: ${formatCompact(n.pipeline_total)}** across ${n.deal_count} deal${n.deal_count !== 1 ? 's' : ''}`;
    if (n.attainment_pct != null) answer += `\nAttainment: ${n.attainment_pct.toFixed(0)}%`;
    if (segments.length > 0) {
      answer += `\n\n**By ${dimension}:**\n${segments.slice(0, 5).map(s => `- ${s.label}: ${formatCompact(s.pipeline)} (${s.count} deals)`).join('\n')}`;
    }
    return { section: 'the_number', display_hint: 'section', answer, tokens_used: 0 };
  }

  // ── 5. Breakdown question ───────────────────────────────────────────────────
  if (/break.?down|by segment|by (record type|deal type|pipeline)|segment breakdown/.test(lower)) {
    if (brief.segments?.omitted) {
      return { section: 'segments', display_hint: 'value', answer: brief.segments.reason || 'No material segment change since Monday.', tokens_used: 0 };
    }
    if (segments.length > 0) {
      return { section: 'segments', display_hint: 'table', answer: formatSegmentsTable(segments, dimension), tokens_used: 0 };
    }
  }

  // ── 6. Reps / rep performance ───────────────────────────────────────────────
  if (/who.s behind|rep performance|how are (my )?reps|underperform|rep attainment|rep scorecard/.test(lower)) {
    if (brief.reps?.omitted || reps.length === 0) {
      return { section: 'reps', display_hint: 'value', answer: brief.reps?.reason || 'No rep changes since Monday.', tokens_used: 0 };
    }
    return { section: 'reps', display_hint: 'table', answer: formatRepsTable(reps), tokens_used: 0 };
  }

  // ── 7. What changed ─────────────────────────────────────────────────────────
  if (/what changed|what happened|since monday|week over week|wow|delta|what moved/.test(lower)) {
    return { section: 'what_changed', display_hint: 'section', answer: formatWhatChanged(brief), tokens_used: 0 };
  }

  // ── 8. The number / forecast / attainment ───────────────────────────────────
  if (/forecast|the number|attainment|quota|are we on track|coverage|gap to quota|are we going/.test(lower)) {
    return { section: 'the_number', display_hint: 'section', answer: formatTheNumber(brief), tokens_used: 0 };
  }

  // ── 9. At risk / deals to watch ────────────────────────────────────────────
  if (/at.?risk|deal risk|deals? to watch|risky deal|what deals/.test(lower)) {
    const riskDeals = deals.filter(d => d.severity === 'critical' || d.severity === 'warning');
    if (riskDeals.length === 0) return { section: 'deals_to_watch', display_hint: 'value', answer: 'No at-risk deals flagged in current brief.', tokens_used: 0 };
    return { section: 'deals_to_watch', display_hint: 'table', answer: formatDealsTable(riskDeals), tokens_used: 0 };
  }

  // ── 9b. Top / open / all deals ───────────────────────────────────────────
  if (/top.*deal|open deal|deal.*quarter|deal.*remain|biggest deal|largest deal|list.*deal|all deal|show.*deal|deal.*left/.test(lower)) {
    if (deals.length === 0) return { section: 'deals_to_watch', display_hint: 'value', answer: 'No open deals in current brief.', tokens_used: 0 };
    const sorted = [...deals].sort((a, b) => b.amount - a.amount);
    return { section: 'deals_to_watch', display_hint: 'table', answer: formatTopDeals(sorted), tokens_used: 0 };
  }

  // ── 10. This week / week recap ─────────────────────────────────────────────
  if (/this week|week recap|how did we do|weekly summary|week in review/.test(lower)) {
    const num = formatTheNumber(brief);
    const changed = formatWhatChanged(brief);
    return { section: 'what_changed', display_hint: 'section', answer: `${num}\n\n${changed}`, tokens_used: 0 };
  }

  return null;
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatGapToTarget(brief: AssembledBrief, deals: DealToWatch[]): string {
  const n = brief.the_number;
  const gap = n.gap ?? 0;
  const att = n.attainment_pct != null ? `${n.attainment_pct.toFixed(0)}%` : '—';
  const days = n.days_remaining != null ? `${n.days_remaining} days left` : null;
  const coverage = n.coverage_on_gap;

  const lines: string[] = ['**Gap to Target**'];
  const daysStr = days ? `, ${days}` : '';
  if (gap <= 0) {
    lines.push(`You've hit quota! Attainment: ${att}${daysStr}.`);
    return lines.join('\n');
  }

  lines.push(`You need **${formatCompact(gap)}** more to hit quota — currently at ${att} attainment${daysStr}.`);
  if (coverage != null) {
    const coverageStr = coverage.toFixed(1);
    const covered = coverage >= 1 ? `Pipeline covers the gap (${coverageStr}× coverage).` : `Pipeline does NOT fully cover the gap (${coverageStr}× coverage) — you need more deals in-quarter.`;
    lines.push(covered);
  }

  const closeable = [...deals].sort((a, b) => b.amount - a.amount).slice(0, 5);
  if (closeable.length > 0) {
    const total = closeable.reduce((s, d) => s + (d.amount || 0), 0);
    lines.push('');
    lines.push('**Top deals that can close the gap:**');
    lines.push('| Deal | Amount | Stage | Owner | Close Date |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const d of closeable) {
      lines.push(`| ${d.name} | ${formatCompact(d.amount)} | ${d.stage} | ${d.owner} | ${d.close_date || '—'} |`);
    }
    const suffix = total >= gap
      ? `These ${closeable.length} deals total **${formatCompact(total)}** — enough to close the gap if they all land.`
      : `These ${closeable.length} deals total **${formatCompact(total)}** — not enough to close the gap alone. You need additional pipeline or faster conversions.`;
    lines.push('');
    lines.push(suffix);
  }
  return lines.join('\n');
}

function formatRepCard(rep: RepPerformance): string {
  const lines: string[] = [`**${rep.name}**`];
  if (rep.pipeline != null) lines.push(`Pipeline: ${formatCompact(rep.pipeline)}`);
  if ((rep as any).attainment_pct != null) lines.push(`Attainment: ${(rep as any).attainment_pct}%`);
  if ((rep as any).quota) lines.push(`Quota: ${formatCompact((rep as any).quota)}`);
  if ((rep as any).gap) lines.push(`Gap: ${formatCompact((rep as any).gap)}`);
  if ((rep as any).flag) lines.push(`\n_${(rep as any).flag}_`);
  return lines.join('\n');
}

function formatDealCard(deal: DealToWatch): string {
  const sev = deal.severity === 'critical' ? '🔴' : deal.severity === 'warning' ? '🟡' : '🟢';
  const lines = [`${sev} **${deal.name}**`, `${formatCompact(deal.amount)} · ${deal.stage} · ${deal.owner}`];
  if (deal.close_date) lines.push(`Close: ${deal.close_date}`);
  if (deal.signal_text) lines.push(`_${deal.signal_text}_`);
  return lines.join('\n');
}

function formatSegmentsTable(segments: any[], dimension: string): string {
  let out = `**Pipeline by ${dimension}**\n\n`;
  out += `| ${dimension} | Pipeline | Deals | Avg Deal |\n`;
  out += `| --- | --- | --- | --- |\n`;
  for (const s of segments) {
    out += `| ${s.label} | ${formatCompact(s.pipeline)} | ${s.count} | ${formatCompact(s.avg_deal)} |\n`;
  }
  return out;
}

function formatRepsTable(reps: RepPerformance[]): string {
  let out = `**Rep Performance**\n\n`;
  out += `| Rep | Pipeline | Attainment | Flag |\n`;
  out += `| --- | --- | --- | --- |\n`;
  for (const r of reps.slice(0, 8)) {
    const att = (r as any).attainment_pct != null ? `${(r as any).attainment_pct}%` : '—';
    const flag = (r as any).flag ? '⚠️' : '✓';
    out += `| ${r.name} | ${formatCompact(r.pipeline)} | ${att} | ${flag} |\n`;
  }
  return out;
}

function formatTopDeals(deals: DealToWatch[]): string {
  const top = deals.slice(0, 6);
  const totalPipeline = deals.reduce((sum, d) => sum + (d.amount || 0), 0);
  let out = `**Top Open Deals**\n\n`;
  out += `| Deal | Amount | Stage | Owner | Close Date | Signal |\n`;
  out += `| --- | --- | --- | --- | --- | --- |\n`;
  for (const d of top) {
    const closeDate = d.close_date ? d.close_date : '—';
    out += `| ${d.name} | ${formatCompact(d.amount)} | ${d.stage} | ${d.owner} | ${closeDate} | ${d.signal_text || '—'} |\n`;
  }
  out += `\n_${deals.length} open deals · ${formatCompact(totalPipeline)} total pipeline_`;
  return out;
}

function formatDealsTable(deals: DealToWatch[]): string {
  let out = `**Deals to Watch**\n\n`;
  out += `| Deal | Amount | Stage | Owner | Signal |\n`;
  out += `| --- | --- | --- | --- | --- |\n`;
  for (const d of deals.slice(0, 6)) {
    const sev = d.severity === 'critical' ? '🔴' : '🟡';
    out += `| ${sev} ${d.name} | ${formatCompact(d.amount)} | ${d.stage} | ${d.owner} | ${d.signal_text || '—'} |\n`;
  }
  return out;
}

function formatTheNumber(brief: AssembledBrief): string {
  const n = brief.the_number;
  const lines: string[] = ['**The Number**'];
  if (n.attainment_pct != null) {
    const dir = n.direction === 'up' ? '↑' : n.direction === 'down' ? '↓' : '→';
    lines.push(`Attainment: **${n.attainment_pct.toFixed(0)}%** ${dir}${n.wow_pts != null ? ` (${n.wow_pts > 0 ? '+' : ''}${n.wow_pts}pts WoW)` : ''}`);
  }
  lines.push(`Pipeline: ${formatCompact(n.pipeline_total)} (${n.deal_count} deals)`);
  if (n.gap > 0) lines.push(`Gap to quota: ${formatCompact(n.gap)}`);
  if (n.coverage_on_gap) lines.push(`Coverage on gap: ${n.coverage_on_gap.toFixed(1)}×`);
  if (n.days_remaining != null) lines.push(`${n.days_remaining} days left in quarter`);
  if (n.delta_since_monday != null) {
    const delta = n.delta_since_monday;
    lines.push(`Change since Monday: ${delta >= 0 ? '+' : ''}${formatCompact(delta)}`);
  }
  if (brief.ai_blurbs?.overall_summary) lines.push(`\n${brief.ai_blurbs.overall_summary}`);
  return lines.join('\n');
}

function formatWhatChanged(brief: AssembledBrief): string {
  const wc = brief.what_changed;
  if ((wc as any).nothing_moved) {
    return `**What Changed**\n\nNothing material moved${(wc as any).since_date ? ` since ${(wc as any).since_date}` : ''}.`;
  }
  const since = (wc as any).since_date ? ` since ${(wc as any).since_date}` : ' WoW';
  const lines = [`**What Changed${since}**`];
  if (wc.created.count > 0) lines.push(`Created: ${wc.created.count} deals (${formatCompact(wc.created.amount)})`);
  if (wc.won.count > 0) lines.push(`Won: ${wc.won.count} deals (${formatCompact(wc.won.amount)})`);
  if (wc.lost.count > 0) lines.push(`Lost: ${wc.lost.count} deals (${formatCompact(wc.lost.amount)})`);
  if (wc.pushed.count > 0) lines.push(`Pushed: ${wc.pushed.count} deals (${formatCompact(wc.pushed.amount)})`);
  if ((wc as any).total_pipeline_delta != null) {
    const delta = (wc as any).total_pipeline_delta;
    lines.push(`\nNet pipeline: ${delta >= 0 ? '+' : ''}${formatCompact(delta)}`);
  }
  if (wc.streak) lines.push(`_${wc.streak}_`);
  return lines.join('\n');
}

// ─── Fetch helper ─────────────────────────────────────────────────────────────

export async function getLatestReadyBrief(workspaceId: string): Promise<AssembledBrief | null> {
  const result = await query<any>(
    `SELECT * FROM weekly_briefs WHERE workspace_id = $1 AND status IN ('ready','sent','edited') ORDER BY generated_at DESC LIMIT 1`,
    [workspaceId]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  const p = (v: any) => typeof v === 'string' ? JSON.parse(v) : (v ?? {});
  return { ...row, the_number: p(row.the_number), what_changed: p(row.what_changed), segments: p(row.segments), reps: p(row.reps), deals_to_watch: p(row.deals_to_watch), ai_blurbs: p(row.ai_blurbs), editorial_focus: p(row.editorial_focus), section_refreshed_at: p(row.section_refreshed_at) };
}
