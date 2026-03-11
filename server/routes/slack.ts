/**
 * Slack deeplink utilities.
 *
 * Feature flag: FEATURE_SLACK_DEEPLINK_CONTEXT=true
 *
 * When enabled, appendPandoraContext() encodes a PandoraContext object into a
 * base64 URL param so the client can pick it up on route load and open Ask Pandora
 * with the relevant context pre-seeded (see client/src/App.tsx Slack deeplink effect).
 */

const DEEPLINK_FLAG = process.env.FEATURE_SLACK_DEEPLINK_CONTEXT === 'true';

export interface SlackPandoraContext {
  source: string;
  label?: string;
  value?: string;
  section?: string;
  skillId?: string;
  dealId?: string;
  dealName?: string;
  accountId?: string;
  accountName?: string;
  anomaly?: string;
}

/**
 * Appends a ?pandoraContext= query param to a URL when the feature flag is on.
 * The param value is a base64-encoded JSON string of a SlackPandoraContext.
 *
 * @example
 * const url = appendPandoraContext(
 *   `https://app.example.com/deals/${dealId}`,
 *   { source: 'slack_alert', label: 'Deal Risk', dealId, dealName }
 * );
 */
export function appendPandoraContext(baseUrl: string, ctx: SlackPandoraContext): string {
  if (!DEEPLINK_FLAG) return baseUrl;
  try {
    const encoded = Buffer.from(JSON.stringify(ctx)).toString('base64');
    const separator = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${separator}pandoraContext=${encodeURIComponent(encoded)}`;
  } catch {
    return baseUrl;
  }
}
