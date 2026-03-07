export type VoicePersona = 'teammate' | 'advisor' | 'analyst';
export type VoiceOwnershipPronoun = 'we' | 'you';
export type VoiceDirectness = 'direct' | 'diplomatic';
export type VoiceDetailLevel = 'executive' | 'manager' | 'analyst';
export type VoiceTemporalAwareness = 'quarter_phase' | 'week_day' | 'both' | 'none';

export interface VoiceProfile {
  persona: VoicePersona;
  ownership_pronoun: VoiceOwnershipPronoun;
  directness: VoiceDirectness;
  detail_level: VoiceDetailLevel;
  name_entities: boolean;
  celebrate_wins: boolean;
  surface_uncertainty: boolean;
  temporal_awareness: VoiceTemporalAwareness;
}

export interface VoiceRenderInput {
  text: string;
  profile: VoiceProfile;
}

export interface VoiceRenderContext {
  attainment_pct?: number;
  days_remaining?: number;
  quarter_phase?: string;
  week_day?: string;
  surface?: 'chat' | 'brief' | 'document';
}

export interface VoiceRenderOutput {
  text: string;
  transformationsApplied: string[];
}

export interface WorkspaceVoiceOverrides {
  // Placeholder for V4
  brief_overrides?: Record<string, any>;
  chat_overrides?: Record<string, any>;
}

export const DEFAULT_VOICE_PROFILE: VoiceProfile = {
  persona: 'teammate',
  ownership_pronoun: 'we',
  directness: 'direct',
  detail_level: 'manager',
  name_entities: true,
  celebrate_wins: true,
  surface_uncertainty: true,
  temporal_awareness: 'both',
};
