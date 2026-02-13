/**
 * Workflow Engine Public API
 *
 * Barrel export for all workflow engine components.
 */

export { WorkflowService } from './workflow-service.js';
export type { APClientInterface } from './workflow-service.js';
export { onActionCreated } from './workflow-trigger.js';
export type { ActionEvent } from './workflow-trigger.js';
export {
  getAvailablePieces,
  getConnectedPieces,
  getPieceByName,
  getRequiredConnectionsForTree,
} from './connector-registry-service.js';
export { pollRunningWorkflows } from './run-monitor.js';
export { seedTemplates, SEED_TEMPLATES } from './template-seed.js';
export { compileWorkflow, hashTree } from './compiler.js';
export { TreeValidator } from './tree-validator.js';
export { ActivePiecesClient } from './ap-client.js';
export { ensureAPProject, cleanupAPProject } from './ap-project-manager.js';
export {
  provisionConnections,
  refreshConnection,
  onConnectorConnected,
  onConnectorDisconnected,
  CONNECTOR_TO_PIECE_MAP,
} from './ap-connection-provisioner.js';
export type { APProject, APFlow, APFlowRun, APConnection } from './ap-types.js';
export * from './types.js';
