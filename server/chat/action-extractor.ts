import { randomUUID } from 'crypto';

export type SuggestedActionType =
  | 'run_skill'
  | 'create_crm_tasks'
  | 'update_forecast_category'
  | 'update_close_date'
  | 'run_meddic_coverage';

export type ExecutionMode = 'auto' | 'queue' | 'hitl';

export interface SuggestedAction {
  id: string;
  type: SuggestedActionType;
  title: string;
  description: string;
  priority: 'P1' | 'P2' | 'P3';
  deal_id?: string;
  deal_name?: string;
  execution_mode: ExecutionMode;
  action_payload: Record<string, unknown>;
  evidence: string;
  threshold_note?: string;
}

interface ToolCallRecord {
  tool: string;
  params: Record<string, unknown>;
  result?: unknown;
  description?: string;
}

const SKILL_PATTERNS: Array<{ pattern: RegExp; skill_id: string; title: string; description: string }> = [
  {
    pattern: /pipeline.?hygiene|stage.?velocity.?missing|missing.*stage.?data/i,
    skill_id: 'pipeline-hygiene',
    title: 'Run Pipeline Hygiene Check',
    description: 'Stage velocity data missing from this analysis',
  },
  {
    pattern: /deal.?risk.?sweep|run.*deal.?risk/i,
    skill_id: 'deal-risk-review',
    title: 'Run Deal Risk Review',
    description: 'Identify at-risk deals across your pipeline',
  },
  {
    pattern: /forecast.*rollup|run.*forecast/i,
    skill_id: 'forecast-rollup',
    title: 'Run Forecast Rollup',
    description: 'Aggregate forecast across all reps and pipelines',
  },
  {
    pattern: /data.?quality|missing.*field|incomplete.*data/i,
    skill_id: 'data-quality-audit',
    title: 'Run Data Quality Audit',
    description: 'Audit missing or inconsistent CRM fields',
  },
];

const HITL_NOTE = 'Requires approval — protected field';

export async function extractSuggestedActions(
  synthesisText: string,
  toolCallHistory: ToolCallRecord[],
  _workspaceId: string,
  dealContext?: { deal_id: string; deal_name: string }
): Promise<SuggestedAction[]> {
  const actions: SuggestedAction[] = [];
  const dealsFromTools = extractDealNamesFromToolCalls(toolCallHistory);

  // ── 1. MEDDIC coverage (P1, auto) ────────────────────────────────────────
  if (
    /meddic|qualification.?gap|missing.*champion|economic.?buyer|no.*champion|weak.*meddic/i.test(synthesisText) &&
    dealsFromTools.length > 0
  ) {
    const deals = dealsFromTools.slice(0, 4);
    actions.push({
      id: randomUUID(),
      type: 'run_meddic_coverage',
      title: `Run MEDDIC Coverage (${deals.length} deal${deals.length !== 1 ? 's' : ''})`,
      description: deals.slice(0, 3).join(' · ') + (deals.length > 3 ? ` + ${deals.length - 3} more` : ''),
      priority: 'P1',
      execution_mode: 'auto',
      action_payload: { deal_names: deals, skill_id: 'meddic-coverage' },
      evidence: 'Qualification gaps identified in this analysis',
    });
  }

  // ── 2. CRM task creation (P1, queue) ────────────────────────────────────
  const numberedItems = extractNumberedItems(synthesisText);
  const hasActionItems = numberedItems.length > 0 || /\b(follow up|audit|review|check in|reach out|next step)\b/i.test(synthesisText);

  if (hasActionItems) {
    const taskTitle = numberedItems[0] || 'Deal follow-up';
    if (dealsFromTools.length > 0) {
      const deals = dealsFromTools.slice(0, 4);
      actions.push({
        id: randomUUID(),
        type: 'create_crm_tasks',
        title: `Create deal audit tasks (${deals.length} deal${deals.length !== 1 ? 's' : ''})`,
        description: deals.slice(0, 3).join(' · ') + (deals.length > 3 ? ` + ${deals.length - 3} more` : ''),
        priority: 'P1',
        execution_mode: 'queue',
        action_payload: {
          deal_names: deals,
          task_title: taskTitle,
          steps: deals.map(d => ({ deal_name: d, title: taskTitle, priority: 'P1', source: 'dossier' as const })),
        },
        evidence: numberedItems.length > 0 ? `Action items extracted from analysis` : 'Follow-up actions identified',
      });
    } else if (dealContext) {
      actions.push({
        id: randomUUID(),
        type: 'create_crm_tasks',
        title: taskTitle.length > 50 ? taskTitle.slice(0, 47) + '…' : taskTitle,
        description: `For ${dealContext.deal_name}`,
        priority: 'P1',
        execution_mode: 'queue',
        deal_id: dealContext.deal_id,
        deal_name: dealContext.deal_name,
        action_payload: {
          deal_id: dealContext.deal_id,
          task_title: taskTitle,
          steps: [{ title: taskTitle, priority: 'P1', source: 'dossier' as const }],
        },
        evidence: 'Action item identified in analysis',
      });
    }
  }

  // ── 3. Forecast category updates (P2, hitl) ───────────────────────────
  const fcMatches = extractForecastCategoryUpdates(synthesisText);
  for (const fc of fcMatches.slice(0, 2)) {
    actions.push({
      id: randomUUID(),
      type: 'update_forecast_category',
      title: `Update forecast: ${fc.deal_name} → ${fc.category}`,
      description: `Proposed category: ${fc.category}`,
      priority: 'P2',
      deal_name: fc.deal_name,
      execution_mode: 'hitl',
      action_payload: { deal_name: fc.deal_name, proposed_category: fc.category },
      evidence: fc.evidence,
      threshold_note: HITL_NOTE,
    });
  }

  // ── 4. Close date fixes (P2, hitl) ────────────────────────────────────
  if (/closing same day|all.*same.*date|push.*close.?date|stale.*close|placeholder.*close|same close date/i.test(synthesisText)) {
    const deals = dealsFromTools.slice(0, 4);
    if (deals.length > 0) {
      actions.push({
        id: randomUUID(),
        type: 'update_close_date',
        title: `Fix stale close dates (${deals.length} deal${deals.length !== 1 ? 's' : ''})`,
        description: deals.slice(0, 3).join(' · ') + (deals.length > 3 ? ` + ${deals.length - 3} more` : ''),
        priority: 'P2',
        execution_mode: 'hitl',
        action_payload: { deal_names: deals },
        evidence: 'Likely placeholder dates detected — multiple deals share the same close date',
        threshold_note: HITL_NOTE,
      });
    }
  }

  // ── 5. Skill run suggestions (P3, auto) ───────────────────────────────
  for (const sp of SKILL_PATTERNS) {
    if (sp.pattern.test(synthesisText)) {
      const alreadyCovered =
        (sp.skill_id === 'meddic-coverage' && actions.some(a => a.type === 'run_meddic_coverage'));
      if (!alreadyCovered) {
        actions.push({
          id: randomUUID(),
          type: 'run_skill',
          title: sp.title,
          description: sp.description,
          priority: 'P3',
          execution_mode: 'auto',
          action_payload: { skill_id: sp.skill_id },
          evidence: 'Skill referenced in analysis',
        });
      }
    }
  }

  // Sort P1 → P2 → P3, cap at 6
  return actions
    .sort((a, b) => a.priority.localeCompare(b.priority))
    .slice(0, 6);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractDealNamesFromToolCalls(toolCalls: ToolCallRecord[]): string[] {
  const names = new Set<string>();
  for (const tc of toolCalls) {
    if (!tc.result || typeof tc.result !== 'object') continue;
    const res = tc.result as Record<string, unknown>;
    const rows: unknown[] = (
      (Array.isArray(res.deals) && res.deals) ||
      (Array.isArray(res.items) && res.items) ||
      (Array.isArray(res.data) && res.data) ||
      []
    );
    for (const row of rows.slice(0, 8)) {
      if (row && typeof row === 'object') {
        const r = row as Record<string, unknown>;
        if (typeof r.name === 'string' && r.name.trim()) names.add(r.name.trim());
        if (typeof r.deal_name === 'string' && r.deal_name.trim()) names.add(r.deal_name.trim());
      }
    }
  }
  return Array.from(names);
}

function extractNumberedItems(text: string): string[] {
  const matches = text.match(/^\s*\d+[.)]\s+(.{5,100})/gm) ?? [];
  return matches
    .map(m => m.replace(/^\s*\d+[.)]\s+/, '').replace(/\*+/g, '').trim())
    .filter(t => t.length > 5)
    .slice(0, 5);
}

interface ForecastMatch {
  deal_name: string;
  category: string;
  evidence: string;
}

function extractForecastCategoryUpdates(text: string): ForecastMatch[] {
  const results: ForecastMatch[] = [];
  const cats = ['Commit', 'Best Case', 'Pipeline'];

  const patterns = [
    /move\s+([A-Z][^,\n.]{3,50}?)\s+(?:from\s+\w+\s+)?to\s+(Commit|Best Case|Pipeline)/gi,
    /([A-Z][^,\n.]{3,50}?)\s+should\s+be\s+(Commit|Best Case|Pipeline)/gi,
    /(Commit|Best Case|Pipeline)(?:\s+candidate)?[:\s]+([A-Z][^,\n.$]{3,50})/gi,
  ];

  for (const pat of patterns) {
    let m: RegExpExecArray | null;
    while ((m = pat.exec(text)) !== null && results.length < 3) {
      const [full, a, b] = m;
      const deal = cats.some(c => a.trim() === c) ? b?.trim() : a?.trim();
      const cat = cats.find(c => c === a.trim() || c === b?.trim());
      if (deal && cat && deal.length < 60 && !results.some(r => r.deal_name === deal)) {
        results.push({ deal_name: deal, category: cat, evidence: full.trim() });
      }
    }
  }
  return results;
}
