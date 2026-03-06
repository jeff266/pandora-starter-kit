/**
 * Action Generator Registry
 *
 * Registers per-skill action generator functions that programmatically create
 * action records from step results.
 *
 * Complements <actions> block extraction from Claude synthesis output.
 */

import type { Pool } from 'pg';
import { insertStageMismatchActions } from './stage-mismatch-detector.js';

export type ActionGeneratorFn = (
  db: Pool,
  workspaceId: string,
  skillRunId: string,
  stepResults: Record<string, any>,
  businessContext: Record<string, any>
) => Promise<number>;

const actionGeneratorRegistry = new Map<string, ActionGeneratorFn>();

export function registerActionGenerator(skillId: string, generator: ActionGeneratorFn): void {
  actionGeneratorRegistry.set(skillId, generator);
}

export function getActionGenerator(skillId: string): ActionGeneratorFn | undefined {
  return actionGeneratorRegistry.get(skillId);
}

export function registerAllActionGenerators(): void {
  registerActionGenerator('stage-mismatch-detector', insertStageMismatchActions);
}
