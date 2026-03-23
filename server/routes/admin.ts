import { Router, type Request, type Response } from 'express';
import { requirePermission } from '../middleware/permissions.js';
import { retroAccuracyBootstrap } from '../jobs/retro-accuracy-bootstrap.js';
import { writeAgentRunToReportDocuments } from '../agents/report-document-writer.js';
import { query } from '../db.js';

const router = Router();

router.post(
  '/:workspaceId/admin/retro-accuracy-bootstrap',
  requirePermission('config.view'),
  async (req: Request, res: Response) => {
    const workspaceId = req.params.workspaceId as string;
    try {
      console.log(`[Admin] Retro accuracy bootstrap triggered for workspace ${workspaceId}`);
      const result = await retroAccuracyBootstrap(workspaceId);
      res.json({ success: true, ...result });
    } catch (err: any) {
      console.error('[Admin] Retro accuracy bootstrap failed:', err?.message);
      res.status(500).json({ error: 'Bootstrap failed', message: err?.message });
    }
  }
);

// One-time backfill: copy historical agent runs into report_documents
router.post(
  '/:workspaceId/admin/backfill-agent-runs',
  requirePermission('config.view'),
  async (req: Request, res: Response) => {
    const workspaceId = req.params.workspaceId as string;
    try {
      // Fetch all completed agent runs with synthesized output for this workspace
      const runsResult = await query(
        `SELECT
           ar.id, ar.agent_id, ar.created_at,
           ar.synthesized_output, ar.skill_results
         FROM agent_runs ar
         WHERE ar.workspace_id = $1
           AND ar.status = 'completed'
           AND ar.synthesized_output IS NOT NULL
           AND ar.synthesized_output != ''
         ORDER BY ar.created_at DESC`,
        [workspaceId]
      );

      if (runsResult.rows.length === 0) {
        res.json({ success: true, backfilled: 0, skipped: 0, message: 'No eligible runs found.' });
        return;
      }

      // Find runs already written to report_documents (by run_id in config)
      const alreadyWritten = await query(
        `SELECT config->>'run_id' as run_id FROM report_documents
         WHERE workspace_id = $1 AND document_type = 'agent_run'`,
        [workspaceId]
      );
      const writtenRunIds = new Set(alreadyWritten.rows.map((r: any) => r.run_id));

      // Fetch agent metadata for each unique agent_id
      const agentIds = [...new Set(runsResult.rows.map((r: any) => r.agent_id))];
      const agentsResult = await query(
        `SELECT id, name, description, goal, skill_ids FROM agents WHERE id = ANY($1)`,
        [agentIds]
      );
      const agentMap = new Map(agentsResult.rows.map((a: any) => [a.id, a]));

      const results: { run_id: string; status: 'written' | 'skipped' | 'error'; doc_id?: string; reason?: string }[] = [];

      for (const run of runsResult.rows) {
        if (writtenRunIds.has(run.id)) {
          results.push({ run_id: run.id, status: 'skipped', reason: 'already in report_documents' });
          continue;
        }

        const agent = agentMap.get(run.agent_id);
        if (!agent) {
          results.push({ run_id: run.id, status: 'skipped', reason: 'agent not found in workspace' });
          continue;
        }

        // Extract skills that actually ran from skill_results
        const skillsRun: string[] = run.skill_results
          ? Object.keys(run.skill_results as Record<string, unknown>)
          : (agent.skill_ids ?? []);

        try {
          const docId = await writeAgentRunToReportDocuments({
            workspaceId,
            agentId: run.agent_id,
            agentName: agent.name,
            agentDescription: agent.description ?? undefined,
            agentGoal: agent.goal ?? undefined,
            synthesizedOutput: run.synthesized_output,
            runId: run.id,
            skillsRun,
            generatedAt: new Date(run.created_at),
          });
          results.push({ run_id: run.id, status: 'written', doc_id: docId });
        } catch (writeErr: any) {
          results.push({ run_id: run.id, status: 'error', reason: writeErr?.message });
        }
      }

      const backfilled = results.filter(r => r.status === 'written').length;
      const skipped = results.filter(r => r.status === 'skipped').length;
      const errors = results.filter(r => r.status === 'error').length;

      console.log(`[Admin] Backfill agent runs: ${backfilled} written, ${skipped} skipped, ${errors} errors`);
      res.json({ success: true, backfilled, skipped, errors, results });
    } catch (err: any) {
      console.error('[Admin] Backfill agent runs failed:', err?.message);
      res.status(500).json({ error: 'Backfill failed', message: err?.message });
    }
  }
);

// Backfill: strip <actions> blocks from existing report_documents sections and
// store the parsed action objects in section.action_items
router.post(
  '/:workspaceId/admin/backfill-actions',
  requirePermission('config.view'),
  async (req: Request, res: Response) => {
    const workspaceId = req.params.workspaceId as string;
    try {
      // Only fetch documents that actually contain <actions> text
      const docsResult = await query(
        `SELECT id, sections
         FROM report_documents
         WHERE workspace_id = $1
           AND sections::text LIKE '%<actions>%'`,
        [workspaceId]
      );

      if (docsResult.rows.length === 0) {
        res.json({ success: true, processed: 0, sections_updated: 0, skipped: 0, message: 'No documents with <actions> blocks found.' });
        return;
      }

      const VALID_URGENCY = new Set(['today', 'this_week', 'this_month']);
      let processed = 0;
      let sectionsUpdated = 0;
      let skipped = 0;

      for (const doc of docsResult.rows) {
        const sections: any[] = Array.isArray(doc.sections) ? doc.sections : [];
        let docModified = false;

        const updatedSections = sections.map((section: any) => {
          const content: string = typeof section.content === 'string' ? section.content : '';
          if (!content.includes('<actions>')) return section;

          // Extract all <actions>...</actions> blocks from the content
          const capturedBlocks: string[] = [];
          const cleanedContent = content
            .replace(/<actions>([\s\S]*?)<\/actions>/g, (_m: string, inner: string) => {
              capturedBlocks.push(inner.trim());
              return '';
            })
            .trim();

          if (capturedBlocks.length === 0) return section;

          // Parse each captured block into ActionItem shape
          const parsedActions: any[] = [];
          for (const raw of capturedBlocks) {
            try {
              const arr = JSON.parse(raw);
              if (!Array.isArray(arr)) continue;
              for (const a of arr) {
                const actionText: string = a.title || a.action || a.summary || '';
                if (!actionText) continue;
                const urgency = VALID_URGENCY.has(a.urgency) ? a.urgency : 'this_week';
                const item: Record<string, string> = { action: actionText, owner: a.owner_email || a.owner || a.rep_name || '', urgency };
                if (a.target_deal_name || a.related_deal) {
                  item.related_deal = a.target_deal_name || a.related_deal;
                }
                parsedActions.push(item);
              }
            } catch {
              // Malformed JSON block — skip silently
            }
          }

          // Merge with existing action_items, deduplicating by action text
          const existing: any[] = Array.isArray(section.action_items) ? section.action_items : [];
          const existingTexts = new Set(existing.map((a: any) => a.action));
          const merged = [...existing, ...parsedActions.filter(a => !existingTexts.has(a.action))];

          docModified = true;
          sectionsUpdated++;

          return { ...section, content: cleanedContent, action_items: merged };
        });

        if (!docModified) {
          skipped++;
          continue;
        }

        await query(
          `UPDATE report_documents SET sections = $1::jsonb WHERE id = $2`,
          [JSON.stringify(updatedSections), doc.id]
        );
        processed++;
      }

      console.log(`[Admin] Backfill actions: ${processed} docs updated, ${sectionsUpdated} sections cleaned, ${skipped} skipped`);
      res.json({ success: true, processed, sections_updated: sectionsUpdated, skipped });
    } catch (err: any) {
      console.error('[Admin] Backfill actions failed:', err?.message);
      res.status(500).json({ error: 'Backfill failed', message: err?.message });
    }
  }
);

export default router;
