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
import { requireWorkspaceAccess } from '../middleware/auth.js';

const router = express.Router();
router.use(requireWorkspaceAccess);
const logger = createLogger('DealInsightsAPI');

// ============================================================================
// Get Insight Configuration
// ============================================================================

router.get('/api/workspaces/:workspaceId/insights/config', requirePermission('config.view'), async (req, res) => {
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

router.put('/api/workspaces/:workspaceId/insights/config', requirePermission('config.edit'), async (req, res) => {
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

router.post('/api/workspaces/:workspaceId/insights/config/auto-detect', requirePermission('config.edit'), async (req, res) => {
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

router.get('/api/workspaces/:workspaceId/insights/config/available-fields', requirePermission('config.view'), async (req, res) => {
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

router.post('/api/workspaces/:workspaceId/insights/extract', requirePermission('skills.run_manual'), async (req, res) => {
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

// ============================================================================
// Get Insight Extraction Status
// ============================================================================

router.get('/api/workspaces/:workspaceId/insights/status', requirePermission('data.deals_view'), async (req, res) => {
  try {
    const { workspaceId } = req.params;

    const insightCounts = await query<{
      total_insights: string;
      current_insights: string;
      superseded_insights: string;
    }>(
      `SELECT
        COUNT(*)::text as total_insights,
        COUNT(*) FILTER (WHERE is_current = true)::text as current_insights,
        COUNT(*) FILTER (WHERE is_current = false)::text as superseded_insights
      FROM deal_insights
      WHERE workspace_id = $1`,
      [workspaceId]
    );

    const byType = await query<{ insight_type: string; count: string }>(
      `SELECT insight_type, COUNT(*)::text as count
       FROM deal_insights
       WHERE workspace_id = $1 AND is_current = true
       GROUP BY insight_type
       ORDER BY count DESC`,
      [workspaceId]
    );

    const conversationCounts = await query<{
      conversations_processed: string;
      conversations_pending: string;
    }>(
      `SELECT
        (SELECT COUNT(DISTINCT source_conversation_id)::text FROM deal_insights WHERE workspace_id = $1 AND source_conversation_id IS NOT NULL) as conversations_processed,
        (SELECT COUNT(*)::text FROM conversations c
         WHERE c.workspace_id = $1
           AND c.is_internal = false
           AND c.deal_id IS NOT NULL
           AND c.duration_seconds > 120
           AND NOT EXISTS (SELECT 1 FROM deal_insights di WHERE di.source_conversation_id = c.id)
        ) as conversations_pending`,
      [workspaceId]
    );

    const lastExtraction = await query<{ extracted_at: string }>(
      `SELECT MAX(extracted_at)::text as extracted_at FROM deal_insights WHERE workspace_id = $1`,
      [workspaceId]
    );

    const config = await query<{ definitions: any }>(
      `SELECT definitions FROM context_layer WHERE workspace_id = $1 LIMIT 1`,
      [workspaceId]
    );

    const insightConfig = config.rows[0]?.definitions?.insight_config || {};

    const row = insightCounts.rows[0] || { total_insights: '0', current_insights: '0', superseded_insights: '0' };
    const convRow = conversationCounts.rows[0] || { conversations_processed: '0', conversations_pending: '0' };

    const byTypeMap: Record<string, number> = {};
    for (const r of byType.rows) {
      byTypeMap[r.insight_type] = parseInt(r.count, 10);
    }

    res.json({
      total_insights: parseInt(row.total_insights, 10),
      current_insights: parseInt(row.current_insights, 10),
      superseded_insights: parseInt(row.superseded_insights, 10),
      by_type: byTypeMap,
      conversations_processed: parseInt(convRow.conversations_processed, 10),
      conversations_pending: parseInt(convRow.conversations_pending, 10),
      last_extraction_at: lastExtraction.rows[0]?.extracted_at || null,
      config: {
        framework: insightConfig.framework || 'none',
        active_types: (insightConfig.active_insights || []).filter((i: any) => i.enabled).map((i: any) => i.insight_type),
        min_confidence: insightConfig.min_confidence || 0.6,
      },
    });
  } catch (error) {
    logger.error('Failed to get insights status', { error });
    res.status(500).json({ error: 'Failed to get insights status' });
  }
});

// ============================================================================
// Get Current Insights for a Deal
// ============================================================================

router.get('/api/workspaces/:workspaceId/deals/:dealId/insights', requirePermission('data.deals_view'), async (req, res) => {
  try {
    const { workspaceId, dealId } = req.params;

    const result = await query<{
      insight_type: string;
      insight_key: string;
      value: string;
      confidence: number;
      source_quote: string | null;
      extracted_at: string;
      source_conversation_id: string | null;
    }>(
      `SELECT insight_type, insight_key, value, confidence,
              source_quote, extracted_at::text as extracted_at, source_conversation_id
       FROM deal_insights
       WHERE workspace_id = $1 AND deal_id = $2 AND is_current = true
       ORDER BY insight_type`,
      [workspaceId, dealId]
    );

    res.json({ deal_id: dealId, insights: result.rows });
  } catch (error) {
    logger.error('Failed to get deal insights', { error });
    res.status(500).json({ error: 'Failed to get deal insights' });
  }
});

// ============================================================================
// Get Full Insight History for a Deal
// ============================================================================

router.get('/api/workspaces/:workspaceId/deals/:dealId/insights/history', requirePermission('data.deals_view'), async (req, res) => {
  try {
    const { workspaceId, dealId } = req.params;

    const result = await query<{
      id: string;
      insight_type: string;
      insight_key: string;
      value: string;
      confidence: number;
      source_quote: string | null;
      extracted_at: string;
      is_current: boolean;
      superseded_by: string | null;
      source_conversation_id: string | null;
      source_call_title: string | null;
    }>(
      `SELECT di.id, di.insight_type, di.insight_key, di.value, di.confidence,
              di.source_quote, di.extracted_at::text as extracted_at,
              di.is_current, di.superseded_by, di.source_conversation_id,
              c.title as source_call_title
       FROM deal_insights di
       LEFT JOIN conversations c ON c.id = di.source_conversation_id
       WHERE di.workspace_id = $1 AND di.deal_id = $2
       ORDER BY di.insight_type, di.extracted_at ASC`,
      [workspaceId, dealId]
    );

    res.json({ deal_id: dealId, history: result.rows });
  } catch (error) {
    logger.error('Failed to get deal insights history', { error });
    res.status(500).json({ error: 'Failed to get deal insights history' });
  }
});

export default router;
