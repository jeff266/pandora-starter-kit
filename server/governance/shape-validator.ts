/**
 * Shape Validator
 *
 * Checks that a proposed change conforms to Pandora's structural contracts.
 * Does NOT evaluate quality — only safety to deploy.
 */

import { query } from '../db.js';

export interface ShapeValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  checks_performed: string[];
}

export async function validateChangeShape(
  workspaceId: string,
  changeType: string,
  payload: any
): Promise<ShapeValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const checks: string[] = [];

  switch (changeType) {
    case 'resolver_pattern': {
      checks.push('regex_syntax', 'test_inputs_match', 'test_non_matches_clear', 'collision_check');

      // Check 1: Valid regex
      try {
        new RegExp(payload.pattern, payload.pattern_flags || '');
      } catch (e: any) {
        errors.push(`Invalid regex pattern: ${e.message}`);
      }

      if (!payload.pattern) {
        errors.push('pattern is required');
        break;
      }

      // Check 2: test_inputs all match
      try {
        const regex = new RegExp(payload.pattern, payload.pattern_flags || '');
        for (const input of (payload.test_inputs || [])) {
          if (!regex.test(input)) {
            errors.push(`Test input "${input}" does NOT match the proposed pattern`);
          }
        }
        // Check 3: test_non_matches all don't match
        for (const nonMatch of (payload.test_non_matches || [])) {
          if (regex.test(nonMatch)) {
            errors.push(`Non-match input "${nonMatch}" DOES match the pattern — too broad`);
          }
        }
      } catch { /* already caught above */ }

      // Check 4: Collision with deployed resolvers
      try {
        const existing = await loadExistingResolvers(workspaceId);
        const newRegex = new RegExp(payload.pattern, payload.pattern_flags || '');
        for (const ex of existing) {
          for (const testInput of (payload.test_inputs || [])) {
            if (ex.pattern.test(testInput)) {
              warnings.push(
                `Test input "${testInput}" also matches existing resolver "${ex.intent}". Priority ordering will determine which fires first.`
              );
            }
          }
        }
      } catch (e: any) {
        warnings.push(`Could not check existing resolvers: ${e.message}`);
      }
      break;
    }

    case 'workspace_context': {
      checks.push('context_key_format', 'value_not_empty', 'injection_point_valid', 'existing_key_check');

      if (!payload.context_key || payload.context_key.length < 3) {
        errors.push('context_key must be at least 3 characters');
      }
      if (!payload.context_value || payload.context_value.length < 10) {
        errors.push('context_value must be at least 10 characters');
      }
      if (!['system_prompt', 'skill_context', 'both'].includes(payload.injection_point)) {
        errors.push(`Invalid injection_point: "${payload.injection_point}" — must be system_prompt, skill_context, or both`);
      }

      // Check for existing key
      try {
        const existing = await loadExistingContext(workspaceId, payload.context_key);
        if (existing) {
          warnings.push(
            `Context key "${payload.context_key}" already exists. This change will overwrite: "${String(existing).substring(0, 100)}"`
          );
        }
      } catch (e: any) {
        warnings.push(`Could not check existing context: ${e.message}`);
      }
      break;
    }

    case 'named_filter': {
      checks.push('filter_name_valid', 'conditions_present', 'entity_type_valid', 'fields_exist');

      if (!payload.filter_name || payload.filter_name.length < 2) {
        errors.push('filter_name must be at least 2 characters');
      }
      if (!payload.filter_definition?.conditions?.length) {
        errors.push('Filter must have at least one condition');
      }
      if (!['deal', 'contact', 'account'].includes(payload.filter_definition?.entity_type)) {
        errors.push(`Invalid entity_type: "${payload.filter_definition?.entity_type}" — must be deal, contact, or account`);
      }

      // Validate field names against information_schema
      const tableMap: Record<string, string> = { deal: 'deals', contact: 'contacts', account: 'accounts' };
      const tableName = tableMap[payload.filter_definition?.entity_type] || '';
      if (tableName) {
        try {
          const colResult = await query(
            `SELECT column_name FROM information_schema.columns
             WHERE table_name = $1 AND table_schema = 'public'`,
            [tableName]
          );
          const existingCols = new Set(colResult.rows.map((r: any) => r.column_name));
          for (const cond of (payload.filter_definition?.conditions || [])) {
            if (!existingCols.has(cond.field)) {
              errors.push(`Field "${cond.field}" does not exist on table "${tableName}"`);
            }
          }
        } catch (e: any) {
          warnings.push(`Could not validate field names: ${e.message}`);
        }
      }
      break;
    }

    case 'skill_definition': {
      checks.push('three_phase_pattern', 'compute_before_synthesize', 'not_starting_with_synthesize');

      const steps = payload.steps || [];
      const phases = steps.map((s: any) => s.phase);

      if (!phases.includes('compute')) {
        errors.push('Skill must have at least one COMPUTE step');
      }
      if (!phases.includes('synthesize')) {
        errors.push('Skill must have at least one SYNTHESIZE step');
      }
      if (phases[0] === 'synthesize') {
        errors.push('SYNTHESIZE (Claude) cannot be the first step — compute must prepare data first');
      }

      const firstSynthesize = phases.indexOf('synthesize');
      const lastCompute = phases.lastIndexOf('compute');
      if (firstSynthesize !== -1 && lastCompute !== -1 && firstSynthesize <= lastCompute) {
        errors.push('SYNTHESIZE step must appear after all COMPUTE steps');
      }
      break;
    }

    default:
      warnings.push(`Unknown change_type: "${changeType}" — no structural checks performed`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    checks_performed: checks,
  };
}

export async function loadExistingResolvers(
  workspaceId: string
): Promise<Array<{ pattern: RegExp; intent: string; id: string }>> {
  try {
    const result = await query(
      `SELECT id, change_payload FROM skill_governance
       WHERE workspace_id = $1
         AND status IN ('deployed', 'monitoring')
         AND change_type = 'resolver_pattern'`,
      [workspaceId]
    );
    return result.rows
      .map((r: any) => {
        const payload = r.change_payload;
        try {
          return {
            id: r.id,
            intent: payload.intent || 'unknown',
            pattern: new RegExp(payload.pattern, payload.pattern_flags || ''),
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean) as Array<{ pattern: RegExp; intent: string; id: string }>;
  } catch {
    return [];
  }
}

export async function loadExistingContext(
  workspaceId: string,
  key: string
): Promise<string | null> {
  try {
    const result = await query(
      `SELECT definitions->'injected_context'->>$2 as val
       FROM context_layer WHERE workspace_id = $1`,
      [workspaceId, key]
    );
    return result.rows[0]?.val || null;
  } catch {
    return null;
  }
}
