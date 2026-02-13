/**
 * Deal Insights API Endpoints
 *
 * Manages workspace insight configuration and CRM field mappings
 *
 * Spec: PANDORA_DEAL_INSIGHTS_SPEC.md (Part 3)
 */

import express from 'express';
import { query } from '../db.js';
import { detectFramework, getFrameworkInsightTypes, getDefaultInsightTypes } from '../analysis/framework-detector.js';
import { extractInsightsFromConversations } from '../analysis/deal-insights-extractor.js';
import { createLogger } from '../utils/logger.js';

const router = express.Router();
const logger = createLogger('DealInsightsAPI');

// ============================================================================
// Get Insight Configuration
// ============================================================================

router.get('/api/workspaces/:workspaceId/insights/config', async (req, res) => {
  try {
    const { workspaceId } = req.params;

    const result = await query<{ definitions: any }>(
      `SELECT definitions FROM context_layer
       WHERE workspace_id = $1 LIMIT 1`,
      [workspaceId]
    );

    if (result.rows.length === 0) {
      // No config yet - return defaults
      return res.json({
        framework: 'none',
        active_insights: getDefaultInsightTypes(),
        crm_field_mappings: [],
        min_confidence: 0.6,
        extract_from_summaries: true,
        extract_from_transcripts: true,
      });
    }

    const definitions = result.rows[0].definitions || {};
    const insightConfig = definitions.insight_config || {
      framework: 'none',
      active_insights: getDefaultInsightTypes(),
      crm_field_mappings: [],
      min_confidence: 0.6,
      extract_from_summaries: true,
      extract_from_transcripts: true,
    };

    res.json(insightConfig);
  } catch (error) {
    logger.error('Failed to get insight config', { error });
    res.status(500).json({ error: 'Failed to get insight config' });
  }
});

// ============================================================================
// Update Insight Configuration
// ============================================================================

router.put('/api/workspaces/:workspaceId/insights/config', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const config = req.body;

    // Validate
    if (!config.framework || !Array.isArray(config.active_insights)) {
      return res.status(400).json({ error: 'Invalid config format' });
    }

    // Load existing context_layer
    const existing = await query<{ id: string; definitions: any }>(
      `SELECT id, definitions FROM context_layer
       WHERE workspace_id = $1 LIMIT 1`,
      [workspaceId]
    );

    let definitions = {};
    let contextLayerId;

    if (existing.rows.length > 0) {
      definitions = existing.rows[0].definitions || {};
      contextLayerId = existing.rows[0].id;
    }

    // Update insight_config
    definitions = {
      ...definitions,
      insight_config: {
        framework: config.framework,
        active_insights: config.active_insights,
        crm_field_mappings: config.crm_field_mappings || [],
        min_confidence: config.min_confidence || 0.6,
        extract_from_summaries: config.extract_from_summaries ?? true,
        extract_from_transcripts: config.extract_from_transcripts ?? true,
      },
    };

    if (contextLayerId) {
      // Update existing
      await query(
        `UPDATE context_layer
         SET definitions = $1, updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(definitions), contextLayerId]
      );
    } else {
      // Insert new
      await query(
        `INSERT INTO context_layer (workspace_id, definitions)
         VALUES ($1, $2)`,
        [workspaceId, JSON.stringify(definitions)]
      );
    }

    logger.info('Updated insight config', {
      workspaceId,
      framework: config.framework,
      activeInsights: config.active_insights.length,
    });

    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to update insight config', { error });
    res.status(500).json({ error: 'Failed to update insight config' });
  }
});

// ============================================================================
// Auto-Detect Framework
// ============================================================================

router.post('/api/workspaces/:workspaceId/insights/config/auto-detect', async (req, res) => {
  try {
    const { workspaceId } = req.params;

    // Get custom fields from discovery result
    const discoveryResult = await query<{ output: any }>(
      `SELECT output FROM skill_runs
       WHERE workspace_id = $1
         AND skill_id = 'custom-field-discovery'
         AND status = 'completed'
       ORDER BY completed_at DESC
       LIMIT 1`,
      [workspaceId]
    );

    if (discoveryResult.rows.length === 0) {
      return res.status(404).json({
        error: 'No custom field discovery results found. Run Custom Field Discovery first.',
      });
    }

    const output = discoveryResult.rows[0].output;
    const fields = output.discoveredFields || [];

    // Convert to format expected by detector
    const fieldsForDetection = fields.map((f: any) => ({
      name: f.fieldKey,
      label: f.fieldKey,
      fill_rate: f.fillRate || 0,
      object_type: f.entityType,
    }));

    const detectionResult = detectFramework(fieldsForDetection);

    // If framework detected, suggest config
    let suggestedConfig = null;

    if (detectionResult.detected_framework) {
      const frameworkInsights = getFrameworkInsightTypes(detectionResult.detected_framework);

      suggestedConfig = {
        framework: detectionResult.detected_framework,
        active_insights: frameworkInsights,
        crm_field_mappings: detectionResult.matched_fields.map(f => ({
          insight_type: f.insight_type,
          crm_object: f.object_type,
          crm_field_name: f.crm_field_name,
          crm_field_type: 'text', // Default
          source: 'auto_detected',
        })),
        min_confidence: 0.6,
        extract_from_summaries: true,
        extract_from_transcripts: true,
      };
    }

    res.json({
      detection: detectionResult,
      suggested_config: suggestedConfig,
    });
  } catch (error) {
    logger.error('Failed to auto-detect framework', { error });
    res.status(500).json({ error: 'Failed to auto-detect framework' });
  }
});

// ============================================================================
// Get Available Fields for Mapping
// ============================================================================

router.get('/api/workspaces/:workspaceId/insights/config/available-fields', async (req, res) => {
  try {
    const { workspaceId } = req.params;

    // Get custom fields from discovery result
    const discoveryResult = await query<{ output: any }>(
      `SELECT output FROM skill_runs
       WHERE workspace_id = $1
         AND skill_id = 'custom-field-discovery'
         AND status = 'completed'
       ORDER BY completed_at DESC
       LIMIT 1`,
      [workspaceId]
    );

    if (discoveryResult.rows.length === 0) {
      return res.json({ crm_fields: [] });
    }

    const output = discoveryResult.rows[0].output;
    const fields = output.discoveredFields || [];

    // Only return opportunity/deal fields
    const crmFields = fields
      .filter((f: any) => f.entityType === 'deal' || f.entityType === 'opportunity')
      .map((f: any) => ({
        name: f.fieldKey,
        label: f.fieldKey,
        fill_rate: f.fillRate || 0,
        object_type: f.entityType,
      }));

    res.json({ crm_fields: crmFields });
  } catch (error) {
    logger.error('Failed to get available fields', { error });
    res.status(500).json({ error: 'Failed to get available fields' });
  }
});

// ============================================================================
// Trigger Manual Extraction
// ============================================================================

router.post('/api/workspaces/:workspaceId/insights/extract', async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const { conversation_ids, batch_size } = req.body;

    const result = await extractInsightsFromConversations(workspaceId, {
      batchSize: batch_size || 20,
      conversationIds: conversation_ids,
    });

    res.json(result);
  } catch (error) {
    logger.error('Failed to extract insights', { error });
    res.status(500).json({ error: 'Failed to extract insights' });
  }
});

export default router;
