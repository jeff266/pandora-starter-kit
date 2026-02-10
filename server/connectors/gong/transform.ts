import type { GongCall } from './types.js';

export interface NormalizedConversation {
  workspace_id: string;
  source: string;
  source_id: string;
  source_data: Record<string, any>;
  title: string | null;
  call_date: Date | null;
  duration_seconds: number | null;
  participants: any[];
  transcript_text: string | null;
  summary: string | null;
  action_items: any[];
  objections: any[];
  sentiment_score: number | null;
  talk_listen_ratio: any | null;
  topics: any[];
  competitor_mentions: any[];
  custom_fields: Record<string, any>;
}

export function transformGongCall(call: GongCall, workspaceId: string): NormalizedConversation {
  const participants = (call.parties || []).map(p => ({
    name: p.name || null,
    email: p.emailAddress || null,
    affiliation: p.affiliation,
    speakerId: p.speakerId || null,
  }));

  return {
    workspace_id: workspaceId,
    source: 'gong',
    source_id: call.id,
    source_data: {
      title: call.title,
      scheduled: call.scheduled,
      started: call.started,
      duration: call.duration,
      direction: call.direction,
      scope: call.scope,
      media: call.media,
      language: call.language,
      url: call.url,
      primaryUserId: call.primaryUserId,
      parties: call.parties,
    },
    title: call.title || null,
    call_date: call.started ? new Date(call.started) : null,
    duration_seconds: call.duration || null,
    participants,
    transcript_text: null,
    summary: null,
    action_items: [],
    objections: [],
    sentiment_score: null,
    talk_listen_ratio: null,
    topics: [],
    competitor_mentions: [],
    custom_fields: {
      direction: call.direction,
      scope: call.scope,
      media: call.media,
      url: call.url,
      primaryUserId: call.primaryUserId,
    },
  };
}
