/**
 * ActivePieces API Response Types
 *
 * Detailed type definitions for AP API responses.
 * Separate from types.ts to keep AP-specific shapes isolated.
 */

// What AP returns for projects
export interface APProject {
  id: string;
  created: string;
  updated: string;
  displayName: string;
  externalId: string;
  metadata: Record<string, any>;
}

// What AP returns for flows
export interface APFlow {
  id: string;
  created: string;
  updated: string;
  projectId: string;
  externalId?: string;
  status: 'ENABLED' | 'DISABLED';
  version: {
    id: string;
    created: string;
    updated: string;
    flowId: string;
    displayName: string;
    trigger: any;  // AP trigger definition
    valid: boolean;
    state: 'LOCKED' | 'DRAFT';
  };
  publishedVersionId?: string;
  folderId?: string;
  metadata: Record<string, any>;
}

// What AP returns for flow runs
export interface APFlowRun {
  id: string;
  created: string;
  updated: string;
  projectId: string;
  flowId: string;
  flowVersionId: string;
  flowDisplayName: string;
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'TIMEOUT' | 'PAUSED' | 'STOPPED' | 'INTERNAL_ERROR';
  startTime: string;
  finishTime?: string;
  duration?: number;       // milliseconds
  steps?: Record<string, APStepOutput>;
  stepsCount?: number;
  error?: {
    message: string;
    step?: string;
  };
  tags?: string[];
}

export interface APStepOutput {
  type: string;
  status: 'SUCCEEDED' | 'FAILED' | 'SKIPPED';
  input: Record<string, any>;
  output: any;
  duration: number;
  error?: { message: string };
}

// What AP returns for connections
export interface APConnection {
  id: string;
  created: string;
  updated: string;
  name: string;
  pieceName: string;
  projectId: string;
  externalId?: string;
  type: string;
  status: 'ACTIVE' | 'ERROR' | 'MISSING_PERMISSIONS';
}

// Paginated response wrapper
export interface APPaginatedResponse<T> {
  data: T[];
  next?: string;   // cursor for next page
}
