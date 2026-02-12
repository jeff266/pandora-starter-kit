/**
 * Workspace Configuration Layer
 *
 * Provides type-safe access to workspace-specific configuration that overrides
 * hardcoded defaults across the application.
 *
 * Stored in context_layer.definitions JSONB column.
 */

import { getDefinitions, updateContext } from '../context/index.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('WorkspaceConfig');

// ============================================================================
// Types
// ============================================================================

/**
 * Stage mapping configuration
 * Maps CRM-specific stage names to normalized stages
 *
 * Example:
 * {
 *   "Pilot Program": "evaluation",
 *   "Final Review": "decision",
 *   "Verbal Commitment": "negotiation"
 * }
 */
export interface StageMapping {
  [crmStageName: string]: 'awareness' | 'qualification' | 'evaluation' | 'decision' | 'negotiation' | 'closed_won' | 'closed_lost';
}

/**
 * Department pattern extensions
 * Adds industry-specific departments with keyword patterns
 *
 * Example:
 * {
 *   "clinical": ["clinical", "medical director", "physician"],
 *   "regulatory": ["regulatory affairs", "compliance", "qa"]
 * }
 */
export interface DepartmentPatterns {
  [departmentName: string]: string[];
}

/**
 * Role field mappings
 * Maps CRM custom fields to standard buying roles
 *
 * Example:
 * {
 *   "Primary_Contact__c": "champion",
 *   "Budget_Owner__c": "economic_buyer",
 *   "Technical_Lead__c": "technical_evaluator"
 * }
 */
export interface RoleFieldMappings {
  [crmFieldName: string]: 'champion' | 'economic_buyer' | 'decision_maker' | 'executive_sponsor' | 'technical_evaluator' | 'influencer' | 'coach' | 'blocker' | 'end_user';
}

/**
 * Lead score grade thresholds
 * Defines minimum scores for each letter grade
 *
 * Example:
 * {
 *   "A": 90,
 *   "B": 75,
 *   "C": 55,
 *   "D": 35,
 *   "F": 0
 * }
 */
export interface GradeThresholds {
  A: number;
  B: number;
  C: number;
  D: number;
  F: number;
}

/**
 * Complete workspace configuration structure
 */
export interface WorkspaceConfig {
  stage_mapping?: StageMapping;
  department_patterns?: DepartmentPatterns;
  role_field_mappings?: RoleFieldMappings;
  grade_thresholds?: GradeThresholds;

  // Legacy fields (already in use)
  qualified_definition?: string[];
  terminology_map?: Record<string, string>;
}

// ============================================================================
// Default Values
// ============================================================================

export const DEFAULT_GRADE_THRESHOLDS: GradeThresholds = {
  A: 85,
  B: 70,
  C: 50,
  D: 30,
  F: 0,
};

// ============================================================================
// Validation
// ============================================================================

const VALID_NORMALIZED_STAGES = new Set([
  'awareness',
  'qualification',
  'evaluation',
  'decision',
  'negotiation',
  'closed_won',
  'closed_lost',
]);

const VALID_BUYING_ROLES = new Set([
  'champion',
  'economic_buyer',
  'decision_maker',
  'executive_sponsor',
  'technical_evaluator',
  'influencer',
  'coach',
  'blocker',
  'end_user',
]);

export class ConfigValidationError extends Error {
  constructor(
    message: string,
    public field: string,
    public value: unknown
  ) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

/**
 * Validate stage mapping configuration
 */
export function validateStageMapping(mapping: unknown): asserts mapping is StageMapping {
  if (typeof mapping !== 'object' || mapping === null) {
    throw new ConfigValidationError('stage_mapping must be an object', 'stage_mapping', mapping);
  }

  for (const [crmStage, normalizedStage] of Object.entries(mapping)) {
    if (typeof crmStage !== 'string' || crmStage.trim() === '') {
      throw new ConfigValidationError('Stage names must be non-empty strings', 'stage_mapping', crmStage);
    }

    if (!VALID_NORMALIZED_STAGES.has(normalizedStage as string)) {
      throw new ConfigValidationError(
        `Invalid normalized stage "${normalizedStage}". Must be one of: ${Array.from(VALID_NORMALIZED_STAGES).join(', ')}`,
        'stage_mapping',
        normalizedStage
      );
    }
  }
}

/**
 * Validate department patterns configuration
 */
export function validateDepartmentPatterns(patterns: unknown): asserts patterns is DepartmentPatterns {
  if (typeof patterns !== 'object' || patterns === null) {
    throw new ConfigValidationError('department_patterns must be an object', 'department_patterns', patterns);
  }

  for (const [deptName, keywords] of Object.entries(patterns)) {
    if (typeof deptName !== 'string' || deptName.trim() === '') {
      throw new ConfigValidationError('Department names must be non-empty strings', 'department_patterns', deptName);
    }

    if (!Array.isArray(keywords)) {
      throw new ConfigValidationError(
        `Department patterns for "${deptName}" must be an array of strings`,
        'department_patterns',
        keywords
      );
    }

    for (const keyword of keywords) {
      if (typeof keyword !== 'string' || keyword.trim() === '') {
        throw new ConfigValidationError(
          `Department keywords for "${deptName}" must be non-empty strings`,
          'department_patterns',
          keyword
        );
      }
    }
  }
}

/**
 * Validate role field mappings configuration
 */
export function validateRoleFieldMappings(mappings: unknown): asserts mappings is RoleFieldMappings {
  if (typeof mappings !== 'object' || mappings === null) {
    throw new ConfigValidationError('role_field_mappings must be an object', 'role_field_mappings', mappings);
  }

  for (const [fieldName, role] of Object.entries(mappings)) {
    if (typeof fieldName !== 'string' || fieldName.trim() === '') {
      throw new ConfigValidationError('Field names must be non-empty strings', 'role_field_mappings', fieldName);
    }

    if (!VALID_BUYING_ROLES.has(role as string)) {
      throw new ConfigValidationError(
        `Invalid buying role "${role}". Must be one of: ${Array.from(VALID_BUYING_ROLES).join(', ')}`,
        'role_field_mappings',
        role
      );
    }
  }
}

/**
 * Validate grade thresholds configuration
 */
export function validateGradeThresholds(thresholds: unknown): asserts thresholds is GradeThresholds {
  if (typeof thresholds !== 'object' || thresholds === null) {
    throw new ConfigValidationError('grade_thresholds must be an object', 'grade_thresholds', thresholds);
  }

  const required = ['A', 'B', 'C', 'D', 'F'];
  for (const grade of required) {
    if (!(grade in thresholds)) {
      throw new ConfigValidationError(`Missing required grade "${grade}"`, 'grade_thresholds', thresholds);
    }

    const value = (thresholds as any)[grade];
    if (typeof value !== 'number' || value < 0 || value > 100) {
      throw new ConfigValidationError(
        `Grade threshold for "${grade}" must be a number between 0 and 100`,
        'grade_thresholds',
        value
      );
    }
  }

  const t = thresholds as GradeThresholds;
  if (t.A <= t.B || t.B <= t.C || t.C <= t.D || t.D < t.F) {
    throw new ConfigValidationError(
      'Grade thresholds must be in descending order: A > B > C > D >= F',
      'grade_thresholds',
      thresholds
    );
  }
}

/**
 * Validate complete workspace configuration
 */
export function validateWorkspaceConfig(config: unknown): asserts config is WorkspaceConfig {
  if (typeof config !== 'object' || config === null) {
    throw new ConfigValidationError('Configuration must be an object', 'config', config);
  }

  const c = config as any;

  if (c.stage_mapping !== undefined) {
    validateStageMapping(c.stage_mapping);
  }

  if (c.department_patterns !== undefined) {
    validateDepartmentPatterns(c.department_patterns);
  }

  if (c.role_field_mappings !== undefined) {
    validateRoleFieldMappings(c.role_field_mappings);
  }

  if (c.grade_thresholds !== undefined) {
    validateGradeThresholds(c.grade_thresholds);
  }
}

// ============================================================================
// Getters
// ============================================================================

/**
 * Get full workspace configuration
 */
export async function getWorkspaceConfig(workspaceId: string): Promise<WorkspaceConfig> {
  const definitions = await getDefinitions(workspaceId);
  return definitions as WorkspaceConfig;
}

/**
 * Get stage mapping for workspace (with empty fallback)
 */
export async function getStageMapping(workspaceId: string): Promise<StageMapping> {
  const config = await getWorkspaceConfig(workspaceId);
  return config.stage_mapping ?? {};
}

/**
 * Get department patterns for workspace (with empty fallback)
 */
export async function getDepartmentPatterns(workspaceId: string): Promise<DepartmentPatterns> {
  const config = await getWorkspaceConfig(workspaceId);
  return config.department_patterns ?? {};
}

/**
 * Get role field mappings for workspace (with empty fallback)
 */
export async function getRoleFieldMappings(workspaceId: string): Promise<RoleFieldMappings> {
  const config = await getWorkspaceConfig(workspaceId);
  return config.role_field_mappings ?? {};
}

/**
 * Get grade thresholds for workspace (with default fallback)
 */
export async function getGradeThresholds(workspaceId: string): Promise<GradeThresholds> {
  const config = await getWorkspaceConfig(workspaceId);
  return config.grade_thresholds ?? DEFAULT_GRADE_THRESHOLDS;
}

// ============================================================================
// Setters
// ============================================================================

/**
 * Update workspace configuration
 * Validates input and merges with existing config
 */
export async function updateWorkspaceConfig(
  workspaceId: string,
  updates: Partial<WorkspaceConfig>,
  updatedBy?: string
): Promise<WorkspaceConfig> {
  // Validate updates
  validateWorkspaceConfig(updates);

  // Get current config
  const currentConfig = await getWorkspaceConfig(workspaceId);

  // Merge updates
  const newConfig: WorkspaceConfig = {
    ...currentConfig,
    ...updates,
  };

  // Save to database
  await updateContext(workspaceId, 'definitions', newConfig, updatedBy);

  logger.info('[Config] Updated workspace configuration', {
    workspaceId,
    updatedFields: Object.keys(updates),
    updatedBy,
  });

  return newConfig;
}

/**
 * Set stage mapping for workspace
 */
export async function setStageMapping(
  workspaceId: string,
  mapping: StageMapping,
  updatedBy?: string
): Promise<void> {
  validateStageMapping(mapping);
  await updateWorkspaceConfig(workspaceId, { stage_mapping: mapping }, updatedBy);
}

/**
 * Set department patterns for workspace
 */
export async function setDepartmentPatterns(
  workspaceId: string,
  patterns: DepartmentPatterns,
  updatedBy?: string
): Promise<void> {
  validateDepartmentPatterns(patterns);
  await updateWorkspaceConfig(workspaceId, { department_patterns: patterns }, updatedBy);
}

/**
 * Set role field mappings for workspace
 */
export async function setRoleFieldMappings(
  workspaceId: string,
  mappings: RoleFieldMappings,
  updatedBy?: string
): Promise<void> {
  validateRoleFieldMappings(mappings);
  await updateWorkspaceConfig(workspaceId, { role_field_mappings: mappings }, updatedBy);
}

/**
 * Set grade thresholds for workspace
 */
export async function setGradeThresholds(
  workspaceId: string,
  thresholds: GradeThresholds,
  updatedBy?: string
): Promise<void> {
  validateGradeThresholds(thresholds);
  await updateWorkspaceConfig(workspaceId, { grade_thresholds: thresholds }, updatedBy);
}
