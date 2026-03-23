/**
 * Google Calendar Sync Adapter
 *
 * Syncs Google Calendar events to calendar_events table and resolves
 * attendees to deals via contacts junction.
 *
 * Sync window: 7 days back, 14 days forward
 * Sync frequency: 15 minutes (configured in scheduler)
 */

import { google } from 'googleapis';
import { query } from '../../db.js';
import { createLogger } from '../../utils/logger.js';
import { decryptCredentials } from '../../lib/encryption.js';

const logger = createLogger('google-calendar');

// Sync window: 7 days back, 14 days forward
const SYNC_DAYS_BACK = 7;
const SYNC_DAYS_FORWARD = 14;

export async function syncGoogleCalendar(workspaceId: string): Promise<{
  synced: number;
  resolved: number;
  errors: string[];
}> {
  const errors: string[] = [];

  // 1. Get credentials from connections table
  const connResult = await query(
    `SELECT credentials FROM connections
     WHERE workspace_id = $1 AND connector_name = 'google-calendar' AND status != 'disconnected'`,
    [workspaceId]
  );

  if (connResult.rows.length === 0) {
    logger.info('No google-calendar connection found — skipping', { workspaceId });
    return { synced: 0, resolved: 0, errors: [] };
  }

  const credentials = decryptCredentials(connResult.rows[0].credentials);

  // 2. Build Google Calendar client
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALENDAR_CALLBACK_URL || process.env.GOOGLE_CALLBACK_URL
  );

  auth.setCredentials({
    access_token: credentials.accessToken,
    refresh_token: credentials.refreshToken,
  });

  // Auto-refresh: handle token expiry
  auth.on('tokens', async (tokens) => {
    if (tokens.refresh_token) {
      // Update stored refresh token
      const newCredentials = decryptCredentials(connResult.rows[0].credentials);
      newCredentials.refreshToken = tokens.refresh_token;
      if (tokens.access_token) {
        newCredentials.accessToken = tokens.access_token;
      }

      // Re-encrypt and update
      const { encryptCredentials } = await import('../../lib/encryption.js');
      const encrypted = encryptCredentials(newCredentials);

      await query(
        `UPDATE connections
         SET credentials = $1, updated_at = now()
         WHERE workspace_id = $2 AND connector_name = 'google-calendar'`,
        [JSON.stringify(encrypted), workspaceId]
      );
    }
  });

  const calendar = google.calendar({ version: 'v3', auth });

  // 3. Fetch events in sync window
  const timeMin = new Date();
  timeMin.setDate(timeMin.getDate() - SYNC_DAYS_BACK);

  const timeMax = new Date();
  timeMax.setDate(timeMax.getDate() + SYNC_DAYS_FORWARD);

  let events: any[] = [];
  let pageToken: string | undefined;

  do {
    try {
      const response = await calendar.events.list({
        calendarId: 'primary',
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 250,
        pageToken,
      });

      events = events.concat(response.data.items || []);
      pageToken = response.data.nextPageToken || undefined;
    } catch (err: any) {
      logger.error('Error fetching calendar events', { error: err?.message, workspaceId });
      errors.push(`Fetch error: ${err.message}`);
      break;
    }
  } while (pageToken);

  logger.info('Fetched calendar events', { workspaceId, count: events.length });

  // 4. Filter: exclude events where user declined or all-day non-work events
  const relevantEvents = events.filter(event => {
    if (event.status === 'cancelled') return false;
    // Check if workspace user accepted/tentative (not declined)
    const selfAttendee = event.attendees?.find((a: any) => a.self);
    if (selfAttendee?.responseStatus === 'declined') return false;
    return true;
  });

  // 5. Upsert events to calendar_events table
  let synced = 0;

  for (const event of relevantEvents) {
    try {
      const startTime = event.start?.dateTime || event.start?.date;
      const endTime = event.end?.dateTime || event.end?.date;

      if (!startTime) continue;

      // Extract Google Meet link if present
      const meetLink = event.conferenceData?.entryPoints
        ?.find((ep: any) => ep.entryPointType === 'video')?.uri || null;

      await query(
        `INSERT INTO calendar_events (
          workspace_id, google_event_id, calendar_id, title, description,
          location, start_time, end_time, is_all_day, timezone,
          attendees, organizer_email, creator_email, status,
          html_link, meet_link, last_synced_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, now())
        ON CONFLICT (workspace_id, google_event_id) DO UPDATE SET
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          location = EXCLUDED.location,
          start_time = EXCLUDED.start_time,
          end_time = EXCLUDED.end_time,
          attendees = EXCLUDED.attendees,
          organizer_email = EXCLUDED.organizer_email,
          status = EXCLUDED.status,
          html_link = EXCLUDED.html_link,
          meet_link = EXCLUDED.meet_link,
          last_synced_at = now()`,
        [
          workspaceId,
          event.id,
          'primary',
          event.summary || null,
          event.description || null,
          event.location || null,
          startTime,
          endTime,
          !event.start?.dateTime,  // is_all_day if no dateTime
          event.start?.timeZone || null,
          JSON.stringify(event.attendees || []),
          event.organizer?.email || null,
          event.creator?.email || null,
          event.status || 'confirmed',
          event.htmlLink || null,
          meetLink,
        ]
      );

      synced++;
    } catch (err: any) {
      logger.error('Error upserting calendar event', { error: err?.message, eventId: event.id });
      errors.push(`Upsert error for ${event.id}: ${err.message}`);
    }
  }

  // 6. Resolve attendees to deals
  const resolved = await resolveAttendeesToDeals(workspaceId);

  // 7. Update connection last_sync_at
  await query(
    `UPDATE connections SET last_sync_at = now(), status = 'synced'
     WHERE workspace_id = $1 AND connector_name = 'google-calendar'`,
    [workspaceId]
  );

  logger.info('Calendar sync complete', { workspaceId, synced, resolved });
  return { synced, resolved, errors };
}

// Resolve calendar event attendees to deal IDs
async function resolveAttendeesToDeals(workspaceId: string): Promise<number> {
  // Get all events that haven't been resolved yet or were updated recently
  const eventsResult = await query(
    `SELECT id, attendees FROM calendar_events
     WHERE workspace_id = $1
       AND start_time >= NOW() - INTERVAL '7 days'
       AND start_time <= NOW() + INTERVAL '14 days'`,
    [workspaceId]
  );

  let resolved = 0;

  for (const event of eventsResult.rows) {
    const attendees = event.attendees || [];
    const attendeeEmails = attendees
      .map((a: any) => a.email)
      .filter((email: string) => email && !email.includes('calendar.google.com'));

    if (attendeeEmails.length === 0) continue;

    // Resolve emails → deal IDs via contacts → deal_contacts
    const dealResult = await query(
      `SELECT DISTINCT dc.deal_id
       FROM contacts c
       JOIN deal_contacts dc ON c.id = dc.contact_id
       WHERE c.workspace_id = $1
         AND LOWER(c.email) = ANY($2::text[])`,
      [workspaceId, attendeeEmails.map((e: string) => e.toLowerCase())]
    );

    const dealIds = dealResult.rows.map((r: any) => r.deal_id);

    if (dealIds.length > 0) {
      await query(
        `UPDATE calendar_events
         SET resolved_deal_ids = $1::uuid[]
         WHERE id = $2`,
        [dealIds, event.id]
      );
      resolved++;
    }
  }

  return resolved;
}
