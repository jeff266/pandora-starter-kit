import { ChartSpec } from '../renderers/types.js';
import { AccumulatedDocument } from '../documents/types.js';

export interface SessionContext {
  activeScope: {
    type: 'workspace' | 'rep' | 'deal' | 'account';
    entityId?: string;
    repEmail?: string;
    label?: string;
  };
  computedThisSession: Record<string, any>;
  dealsLookedUp: string[];
  conversationHistory: any[];
  sessionFindings: any[];
  sessionCharts: ChartSpec[];
  sessionTables: any[];
  sessionRecommendations: any[];
  accumulatedDocument?: AccumulatedDocument; 
}

export function createSessionContext(initialScope?: Partial<SessionContext['activeScope']>): SessionContext {
  return {
    activeScope: {
      type: 'workspace',
      ...initialScope,
    },
    computedThisSession: {},
    dealsLookedUp: [],
    conversationHistory: [],
    sessionFindings: [],
    sessionCharts: [],
    sessionTables: [],
    sessionRecommendations: [],
  };
}

export function getOrCreateSessionContext(existingContext?: any): SessionContext {
  if (existingContext?.sessionContext) {
    return existingContext.sessionContext;
  }
  return createSessionContext();
}

export function updateSessionScope(context: SessionContext, newScope: Partial<SessionContext['activeScope']>) {
  context.activeScope = {
    ...context.activeScope,
    ...newScope,
  };
}

export function cacheComputation(context: SessionContext, key: string, value: any) {
  context.computedThisSession[key] = value;
}

export function getCachedComputation(context: SessionContext, key: string): any | undefined {
  return context.computedThisSession[key];
}

export function addSessionFinding(context: SessionContext, finding: any) {
  context.sessionFindings.push(finding);
}

export function addSessionChart(context: SessionContext, chart: ChartSpec) {
  context.sessionCharts.push(chart);
}

export function addSessionRecommendation(context: SessionContext, recommendation: any) {
  context.sessionRecommendations.push(recommendation);
}
