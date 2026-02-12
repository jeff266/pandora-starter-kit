/**
 * Workspace Configuration Module
 *
 * Barrel export for workspace-specific configuration functionality
 */

export {
  // Types
  type WorkspaceConfig,
  type StageMapping,
  type DepartmentPatterns,
  type RoleFieldMappings,
  type GradeThresholds,

  // Constants
  DEFAULT_GRADE_THRESHOLDS,

  // Validation
  ConfigValidationError,
  validateWorkspaceConfig,
  validateStageMapping,
  validateDepartmentPatterns,
  validateRoleFieldMappings,
  validateGradeThresholds,

  // Getters
  getWorkspaceConfig,
  getStageMapping,
  getDepartmentPatterns,
  getRoleFieldMappings,
  getGradeThresholds,

  // Setters
  updateWorkspaceConfig,
  setStageMapping,
  setDepartmentPatterns,
  setRoleFieldMappings,
  setGradeThresholds,
} from './workspace-config.js';
