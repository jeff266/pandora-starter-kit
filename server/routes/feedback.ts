import { Router, type Request, type Response } from 'express';
import { query } from '../db.js';
import {
  createAnnotation,
  getActiveAnnotations,
  getAnnotationsForWorkspace,
  resolveAnnotation,
} from '../feedback/annotations.js';
import {
  recordFeedbackSignal,
  getFeedbackSummary,
} from '../feedback/signals.js';
import {
  checkDismissVelocity,
  checkCategoryDismissals,
  boostConfigConfidence,
} from '../feedback/dismiss-velocity.js';
import { getSuggestions, resolveSuggestion } from '../config/config-suggestions.js';

const router = Router();

router.post('/:workspaceId/feedback', async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.params;
    const { targetType, targetId, signalType, metadata, source } = req.body;

    if (!targetType || !targetId || !signalType) {
      res.status(400).json({ error: 'targetType, targetId, and signalType are required' });
      return;
    }

    const signal = await recordFeedbackSignal(workspaceId, {
      targetType,
      targetId,
      signalType,
      metadata: metadata || {},
      source: source || 'web',
      createdBy: (req as any).user?.id || undefined,
    });

    if (signalType === 'dismiss' && targetType === 'finding') {
      const userId = (req as any).user?.id;
      if (userId) {
        checkDismissVelocity(workspaceId, userId).catch(err =>
          console.error('[feedback] dismiss velocity check failed:', err)
        );
      }
    }

    if (signalType === 'confirm' && targetId) {
      boostConfigConfidence(workspaceId, [
        { entityType: targetType, entityId: targetId },
      ]).catch(err =>
        console.error('[feedback] boost confidence failed:', err)
      );
    }

    res.json({ ok: true, signal });
  } catch (err) {
    console.error('[feedback] Error recording signal:', err);
    res.status(500).json({ error: 'Failed to record feedback signal' });
  }
});

router.post('/:workspaceId/annotations', async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.params;
    const {
      entityType, entityId, entityName, annotationType, content, source,
      sourceThreadId, referencesFindingId, referencesSkillRunId,
    } = req.body;

    if (!entityType || !annotationType || !content || !source) {
      res.status(400).json({ error: 'entityType, annotationType, content, and source are required' });
      return;
    }

    const result = await createAnnotation(workspaceId, {
      entityType,
      entityId,
      entityName,
      annotationType,
      content,
      source,
      sourceThreadId,
      createdBy: (req as any).user?.id || undefined,
      referencesFindingId,
      referencesSkillRunId,
    });

    res.json({ id: result.id, expiresAt: result.expiresAt });
  } catch (err) {
    console.error('[feedback] Error creating annotation:', err);
    res.status(500).json({ error: 'Failed to create annotation' });
  }
});

router.get('/:workspaceId/annotations', async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.params;
    const { entityType, entityId, annotationType, active, limit, offset } = req.query;

    const result = await getAnnotationsForWorkspace(workspaceId, {
      entityType: entityType as string | undefined,
      entityId: entityId as string | undefined,
      annotationType: annotationType as string | undefined,
      active: active !== 'false',
      limit: limit ? parseInt(limit as string, 10) : 50,
      offset: offset ? parseInt(offset as string, 10) : 0,
    });

    res.json({ annotations: result.rows, total: result.total });
  } catch (err) {
    console.error('[feedback] Error listing annotations:', err);
    res.status(500).json({ error: 'Failed to list annotations' });
  }
});

router.get('/:workspaceId/annotations/entity/:entityType/:entityId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId, entityType, entityId } = req.params;
    const annotations = await getActiveAnnotations(workspaceId, entityType, entityId);
    res.json({ annotations });
  } catch (err) {
    console.error('[feedback] Error getting entity annotations:', err);
    res.status(500).json({ error: 'Failed to get entity annotations' });
  }
});

router.get('/:workspaceId/feedback/summary', async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.params;
    const sinceParam = req.query.since as string | undefined;
    const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const summary = await getFeedbackSummary(workspaceId, since);
    res.json(summary);
  } catch (err) {
    console.error('[feedback] Error getting feedback summary:', err);
    res.status(500).json({ error: 'Failed to get feedback summary' });
  }
});

router.get('/:workspaceId/learning/summary', async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.params;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      activeAnnotationsResult,
      annotationsByTypeResult,
      annotationsByEntityResult,
      expiringResult,
      recentAnnotationsResult,
      feedbackSummary,
      allSuggestions,
    ] = await Promise.all([
      query<{ cnt: string }>(
        `SELECT COUNT(*) as cnt FROM workspace_annotations
         WHERE workspace_id = $1 AND resolved_at IS NULL
           AND (expires_at IS NULL OR expires_at > NOW())`,
        [workspaceId]
      ),
      query<{ annotation_type: string; cnt: string }>(
        `SELECT annotation_type, COUNT(*) as cnt FROM workspace_annotations
         WHERE workspace_id = $1 AND resolved_at IS NULL
           AND (expires_at IS NULL OR expires_at > NOW())
         GROUP BY annotation_type`,
        [workspaceId]
      ),
      query<{ entity_type: string; cnt: string }>(
        `SELECT entity_type, COUNT(*) as cnt FROM workspace_annotations
         WHERE workspace_id = $1 AND resolved_at IS NULL
           AND (expires_at IS NULL OR expires_at > NOW())
         GROUP BY entity_type`,
        [workspaceId]
      ),
      query<{ cnt: string }>(
        `SELECT COUNT(*) as cnt FROM workspace_annotations
         WHERE workspace_id = $1 AND resolved_at IS NULL
           AND expires_at IS NOT NULL
           AND expires_at <= NOW() + INTERVAL '30 days'
           AND expires_at > NOW()`,
        [workspaceId]
      ),
      query<any>(
        `SELECT * FROM workspace_annotations
         WHERE workspace_id = $1 AND created_at >= $2
         ORDER BY created_at DESC LIMIT 10`,
        [workspaceId, thirtyDaysAgo.toISOString()]
      ),
      getFeedbackSummary(workspaceId, thirtyDaysAgo),
      getSuggestions(workspaceId, 'all'),
    ]);

    const byType: Record<string, number> = {};
    for (const r of annotationsByTypeResult.rows) {
      byType[r.annotation_type] = parseInt(r.cnt, 10);
    }

    const byEntity: Record<string, number> = {};
    for (const r of annotationsByEntityResult.rows) {
      byEntity[r.entity_type] = parseInt(r.cnt, 10);
    }

    const pending = allSuggestions.filter(s => s.status === 'pending');
    const accepted = allSuggestions.filter(s => s.status === 'accepted');
    const dismissed = allSuggestions.filter(s => s.status === 'dismissed');
    const fromFeedback = allSuggestions.filter(s =>
      s.source_skill === 'feedback-velocity' || s.source_skill === 'feedback-category-analysis'
    );
    const fromSkills = allSuggestions.filter(s =>
      s.source_skill !== 'feedback-velocity' && s.source_skill !== 'feedback-category-analysis'
    );

    const totalSignals = Object.values(feedbackSummary.totals).reduce((a, b) => a + b, 0);
    const activeCount = parseInt(activeAnnotationsResult.rows[0]?.cnt || '0', 10);
    const learningRate = totalSignals > 0 ? Math.min(1, activeCount / Math.max(1, totalSignals)) : 0;

    res.json({
      annotations: {
        active: activeCount,
        byType,
        byEntity,
        expiringIn30Days: parseInt(expiringResult.rows[0]?.cnt || '0', 10),
        recentlyAdded: recentAnnotationsResult.rows,
      },
      feedbackSignals: {
        last30Days: {
          thumbsUp: feedbackSummary.totals['thumbs_up'] || 0,
          thumbsDown: feedbackSummary.totals['thumbs_down'] || 0,
          dismiss: feedbackSummary.totals['dismiss'] || 0,
          confirm: feedbackSummary.totals['confirm'] || 0,
          correct: feedbackSummary.totals['correct'] || 0,
          total: totalSignals,
        },
        byWeek: feedbackSummary.byWeek,
      },
      configSuggestions: {
        pending: pending.length,
        accepted: accepted.length,
        dismissed: dismissed.length,
        fromFeedback: fromFeedback.length,
        fromSkills: fromSkills.length,
        items: pending.slice(0, 20),
      },
      health: {
        learningRate: Math.round(learningRate * 100) / 100,
        annotationCoverage: activeCount,
        configConfidence: accepted.length > 0
          ? Math.round((accepted.length / Math.max(1, allSuggestions.length)) * 100) / 100
          : 0,
      },
    });
  } catch (err) {
    console.error('[feedback] Error getting learning summary:', err);
    res.status(500).json({ error: 'Failed to get learning summary' });
  }
});

router.get('/:workspaceId/config/suggestions', async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId } = req.params;
    const status = (req.query.status as string) || 'pending';
    const suggestions = await getSuggestions(workspaceId, status as any);
    res.json({ suggestions });
  } catch (err) {
    console.error('[feedback] Error getting config suggestions:', err);
    res.status(500).json({ error: 'Failed to get config suggestions' });
  }
});

router.post('/:workspaceId/config/suggestions/:suggestionId/accept', async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId, suggestionId } = req.params;
    const ok = await resolveSuggestion(workspaceId, suggestionId, 'accepted');
    if (!ok) {
      res.status(404).json({ error: 'Suggestion not found' });
      return;
    }
    res.json({ ok: true, status: 'accepted' });
  } catch (err) {
    console.error('[feedback] Error accepting suggestion:', err);
    res.status(500).json({ error: 'Failed to accept suggestion' });
  }
});

router.post('/:workspaceId/config/suggestions/:suggestionId/dismiss', async (req: Request, res: Response): Promise<void> => {
  try {
    const { workspaceId, suggestionId } = req.params;
    const ok = await resolveSuggestion(workspaceId, suggestionId, 'dismissed');
    if (!ok) {
      res.status(404).json({ error: 'Suggestion not found' });
      return;
    }
    res.json({ ok: true, status: 'dismissed' });
  } catch (err) {
    console.error('[feedback] Error dismissing suggestion:', err);
    res.status(500).json({ error: 'Failed to dismiss suggestion' });
  }
});

export default router;
