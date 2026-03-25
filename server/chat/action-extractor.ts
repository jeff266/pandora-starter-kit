import { randomUUID } from 'crypto';

export type SuggestedActionType =
  | 'run_skill'
  | 'create_crm_tasks'
  | 'update_forecast_category'
  | 'update_close_date'
  | 'run_meddic_coverage'
  | 'update_data_dictionary'
  | 'update_workspace_knowledge'
  | 'confirm_metric_definition'
  | 'update_calibration';

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
    pattern: /pipeline.?hygiene|deal.?hygiene|stage.?velocity.?missing|missing.*stage.?data/i,
    skill_id: 'pipeline-hygiene',
    title: 'Run Pipeline Hygiene Check',
    description: 'Audit stage completeness and velocity across the pipeline',
  },
  {
    pattern: /deal.?risk.?sweep|run.*deal.?risk/i,
    skill_id: 'deal-risk-review',
    title: 'Run Deal Risk Review',
    description: 'Identify at-risk deals across your pipeline',
  },
  {
    pattern: /forecast.*rollup|run.*forecast.*rollup/i,
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
  {
    pattern: /deal.?scor|rfm.?scor|scoring.?model|deal.*rfm|run.*deal.*scoring/i,
    skill_id: 'deal-scoring-model',
    title: 'Run Deal Scoring',
    description: 'Score all open deals by fit, engagement, and pipeline health',
  },
  {
    pattern: /pipeline.?coverage|coverage.?gap|coverage.?ratio/i,
    skill_id: 'pipeline-coverage',
    title: 'Run Pipeline Coverage Analysis',
    description: 'Measure pipeline coverage vs. quota across all reps',
  },
  {
    pattern: /rep.?scorecard|rep.*performance.*review|coaching.*digest/i,
    skill_id: 'rep-scorecard',
    title: 'Run Rep Scorecard',
    description: 'Benchmark rep performance against team averages',
  },
  {
    pattern: /stage.?mismatch|stage.*divergen|divergen.*stage/i,
    skill_id: 'stage-mismatch-detector',
    title: 'Run Stage Mismatch Detector',
    description: 'Find deals where CRM stage conflicts with conversation signals',
  },
  {
    pattern: /meddic.?coverage|run.*meddic/i,
    skill_id: 'meddic-coverage',
    title: 'Run MEDDIC Coverage',
    description: 'Score qualification completeness across open deals',
  },
  {
    pattern: /rfm.*(?:null|missing|not.*run|never.*run|all.*same|all.*A|all.*graded|no.*grade)|deal.*grade.*(?:null|missing|empty|not\s+computed)|grades.*(?:missing|empty|null|uniform|all\s*A)|all deals.*graded.*A|deal.*health.*(?:null|missing|not.*scored)/i,
    skill_id: 'deal-rfm-scoring',
    title: 'Run Deal RFM Scoring',
    description: 'Compute risk grades (A–F) for all deals based on recency, frequency, and deal value',
  },
  {
    pattern: /icp.*(?:score|fit|tier).*(?:null|missing|not.*run|never.*run|same|uniform)|fit.*score.*(?:missing|empty|not\s+computed)|icp.*(?:hasn.t|has not|never).*run/i,
    skill_id: 'icp-discovery',
    title: 'Run ICP Discovery',
    description: 'Score all accounts against your Ideal Customer Profile to populate ICP fit tiers',
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
  const hasActionItems = numberedItems.length > 0 || /\b(follow up|audit|review|check in|reach out|next step|immediately|priorit)\b/i.test(synthesisText);

  if (hasActionItems) {
    const taskTitle = numberedItems[0] || 'Pipeline review task';
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
    } else if (numberedItems.length > 0) {
      actions.push({
        id: randomUUID(),
        type: 'create_crm_tasks',
        title: taskTitle.length > 60 ? taskTitle.slice(0, 57) + '…' : taskTitle,
        description: `Workspace-level action from this analysis`,
        priority: 'P1',
        execution_mode: 'queue',
        action_payload: {
          task_title: taskTitle,
          steps: numberedItems.map(item => ({ title: item, priority: 'P1' as const, source: 'dossier' as const })),
        },
        evidence: 'Action items extracted from analysis',
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

  // ── 5. Skill run suggestions (P2, auto) ───────────────────────────────
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
          priority: 'P2',
          execution_mode: 'auto',
          action_payload: { skill_id: sp.skill_id },
          evidence: 'Skill referenced in analysis',
        });
      }
    }
  }

  // ── 6. Update data dictionary (P1, hitl) ──────────────────────────────
  const ddTermMatch = synthesisText.match(
    /(?:definition\s+of|define|how\s+(?:do\s+)?we\s+define|what\s+is\s+(?:our\s+)?definition\s+of)\s+["']?([A-Za-z][A-Za-z\s\-]{2,40}?)["']?(?:\s|[.,?]|$)/i
  );
  const ddRefined = /refine|update.*(?:definition|term)|(?:definition|term).*update|more\s+precise|better\s+definition|new\s+definition|derived.*definition|updated.*definition|save.*(?:to|in|into).*(?:dictionary|data\s+dictionary)/i.test(synthesisText);
  const ddToolRan = toolCallHistory.some(tc => ['getDataDictionary', 'queryDeals', 'runSqlQuery', 'getStageVelocityBenchmarks'].includes(tc.tool));

  if (ddTermMatch && ddRefined && ddToolRan) {
    const term = ddTermMatch[1].trim();
    actions.push({
      id: randomUUID(),
      type: 'update_data_dictionary',
      title: `Update Data Dictionary: ${term}`,
      description: `Save refined definition for "${term}"`,
      priority: 'P1',
      execution_mode: 'hitl',
      action_payload: { term, source: 'computed', confidence: 1.0 },
      evidence: 'Refined definition derived from data analysis in this conversation',
      threshold_note: 'Requires approval — updates shared workspace knowledge',
    });
  }

  // ── 7. Update workspace knowledge (P2, hitl) ─────────────────────────
  if (/you(?:'ve)?\s+(?:told|mentioned|said|shared)|based\s+on\s+what\s+you(?:'ve)?\s+told\s+me|noted|remember(?:ing)?|save\s+(?:this|that)\s+(?:for|to)|learned\s+from\s+(?:this|our)\s+conversation/i.test(synthesisText)) {
    const knowledgeMatch = synthesisText.match(/(?:noted|remember|save):\s*(.{10,120})/i)
      || synthesisText.match(/you(?:'ve)?\s+(?:told|mentioned|said|shared)\s+(?:me\s+)?(?:that\s+)?(.{10,80})/i);
    if (knowledgeMatch) {
      const value = knowledgeMatch[1].replace(/[.,;]$/, '').trim();
      actions.push({
        id: randomUUID(),
        type: 'update_workspace_knowledge',
        title: 'Save to workspace knowledge',
        description: value.length > 60 ? value.slice(0, 57) + '…' : value,
        priority: 'P2',
        execution_mode: 'hitl',
        action_payload: { key: 'conversation_note', value, source: 'conversation', confidence: 0.7 },
        evidence: 'Business context stated in conversation',
        threshold_note: 'Requires approval — saves to shared workspace memory',
      });
    }
  }

  // ── 8. Confirm metric definition (P1, hitl) ───────────────────────────
  if (/\b(win\s*rate|average\s+deal\s+size|avg\s+sales\s+cycle|pipeline\s+coverage|close\s+rate|conversion\s+rate)\b/i.test(synthesisText)
    && /\b(confirm|lock|use\s+(?:this|that)|(?:that'?s?\s+(?:right|correct))|(?:go\s+with)|(?:option\s+[AB])|(?:choice\s+[AB]))\b/i.test(synthesisText)) {
    const metricMatch = synthesisText.match(/\b(win\s*rate|average\s+deal\s+size|avg\s+sales\s+cycle|pipeline\s+coverage|close\s+rate|conversion\s+rate)\b/i);
    if (metricMatch) {
      const metricKey = metricMatch[1].toLowerCase().replace(/\s+/g, '_');
      actions.push({
        id: randomUUID(),
        type: 'confirm_metric_definition',
        title: `Confirm ${metricMatch[1]}`,
        description: 'Lock this metric value as the official benchmark',
        priority: 'P1',
        execution_mode: 'hitl',
        action_payload: { metric_key: metricKey, calibration_source: 'confirmed' },
        evidence: 'User confirmed metric value in this conversation',
        threshold_note: 'Requires approval — locks as confirmed benchmark',
      });
    }
  }

  // ── 9. Update calibration threshold (P2, hitl) ───────────────────────
  if (/(?:stale|stall|threshold|benchmark|p75|percentile|days\s+in\s+stage|stage\s+velocity)/i.test(synthesisText)
    && /(?:update|save|use\s+(?:this|that|these)|apply|set\s+(?:the\s+)?threshold)/i.test(synthesisText)) {
    const dimMatch = synthesisText.match(/\b(evaluation|qualification|decision|negotiation|awareness|discovery)\b/i);
    if (dimMatch) {
      const dimensionKey = dimMatch[1].toLowerCase();
      actions.push({
        id: randomUUID(),
        type: 'update_calibration',
        title: `Update calibration: ${dimMatch[1]}`,
        description: `Save new ${dimMatch[1]} stage threshold from velocity benchmarks`,
        priority: 'P2',
        execution_mode: 'hitl',
        action_payload: { dimension_key: dimensionKey, source: 'computed' },
        evidence: 'Stage threshold derived from velocity benchmark analysis',
        threshold_note: 'Requires approval — updates business dimension definition',
      });
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

  function extractFromValue(val: unknown, depth = 0): void {
    if (depth > 3 || !val || typeof val !== 'object') return;
    const obj = val as Record<string, unknown>;

    const candidateArrayKeys = [
      'deals', 'items', 'data', 'results', 'rows',
      'pipeline_deals', 'deals_at_risk', 'open_deals',
      'at_risk_deals', 'flagged_deals', 'risk_deals',
    ];

    for (const key of candidateArrayKeys) {
      if (Array.isArray(obj[key])) {
        for (const row of (obj[key] as unknown[]).slice(0, 12)) {
          if (row && typeof row === 'object') {
            const r = row as Record<string, unknown>;
            if (typeof r.name === 'string' && r.name.trim()) names.add(r.name.trim());
            if (typeof r.deal_name === 'string' && r.deal_name.trim()) names.add(r.deal_name.trim());
            if (typeof r.title === 'string' && r.title.trim() && r.amount) names.add(r.title.trim());
          }
        }
      }
    }

    for (const childKey of Object.keys(obj)) {
      if (typeof obj[childKey] === 'object' && !Array.isArray(obj[childKey])) {
        extractFromValue(obj[childKey], depth + 1);
      }
    }
  }

  for (const tc of toolCalls) {
    if (!tc.result) continue;
    extractFromValue(tc.result);
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
