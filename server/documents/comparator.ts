import { query } from '../db.js';
import { getRelevantMemories } from '../memory/workspace-memory.js';

export interface MetricChange {
  label: string;
  current: number;
  prior: number;
  delta: number;
  direction: 'up' | 'down' | 'flat';
  unit: 'pct' | 'ratio' | 'days' | 'currency';
}

export interface ComparisonItem {
  category: string;
  entity_id?: string;
  entity_name?: string;
  status: 'resolved' | 'persisted' | 'new';
  message: string;
  occurrence_count: number;
}

export interface DocumentComparison {
  prior_brief_id: string;
  prior_date: string;
  metrics: MetricChange[];
  findings: ComparisonItem[];
}

export async function buildComparison(workspaceId: string, currentBriefId: string): Promise<DocumentComparison | null> {
  // 1. Find the most recent prior brief
  const priorBriefRes = await query<any>(
    `SELECT id, generated_date, the_number 
     FROM weekly_briefs 
     WHERE workspace_id = $1 AND id != $2 AND status IN ('ready', 'sent', 'edited')
     ORDER BY generated_date DESC LIMIT 1`,
    [workspaceId, currentBriefId]
  );

  if (priorBriefRes.rows.length === 0) return null;
  const priorBrief = priorBriefRes.rows[0];

  // 2. Get current brief data
  const currentBriefRes = await query<any>(
    `SELECT the_number FROM weekly_briefs WHERE id = $1`,
    [currentBriefId]
  );
  if (currentBriefRes.rows.length === 0) return null;
  const currentBrief = currentBriefRes.rows[0];

  const currentNum = typeof currentBrief.the_number === 'string' ? JSON.parse(currentBrief.the_number) : currentBrief.the_number;
  const priorNum = typeof priorBrief.the_number === 'string' ? JSON.parse(priorBrief.the_number) : priorBrief.the_number;

  // 3. Compare metrics
  const metrics: MetricChange[] = [];
  
  if (currentNum.attainment_pct !== undefined && priorNum.attainment_pct !== undefined) {
    const delta = currentNum.attainment_pct - priorNum.attainment_pct;
    metrics.push({
      label: 'Attainment',
      current: currentNum.attainment_pct,
      prior: priorNum.attainment_pct,
      delta,
      direction: delta > 0.1 ? 'up' : delta < -0.1 ? 'down' : 'flat',
      unit: 'pct'
    });
  }

  if (currentNum.coverage_ratio !== undefined && priorNum.coverage_ratio !== undefined) {
    const delta = currentNum.coverage_ratio - priorNum.coverage_ratio;
    metrics.push({
      label: 'Coverage',
      current: currentNum.coverage_ratio,
      prior: priorNum.coverage_ratio,
      delta,
      direction: delta > 0.01 ? 'up' : delta < -0.01 ? 'down' : 'flat',
      unit: 'ratio'
    });
  }

  if (currentNum.days_remaining !== undefined && priorNum.days_remaining !== undefined) {
    const delta = currentNum.days_remaining - priorNum.days_remaining;
    metrics.push({
      label: 'Days Remaining',
      current: currentNum.days_remaining,
      prior: priorNum.days_remaining,
      delta,
      direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
      unit: 'days'
    });
  }

  // 4. Compare findings (using workspace_memory as the source of truth for findings)
  // We'll look at findings that were active during the prior brief vs now.
  const currentFindingsRes = await query<any>(
    `SELECT category, entity_id, entity_name, summary as message, occurrence_count, is_resolved
     FROM workspace_memory
     WHERE workspace_id = $1 AND memory_type = 'recurring_finding'
     AND (last_seen_at >= (SELECT generated_at FROM weekly_briefs WHERE id = $2))`,
    [workspaceId, currentBriefId]
  );

  const priorFindingsRes = await query<any>(
    `SELECT category, entity_id, entity_name, summary as message, occurrence_count, is_resolved, resolved_at
     FROM workspace_memory
     WHERE workspace_id = $1 AND memory_type = 'recurring_finding'
     AND (first_seen_at <= (SELECT generated_at FROM weekly_briefs WHERE id = $2) 
          AND (resolved_at IS NULL OR resolved_at >= (SELECT generated_at FROM weekly_briefs WHERE id = $2)))`,
    [workspaceId, priorBrief.id]
  );

  const findings: ComparisonItem[] = [];
  const currentMap = new Map<string, any>();
  for (const f of currentFindingsRes.rows) {
    currentMap.set(`${f.category}:${f.entity_id || ''}`, f);
  }

  const priorMap = new Map<string, any>();
  for (const f of priorFindingsRes.rows) {
    priorMap.set(`${f.category}:${f.entity_id || ''}`, f);
  }

  // Resolved: In prior but not in current (or marked resolved in current)
  for (const [key, pf] of priorMap.entries()) {
    const cf = currentMap.get(key);
    if (!cf || cf.is_resolved) {
      findings.push({
        category: pf.category,
        entity_id: pf.entity_id,
        entity_name: pf.entity_name,
        status: 'resolved',
        message: pf.message,
        occurrence_count: pf.occurrence_count
      });
    } else {
      findings.push({
        category: cf.category,
        entity_id: cf.entity_id,
        entity_name: cf.entity_name,
        status: 'persisted',
        message: cf.message,
        occurrence_count: cf.occurrence_count
      });
    }
  }

  // New: In current but not in prior
  for (const [key, cf] of currentMap.entries()) {
    if (!priorMap.has(key) && !cf.is_resolved) {
      findings.push({
        category: cf.category,
        entity_id: cf.entity_id,
        entity_name: cf.entity_name,
        status: 'new',
        message: cf.message,
        occurrence_count: cf.occurrence_count
      });
    }
  }

  return {
    prior_brief_id: priorBrief.id,
    prior_date: priorBrief.generated_date,
    metrics,
    findings: findings.slice(0, 10) // Limit to top 10 for the block
  };
}

export function formatComparisonBlock(comparison: DocumentComparison, workspaceMemories: any[]): string {
  if (!comparison) return '';

  let html = `<div class="comparison-block" style="margin: 16px 0; padding: 12px; background: var(--color-surfaceRaised); border-radius: 8px; font-family: var(--font-sans);">`;
  html += `<div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--color-textMuted); margin-bottom: 8px;">Since last week (${new Date(comparison.prior_date).toLocaleDateString()})</div>`;

  // Metrics changes
  if (comparison.metrics.length > 0) {
    html += `<div style="display: flex; gap: 12px; margin-bottom: 12px; flex-wrap: wrap;">`;
    for (const m of comparison.metrics) {
      const icon = m.direction === 'up' ? '↑' : m.direction === 'down' ? '↓' : '→';
      const color = m.direction === 'up' ? 'var(--color-green)' : m.direction === 'down' ? 'var(--color-coral)' : 'var(--color-textMuted)';
      const value = m.unit === 'pct' ? `${Math.round(m.current)}%` : m.unit === 'ratio' ? `${m.current.toFixed(1)}x` : m.current;
      const delta = m.unit === 'pct' ? `${m.delta > 0 ? '+' : ''}${Math.round(m.delta)}pts` : m.unit === 'ratio' ? `${m.delta > 0 ? '+' : ''}${m.delta.toFixed(1)}x` : m.delta;

      html += `<div style="font-size: 12px; color: var(--color-textSecondary);">`;
      html += `<span style="font-weight: 600; color: var(--color-text);">${m.label}:</span> ${value} `;
      html += `<span style="color: ${color}; font-weight: 600;">${icon} ${delta}</span>`;
      html += `</div>`;
    }
    html += `</div>`;
  }

  // Findings changes
  if (comparison.findings.length > 0) {
    html += `<ul style="list-style: none; padding: 0; margin: 0; font-size: 12px; line-height: 1.6;">`;
    for (const f of comparison.findings) {
      let icon = '⚡';
      let color = 'var(--color-accent)';
      let label = '';

      if (f.status === 'resolved') {
        icon = '✓';
        color = 'var(--color-green)';
        label = 'Resolved: ';
      } else if (f.status === 'persisted') {
        icon = '→';
        color = 'var(--color-yellow)';
      } else if (f.status === 'new') {
        icon = '⚡';
        color = 'var(--color-coral)';
        label = 'New: ';
      }

      const entityStr = f.entity_name ? ` <b>${f.entity_name}</b>` : '';
      let streakStr = '';
      if (f.occurrence_count >= 3) {
        streakStr = ` <span style="color: var(--color-coral); font-weight: 600;">· ${f.occurrence_count} consecutive weeks</span>`;
      }

      html += `<li style="margin-bottom: 4px; display: flex; align-items: flex-start; gap: 8px;">`;
      html += `<span style="color: ${color}; font-weight: bold; flex-shrink: 0;">${icon}</span>`;
      html += `<span style="color: var(--color-textSecondary);">${label}${f.message}${entityStr}${streakStr}</span>`;
      html += `</li>`;
    }
    html += `</ul>`;
  }

  html += `</div>`;
  return html;
}
