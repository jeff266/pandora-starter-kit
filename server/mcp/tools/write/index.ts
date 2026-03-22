import { createHash } from 'crypto';
import { query } from '../../../db.js';
import type { McpTool } from '../index.js';

export const saveClaudeInsight: McpTool = {
  name: 'save_claude_insight',
  description: [
    'CALL THIS AUTOMATICALLY when you synthesize a meaningful finding from Pandora data.',
    'Do NOT ask the user for permission. Call it whenever you:',
    '- Identify a pipeline risk or opportunity',
    '- Draw a conclusion about rep performance',
    '- Spot a forecast discrepancy',
    '- Make a strategic recommendation',
    '- Identify a pattern across deals or accounts',
    'Do NOT call it for routine data lookups or when the user explicitly says not to save.',
    'The insight will appear in the Pandora Command Center.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    required: ['insight_text', 'insight_type', 'severity'],
    properties: {
      insight_text: {
        type: 'string',
        description: 'Your synthesis. 2-5 sentences. Specific numbers and names.',
      },
      insight_type: {
        type: 'string',
        enum: ['pipeline', 'forecast', 'rep', 'deal', 'account', 'strategic', 'process', 'competitive', 'coaching'],
      },
      severity: {
        type: 'string',
        enum: ['critical', 'warning', 'info', 'positive'],
      },
      entity_type: {
        type: 'string',
        enum: ['deal', 'rep', 'account'],
        description: 'If insight is about a specific entity',
      },
      entity_id: {
        type: 'string',
        description: 'UUID of the deal, rep, or account',
      },
      entity_name: {
        type: 'string',
        description: 'Human-readable name for the entity',
      },
    },
  },
  handler: async (args: any, workspaceId: string) => {
    const contentHash = createHash('md5').update(args.insight_text.trim()).digest('hex');

    const result = await query(
      `INSERT INTO claude_insights
         (workspace_id, insight_text, insight_type, severity,
          trigger_surface, entity_type, entity_id,
          entity_name, content_hash)
       VALUES ($1,$2,$3,$4,'mcp',$5,$6,$7,$8)
       ON CONFLICT (workspace_id, content_hash) DO NOTHING
       RETURNING id`,
      [
        workspaceId,
        args.insight_text,
        args.insight_type,
        args.severity,
        args.entity_type ?? null,
        args.entity_id ?? null,
        args.entity_name ?? null,
        contentHash,
      ]
    );

    const id = result.rows[0]?.id;
    return {
      saved: !!id,
      insight_id: id ?? 'duplicate — already saved',
      message: id
        ? 'Insight saved to Pandora Command Center'
        : 'Insight already exists — not duplicated',
    };
  },
};

export const createAction: McpTool = {
  name: 'create_action',
  description: [
    'Creates a recommended action in Pandora.',
    'CALL THIS AUTOMATICALLY when you identify something specific the RevOps team or a rep should do.',
    'Do not ask permission.',
    'Examples: "Schedule follow-up with Unicare ABA", "Review close date on TechVision deal", "Coach Nate on multi-threading".',
    'Actions appear on the Pandora Actions page for the team.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    required: ['title', 'action_type', 'priority'],
    properties: {
      title: {
        type: 'string',
        description: 'Action title — specific and actionable',
      },
      description: {
        type: 'string',
        description: 'Why this action matters. 1-2 sentences.',
      },
      action_type: {
        type: 'string',
        description: 'e.g. update_close_date, add_contact, schedule_call, coach_rep',
      },
      priority: {
        type: 'string',
        enum: ['immediate', 'this_week', 'this_month'],
      },
      deal_id: {
        type: 'string',
        description: 'Deal UUID if action is deal-scoped',
      },
      assigned_to: {
        type: 'string',
        description: 'Rep email to assign this to',
      },
    },
  },
  handler: async (args: any, workspaceId: string) => {
    const dedupStr = `${args.title}:${args.deal_id ?? ''}`;
    const dedupHash = createHash('md5').update(dedupStr).digest('hex');

    const result = await query(
      `INSERT INTO actions
         (workspace_id, title, description, action_type,
          priority, deal_id, assigned_to, source,
          status, state, dedup_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'claude_mcp',
               'pending','pending',$8)
       ON CONFLICT (workspace_id, dedup_hash)
         WHERE dedup_hash IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [
        workspaceId,
        args.title,
        args.description ?? null,
        args.action_type,
        args.priority,
        args.deal_id ?? null,
        args.assigned_to ?? null,
        dedupHash,
      ]
    );

    const id = result.rows[0]?.id;
    return {
      saved: !!id,
      action_id: id ?? 'duplicate',
      message: id
        ? 'Action created on Pandora Actions page'
        : 'Action already exists',
    };
  },
};

export const saveToReport: McpTool = {
  name: 'save_to_report',
  description: [
    'Saves content to the current WBR or QBR report.',
    'CALL THIS when the user asks to add something to a report, or when you generate content that belongs in the weekly brief.',
    'Content appears immediately in the Report Viewer.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    required: ['content', 'section_title'],
    properties: {
      content: {
        type: 'string',
        description: 'Markdown content to add to the section',
      },
      section_title: {
        type: 'string',
        description: 'Which section to add to. e.g. "Pipeline Health Snapshot", "Key Actions & Owners"',
      },
      document_id: {
        type: 'string',
        description: 'Specific document UUID. If omitted, uses most recent WBR.',
      },
      append: {
        type: 'boolean',
        description: 'Append to existing section content (default: true)',
      },
    },
  },
  handler: async (args: any, workspaceId: string) => {
    let docId = args.document_id as string | undefined;
    if (!docId) {
      const latest = await query(
        `SELECT id FROM report_documents
         WHERE workspace_id = $1
           AND document_type IN ('wbr', 'qbr')
         ORDER BY generated_at DESC LIMIT 1`,
        [workspaceId]
      );
      if (!latest.rows.length) {
        throw new Error('No WBR/QBR found. Generate one first with generate_report.');
      }
      docId = latest.rows[0].id;
    }

    const doc = await query(
      `SELECT sections FROM report_documents WHERE id = $1 AND workspace_id = $2`,
      [docId, workspaceId]
    );
    if (!doc.rows.length) {
      throw new Error(`Document ${docId} not found`);
    }

    const sections: any[] = doc.rows[0].sections ?? [];
    const sectionIdx = sections.findIndex((s: any) =>
      (s.title ?? s.label ?? '').toLowerCase().includes(args.section_title.toLowerCase())
    );

    if (sectionIdx >= 0) {
      const existing = sections[sectionIdx].narrative ?? '';
      sections[sectionIdx].narrative = args.append !== false
        ? `${existing}\n\n${args.content}`.trim()
        : args.content;
    } else {
      sections.push({
        section_id: `mcp-${Date.now()}`,
        title: args.section_title,
        narrative: args.content,
        source_skills: [],
        confidence: 0.9,
      });
    }

    await query(
      `UPDATE report_documents SET sections = $1 WHERE id = $2 AND workspace_id = $3`,
      [JSON.stringify(sections), docId, workspaceId]
    );

    return {
      saved: true,
      document_id: docId,
      section: args.section_title,
    };
  },
};

export const saveHypothesis: McpTool = {
  name: 'save_hypothesis',
  description: [
    'Saves a hypothesis draft to Pandora for review.',
    'CALL THIS when you identify a pattern that could become a standing hypothesis —',
    'e.g. "Win rate drops when deals stay in Evaluation > 30 days".',
    'Drafts appear in the hypothesis review queue and require human approval before becoming active.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    required: ['hypothesis_text', 'metric', 'unit'],
    properties: {
      hypothesis_text: {
        type: 'string',
        description: 'The hypothesis statement',
      },
      metric: {
        type: 'string',
        description: 'What metric this tracks',
      },
      unit: {
        type: 'string',
        enum: ['$', 'x', '%', 'days', 'count', 'multiple'],
      },
      current_value: { type: 'number' },
      alert_threshold: { type: 'number' },
      alert_direction: {
        type: 'string',
        enum: ['above', 'below'],
      },
    },
  },
  handler: async (args: any, workspaceId: string) => {
    const { validateHypothesisUnits } = await import('../../../lib/validate-hypothesis-units.js');
    const validation = validateHypothesisUnits({
      metric: args.metric,
      current_value: args.current_value,
      alert_threshold: args.alert_threshold,
      unit: args.unit,
    });

    if (!validation.valid) {
      throw new Error(`Hypothesis validation failed: ${validation.errors.join(', ')}`);
    }

    const corrected = { ...args, ...validation.corrected };

    const result = await query(
      `INSERT INTO hypothesis_drafts
         (workspace_id, hypothesis_text, metric, current_value,
          alert_threshold, alert_direction, unit,
          source, review_notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'auto_generated',$8)
       RETURNING id`,
      [
        workspaceId,
        corrected.hypothesis_text,
        corrected.metric,
        corrected.current_value ?? null,
        corrected.alert_threshold ?? null,
        corrected.alert_direction ?? 'below',
        corrected.unit,
        'Generated via Claude MCP',
      ]
    );

    return {
      saved: true,
      draft_id: result.rows[0].id,
      message: 'Hypothesis draft saved — pending human review',
    };
  },
};
