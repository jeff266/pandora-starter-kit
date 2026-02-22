/**
 * Agent Feedback API Routes
 *
 * Endpoints for submitting and managing feedback on agent-generated briefings.
 */

import express from 'express';
import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';
import { processFeedback, getFeedbackSummary, type AgentFeedback } from '../agents/feedback-processor.js';
import { getTuningPairs, removeTuningPair } from '../agents/tuning.js';

const router = express.Router();
const logger = createLogger('AgentFeedbackRoutes');

/**
 * POST /:workspaceId/agents/:agentId/feedback
 * Submit feedback on an agent generation
 */
router.post('/:workspaceId/agents/:agentId/feedback', async (req, res) => {
  try {
    const { workspaceId, agentId } = req.params;
    const {
      generation_id,
      feedback_type,
      section_id,
      signal,
      rating,
      comment,
    } = req.body;

    // Validate required fields
    if (!generation_id || !feedback_type || !signal) {
      return res.status(400).json({ error: 'Missing required fields: generation_id, feedback_type, signal' });
    }

    // Validate feedback_type
    if (!['section', 'editorial', 'overall'].includes(feedback_type)) {
      return res.status(400).json({ error: 'Invalid feedback_type. Must be: section, editorial, or overall' });
    }

    // Validate section_id for section feedback
    if (feedback_type === 'section' && !section_id) {
      return res.status(400).json({ error: 'section_id required for section feedback' });
    }

    // Validate rating if provided
    if (rating !== undefined && (rating < 1 || rating > 5)) {
      return res.status(400).json({ error: 'rating must be between 1 and 5' });
    }

    // Insert feedback
    const result = await query(
      `INSERT INTO agent_feedback
        (workspace_id, agent_id, generation_id, feedback_type, section_id, signal, rating, comment)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [workspaceId, agentId, generation_id, feedback_type, section_id, signal, rating, comment]
    );

    const feedback = result.rows[0] as AgentFeedback;

    logger.info('[AgentFeedback] Feedback submitted', {
      workspace_id: workspaceId,
      agent_id: agentId,
      feedback_id: feedback.id,
      signal,
      section_id,
    });

    // Process feedback immediately (convert to tuning pair if applicable)
    await processFeedback(feedback);

    // Fetch updated feedback state
    const updatedFeedback = await query(
      'SELECT * FROM agent_feedback WHERE id = $1',
      [feedback.id]
    );

    res.status(201).json({
      feedback_id: feedback.id,
      processed: updatedFeedback.rows[0].processed,
      tuning_key: updatedFeedback.rows[0].tuning_key,
    });
  } catch (err) {
    logger.error('[AgentFeedback] Failed to submit feedback', err as Error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /:workspaceId/agents/:agentId/feedback
 * List feedback history for an agent
 */
router.get('/:workspaceId/agents/:agentId/feedback', async (req, res) => {
  try {
    const { workspaceId, agentId } = req.params;
    const { generation_id, limit = '20' } = req.query;

    let queryText = `
      SELECT *
      FROM agent_feedback
      WHERE workspace_id = $1 AND agent_id = $2
    `;
    const params: any[] = [workspaceId, agentId];

    if (generation_id) {
      params.push(generation_id);
      queryText += ` AND generation_id = $${params.length}`;
    }

    queryText += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(Math.min(parseInt(limit as string, 10), 100));

    const result = await query(queryText, params);

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) as total
       FROM agent_feedback
       WHERE workspace_id = $1 AND agent_id = $2${generation_id ? ' AND generation_id = $3' : ''}`,
      generation_id ? [workspaceId, agentId, generation_id] : [workspaceId, agentId]
    );

    res.json({
      feedback: result.rows,
      total: parseInt(countResult.rows[0].total, 10),
    });
  } catch (err) {
    logger.error('[AgentFeedback] Failed to fetch feedback history', err as Error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /:workspaceId/agents/:agentId/tuning
 * List active tuning pairs for an agent
 */
router.get('/:workspaceId/agents/:agentId/tuning', async (req, res) => {
  try {
    const { workspaceId, agentId } = req.params;

    const tuningPairs = await getTuningPairs(agentId, workspaceId);

    res.json({
      tuning_pairs: tuningPairs.map(pair => ({
        key: `${agentId}:${pair.key}`,
        instruction: pair.value?.instruction || JSON.stringify(pair.value),
        confidence: pair.confidence,
        source: pair.source,
        created_at: pair.value?.created_at,
        feedback_id: pair.value?.feedback_id,
      })),
      count: tuningPairs.length,
      cap: 15,
    });
  } catch (err) {
    logger.error('[AgentFeedback] Failed to fetch tuning pairs', err as Error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /:workspaceId/agents/:agentId/tuning/:key
 * Remove a specific tuning pair
 */
router.delete('/:workspaceId/agents/:agentId/tuning/:key', async (req, res) => {
  try {
    const { workspaceId, agentId, key } = req.params;

    // Remove the agent prefix if present (key might be sent with or without it)
    const shortKey = key.startsWith(`${agentId}:`) ? key.replace(`${agentId}:`, '') : key;

    await removeTuningPair(agentId, workspaceId, shortKey);

    logger.info('[AgentFeedback] Tuning pair removed', {
      workspace_id: workspaceId,
      agent_id: agentId,
      key: shortKey,
    });

    // Optionally update the original feedback to clear tuning_key
    await query(
      `UPDATE agent_feedback
       SET tuning_key = NULL, processed = false
       WHERE workspace_id = $1 AND agent_id = $2 AND tuning_key = $3`,
      [workspaceId, agentId, `${agentId}:${shortKey}`]
    );

    res.json({ deleted: true, key: shortKey });
  } catch (err) {
    logger.error('[AgentFeedback] Failed to delete tuning pair', err as Error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /:workspaceId/generations/:generationId/feedback-summary
 * Quick summary of feedback state for a specific generation (for viewer UI)
 */
router.get('/:workspaceId/generations/:generationId/feedback-summary', async (req, res) => {
  try {
    const { generationId } = req.params;

    const summary = await getFeedbackSummary(generationId);

    res.json(summary);
  } catch (err) {
    logger.error('[AgentFeedback] Failed to fetch feedback summary', err as Error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
