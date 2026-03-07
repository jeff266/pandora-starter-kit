export interface SlackSlashCommandPayload {
  command: string;
  text: string;
  user_id: string;
  user_name: string;
  team_id: string;
  channel_id: string;
  channel_name: string;
  response_url: string;
  trigger_id: string;
}

export interface SlackMessageEvent {
  type: string;
  subtype?: string;
  text?: string;
  user?: string;
  channel: string;
  channel_type?: string;
  ts: string;
  thread_ts?: string;
  team_id?: string;
  bot_id?: string;
}

export interface SlackInteractionPayload {
  type: string;
  action_id?: string;
  callback_id?: string;
  trigger_id: string;
  user: { id: string; username: string; team_id: string };
  team: { id: string; domain: string };
  channel?: { id: string; name: string };
  message?: { ts: string; blocks?: any[] };
  actions?: Array<{ action_id: string; value?: string; block_id?: string }>;
  view?: { id: string; callback_id: string; state: { values: any } };
}

export interface BlockKitRenderOptions {
  includeShareButton?: boolean;
  includeDeepLink?: boolean;
  ephemeral?: boolean;
}

export interface PandoraParentMessage {
  type: 'brief' | 'alert' | 'skill_run';
  data: Record<string, any>;
}

export interface SlackSessionEntry {
  threadId: string;
  expiresAt: number;
}

export type SlackBlock = Record<string, any>;
