import type { GongCall, GongUser } from './types.js';
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
  is_internal: boolean;
  call_disposition: string | null;
  decision_makers_mentioned: any[];
}

export type GongUserMap = Map<string, { name: string; email: string; title?: string }>;

export function buildUserMap(users: GongUser[]): GongUserMap {
  const map: GongUserMap = new Map();
  for (const u of users) {
    map.set(u.id, {
      name: `${u.firstName} ${u.lastName}`.trim(),
      email: u.emailAddress,
      title: u.title || undefined,
    });
  }
  return map;
}

function deriveCallDisposition(call: GongCall): string {
  const dir = call.direction;
  const scope = call.scope;
  const media = call.media;

  if (scope === 'Internal') return 'internal';
  if (dir === 'Inbound') return media === 'Video' ? 'demo_inbound' : 'discovery';
  if (dir === 'Outbound') return media === 'Video' ? 'demo_outbound' : 'prospecting';
  return 'meeting';
}

function extractDecisionMakers(parties: GongCall['parties'], userMap?: GongUserMap): any[] {
  return parties
    .filter(p => p.affiliation === 'External' && p.title)
    .map(p => {
      const title = p.title || '';
      const titleLower = title.toLowerCase();
      const isDecisionMaker =
        titleLower.includes('vp') || titleLower.includes('vice president') ||
        titleLower.includes('director') || titleLower.includes('chief') ||
        titleLower.includes('head of') || titleLower.includes('president') ||
        titleLower.includes('ceo') || titleLower.includes('cfo') ||
        titleLower.includes('cto') || titleLower.includes('coo') ||
        titleLower.includes('owner') || titleLower.includes('founder');

      return {
        name: p.name || null,
        title,
        involvement: isDecisionMaker ? 'decision_maker' : 'stakeholder',
        context: `Participated in call as ${p.affiliation} party`,
      };
    });
}

export function transformGongCall(call: GongCall, workspaceId: string, userMap?: GongUserMap): NormalizedConversation {
  const participants = (call.parties || []).map(p => {
    let name = p.name || null;
    let email = p.emailAddress || null;
    let title: string | null = p.title || null;

    if (p.userId && userMap) {
      const user = userMap.get(p.userId);
      if (user) {
        name = name || user.name;
        email = email || user.email;
        title = title || user.title || null;
      }
    }

    return {
      name,
      email,
      title,
      affiliation: p.affiliation,
      speakerId: p.speakerId || null,
      userId: p.userId || null,
    };
  });

  const isInternal = call.scope === 'Internal';
  const callDisposition = deriveCallDisposition(call);
  const decisionMakers = extractDecisionMakers(call.parties || [], userMap);

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
    duration_seconds: sanitizeInteger(call.duration),
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
    is_internal: isInternal,
    call_disposition: callDisposition,
    decision_makers_mentioned: decisionMakers,
  };
}
