import { query, getClient } from '../../db.js';
import { HubSpotClient } from './client.js';

export interface RoleResolutionResult {
  created: number;
  updated: number;
  skipped: number;
  total: number;
}

interface ActivityProfile {
  totalActivities: number;
  meetings: number;
  calls: number;
  emails: number;
  firstActivity: Date | null;
  lastActivity: Date | null;
}

const TITLE_ROLE_MAP: Record<string, RegExp[]> = {
  executive_sponsor: [
    /\b(ceo|cfo|coo|cto|cmo|cro|president|founder|owner)\b/i,
    /\b(chief)\b/i,
    /\b(evp|svp)\b.*\b(sales|revenue|operations|growth)\b/i,
  ],
  decision_maker: [
    /\b(vp|vice president)\b/i,
    /\b(director)\b.*\b(sales|revenue|operations|marketing|growth)\b/i,
    /\b(head of)\b/i,
    /\b(general manager|gm)\b/i,
  ],
  champion: [
    /\b(manager|lead)\b.*\b(sales|revenue|revops|operations)\b/i,
    /\b(sales ops|revenue ops|revops)\b/i,
    /\b(enablement)\b/i,
  ],
  technical_evaluator: [
    /\b(engineer|developer|architect|analyst)\b/i,
    /\b(technical|solutions|implementation)\b/i,
    /\b(it manager|it director|systems)\b/i,
  ],
  influencer: [
    /\b(coordinator|specialist|associate|consultant)\b/i,
    /\b(advisor|strategist)\b/i,
  ],
  end_user: [
    /\b(rep|representative|sdr|bdr|ae|account executive)\b/i,
    /\b(agent|specialist|coordinator)\b/i,
  ],
};

/**
 * Infer buying role from contact title using pattern matching
 */
function inferRoleFromTitle(title: string | null): { role: string; confidence: number } {
  if (!title) {
    return { role: 'unknown', confidence: 0 };
  }

  for (const [role, patterns] of Object.entries(TITLE_ROLE_MAP)) {
    for (const pattern of patterns) {
      if (pattern.test(title)) {
        return { role, confidence: 0.7 }; // Title-inferred = 0.7 confidence
      }
    }
  }

  return { role: 'influencer', confidence: 0.3 }; // Default fallback
}

/**
 * Adjust role confidence based on activity patterns
 */
function adjustRoleFromActivity(
  baseRole: string,
  baseConfidence: number,
  activityProfile: ActivityProfile,
  dealMidpoint: Date | null
): { role: string; confidence: number } {
  let role = baseRole;
  let confidence = baseConfidence;

  // Most meetings → likely champion or decision_maker
  if (activityProfile.meetings >= 3 && !['executive_sponsor', 'decision_maker'].includes(role)) {
    role = 'champion';
    confidence = Math.min(confidence + 0.1, 0.9);
  }

  // Senior title but late engagement → executive sponsor
  if (
    ['decision_maker', 'executive_sponsor'].includes(role) &&
    dealMidpoint &&
    activityProfile.firstActivity &&
    activityProfile.firstActivity > dealMidpoint
  ) {
    role = 'executive_sponsor';
    confidence = Math.min(confidence + 0.1, 0.9);
  }

  // Heavy activity throughout → champion
  if (
    activityProfile.totalActivities >= 5 &&
    activityProfile.meetings >= 2 &&
    activityProfile.calls >= 1
  ) {
    if (role === 'influencer' || role === 'unknown') {
      role = 'champion';
      confidence = Math.min(confidence + 0.15, 0.9);
    }
  }

  return { role, confidence };
}

/**
 * Get activity profile for a contact on a specific deal
 */
async function getContactDealActivities(
  contactId: string,
  dealId: string
): Promise<ActivityProfile> {
  const result = await query<{
    total_activities: string;
    meetings: string;
    calls: string;
    emails: string;
    first_activity: string | null;
    last_activity: string | null;
  }>(
    `SELECT
      COUNT(a.id) as total_activities,
      COUNT(a.id) FILTER (WHERE a.activity_type = 'meeting') as meetings,
      COUNT(a.id) FILTER (WHERE a.activity_type = 'call') as calls,
      COUNT(a.id) FILTER (WHERE a.activity_type = 'email') as emails,
      MIN(a.timestamp) as first_activity,
      MAX(a.timestamp) as last_activity
    FROM activities a
    WHERE a.contact_id = $1 AND a.deal_id = $2`,
    [contactId, dealId]
  );

  const row = result.rows[0];

  return {
    totalActivities: parseInt(row?.total_activities || '0', 10),
    meetings: parseInt(row?.meetings || '0', 10),
    calls: parseInt(row?.calls || '0', 10),
    emails: parseInt(row?.emails || '0', 10),
    firstActivity: row?.first_activity ? new Date(row.first_activity) : null,
    lastActivity: row?.last_activity ? new Date(row.last_activity) : null,
  };
}

/**
 * Resolve HubSpot contact roles by inferring from associations + titles + activity
 * For each deal, gets associated contacts and infers their buying roles
 */
export async function resolveHubSpotContactRoles(
  hubspotClient: HubSpotClient,
  workspaceId: string
): Promise<RoleResolutionResult> {
  console.log(`[Contact Role Resolution] Starting for workspace ${workspaceId}`);

  // Get all deals for this workspace
  const dealsResult = await query<{
    id: string;
    source_id: string;
    name: string;
    created_at: string | null;
    close_date: string | null;
  }>(
    `SELECT id, source_id, name, created_at, close_date
     FROM deals
     WHERE workspace_id = $1 AND source = 'hubspot'`,
    [workspaceId]
  );

  const deals = dealsResult.rows;
  console.log(`[Contact Role Resolution] Found ${deals.length} deals`);

  if (deals.length === 0) {
    return { created: 0, updated: 0, skipped: 0, total: 0 };
  }

  // Batch fetch associations from HubSpot (deals → contacts)
  const dealSourceIds = deals.map(d => d.source_id);
  const associationsMap = await hubspotClient.batchGetAssociations('deals', 'contacts', dealSourceIds);

  console.log(`[Contact Role Resolution] Fetched associations for ${associationsMap.size} deals`);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const deal of deals) {
    const contactSourceIds = associationsMap.get(deal.source_id) || [];

    if (contactSourceIds.length === 0) {
      skipped++;
      continue;
    }

    const dealMidpoint = deal.created_at && deal.close_date
      ? new Date((new Date(deal.created_at).getTime() + new Date(deal.close_date).getTime()) / 2)
      : null;

    for (const contactSourceId of contactSourceIds) {
      // Find contact in our DB
      const contactResult = await query<{
        id: string;
        title: string | null;
        first_name: string | null;
        last_name: string | null;
        email: string | null;
      }>(
        `SELECT id, title, first_name, last_name, email
         FROM contacts
         WHERE workspace_id = $1 AND source_id = $2 AND source = 'hubspot'`,
        [workspaceId, contactSourceId]
      );

      if (contactResult.rows.length === 0) {
        skipped++;
        continue;
      }

      const contact = contactResult.rows[0];

      // Infer role from title
      let { role, confidence } = inferRoleFromTitle(contact.title);

      // Get activity profile
      const activityProfile = await getContactDealActivities(contact.id, deal.id);

      // Adjust role from activity signals
      ({ role, confidence } = adjustRoleFromActivity(role, confidence, activityProfile, dealMidpoint));

      // Upsert deal_contact
      const upsertResult = await query(
        `INSERT INTO deal_contacts (
          workspace_id, deal_id, contact_id, source, buying_role,
          role_source, role_confidence, created_at, updated_at
        )
        VALUES ($1, $2, $3, 'hubspot', $4, 'inferred', $5, NOW(), NOW())
        ON CONFLICT (workspace_id, deal_id, contact_id, source)
        DO UPDATE SET
          buying_role = CASE
            WHEN deal_contacts.role_source = 'crm' THEN deal_contacts.buying_role
            ELSE EXCLUDED.buying_role
          END,
          role_confidence = CASE
            WHEN deal_contacts.role_source = 'crm' THEN deal_contacts.role_confidence
            ELSE EXCLUDED.role_confidence
          END,
          updated_at = NOW()
        RETURNING (xmax = 0) AS inserted`,
        [workspaceId, deal.id, contact.id, role, confidence]
      );

      const wasInserted = upsertResult.rows[0]?.inserted;
      if (wasInserted) {
        created++;
      } else {
        updated++;
      }
    }
  }

  const result = { created, updated, skipped, total: created + updated + skipped };
  console.log(`[Contact Role Resolution] Complete:`, result);
  return result;
}
