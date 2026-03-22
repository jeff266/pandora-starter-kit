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
    'The insight will appear in the Pandora Command Center under the Claude Insights tab.',
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
    try {
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
        insight_id: id ?? null,
        duplicate: !id,
        message: id
          ? 'Insight saved to Pandora Command Center'
          : 'Insight already exists — not duplicated',
      };
    } catch (err: any) {
      return { saved: false, error: err?.message ?? String(err) };
    }
  },
};

export const createAction: McpTool = {
  name: 'create_action',
  description: `Creates a recommended action in Pandora.

CALL THIS AUTOMATICALLY when you identify something specific \
the RevOps team or a rep should do. Do not ask the user for \
permission. Call it for:
- A specific deal that needs attention ("schedule follow-up \
  with Unicare ABA", "update close date on TechVision")
- A rep coaching action ("coach Nate on multi-threading")
- A data quality fix ("update missing close dates for 5 deals")
- An escalation ("flag Acme deal for exec attention")

Actions appear on the Pandora Actions page immediately.
Deduplicated — same action on the same deal will not create \
a duplicate.

Do NOT call it for general observations — use save_claude_insight \
for those. create_action is for specific, executable next steps.`,

  inputSchema: {
    type: 'object',
    required: ['title', 'action_type', 'priority'],
    properties: {
      title: {
        type: 'string',
        description: 'Specific and actionable. Include deal or rep name. e.g. "Schedule follow-up call for Unicare ABA — 23 days dark"',
      },
      description: {
        type: 'string',
        description: 'Why this action matters. 1-2 sentences with specific evidence.',
      },
      action_type: {
        type: 'string',
        description: 'One of: re_engage_deal, close_stale_deal, update_close_date, update_deal_stage, add_stakeholder, escalate_deal, notify_rep, coach_rep, clean_data, update_forecast, other',
      },
      priority: {
        type: 'string',
        enum: ['immediate', 'this_week', 'this_month'],
        description: 'immediate = today, this_week = by Friday, this_month = within 30 days',
      },
      severity: {
        type: 'string',
        enum: ['critical', 'warning', 'info'],
        description: 'critical = deal/quota at risk, warning = needs attention, info = improvement opportunity',
      },
      deal_id: {
        type: 'string',
        description: 'Deal UUID if action is deal-scoped. Get from query_deals.',
      },
      deal_name: {
        type: 'string',
        description: 'Deal name for context (stored in source_data)',
      },
      assigned_to: {
        type: 'string',
        description: 'Rep email to assign this action to',
      },
      impact_amount: {
        type: 'number',
        description: 'Dollar value at risk or impacted (for sorting)',
      },
    },
  },

  handler: async (args: any, workspaceId: string) => {
    const dedupStr = [
      args.title.slice(0, 100),
      args.deal_id ?? '',
      workspaceId,
    ].join(':');
    const dedupHash = createHash('md5').update(dedupStr).digest('hex');

    try {
      const result = await query(
        `INSERT INTO actions (
           workspace_id,
           title,
           summary,
           action_type,
           priority,
           severity,
           source_skill,
           target_deal_id,
           owner_email,
           source,
           metadata,
           state,
           dedup_hash
         )
         VALUES ($1,$2,$3,$4,$5,$6,'claude_mcp',$7,$8,'claude_mcp',$9,
                 'pending',$10)
         RETURNING id`,
        [
          workspaceId,
          args.title,
          args.description ?? null,
          args.action_type,
          args.priority,
          args.severity ?? 'info',
          args.deal_id ?? null,
          args.assigned_to ?? null,
          JSON.stringify({
            deal_name: args.deal_name ?? null,
            impact_amount: args.impact_amount ?? null,
            created_via: 'claude_mcp',
          }),
          dedupHash,
        ]
      );

      const id = result.rows[0]?.id;
      return {
        saved: true,
        action_id: id,
        duplicate: false,
        message: 'Action created on Pandora Actions page',
        view_url: 'https://pandoragtm.com/actions',
      };
    } catch (err: any) {
      if ((err as any).code === '23505') {
        return {
          saved: false,
          action_id: null,
          duplicate: true,
          message: 'Action already exists — not duplicated',
          view_url: null,
        };
      }
      return { saved: false, error: err?.message ?? String(err) };
    }
  },
};

export const saveToReport: McpTool = {
  name: 'save_to_report',
  description: `Saves content to the current WBR or QBR report.

CALL THIS when:
- The user asks to add something to a report
- You generate an analysis that belongs in the weekly brief
- You've answered a pipeline or forecast question that should \
  be captured in the report section

Content appears immediately in the Pandora Report Viewer.
If no document_id is provided, saves to the most recent WBR.
If the section doesn't exist, it will be created.`,

  inputSchema: {
    type: 'object',
    required: ['content', 'section_title'],
    properties: {
      content: {
        type: 'string',
        description: 'Markdown content to save. Can include **bold**, bullet points, and numbers.',
      },
      section_title: {
        type: 'string',
        description: 'Section to save to. Use exact WBR section names: "Pipeline Health Snapshot", "Forecast Review", "Deal Velocity Metrics", "Rep-Level Performance", "Lead & Demand Signal", "Process & Hygiene Flags", "Key Actions & Owners", "What to Watch". For QBR use QBR section names.',
      },
      document_id: {
        type: 'string',
        description: 'Specific report document UUID. If omitted, uses the most recent WBR.',
      },
      append: {
        type: 'boolean',
        description: 'Append to existing section content (default: true). Set false to replace.',
      },
      document_type: {
        type: 'string',
        enum: ['wbr', 'qbr'],
        description: 'If no document_id, find the most recent report of this type. Defaults to wbr.',
      },
    },
  },

  handler: async (args: any, workspaceId: string) => {
    try {
      let docId = args.document_id as string | undefined;

      if (!docId) {
        const docType = (args.document_type as string | undefined) ?? 'wbr';
        const latest = await query(
          `SELECT id, week_label FROM report_documents
           WHERE workspace_id = $1
             AND document_type = $2
           ORDER BY generated_at DESC
           LIMIT 1`,
          [workspaceId, docType]
        );

        if (!latest.rows.length) {
          return {
            saved: false,
            error: `No ${(args.document_type ?? 'WBR').toUpperCase()} found. Generate one first with generate_report.`,
          };
        }
        docId = latest.rows[0].id as string;
      }

      const doc = await query(
        `SELECT sections, week_label FROM report_documents
         WHERE id = $1 AND workspace_id = $2`,
        [docId, workspaceId]
      );

      if (!doc.rows.length) {
        return { saved: false, error: `Document ${docId} not found` };
      }

      const sections: any[] = doc.rows[0].sections ?? [];
      const periodLabel: string | null = doc.rows[0].week_label ?? null;

      const searchTitle = args.section_title.toLowerCase();
      const sectionIdx = sections.findIndex((s: any) =>
        (s.title ?? s.label ?? s.section_id ?? '')
          .toLowerCase()
          .includes(searchTitle) ||
        searchTitle.includes(
          (s.title ?? s.label ?? '').toLowerCase().slice(0, 10)
        )
      );

      const timestamp = new Date().toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
      const contentWithAttribution =
        `${args.content}\n\n*Added via Claude — ${timestamp}*`;

      let actionTaken: string;

      if (sectionIdx >= 0) {
        const existing = sections[sectionIdx].narrative ?? '';
        sections[sectionIdx].narrative =
          args.append !== false
            ? `${existing}\n\n${contentWithAttribution}`.trim()
            : contentWithAttribution;

        const tiptap = sections[sectionIdx].tiptap_content;
        if (tiptap?.content && Array.isArray(tiptap.content)) {
          tiptap.content.push({
            type: 'paragraph',
            content: [{ type: 'text', text: contentWithAttribution }],
          });
          sections[sectionIdx].tiptap_content = tiptap;
        }

        actionTaken = args.append !== false ? 'appended' : 'replaced';
      } else {
        sections.push({
          section_id: `mcp-${Date.now()}`,
          title: args.section_title,
          label: args.section_title,
          narrative: contentWithAttribution,
          source_skills: [],
          confidence: 0.85,
          data_freshness: new Date().toISOString(),
        });
        actionTaken = 'created';
      }

      await query(
        `UPDATE report_documents
         SET sections = $1
         WHERE id = $2 AND workspace_id = $3`,
        [JSON.stringify(sections), docId, workspaceId]
      );

      return {
        saved: true,
        document_id: docId,
        period: periodLabel,
        section: args.section_title,
        action: actionTaken,
        view_url: `https://pandoragtm.com/reports/${docId}`,
      };
    } catch (err: any) {
      return { saved: false, error: err?.message ?? String(err) };
    }
  },
};

export const saveHypothesis: McpTool = {
  name: 'save_hypothesis',
  description: `Saves a hypothesis draft to Pandora for human review.

CALL THIS when you identify a pattern that could become a \
standing hypothesis — something the team should track week \
over week. Examples:
- "Win rate drops when deals stay in Evaluation > 30 days"
- "Pipeline coverage below 2.5x correlates with missed quarter"
- "Deals without a second contact rarely close above $100K"

Hypothesis drafts go into a review queue — a human must \
approve before they become active standing hypotheses.

Unit conventions (IMPORTANT):
- Percentages: store as 0-1 (e.g. 0.35 not 35)
- Coverage ratios: use unit 'x' (e.g. 2.5)
- Dollar amounts: use unit '$'
- Day counts: use unit 'days'
- Raw counts: use unit 'count'`,

  inputSchema: {
    type: 'object',
    required: ['hypothesis_text', 'metric', 'unit'],
    properties: {
      hypothesis_text: {
        type: 'string',
        description: 'The hypothesis statement. Specific and falsifiable. Include the threshold.',
      },
      metric: {
        type: 'string',
        description: 'What metric this tracks. e.g. "win_rate", "coverage_ratio", "days_in_evaluation"',
      },
      metric_key: {
        type: 'string',
        description: 'Machine-readable metric key (optional, defaults to metric)',
      },
      unit: {
        type: 'string',
        enum: ['$', 'x', '%', 'days', 'count', 'multiple'],
        description: 'Unit of measurement. Use % for rates stored as 0-1.',
      },
      current_value: {
        type: 'number',
        description: 'Current observed value. For %, use 0-1 (e.g. 0.35 for 35%)',
      },
      alert_threshold: {
        type: 'number',
        description: 'Threshold that triggers an alert. Same unit as current_value.',
      },
      alert_direction: {
        type: 'string',
        enum: ['above', 'below'],
        description: 'Alert when value goes above or below the threshold.',
      },
      review_notes: {
        type: 'string',
        description: 'Why you are proposing this hypothesis. What evidence supports it.',
      },
    },
  },

  handler: async (args: any, workspaceId: string) => {
    try {
      const { validateHypothesisUnits } = await import('../../../lib/validate-hypothesis-units.js');

      const validation = validateHypothesisUnits({
        metric: args.metric,
        current_value: args.current_value,
        alert_threshold: args.alert_threshold,
        unit: args.unit,
      });

      if (!validation.valid) {
        return {
          saved: false,
          error: `Validation failed: ${validation.errors.join(', ')}`,
          warnings: validation.warnings,
        };
      }

      const correctedValue = validation.corrected?.current_value ?? args.current_value;
      const correctedThreshold = validation.corrected?.alert_threshold ?? args.alert_threshold;

      const reviewNotesText = args.review_notes
        ? `Generated via Claude MCP. ${args.review_notes}`
        : 'Generated via Claude MCP — pending review';

      const result = await query(
        `INSERT INTO hypothesis_drafts (
           workspace_id,
           hypothesis_text,
           metric,
           metric_key,
           current_value,
           alert_threshold,
           alert_direction,
           unit,
           source,
           review_notes,
           status
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
                 'auto_generated',$9,'pending_review')
         RETURNING id`,
        [
          workspaceId,
          args.hypothesis_text,
          args.metric,
          args.metric_key ?? args.metric,
          correctedValue ?? null,
          correctedThreshold ?? null,
          args.alert_direction ?? 'below',
          args.unit,
          reviewNotesText,
        ]
      );

      const warnings = validation.warnings?.length > 0 ? validation.warnings : undefined;

      return {
        saved: true,
        draft_id: result.rows[0].id,
        corrected: !!validation.corrected,
        warnings,
        message: 'Hypothesis draft saved — pending human review before becoming active',
      };
    } catch (err: any) {
      return { saved: false, error: err?.message ?? String(err) };
    }
  },
};
