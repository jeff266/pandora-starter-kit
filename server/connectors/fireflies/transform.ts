import type { FirefliesTranscript } from './types.js';
import { parseFirefliesDate } from './client.js';
import { sanitizeInteger } from '../../utils/field-sanitizer.js';

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

export function transformFirefliesTranscript(transcript: FirefliesTranscript, workspaceId: string): NormalizedConversation {
  const { sentences, ...sourceData } = transcript;

  const participants = (transcript.meeting_attendees || []).map(a => ({
    name: a.name || a.displayName || null,
    email: a.email || null,
  }));

  return {
    workspace_id: workspaceId,
    source: 'fireflies',
    source_id: transcript.id,
    source_data: sourceData,
    title: transcript.title || null,
    call_date: parseFirefliesDate(transcript),
    duration_seconds: sanitizeInteger(transcript.duration), // FIX: empty string would become 0 with Math.round
    participants,
    transcript_text: null,
    summary: transcript.summary?.overview || null,
    action_items: transcript.summary?.action_items || [],
    objections: [],
    sentiment_score: null,
    talk_listen_ratio: null,
    topics: transcript.summary?.keywords || [],
    competitor_mentions: [],
    custom_fields: {
      transcript_url: transcript.transcript_url || null,
      audio_url: transcript.audio_url || null,
      host_email: transcript.host_email || null,
      organizer_email: transcript.organizer_email || null,
    },
  };
}
