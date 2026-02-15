/**
 * Discovery Module - Barrel Exports
 *
 * Central export point for the dimension discovery system:
 * - Dimension Registry: Static catalog of all possible dimensions
 * - Discovery Engine: Evaluation engine for workspace-specific discovery
 */

// Dimension Registry
export {
  DIMENSION_REGISTRY,
  UNIVERSAL_DIMENSIONS,
  CONDITIONAL_DIMENSIONS,
  getDimension,
  getDimensionsByCategory,
  type DimensionDefinition,
  type InclusionCriteria,
  type SourceType,
  type DimensionCategory,
} from './dimension-registry.js';

// Discovery Engine
export {
  runDimensionDiscovery,
  type DiscoveryInput,
  type DiscoveryOutput,
  type DiscoveredDimension,
  type DiscoveredStage,
} from './discovery-engine.js';
