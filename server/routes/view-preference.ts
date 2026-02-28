import { Router, Request, Response } from 'express';
import { query } from '../db.js';

const router = Router();

const VALID_VIEWS = ['command', 'assistant'] as const;
type View = typeof VALID_VIEWS[number];

function isValidView(v: unknown): v is View {
  return typeof v === 'string' && (VALID_VIEWS as readonly string[]).includes(v);
}

router.get('/:workspaceId/view-preference', async (req: Request, res: Response): Promise<void> => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const userId = (req as any).user?.user_id;

    let preferred: View = 'command';

    if (userId) {
      try {
        const memberResult = await query<{ preferred_view: string | null }>(
          `SELECT preferred_view FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
          [workspaceId, userId]
        );
        if (memberResult.rows[0]?.preferred_view) {
          preferred = memberResult.rows[0].preferred_view as View;
        } else {
          const wsResult = await query<{ default_view: string | null }>(
            `SELECT default_view FROM workspaces WHERE id = $1`,
            [workspaceId]
          );
          if (wsResult.rows[0]?.default_view) {
            preferred = wsResult.rows[0].default_view as View;
          }
        }
      } catch {
      }
    }

    res.json({ preferred_view: preferred });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.put('/:workspaceId/view-preference', async (req: Request, res: Response): Promise<void> => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const userId = (req as any).user?.user_id;
    const { preferred_view } = req.body;

    if (!isValidView(preferred_view)) {
      res.status(400).json({ error: 'preferred_view must be "command" or "assistant"' });
      return;
    }

    if (userId) {
      try {
        await query(
          `UPDATE workspace_members SET preferred_view = $1 WHERE workspace_id = $2 AND user_id = $3`,
          [preferred_view, workspaceId, userId]
        );
      } catch {
      }
    }

    res.json({ preferred_view });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

router.put('/:workspaceId/settings/default-view', async (req: Request, res: Response): Promise<void> => {
  try {
    const workspaceId = req.params.workspaceId as string;
    const { default_view } = req.body;

    if (!isValidView(default_view)) {
      res.status(400).json({ error: 'default_view must be "command" or "assistant"' });
      return;
    }

    try {
      await query(
        `UPDATE workspaces SET default_view = $1 WHERE id = $2`,
        [default_view, workspaceId]
      );
    } catch {
    }

    res.json({ default_view });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

export default router;
