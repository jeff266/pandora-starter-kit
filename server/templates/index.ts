/**
 * Templates Module - Barrel Exports
 *
 * Central export point for the template assembly and cell population system:
 * - Template Assembler: DiscoveryOutput → TemplateMatrix skeleton
 * - Cell Populator: Populate config, computed, and synthesize cells
 * - Deliverable Pipeline: Full orchestration
 */

// Template Assembler
export {
  assembleTemplate,
  type TemplateMatrix,
  type TemplateRow,
  type TemplateCell,
  type CellStatus,
  type CellSourceType,
} from './template-assembler.js';

// Cell Populator
export {
  populateTemplate,
  type PopulationContext,
  type PopulationResult,
} from './cell-populator.js';

// Deliverable Pipeline
export {
  generateDeliverable,
  type DeliverablePipelineInput,
  type DeliverablePipelineOutput,
} from './deliverable-pipeline.js';
