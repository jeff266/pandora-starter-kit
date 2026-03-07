import { ChartSpec } from '../renderers/types.js';
import { AccumulatedDocument } from '../documents/types.js';
import type { VoiceProfile } from '../voice/types.js';
import { DEFAULT_VOICE_PROFILE } from '../voice/types.js';
import { configLoader } from '../config/workspace-config-loader.js';

export type { VoiceProfile };

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
  voiceProfile: VoiceProfile;
  workspaceId?: string;
  userId?: string;
  userRole?: 'admin' | 'manager' | 'rep' | 'analyst' | 'viewer' | 'member';
}

export function createSessionContext(initialScope?: Partial<SessionContext['activeScope']>, workspaceId?: string): SessionContext {
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
    voiceProfile: DEFAULT_VOICE_PROFILE,
    workspaceId,
  };
}

export async function getOrCreateSessionContext(existingContext?: any, workspaceId?: string): Promise<SessionContext> {
  if (existingContext?.sessionContext) {
    return existingContext.sessionContext;
  }
  const context = createSessionContext(undefined, workspaceId);
  if (workspaceId) {
    try {
      context.voiceProfile = await configLoader.getVoiceProfile(workspaceId);
    } catch (err) {
      console.error(`[session-context] Failed to load voice profile for workspace ${workspaceId}:`, err);
    }
  }
  return context;
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
