import { query } from '../../db.js';
import { getConnectorCredentials } from '../../lib/credential-store.js';
import { getSlackWebhook, postBlocks, type SlackBlock } from './client.js';

export interface SlackPostOptions {
  thread_ts?: string;
  metadata?: {
    skill_id: string;
    run_id: string;
    workspace_id: string;
  };
  unfurl_links?: boolean;
  unfurl_media?: boolean;
}

export interface SlackMessageRef {
  ts: string;
  channel: string;
  ok: boolean;
  error?: string;
}

export class SlackAppClient {
  private static instance: SlackAppClient;

  static getInstance(): SlackAppClient {
    if (!SlackAppClient.instance) {
      SlackAppClient.instance = new SlackAppClient();
    }
    return SlackAppClient.instance;
  }

  async getBotToken(workspaceId: string): Promise<string | null> {
    const creds = await getConnectorCredentials(workspaceId, 'slack_app');
    if (creds?.bot_token) {
      return creds.bot_token;
    }
    return null;
  }

  async getDefaultChannel(workspaceId: string): Promise<string | null> {
    const result = await query<{ channel_id: string }>(
      `SELECT channel_id FROM slack_channel_config
       WHERE workspace_id = $1 AND is_default = true
       LIMIT 1`,
      [workspaceId]
    );
    if (result.rows.length > 0) return result.rows[0].channel_id;

    const firstResult = await query<{ channel_id: string }>(
      `SELECT channel_id FROM slack_channel_config
       WHERE workspace_id = $1
       ORDER BY created_at ASC LIMIT 1`,
      [workspaceId]
    );
    return firstResult.rows.length > 0 ? firstResult.rows[0].channel_id : null;
  }

  async getChannelForSkill(workspaceId: string, skillId: string): Promise<string | null> {
    const result = await query<{ channel_id: string }>(
      `SELECT channel_id FROM slack_channel_config
       WHERE workspace_id = $1 AND $2 = ANY(skills)
       LIMIT 1`,
      [workspaceId, skillId]
    );
    if (result.rows.length > 0) return result.rows[0].channel_id;
    return this.getDefaultChannel(workspaceId);
  }

  async postMessage(
    workspaceId: string,
    channel: string,
    blocks: SlackBlock[],
    options?: SlackPostOptions
  ): Promise<SlackMessageRef> {
    const botToken = await this.getBotToken(workspaceId);

    if (botToken) {
      return this.postViaAPI(botToken, channel, blocks, options);
    }

    return this.postViaWebhook(workspaceId, blocks);
  }

  async updateMessage(
    workspaceId: string,
    options: {
      channel: string;
      ts: string;
      blocks: SlackBlock[];
      text?: string;
    }
  ): Promise<{ ok: boolean; error?: string }> {
    const botToken = await this.getBotToken(workspaceId);
    if (!botToken) {
      return { ok: false, error: 'Bot token required for message updates' };
    }

    try {
      const response = await fetch('https://slack.com/api/chat.update', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel: options.channel,
          ts: options.ts,
          blocks: options.blocks,
          text: options.text || '',
        }),
      });

      const data = await response.json() as any;
      if (!data.ok) {
        console.error('[slack-app] Update message error:', data.error);
        return { ok: false, error: data.error };
      }
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[slack-app] Update message exception:', msg);
      return { ok: false, error: msg };
    }
  }

  async postEphemeral(
    workspaceId: string,
    options: {
      channel: string;
      user: string;
      text: string;
      thread_ts?: string;
    }
  ): Promise<{ ok: boolean; error?: string }> {
    const botToken = await this.getBotToken(workspaceId);
    if (!botToken) {
      return { ok: false, error: 'Bot token required for ephemeral messages' };
    }

    try {
      const response = await fetch('https://slack.com/api/chat.postEphemeral', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel: options.channel,
          user: options.user,
          text: options.text,
          thread_ts: options.thread_ts,
        }),
      });

      const data = await response.json() as any;
      if (!data.ok) {
        console.error('[slack-app] Ephemeral error:', data.error);
        return { ok: false, error: data.error };
      }
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  }

  async openModal(
    workspaceId: string,
    triggerId: string,
    view: Record<string, any>
  ): Promise<{ ok: boolean; error?: string }> {
    const botToken = await this.getBotToken(workspaceId);
    if (!botToken) {
      return { ok: false, error: 'Bot token required for modals' };
    }

    try {
      const response = await fetch('https://slack.com/api/views.open', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          trigger_id: triggerId,
          view,
        }),
      });

      const data = await response.json() as any;
      if (!data.ok) {
        console.error('[slack-app] views.open error:', data.error);
        return { ok: false, error: data.error };
      }
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[slack-app] openModal exception:', msg);
      return { ok: false, error: msg };
    }
  }

  private async postViaAPI(
    botToken: string,
    channel: string,
    blocks: SlackBlock[],
    options?: SlackPostOptions
  ): Promise<SlackMessageRef> {
    try {
      const payload: any = {
        channel,
        blocks,
        text: 'Pandora update',
        unfurl_links: options?.unfurl_links ?? false,
        unfurl_media: options?.unfurl_media ?? false,
      };

      if (options?.thread_ts) {
        payload.thread_ts = options.thread_ts;
      }

      if (options?.metadata) {
        payload.metadata = {
          event_type: 'pandora_skill_run',
          event_payload: options.metadata,
        };
      }

      const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json() as any;
      if (!data.ok) {
        console.error('[slack-app] chat.postMessage error:', data.error);
        return { ts: '', channel, ok: false, error: data.error };
      }

      return { ts: data.ts, channel: data.channel, ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[slack-app] postMessage exception:', msg);
      return { ts: '', channel, ok: false, error: msg };
    }
  }

  private async postViaWebhook(
    workspaceId: string,
    blocks: SlackBlock[]
  ): Promise<SlackMessageRef> {
    const webhookUrl = await getSlackWebhook(workspaceId);
    if (!webhookUrl) {
      return { ts: '', channel: '', ok: false, error: 'No webhook or bot token configured' };
    }

    const result = await postBlocks(webhookUrl, blocks);
    return { ts: '', channel: '', ok: result.ok, error: result.error };
  }
}

export function getSlackAppClient(): SlackAppClient {
  return SlackAppClient.getInstance();
}
