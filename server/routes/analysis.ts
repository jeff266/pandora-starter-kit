import { Router, type Request, type Response } from 'express';
import { query } from '../db.js';
import {
  runScopedAnalysis,
  analyzeQuestion,
  getAnalysisSuggestions,
  type AnalysisRequest,
} from '../analysis/scoped-analysis.js';

const router = Router();

const VALID_SCOPE_TYPES = ['deal', 'account', 'pipeline', 'rep', 'workspace'];
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

const rateLimitCounters = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(workspaceId: string): boolean {
  const now = Date.now();
  const entry = rateLimitCounters.get(workspaceId);

  if (!entry || now >= entry.resetAt) {
    rateLimitCounters.set(workspaceId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }

  entry.count++;
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitCounters) {
    if (now >= entry.resetAt) {
      rateLimitCounters.delete(key);
    }
  }
}, 5 * 60_000);

router.post('/:workspaceId/analyze', async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.params;

    if (!checkRateLimit(workspaceId)) {
      res.status(429).json({ error: 'Rate limit exceeded. Maximum 10 analysis requests per minute.' });
      return;
    }

    const { question, scope, format, max_tokens } = req.body;

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      res.status(400).json({ error: 'question is required and must be a non-empty string' });
      return;
    }

    if (question.trim().length > 500) {
      res.status(400).json({ error: 'question must be 500 characters or fewer' });
      return;
    }

    if (!scope || !scope.type || !VALID_SCOPE_TYPES.includes(scope.type)) {
      res.status(400).json({ error: `scope.type is required and must be one of: ${VALID_SCOPE_TYPES.join(', ')}` });
      return;
    }

    if ((scope.type === 'deal' || scope.type === 'account') && !scope.entity_id) {
      res.status(400).json({ error: `scope.entity_id is required for ${scope.type} scope` });
      return;
    }

    if (scope.type === 'rep' && !scope.rep_email) {
      res.status(400).json({ error: 'scope.rep_email is required for rep scope' });
      return;
    }

    const result = await analyzeQuestion(
      workspaceId,
      question.trim(),
      {
        type: scope.type,
        entityId: scope.entity_id,
        ownerEmail: scope.rep_email,
      }
    );

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

    console.log(`[analysis] ${scope.type}${scope.entity_id ? `:${scope.entity_id.slice(0, 8)}` : ''} answered in ${result.latency_ms}ms (${result.tokens_used} tokens, confidence: ${result.confidence})`);

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

router.post('/:workspaceId/analyze/legacy', async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.params;
    const { question, scope, format, max_tokens } = req.body;

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      res.status(400).json({ error: 'question is required' });
      return;
    }
    if (!scope || !scope.type || !VALID_SCOPE_TYPES.includes(scope.type)) {
      res.status(400).json({ error: `scope.type must be one of: ${VALID_SCOPE_TYPES.join(', ')}` });
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
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('not found')) {
      res.status(404).json({ error: msg });
      return;
    }
    res.status(500).json({ error: msg });
  }
});

router.get('/:workspaceId/analyze/suggestions', async (req: Request, res: Response): Promise<void> => {
  try {
    const scopeParam = (req.query.scope as string) || '';

    if (scopeParam && VALID_SCOPE_TYPES.includes(scopeParam)) {
      res.json({ suggestions: getAnalysisSuggestions(scopeParam) });
      return;
    }

    res.json({
      deal: getAnalysisSuggestions('deal'),
      account: getAnalysisSuggestions('account'),
      pipeline: getAnalysisSuggestions('pipeline'),
      rep: getAnalysisSuggestions('rep'),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[analysis] Suggestions error:', msg);
    res.status(500).json({ error: msg });
  }
});

export default router;
