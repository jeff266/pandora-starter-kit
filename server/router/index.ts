/**
 * Router Module - Barrel Exports
 *
 * Central export point for the router system:
 * - State Index: Workspace capability tracking
 * - Request Router: Free-text classification
 * - Dispatcher: Execution handler
 */

// State Index
export {
  buildWorkspaceStateIndex,
  getWorkspaceState,
  invalidateStateCache,
  type WorkspaceStateIndex,
  type SkillState,
  type DataCoverage,
  type TemplateReadiness,
} from './state-index.js';

// Request Router
export {
  classifyRequest,
  type RouterDecision,
  type RequestType,
} from './request-router.js';

// Dispatcher
export {
  dispatch,
  type ExecutionResult,
} from './dispatcher.js';
