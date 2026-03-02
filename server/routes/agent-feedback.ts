/**
 * Agent Feedback API Routes
 *
 * Endpoints for submitting and managing feedback on agent-generated briefings.
 */

import express from 'express';
import { randomUUID } from 'crypto';
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

/**
 * POST /:workspaceId/agents/pandora_chat/feedback/review
 * LLM reviews recent feedback patterns and generates self-heal suggestions
 */
router.post('/:workspaceId/agents/pandora_chat/feedback/review', async (req, res) => {
  try {
    const { workspaceId } = req.params;

    const agentRow = await query(
      `SELECT id FROM agents WHERE workspace_id = $1 AND template_id = 'pandora_chat' LIMIT 1`,
      [workspaceId]
    );
    if (agentRow.rows.length === 0) {
      res.json({ suggestions: [], message: 'No feedback data yet — suggestions will appear after users interact with the assistant.' });
      return;
    }
    const agentId = agentRow.rows[0].id;

    const feedbackResult = await query(
      `SELECT signal, comment, rating, created_at, tuning_key
       FROM agent_feedback
       WHERE workspace_id = $1 AND agent_id = $2
       AND created_at > NOW() - INTERVAL '30 days'
       ORDER BY created_at DESC
       LIMIT 50`,
      [workspaceId, agentId]
    );

    const records = feedbackResult.rows;

    if (records.length === 0) {
      res.json({ suggestions: [], message: 'No feedback data yet — suggestions will appear after users interact with the assistant.' });
      return;
    }

    const thumbsDown = records.filter((r: any) => r.signal === 'thumbs_down');
    const repeated = records.filter((r: any) => r.signal === 'repeated_question');
    const thumbsUp = records.filter((r: any) => r.signal === 'thumbs_up');

    const summary = [
      `Total feedback records: ${records.length}`,
      `Thumbs up: ${thumbsUp.length}`,
      `Thumbs down: ${thumbsDown.length} (${thumbsDown.map((r: any) => r.comment || 'no comment').join(' | ')})`,
      `Repeated questions: ${repeated.length} (${repeated.map((r: any) => (r.comment || '').substring(0, 100)).join(' | ')})`,
    ].join('\n');

    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `You are reviewing user feedback for Pandora, a RevOps assistant that answers sales pipeline questions.

Here is a summary of feedback patterns from the last 30 days:
${summary}

For each clear pattern of dissatisfaction (thumbs-down with comments, or repeated questions), suggest ONE specific improvement from these categories:
1. "resolver_pattern" — a new question pattern the resolver should handle (regex + response shape)
2. "context_addition" — a fact or rule to inject into the LLM system context
3. "named_filter" — a common deal/rep/segment filter to pre-compute

Only suggest improvements where you see a clear signal. Be specific and actionable.

Output as JSON with this exact structure:
{"suggestions": [{"type": "resolver_pattern|context_addition|named_filter", "description": "What the problem is", "implementation_hint": "Specific change to make", "confidence": 0.0-1.0}]}`,
      }],
    });

    const content = response.content[0];
    let suggestions: any[] = [];
    if (content.type === 'text') {
      try {
        const parsed = JSON.parse(content.text.replace(/```json\n?|\n?```/g, '').trim());
        suggestions = parsed.suggestions ?? [];
      } catch {
        suggestions = [{ type: 'context_addition', description: 'Unable to parse suggestions', implementation_hint: content.text.substring(0, 200), confidence: 0.1 }];
      }
    }

    for (const s of suggestions) {
      await query(
        `INSERT INTO agent_feedback
          (workspace_id, agent_id, generation_id, feedback_type, signal, rating, comment, tuning_key)
         VALUES ($1, $2, $3, 'overall', 'self_heal_suggestion', NULL, $4, 'self_heal_suggestion')`,
        [workspaceId, agentId, randomUUID(), JSON.stringify(s)]
      ).catch(() => null);
    }

    res.json({
      suggestions,
      feedback_analyzed: records.length,
      thumbs_up: thumbsUp.length,
      thumbs_down: thumbsDown.length,
      repeated_questions: repeated.length,
    });
  } catch (err) {
    logger.error('[AgentFeedback] Self-heal review failed', err as Error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
