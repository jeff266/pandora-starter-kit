/**
 * Activity Text Preprocessing Utility
 *
 * Shared utilities for cleaning and parsing activity body content:
 * 1. HTML cleanup
 * 2. Reply thread deduplication
 * 3. Email header parsing
 * 4. Direction + participant classification
 * 5. Combined cleaning entry points
 */

// ── 1. HTML cleanup ──────────────────────────────────────────────────────────

export function stripHtml(html: string): string {
  if (!html) return '';

  return html
    .replace(/<\/(p|div|h[1-6]|li|ul|ol|tr|td|th|br|section|article|header|footer)[^>]*>/gi, ' ') // block elements → space
    .replace(/<br\s*\/?>/gi, ' ') // <br> → space
    .replace(/<[^>]+>/g, '') // Remove remaining HTML tags
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&[a-z]+;/gi, ' ') // Catch-all for other entities
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}

// ── 2. Reply thread deduplication ───────────────────────────────────────────

export function stripReplyThreads(rawBody: string): string {
  if (!rawBody) return '';

  let cleaned = rawBody;

  // Remove <blockquote> tags (HubSpot/Gmail wrap quoted replies)
  cleaned = cleaned.replace(/<blockquote[^>]*>[\s\S]*?<\/blockquote>/gi, '');

  // Remove "On [date] [name] wrote:" reply markers and everything after
  cleaned = cleaned.replace(/On .{1,100} wrote:[\s\S]*$/i, '');

  // Remove "-----Original Message-----" divider blocks and everything after
  cleaned = cleaned.replace(/-----Original Message-----[\s\S]*$/i, '');
  cleaned = cleaned.replace(/_{5,}[\s\S]*$/i, ''); // Also match underscores

  // Remove repeating plain-text header blocks (second "To:/CC:/Subject:/Body:" indicates older message)
  const headerPattern = /To:\s*.+?\nCC:\s*.+?\nSubject:\s*.+?\nBody:/gi;
  const matches = cleaned.match(headerPattern);
  if (matches && matches.length > 1) {
    // Keep only first header block, strip everything after second occurrence
    const secondHeaderIndex = cleaned.indexOf(matches[1]);
    if (secondHeaderIndex > 0) {
      cleaned = cleaned.substring(0, secondHeaderIndex);
    }
  }

  return cleaned.trim();
}

// ── 3. Email header parsing ─────────────────────────────────────────────────

export interface EmailHeaders {
  to: string[];       // parsed email addresses
  cc: string[];
  bcc: string[];
  subject: string;
  bodyText: string;   // everything after "Body:\n"
  hasHeaders: boolean; // false if this is not an email-type activity
}

export function parseEmailHeaders(rawBody: string): EmailHeaders {
  if (!rawBody) {
    return { to: [], cc: [], bcc: [], subject: '', bodyText: '', hasHeaders: false };
  }

  // Check if this looks like an email with headers (starts with "To:")
  // Use [^\n]* for each header field to prevent cross-line matching
  const headerPattern = /^To:[^\S\n]*([^\n]+?)(?:\nCC:[^\S\n]*([^\n]*))?(?:\nBCC:[^\S\n]*([^\n]*))?(?:\nAttachment:[^\n]*)?\nSubject:[^\S\n]*([^\n]+)\nBody:[^\S\n]*([\s\S]+)/i;
  const match = rawBody.match(headerPattern);

  if (!match) {
    return { to: [], cc: [], bcc: [], subject: '', bodyText: rawBody, hasHeaders: false };
  }

  const parseAddresses = (field: string | undefined): string[] => {
    if (!field) return [];
    return field
      .split(/[;,]/)
      .map(addr => addr.trim())
      .filter(addr => addr.length > 0 && addr !== '--none--');
  };

  return {
    to: parseAddresses(match[1]),
    cc: parseAddresses(match[2]),
    bcc: parseAddresses(match[3]),
    subject: match[4]?.trim() || '',
    bodyText: match[5]?.trim() || '',
    hasHeaders: true,
  };
}

// ── 4. Direction + participant classification ───────────────────────────────

export interface EmailParticipants {
  direction: 'inbound' | 'outbound' | 'unknown';
  // inbound  = customer sent to rep (To: contains rep domain)
  // outbound = rep sent to customer (To: contains customer domain)
  prospectAddresses: string[];  // addresses on customer domains
  internalAddresses: string[];  // addresses on rep's company domain
  unknownAddresses: string[];   // addresses on unrecognized domains
}

export function classifyEmailParticipants(
  headers: EmailHeaders,
  repDomain: string
): EmailParticipants {
  if (!headers.hasHeaders || !repDomain) {
    return {
      direction: 'unknown',
      prospectAddresses: [],
      internalAddresses: [],
      unknownAddresses: [],
    };
  }

  const allAddresses = [...headers.to, ...headers.cc, ...headers.bcc];
  const prospectAddresses: string[] = [];
  const internalAddresses: string[] = [];
  const unknownAddresses: string[] = [];

  const repDomainLower = repDomain.toLowerCase();

  for (const addr of allAddresses) {
    const domain = addr.split('@')[1]?.toLowerCase();
    if (!domain) {
      unknownAddresses.push(addr);
      continue;
    }

    if (domain === repDomainLower) {
      internalAddresses.push(addr);
    } else {
      // All other domains are prospect domains (customer, partners, etc.)
      prospectAddresses.push(addr);
    }
  }

  // Direction: based on To: field only
  let direction: 'inbound' | 'outbound' | 'unknown' = 'unknown';
  if (headers.to.length > 0) {
    const toDomain = headers.to[0].split('@')[1]?.toLowerCase();
    if (toDomain === repDomainLower) {
      direction = 'inbound'; // Customer sent to rep
    } else if (toDomain) {
      direction = 'outbound'; // Rep sent to customer
    }
  }

  return {
    direction,
    prospectAddresses,
    internalAddresses,
    unknownAddresses,
  };
}

// ── 5. Combined cleaning entry point ────────────────────────────────────────

export function cleanActivityBody(rawBody: string, activityType?: string): string {
  if (!rawBody) return '';

  let cleaned = rawBody;

  // For email activities: parse headers first, use bodyText
  if (activityType === 'email') {
    const headers = parseEmailHeaders(rawBody);
    if (headers.hasHeaders) {
      cleaned = headers.bodyText;
    }
  }

  // Strip reply threads
  cleaned = stripReplyThreads(cleaned);

  // Strip HTML
  cleaned = stripHtml(cleaned);

  return cleaned.trim();
}

export function activityPreview(rawBody: string, maxChars: number, activityType?: string): string {
  const cleaned = cleanActivityBody(rawBody, activityType);
  if (cleaned.length <= maxChars) return cleaned;
  return cleaned.slice(0, maxChars) + '…';
}
