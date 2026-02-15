import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { query } from '../db.js';
import { runScopedAnalysis, type AnalysisRequest } from '../analysis/scoped-analysis.js';

const router = Router();

const analysisLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.params.workspaceId,
  message: { error: 'Analysis rate limit exceeded. Try again in a minute.' },
});

const VALID_SCOPE_TYPES = ['deal', 'account', 'pipeline', 'rep', 'workspace'];

router.post('/:workspaceId/analyze', analysisLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.params;
    const { question, scope, format, max_tokens } = req.body;

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      res.status(400).json({ error: 'question is required and must be a non-empty string' });
      return;
    }

    if (!scope || !scope.type || !VALID_SCOPE_TYPES.includes(scope.type)) {
      res.status(400).json({ error: `scope.type is required and must be one of: ${VALID_SCOPE_TYPES.join(', ')}` });
      return;
    }

    if (scope.type === 'deal' && !scope.entity_id) {
      res.status(400).json({ error: 'scope.entity_id is required for deal scope' });
      return;
    }

    if (scope.type === 'account' && !scope.entity_id) {
      res.status(400).json({ error: 'scope.entity_id is required for account scope' });
      return;
    }

    if (scope.type === 'rep' && !scope.rep_email) {
      res.status(400).json({ error: 'scope.rep_email is required for rep scope' });
      return;
    }

    const analysisRequest: AnalysisRequest = {
      workspace_id: workspaceId,
      question: question.trim(),
      scope,
      format: format || 'text',
      max_tokens: max_tokens ? Math.min(Math.max(parseInt(max_tokens, 10) || 2000, 100), 4000) : 2000,
    };

    const result = await runScopedAnalysis(analysisRequest);

    try {
      await query(
        `INSERT INTO token_usage (workspace_id, phase, step_name, provider, model, input_tokens, output_tokens, total_tokens, estimated_cost_usd, prompt_chars, response_chars, truncated, latency_ms)
         VALUES ($1, 'analysis', 'scoped-analysis', 'anthropic', 'claude-sonnet', $2, $3, $4, $5, 0, $6, false, $7)`,
        [
          workspaceId,
          Math.round(result.tokens_used * 0.7),
          Math.round(result.tokens_used * 0.3),
          result.tokens_used,
          result.tokens_used * 0.000015,
          result.answer.length,
          result.latency_ms,
        ]
      );
    } catch (logErr) {
      console.warn('[analysis] Failed to log token usage:', logErr instanceof Error ? logErr.message : logErr);
    }

    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[analysis] Error:', msg);

    if (msg.includes('not found')) {
      res.status(404).json({ error: msg });
      return;
    }

    res.status(500).json({ error: msg });
  }
});

export default router;
