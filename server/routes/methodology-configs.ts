/**
 * Methodology Configs API Routes
 *
 * CRUD operations for workspace methodology configurations
 * with versioning, diff, preview, and system defaults
 */

import { Router } from 'express';
import { query } from '../db.js';
import { requireWorkspaceAccess } from '../middleware/auth.js';
import { getMethodologyConfigResolver } from '../methodology/config-resolver.js';
import { ALL_FRAMEWORKS } from '../config/methodology-frameworks.js';
import type { MethodologyConfig } from '../methodology/config-resolver.js';
import crypto from 'crypto';

const router = Router();

// All routes require workspace access
router.use(requireWorkspaceAccess);

/**
 * GET /methodology-configs - List all configs for workspace
 */
router.get('/', async (req, res) => {
  try {
    const workspaceId = req.workspaceId!;
    const resolver = getMethodologyConfigResolver();
    const configs = await resolver.listConfigs(workspaceId);

    res.json({ configs });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /methodology-configs - Create new config
 */
router.post('/', async (req, res) => {
  try {
    const workspaceId = req.workspaceId!;
    const userId = req.user?.id;

    const {
      scope_type = 'workspace',
      scope_segment,
      scope_product,
      base_methodology,
      display_name,
      config = {}
    } = req.body;

    if (!base_methodology) {
      return res.status(400).json({ error: 'base_methodology is required' });
    }

    // Validate framework exists
    const framework = ALL_FRAMEWORKS.find(f => f.id === base_methodology);
    if (!framework) {
      return res.status(400).json({ error: `Invalid base_methodology: ${base_methodology}` });
    }

    // Insert new config
    const result = await query<MethodologyConfig>(
      `INSERT INTO methodology_configs (
        workspace_id, scope_type, scope_segment, scope_product,
        base_methodology, display_name, config, version, is_current, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 1, true, $8)
      RETURNING *`,
      [
        workspaceId,
        scope_type,
        scope_segment || null,
        scope_product || null,
        base_methodology,
        display_name || null,
        JSON.stringify(config),
        userId || null
      ]
    );

    res.status(201).json({ config: result.rows[0] });
  } catch (error: any) {
    if (error.code === '23505') {
      res.status(409).json({ error: 'A current config already exists for this scope' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

/**
 * GET /methodology-configs/:id - Get config merged with base framework
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const resolver = getMethodologyConfigResolver();
    const mergedConfig = await resolver.getMergedConfig(id);

    res.json({ config: mergedConfig });
  } catch (error: any) {
    if (error.message.includes('not found')) {
      res.status(404).json({ error: error.message });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

/**
 * PATCH /methodology-configs/:id - Update config (creates new version)
 */
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const workspaceId = req.workspaceId!;
    const userId = req.user?.id;

    const { display_name, config } = req.body;

    // Load current config
    const currentResult = await query<MethodologyConfig>(
      `SELECT * FROM methodology_configs WHERE id = $1 AND workspace_id = $2`,
      [id, workspaceId]
    );

    if (currentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Config not found' });
    }

    const current = currentResult.rows[0];

    // Set current version to not current
    await query(
      `UPDATE methodology_configs SET is_current = false WHERE id = $1`,
      [id]
    );

    // Create new version
    const newVersion = current.version + 1;
    const newResult = await query<MethodologyConfig>(
      `INSERT INTO methodology_configs (
        workspace_id, scope_type, scope_segment, scope_product,
        base_methodology, display_name, config, version, is_current,
        parent_version_id, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10)
      RETURNING *`,
      [
        current.workspace_id,
        current.scope_type,
        current.scope_segment,
        current.scope_product,
        current.base_methodology,
        display_name !== undefined ? display_name : current.display_name,
        JSON.stringify(config !== undefined ? config : current.config),
        newVersion,
        current.id,
        userId || null
      ]
    );

    res.json({ config: newResult.rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /methodology-configs/:id - Soft deactivate
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const workspaceId = req.workspaceId!;

    await query(
      `UPDATE methodology_configs SET is_current = false WHERE id = $1 AND workspace_id = $2`,
      [id, workspaceId]
    );

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /methodology-configs/:id/restore - Restore prior version
 */
router.post('/:id/restore', async (req, res) => {
  try {
    const { id } = req.params;
    const workspaceId = req.workspaceId!;
    const userId = req.user?.id;

    // Load version to restore
    const versionResult = await query<MethodologyConfig>(
      `SELECT * FROM methodology_configs WHERE id = $1 AND workspace_id = $2`,
      [id, workspaceId]
    );

    if (versionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Version not found' });
    }

    const versionToRestore = versionResult.rows[0];

    // Find current version
    const currentResult = await query<MethodologyConfig>(
      `SELECT * FROM methodology_configs
       WHERE workspace_id = $1
         AND scope_type = $2
         AND COALESCE(scope_segment, '') = COALESCE($3, '')
         AND COALESCE(scope_product, '') = COALESCE($4, '')
         AND is_current = true`,
      [
        workspaceId,
        versionToRestore.scope_type,
        versionToRestore.scope_segment,
        versionToRestore.scope_product
      ]
    );

    if (currentResult.rows.length > 0) {
      // Set current to not current
      await query(
        `UPDATE methodology_configs SET is_current = false WHERE id = $1`,
        [currentResult.rows[0].id]
      );
    }

    // Create new version with restored content
    const newVersion = currentResult.rows.length > 0 ? currentResult.rows[0].version + 1 : 1;
    const newResult = await query<MethodologyConfig>(
      `INSERT INTO methodology_configs (
        workspace_id, scope_type, scope_segment, scope_product,
        base_methodology, display_name, config, version, is_current,
        parent_version_id, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10)
      RETURNING *`,
      [
        versionToRestore.workspace_id,
        versionToRestore.scope_type,
        versionToRestore.scope_segment,
        versionToRestore.scope_product,
        versionToRestore.base_methodology,
        versionToRestore.display_name,
        JSON.stringify(versionToRestore.config),
        newVersion,
        id, // Parent is the version we're restoring from
        userId || null
      ]
    );

    res.json({ config: newResult.rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /methodology-configs/:id/versions - Version history
 */
router.get('/:id/versions', async (req, res) => {
  try {
    const { id } = req.params;
    const resolver = getMethodologyConfigResolver();
    const versions = await resolver.getVersionHistory(id);

    res.json({ versions });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /methodology-configs/:id/diff - Diff between versions
 */
router.get('/:id/diff', async (req, res) => {
  try {
    const { id } = req.params;
    const { v1, v2 } = req.query;

    if (!v1 || !v2) {
      return res.status(400).json({ error: 'v1 and v2 query params required' });
    }

    const resolver = getMethodologyConfigResolver();
    const versions = await resolver.getVersionHistory(id);

    const version1 = versions.find(v => v.version === parseInt(v1 as string));
    const version2 = versions.find(v => v.version === parseInt(v2 as string));

    if (!version1 || !version2) {
      return res.status(404).json({ error: 'Version not found' });
    }

    // Build field-level diff
    const diff: Record<string, any> = {};
    const allKeys = new Set([
      ...Object.keys(version1.config || {}),
      ...Object.keys(version2.config || {})
    ]);

    for (const key of allKeys) {
      const v1Val = (version1.config as any)?.[key];
      const v2Val = (version2.config as any)?.[key];

      diff[key] = {
        v1: v1Val !== undefined ? v1Val : null,
        v2: v2Val !== undefined ? v2Val : null,
        changed: JSON.stringify(v1Val) !== JSON.stringify(v2Val)
      };
    }

    res.json({ diff, version1: version1.version, version2: version2.version });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /methodology-configs/:id/preview - Preview assembled prompt block
 */
router.post('/:id/preview', async (req, res) => {
  try {
    const { id } = req.params;
    const resolver = getMethodologyConfigResolver();
    const mergedConfig = await resolver.getMergedConfig(id);

    // Build methodology context block (same as runtime)
    const contextBlock = buildMethodologyContextBlock(mergedConfig);

    // Estimate token count (rough: 1 token ~= 4 chars)
    const tokenEstimate = Math.ceil(contextBlock.length / 4);
    const exceedsLimit = tokenEstimate > 2000;

    res.json({
      preview: exceedsLimit ? contextBlock.slice(0, 8000) + '\n\n[... truncated]' : contextBlock,
      token_count: tokenEstimate,
      warning: exceedsLimit ? 'Config exceeds 2000 token limit' : null
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /methodology-configs/system-defaults - List all frameworks
 */
router.get('/system-defaults', async (req, res) => {
  try {
    const frameworks = ALL_FRAMEWORKS.map(f => ({
      id: f.id,
      label: f.label,
      description: f.description,
      vendor: f.vendor,
      dimension_count: f.dimensions.length,
      dimensions: f.dimensions.map(d => ({
        id: d.id,
        label: d.label,
        description: d.description
      }))
    }));

    res.json({ frameworks });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /methodology-configs/system-defaults/:key - Single framework
 */
router.get('/system-defaults/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const framework = ALL_FRAMEWORKS.find(f => f.id === key);

    if (!framework) {
      return res.status(404).json({ error: 'Framework not found' });
    }

    res.json({ framework });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Helper: Build methodology context block for preview
 */
function buildMethodologyContextBlock(mergedConfig: any): string {
  const sections: string[] = [];

  sections.push(`METHODOLOGY_CONTEXT:`);
  sections.push(`Framework: ${mergedConfig.base_methodology} (${mergedConfig.display_name || 'Standard'})`);
  sections.push(`Version: ${mergedConfig.version} | Scope: ${mergedConfig.scope_type}`);
  sections.push('');

  if (mergedConfig.config.problem_definition) {
    sections.push('PROBLEM DEFINITION:');
    sections.push(mergedConfig.config.problem_definition);
    sections.push('');
  }

  if (mergedConfig.config.champion_signals) {
    sections.push('CHAMPION SIGNALS:');
    sections.push(mergedConfig.config.champion_signals);
    sections.push('');
  }

  if (mergedConfig.config.economic_buyer_signals) {
    sections.push('ECONOMIC BUYER SIGNALS:');
    sections.push(mergedConfig.config.economic_buyer_signals);
    sections.push('');
  }

  if (mergedConfig.config.disqualifying_signals) {
    sections.push('DISQUALIFYING SIGNALS:');
    sections.push(mergedConfig.config.disqualifying_signals);
    sections.push('');
  }

  if (mergedConfig.config.qualifying_questions?.length > 0) {
    sections.push('QUALIFYING QUESTIONS:');
    sections.push(mergedConfig.config.qualifying_questions.join('\n'));
    sections.push('');
  }

  if (mergedConfig.config.stage_criteria && Object.keys(mergedConfig.config.stage_criteria).length > 0) {
    sections.push('STAGE ADVANCEMENT CRITERIA:');
    sections.push(JSON.stringify(mergedConfig.config.stage_criteria, null, 2));
    sections.push('');
  }

  return sections.join('\n');
}

export default router;
