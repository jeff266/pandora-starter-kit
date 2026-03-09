import { configLoader } from './workspace-config-loader.js';
import { query } from '../db.js';
import { getFrameworkById, type MethodologyFramework } from './methodology-frameworks.js';

export async function getWorkspaceMethodology(
  workspaceId: string,
): Promise<MethodologyFramework | null> {
  try {
    const config = await configLoader.getConfig(workspaceId);

    if (config.methodology?.framework_id) {
      return getFrameworkById(config.methodology.framework_id);
    }

    const result = await query<{ definitions: any }>(
      `SELECT definitions FROM context_layer
       WHERE workspace_id = $1 AND layer_type = 'inference'
       ORDER BY created_at DESC LIMIT 1`,
      [workspaceId],
    );

    if (result.rows.length > 0) {
      const defs = result.rows[0].definitions;
      const frameworkId =
        defs?.business_model?.methodology ||
        defs?.business_model?.detected_methodology ||
        defs?.methodology?.framework_id;

      if (frameworkId) {
        return getFrameworkById(String(frameworkId));
      }
    }
  } catch {
  }

  return null;
}
