import { query } from '../db.js';

export class SlackAppClient {
  async sendMessage(workspaceId: string, channel: string, text: string): Promise<void> {
    const connResult = await query<{ credentials: any }>(
      `SELECT credentials FROM workspace_connectors WHERE workspace_id = $1 AND connector_type = 'slack' AND status = 'connected' LIMIT 1`,
      [workspaceId]
    );
    if (!connResult.rows.length) {
      throw new Error('No Slack connector configured for workspace');
    }
    const { botToken } = connResult.rows[0].credentials ?? {};
    if (!botToken) throw new Error('Slack bot token not found');

    const resp = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${botToken}` },
      body: JSON.stringify({ channel, text }),
    });
    const data = await resp.json() as { ok: boolean; error?: string };
    if (!data.ok) throw new Error(`Slack API error: ${data.error}`);
  }
}
