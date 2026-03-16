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
import { getConnectorCredentials, updateCredentialFields } from '../lib/credential-store.js';
import { SalesforceClient, SalesforceSessionExpiredError } from '../connectors/salesforce/client.js';

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

/**
 * Build a SalesforceClient, refreshing the access token if it has expired.
 * Persists refreshed token back to the credential store.
 */
async function buildClient(
  creds: Record<string, any>,
  workspaceId: string
): Promise<SalesforceClient> {
  return new SalesforceClient({
    accessToken: creds.accessToken,
    instanceUrl: creds.instanceUrl,
    apiVersion: creds.apiVersion,
  });
}

async function callWithRefresh<T>(
  creds: Record<string, any>,
  workspaceId: string,
  fn: (client: SalesforceClient) => Promise<T>
): Promise<T> {
  const client = await buildClient(creds, workspaceId);
  try {
    return await fn(client);
  } catch (err) {
    if (err instanceof SalesforceSessionExpiredError) {
      logger.info('[CustomObjects] Token expired, refreshing', { workspaceId });
      const refreshed = await SalesforceClient.refreshAccessToken(
        creds.refreshToken,
        creds.clientId ?? process.env.SALESFORCE_CLIENT_ID!,
        creds.clientSecret ?? process.env.SALESFORCE_CLIENT_SECRET!
      );
      await updateCredentialFields(workspaceId, 'salesforce', {
        accessToken: refreshed.accessToken,
        instanceUrl: refreshed.instanceUrl,
      });
      const fresh = new SalesforceClient({
        accessToken: refreshed.accessToken,
        instanceUrl: refreshed.instanceUrl,
        apiVersion: creds.apiVersion,
      });
      return await fn(fresh);
    }
    throw err;
  }
}

async function describeObjectFields(
  client: SalesforceClient,
  objectName: string
): Promise<SalesforceFieldMeta[]> {
  const url = `${(client as any).baseUrl}/sobjects/${objectName}/describe`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${(client as any).accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 404 || text.includes('NOT_FOUND') || text.includes('INVALID_TYPE')) {
      throw new Error(`Salesforce describe failed for ${objectName}: ${res.status} ${text}`);
    }
    if (res.status === 401) throw new SalesforceSessionExpiredError();
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
 * GET /:workspaceId/connectors/salesforce/objects
 * Lists all custom objects in the connected Salesforce org.
 * Used for discoverability when the exact API name isn't known.
 */
router.get(
  '/:workspaceId/connectors/salesforce/objects',
  async (req: Request, res: Response) => {
    const { workspaceId } = req.params;
    try {
      const creds = await getConnectorCredentials(workspaceId, 'salesforce');
      if (!creds) {
        return res.status(400).json({ error: 'Salesforce not connected for this workspace' });
      }

      const objects = await callWithRefresh(creds, workspaceId, async (client) => {
        const url = `${(client as any).baseUrl}/sobjects`;
        const r = await fetch(url, {
          headers: {
            Authorization: `Bearer ${(client as any).accessToken}`,
            'Content-Type': 'application/json',
          },
        });
        if (!r.ok) {
          if (r.status === 401) throw new SalesforceSessionExpiredError();
          throw new Error(`Failed to list objects: ${r.status}`);
        }
        const data = await r.json() as { sobjects: any[] };
        return (data.sobjects || [])
          .filter((o: any) => o.custom || o.customSetting)
          .map((o: any) => ({ name: o.name, label: o.label, custom: o.custom }))
          .sort((a: any, b: any) => a.label.localeCompare(b.label));
      });

      res.json({ objects });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logger.error('[CustomObjects] List objects failed', err as Error);
      res.status(500).json({ error: msg });
    }
  }
);

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

      const fields = await callWithRefresh(creds, workspaceId, (client) =>
        describeObjectFields(client, objectName)
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
