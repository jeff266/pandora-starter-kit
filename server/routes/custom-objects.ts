/**
 * Custom Object Mapping Routes
 *
 * Allows workspaces to map custom CRM objects (e.g. Salesforce Transcript__c)
 * to Pandora's normalized entity tables (conversations, etc.).
 *
 * Endpoints:
 *   GET  /:workspaceId/connectors/salesforce/objects/:objectName/fields
 *   GET  /:workspaceId/custom-objects
 *   PUT  /:workspaceId/custom-objects
 */

import { Router, type Request, type Response } from 'express';
import { query } from '../db.js';
import { createLogger } from '../utils/logger.js';
import { getConnectorCredentials } from '../lib/credential-store.js';

const router = Router();
const logger = createLogger('CustomObjectRoutes');

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SalesforceFieldMeta {
  name: string;
  label: string;
  type: string;
  is_custom: boolean;
  nillable: boolean;
}

export interface CustomObjectConfig {
  id: string;
  connector: 'salesforce';
  object_name: string;
  label: string;
  mode: 'map_to_entity';
  target: 'conversations';
  field_map: Record<string, string>;
  created_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const MAPPABLE_SF_TYPES = new Set([
  'string', 'textarea', 'date', 'datetime', 'double', 'integer', 'currency',
  'percent', 'phone', 'email', 'url', 'reference', 'id', 'long', 'boolean',
]);

async function describeObject(
  accessToken: string,
  instanceUrl: string,
  objectName: string
): Promise<SalesforceFieldMeta[]> {
  const url = `${instanceUrl}/services/data/v62.0/sobjects/${objectName}/describe`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Salesforce describe failed for ${objectName}: ${res.status} ${text}`);
  }

  const data = await res.json() as { fields: any[] };

  return (data.fields || [])
    .filter((f: any) => MAPPABLE_SF_TYPES.has(f.type))
    .map((f: any): SalesforceFieldMeta => ({
      name: f.name,
      label: f.label || f.name,
      type: f.type,
      is_custom: f.custom === true,
      nillable: f.nillable === true,
    }))
    .sort((a, b) => {
      if (a.is_custom !== b.is_custom) return a.is_custom ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
}

async function getCustomObjectsConfig(workspaceId: string): Promise<CustomObjectConfig[]> {
  const result = await query<{ definitions: any }>(
    `SELECT definitions FROM workspace_definitions
     WHERE workspace_id = $1 AND category = 'settings' AND key = 'workspace_config'
     LIMIT 1`,
    [workspaceId]
  );
  const defs = result.rows[0]?.definitions ?? {};
  return defs.custom_objects ?? [];
}

async function saveCustomObjectsConfig(
  workspaceId: string,
  customObjects: CustomObjectConfig[]
): Promise<void> {
  await query(
    `INSERT INTO workspace_definitions (workspace_id, category, key, definitions, updated_at)
     VALUES ($1, 'settings', 'workspace_config', jsonb_build_object('custom_objects', $2::jsonb), NOW())
     ON CONFLICT (workspace_id, category, key) DO UPDATE
       SET definitions = jsonb_set(
             COALESCE(workspace_definitions.definitions, '{}'::jsonb),
             '{custom_objects}',
             $2::jsonb
           ),
           updated_at = NOW()`,
    [workspaceId, JSON.stringify(customObjects)]
  );
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /:workspaceId/connectors/salesforce/objects/:objectName/fields
 * Describes a Salesforce object and returns its mappable fields.
 */
router.get(
  '/:workspaceId/connectors/salesforce/objects/:objectName/fields',
  async (req: Request, res: Response) => {
    const { workspaceId, objectName } = req.params;

    try {
      const creds = await getConnectorCredentials(workspaceId, 'salesforce');
      if (!creds) {
        return res.status(400).json({ error: 'Salesforce not connected for this workspace' });
      }

      const fields = await describeObject(
        creds.credentials.access_token,
        creds.credentials.instance_url,
        objectName
      );

      logger.info('[CustomObjects] Described SF object', { workspaceId, objectName, fieldCount: fields.length });
      res.json({ object_name: objectName, fields });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logger.error('[CustomObjects] Describe failed', err as Error);
      if (msg.includes('describe failed')) {
        return res.status(404).json({ error: `Object "${objectName}" not found in Salesforce. Check the API name.` });
      }
      res.status(500).json({ error: msg });
    }
  }
);

/**
 * GET /:workspaceId/custom-objects
 * Returns the workspace's custom object configurations.
 */
router.get('/:workspaceId/custom-objects', async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  try {
    const configs = await getCustomObjectsConfig(workspaceId);
    res.json({ custom_objects: configs });
  } catch (err) {
    logger.error('[CustomObjects] Read config failed', err as Error);
    res.status(500).json({ error: 'Failed to load custom object configuration' });
  }
});

/**
 * PUT /:workspaceId/custom-objects
 * Saves the full custom_objects array to workspace_config.
 * Body: { custom_objects: CustomObjectConfig[] }
 */
router.put('/:workspaceId/custom-objects', async (req: Request, res: Response) => {
  const { workspaceId } = req.params;
  const { custom_objects } = req.body;

  if (!Array.isArray(custom_objects)) {
    return res.status(400).json({ error: 'custom_objects must be an array' });
  }

  try {
    await saveCustomObjectsConfig(workspaceId, custom_objects);
    logger.info('[CustomObjects] Saved config', { workspaceId, count: custom_objects.length });
    res.json({ ok: true, custom_objects });
  } catch (err) {
    logger.error('[CustomObjects] Save config failed', err as Error);
    res.status(500).json({ error: 'Failed to save custom object configuration' });
  }
});

export default router;
