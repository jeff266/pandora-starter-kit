import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';
import type {
  EditorialOutput,
  AgentRunDigest,
  AgentMemory,
} from './editorial-types.js';
import type { SkillEvidence } from '../skills/types.js';

const logger = createLogger('AgentMemory');

function daysSince(isoDate: string): number {
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60 * 24));
}

function createEmptyMemory(workspaceId: string, agentId: string): AgentMemory {
  return {
    workspace_id: workspaceId,
    agent_id: agentId,
    recurring_flags: [],
    deal_history: [],
    metric_history: [],
    predictions: [],
    last_updated: new Date().toISOString(),
  };
}

export function extractDigest(output: EditorialOutput): AgentRunDigest {
  return {
    generated_at: new Date().toISOString(),
    opening_narrative: output.opening_narrative,
    key_findings: output.sections.map(s => ({
      section_id: s.section_id,
      headline: s.narrative?.split('.')[0] || s.title,
      deals_flagged: (s.deal_cards || []).map(d => d.name),
      metrics_snapshot: Object.fromEntries(
        (s.metrics || [])
          .filter(m => {
            const numVal = parseFloat(String(m.value).replace(/[^0-9.\-]/g, ''));
            return !isNaN(numVal);
          })
          .map(m => [m.label, parseFloat(String(m.value).replace(/[^0-9.\-]/g, ''))])
      ),
      severity: s.metrics?.some(m => m.severity === 'critical') ? 'critical'
        : s.metrics?.some(m => m.severity === 'warning') ? 'warning' : 'good',
    })),
    actions_recommended: output.sections
      .flatMap(s => s.action_items || [])
      .slice(0, 10)
      .map(a => ({
        deal_or_target: a.related_deal || a.owner,
        action: a.action,
        urgency: a.urgency || 'this_week',
      })),
    sections_included: output.sections_included || output.sections.map(s => s.section_id),
    sections_dropped: output.sections_dropped || [],
    lead_section: output.editorial_decisions?.find(d => d.decision === 'lead_with')?.affected_sections?.[0]
      || output.sections[0]?.section_id || '',
  };
}

export async function saveDigest(generationId: string, digest: AgentRunDigest): Promise<void> {
  await query(
    `UPDATE report_generations SET run_digest = $1 WHERE id = $2`,
    [JSON.stringify(digest), generationId]
  );
  logger.info('[AgentMemory] Digest saved', { generation_id: generationId });
}

export async function getLatestDigest(
  agentId: string,
  workspaceId: string
): Promise<AgentRunDigest | null> {
  const result = await query<{ run_digest: AgentRunDigest }>(
    `SELECT run_digest
     FROM report_generations
     WHERE agent_id = $1
       AND workspace_id = $2
       AND run_digest IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [agentId, workspaceId]
  );
  return result.rows[0]?.run_digest || null;
}

export async function getAgentMemory(
  agentId: string,
  workspaceId: string
): Promise<AgentMemory | null> {
  const result = await query<{ memory: AgentMemory }>(
    `SELECT memory
     FROM agent_memory
     WHERE workspace_id = $1 AND agent_id = $2`,
    [workspaceId, agentId]
  );
  if (!result.rows[0]?.memory) return null;
  const memory = result.rows[0].memory;
  return typeof memory === 'string' ? JSON.parse(memory) : memory;
}

function findDealOutcome(
  dealName: string,
  evidence: Record<string, any>
): string | null {
  for (const skillId of ['pipeline-hygiene', 'deal-risk-review', 'forecast-rollup']) {
    const skillEvidence = evidence[skillId];
    if (!skillEvidence) continue;

    const claims = skillEvidence.claims || skillEvidence?.evidence?.claims || [];
    const dealClaim = claims.find((c: any) =>
      c.claim_text?.toLowerCase().includes(dealName.toLowerCase()) &&
      (c.claim_text?.includes('closed') || c.claim_text?.includes('won') ||
       c.claim_text?.includes('lost') || c.claim_text?.includes('advanced'))
    );

    if (dealClaim?.claim_text?.toLowerCase().includes('won')) return 'closed_won';
    if (dealClaim?.claim_text?.toLowerCase().includes('lost')) return 'closed_lost';
    if (dealClaim?.claim_text?.toLowerCase().includes('advanced')) return 'advanced';

    const records = skillEvidence.evaluated_records || skillEvidence?.evidence?.evaluated_records || [];
    const dealRecord = records.find((r: any) =>
      r.name?.toLowerCase() === dealName.toLowerCase() ||
      r.deal_name?.toLowerCase() === dealName.toLowerCase()
    );
    if (dealRecord) {
      const stage = (dealRecord.stage || '').toLowerCase();
      if (stage.includes('closed') && stage.includes('won')) return 'closed_won';
      if (stage.includes('closed') && stage.includes('lost')) return 'closed_lost';
    }
  }
  return null;
}

function checkPredictionOutcome(
  prediction: { prediction: string; date: string },
  evidence: Record<string, any>
): { result: string; correct: boolean } | null {
  for (const skillId of ['pipeline-hygiene', 'deal-risk-review']) {
    const skillEvidence = evidence[skillId];
    const records = skillEvidence?.evaluated_records || skillEvidence?.evidence?.evaluated_records || [];
    for (const record of records) {
      const dealName = record.name || record.deal_name || '';
      if (!dealName || !prediction.prediction.toLowerCase().includes(dealName.toLowerCase())) continue;
      const stage = (record.stage || '').toLowerCase();
      if (stage.includes('closed') && stage.includes('won')) {
        const predictedRisk = prediction.prediction.toLowerCase().includes('slip') ||
          prediction.prediction.toLowerCase().includes('risk') ||
          prediction.prediction.toLowerCase().includes('stall');
        return { result: 'closed_won', correct: !predictedRisk };
      }
      if (stage.includes('closed') && stage.includes('lost')) {
        const predictedRisk = prediction.prediction.toLowerCase().includes('risk') ||
          prediction.prediction.toLowerCase().includes('lose');
        return { result: 'closed_lost', correct: predictedRisk };
      }
    }
  }
  return null;
}

export async function updateAgentMemory(
  agentId: string,
  workspaceId: string,
  currentDigest: AgentRunDigest,
  previousMemory: AgentMemory | null,
  currentEvidence: Record<string, any>
): Promise<AgentMemory> {
  const memory = previousMemory || createEmptyMemory(workspaceId, agentId);

  // 1. UPDATE RECURRING FLAGS
  for (const finding of currentDigest.key_findings) {
    if (finding.severity === 'good') continue;
    const existing = memory.recurring_flags.find(f => f.key === finding.section_id);
    if (existing) {
      existing.times_flagged++;
      existing.last_flagged = currentDigest.generated_at;
      existing.resolved = false;
    } else {
      memory.recurring_flags.push({
        key: finding.section_id,
        first_flagged: currentDigest.generated_at,
        times_flagged: 1,
        last_flagged: currentDigest.generated_at,
        resolved: false,
      });
    }
  }
  for (const flag of memory.recurring_flags) {
    const currentFinding = currentDigest.key_findings.find(f => f.section_id === flag.key);
    if (currentFinding?.severity === 'good') flag.resolved = true;
  }
  memory.recurring_flags = memory.recurring_flags
    .filter(f => !f.resolved || daysSince(f.last_flagged) < 30)
    .slice(0, 30);

  // 2. UPDATE DEAL HISTORY
  for (const finding of currentDigest.key_findings) {
    for (const dealName of finding.deals_flagged) {
      const existing = memory.deal_history.find(d => d.deal_name === dealName);
      if (existing) {
        existing.mentions.push({
          date: currentDigest.generated_at,
          status: 'flagged',
          summary: `Flagged in ${finding.section_id} (${finding.severity})`,
        });
        if (existing.mentions.length > 5) existing.mentions.shift();
      } else {
        memory.deal_history.push({
          deal_name: dealName,
          deal_id: '',
          first_mentioned: currentDigest.generated_at,
          mentions: [{
            date: currentDigest.generated_at,
            status: 'flagged',
            summary: `First mention in ${finding.section_id}`,
          }],
        });
      }
    }
  }

  for (const tracked of memory.deal_history) {
    const stillFlagged = currentDigest.key_findings.some(
      f => f.deals_flagged.includes(tracked.deal_name)
    );
    const lastMention = tracked.mentions[tracked.mentions.length - 1];
    if (!stillFlagged && lastMention?.status === 'flagged') {
      const outcome = findDealOutcome(tracked.deal_name, currentEvidence);
      if (outcome) {
        tracked.mentions.push({
          date: currentDigest.generated_at,
          status: outcome,
          summary: `No longer flagged — ${outcome}`,
        });
        if (tracked.mentions.length > 5) tracked.mentions.shift();
      }
    }
  }
  if (memory.deal_history.length > 20) {
    memory.deal_history = memory.deal_history.slice(-20);
  }

  // 3. APPEND METRIC SNAPSHOTS
  for (const finding of currentDigest.key_findings) {
    for (const [metric, value] of Object.entries(finding.metrics_snapshot)) {
      let series = memory.metric_history.find(m => m.metric === metric);
      if (!series) {
        series = { metric, values: [] };
        memory.metric_history.push(series);
      }
      series.values.push({ date: currentDigest.generated_at, value });
      if (series.values.length > 8) series.values.shift();
    }
  }

  // 4. CHECK PREVIOUS PREDICTIONS
  for (const prediction of memory.predictions) {
    if (prediction.outcome !== null) continue;
    const outcome = checkPredictionOutcome(prediction, currentEvidence);
    if (outcome) {
      prediction.outcome = outcome.result;
      prediction.correct = outcome.correct;
    }
  }

  memory.last_updated = currentDigest.generated_at;

  await query(
    `INSERT INTO agent_memory (workspace_id, agent_id, memory, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (workspace_id, agent_id)
     DO UPDATE SET memory = $3, updated_at = NOW()`,
    [workspaceId, agentId, JSON.stringify(memory)]
  );

  logger.info('[AgentMemory] Rolling memory updated', {
    agent_id: agentId,
    recurring_flags: memory.recurring_flags.length,
    deal_history: memory.deal_history.length,
    metric_series: memory.metric_history.length,
    predictions: memory.predictions.length,
  });

  return memory;
}

export function formatMemoryForPrompt(
  digest: AgentRunDigest | null,
  memory: AgentMemory | null
): string {
  if (!digest && !memory) {
    return 'This is your first run. No previous briefings to reference.';
  }

  const parts: string[] = ['MEMORY (from your previous runs):'];

  if (digest) {
    const daysAgo = daysSince(digest.generated_at);
    parts.push(`\nLast briefing (${daysAgo} day${daysAgo !== 1 ? 's' : ''} ago):`);
    parts.push(`- Opening: "${digest.opening_narrative}"`);
    parts.push(`- Led with: ${digest.lead_section}`);

    const allDeals = digest.key_findings.flatMap(f => f.deals_flagged);
    if (allDeals.length > 0) {
      parts.push(`- Deals flagged: ${allDeals.join(', ')}`);
    }

    const keyMetrics = digest.key_findings
      .flatMap(f => Object.entries(f.metrics_snapshot))
      .slice(0, 6)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    if (keyMetrics) {
      parts.push(`- Key metrics: ${keyMetrics}`);
    }

    if (digest.actions_recommended.length > 0) {
      parts.push(`- Actions recommended: ${digest.actions_recommended.slice(0, 3).map(a => `${a.deal_or_target}: ${a.action}`).join('; ')}`);
    }
  }

  if (memory) {
    const unresolved = memory.recurring_flags.filter(f => !f.resolved && f.times_flagged > 1);
    if (unresolved.length > 0) {
      parts.push('\nRecurring patterns (still unresolved):');
      for (const flag of unresolved.slice(0, 5)) {
        parts.push(`- "${flag.key}" flagged ${flag.times_flagged} times (since ${flag.first_flagged.split('T')[0]})`);
      }
    }

    const recentlyResolved = memory.recurring_flags.filter(f => f.resolved && daysSince(f.last_flagged) < 14);
    if (recentlyResolved.length > 0) {
      parts.push('\nRecently resolved:');
      for (const flag of recentlyResolved.slice(0, 3)) {
        parts.push(`- "${flag.key}" resolved after ${flag.times_flagged} flags`);
      }
    }

    const trackedDeals = memory.deal_history.filter(d => d.mentions.length > 1);
    if (trackedDeals.length > 0) {
      parts.push('\nDeal tracking:');
      for (const deal of trackedDeals.slice(0, 5)) {
        const latest = deal.mentions[deal.mentions.length - 1];
        const first = deal.mentions[0];
        parts.push(`- ${deal.deal_name}: ${first.status} on ${first.date.split('T')[0]} → ${latest.status} on ${latest.date.split('T')[0]} (${deal.mentions.length} mentions)`);
      }
    }

    const trends = memory.metric_history
      .filter(m => m.values.length >= 3)
      .map(m => {
        const vals = m.values.map(v => v.value);
        const recent = vals.slice(-3);
        const direction = recent[2] > recent[0] ? 'improving'
          : recent[2] < recent[0] ? 'declining' : 'flat';
        return { metric: m.metric, values: recent, direction };
      })
      .filter(t => t.direction !== 'flat');

    if (trends.length > 0) {
      parts.push('\nMetric trends (last 3 readings):');
      for (const t of trends.slice(0, 5)) {
        parts.push(`- ${t.metric}: ${t.values.join(' → ')} (${t.direction})`);
      }
    }

    const resolved = memory.predictions.filter(p => p.outcome !== null);
    if (resolved.length > 0) {
      const correct = resolved.filter(p => p.correct).length;
      parts.push(`\nPrediction accuracy: ${correct}/${resolved.length} correct`);
      const latest = resolved[resolved.length - 1];
      parts.push(`- Latest: "${latest.prediction}" → ${latest.outcome} (${latest.correct ? '✓ correct' : '✗ wrong'})`);
    }
  }

  parts.push('\nSELF-REFERENCE INSTRUCTIONS:');
  parts.push('- Reference what changed since last briefing (improved, worsened, resolved, new)');
  parts.push('- If you flagged deals last time, report their status (advanced? stalled? closed?)');
  parts.push('- If you\'ve flagged the same issue multiple runs in a row, escalate: "This is the Nth time I\'ve flagged X — it hasn\'t been addressed"');
  parts.push('- If a prediction was wrong, acknowledge it: "I predicted X would slip — good news, it closed"');
  parts.push('- Do NOT repeat the same opening narrative — lead with what\'s NEW or DIFFERENT');
  parts.push('- Use metric trends to show direction: "Coverage improved from 1.8x to 2.3x over the last 3 weeks"');

  return parts.join('\n');
}
