import { Router, Request, Response } from 'express';
import { getLLMConfig, updateLLMConfig, getLLMUsage, clearConfigCache } from '../utils/llm-router.js';
import { query } from '../db.js';

const router = Router();

router.get('/:id/llm/config', async (req: Request, res: Response) => {
  try {
    const config = await getLLMConfig(req.params.id);
    res.json(config);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[LLM Config] GET error:', msg);
    res.status(500).json({ error: msg });
  }
});

router.post('/:id/llm/config', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.id;
    const { routing, providers, default_token_budget } = req.body;

    if (routing) {
      const validCapabilities = ['extract', 'reason', 'generate', 'classify'];
      for (const key of Object.keys(routing)) {
        if (!validCapabilities.includes(key)) {
          res.status(400).json({ error: `Invalid capability '${key}'. Must be one of: ${validCapabilities.join(', ')}` });
          return;
        }
        if (!routing[key].includes('/')) {
          res.status(400).json({ error: `Invalid routing format for '${key}': must be 'provider/model'` });
          return;
        }
      }
    }

    const existing = await query(
      'SELECT id FROM llm_configs WHERE workspace_id = $1',
      [workspaceId]
    );

    if (existing.rows.length === 0) {
      await query(
        `INSERT INTO llm_configs (workspace_id, providers, routing, default_token_budget)
         VALUES ($1, $2, $3, $4)`,
        [
          workspaceId,
          JSON.stringify(providers || {}),
          JSON.stringify(routing || {
            extract: 'fireworks/deepseek-v3',
            reason: 'anthropic/claude-sonnet-4-20250514',
            generate: 'anthropic/claude-sonnet-4-20250514',
            classify: 'fireworks/deepseek-v3',
          }),
          default_token_budget || 50000,
        ]
      );
    } else {
      await updateLLMConfig(workspaceId, { routing, providers, default_token_budget });
    }

    clearConfigCache(workspaceId);

    const config = await getLLMConfig(workspaceId);
    res.json({ status: 'updated', config });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[LLM Config] POST error:', msg);
    res.status(500).json({ error: msg });
  }
});

router.get('/:id/llm/usage', async (req: Request, res: Response) => {
  try {
    const usage = await getLLMUsage(req.params.id);
    res.json(usage);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[LLM Usage] GET error:', msg);
    res.status(500).json({ error: msg });
  }
});

export default router;
