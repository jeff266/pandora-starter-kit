import { HubSpotClient } from './client.js';
import { getConnectorCredentials } from '../../lib/credential-store.js';
import { hubspotFetch } from '../../utils/throttle.js';
import { query } from '../../db.js';

export interface ResolvedQuota {
  rep_name: string;
  rep_email: string;
  quota_amount: number;
  period_start: string;
  period_end: string;
  period_label: string;
  period_type: string;
  hubspot_goal_id: string;
}

interface HubSpotGoalTarget {
  id: string;
  properties: Record<string, string | null>;
}

interface HubSpotOwnerWithUserId {
  id: string;
  userId: number;
  firstName: string;
  lastName: string;
  email: string;
}

const BASE_URL = 'https://api.hubapi.com';

async function hubspotRequest<T>(accessToken: string, endpoint: string): Promise<T> {
  const url = `${BASE_URL}${endpoint}`;
  const response = await hubspotFetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HubSpot API error: ${response.status} - ${errorText}`);
  }

  return response.json() as Promise<T>;
}

async function fetchAllGoalTargets(accessToken: string): Promise<HubSpotGoalTarget[]> {
  const allGoals: HubSpotGoalTarget[] = [];
  let after: string | undefined;
  const properties = [
    'hs_goal_name',
    'hs_target_amount',
    'hs_start_datetime',
    'hs_end_datetime',
    'hs_assignee_user_id',
    'hs_assignee_team_id',
    'hs_created_by_user_id',
  ].join(',');

  do {
    let endpoint = `/crm/v3/objects/goal_targets?limit=100&properties=${properties}`;
    if (after) endpoint += `&after=${after}`;

    const response = await hubspotRequest<{
      results: HubSpotGoalTarget[];
      paging?: { next?: { after: string } };
    }>(accessToken, endpoint);

    allGoals.push(...response.results);
    after = response.paging?.next?.after;
  } while (after);

  return allGoals;
}

async function fetchAllOwnersWithUserId(accessToken: string): Promise<Map<string, { email: string; name: string }>> {
  const ownerMap = new Map<string, { email: string; name: string }>();
  let after: string | undefined;

  do {
    let endpoint = '/crm/v3/owners?limit=100';
    if (after) endpoint += `&after=${after}`;

    const response = await hubspotRequest<{
      results: HubSpotOwnerWithUserId[];
      paging?: { next?: { after: string } };
    }>(accessToken, endpoint);

    for (const owner of response.results) {
      const name = `${owner.firstName || ''} ${owner.lastName || ''}`.trim();
      if (owner.userId) {
        ownerMap.set(String(owner.userId), {
          email: owner.email,
          name: name || owner.email,
        });
      }
    }

    after = response.paging?.next?.after;
  } while (after);

  return ownerMap;
}

function detectPeriodType(startDate: Date, endDate: Date): string {
  const diffMs = endDate.getTime() - startDate.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffDays <= 35) return 'monthly';
  if (diffDays <= 100) return 'quarterly';
  return 'annual';
}

function generatePeriodLabel(startDate: Date, periodType: string): string {
  const year = startDate.getFullYear();
  const month = startDate.getMonth();

  if (periodType === 'monthly') {
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    return `${monthNames[month]} ${year}`;
  }

  if (periodType === 'quarterly') {
    const quarter = Math.floor(month / 3) + 1;
    return `Q${quarter} ${year}`;
  }

  return `FY${year}`;
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export async function fetchHubSpotGoals(workspaceId: string): Promise<{
  goals: ResolvedQuota[];
  warnings: string[];
  raw_count: number;
}> {
  const credentials = await getConnectorCredentials(workspaceId, 'hubspot');
  if (!credentials || !credentials.accessToken) {
    return { goals: [], warnings: ['No HubSpot credentials found'], raw_count: 0 };
  }

  const accessToken = credentials.accessToken as string;

  let rawGoals: HubSpotGoalTarget[];
  try {
    rawGoals = await fetchAllGoalTargets(accessToken);
  } catch (error: any) {
    if (error?.message?.includes('403')) {
      return { goals: [], warnings: ['missing_scope'], raw_count: 0 };
    }
    throw error;
  }

  const ownerMap = await fetchAllOwnersWithUserId(accessToken);

  const goals: ResolvedQuota[] = [];
  const warnings: string[] = [];

  for (const goal of rawGoals) {
    const props = goal.properties;
    const targetAmount = props.hs_target_amount ? parseFloat(props.hs_target_amount) : null;

    if (!targetAmount || isNaN(targetAmount)) {
      warnings.push(`Skipped goal ${goal.id}: no target amount`);
      continue;
    }

    const assigneeUserId = props.hs_assignee_user_id;
    const assigneeTeamId = props.hs_assignee_team_id;

    if (!assigneeUserId && assigneeTeamId) {
      warnings.push(`Skipped goal ${goal.id} ("${props.hs_goal_name || ''}"): team-level goal`);
      continue;
    }

    if (!assigneeUserId) {
      warnings.push(`Skipped goal ${goal.id}: no assignee user ID`);
      continue;
    }

    const owner = ownerMap.get(assigneeUserId);
    if (!owner) {
      warnings.push(`Skipped goal ${goal.id} ("${props.hs_goal_name || ''}"): unknown assignee userId ${assigneeUserId}`);
      continue;
    }

    const startDateStr = props.hs_start_datetime;
    const endDateStr = props.hs_end_datetime;

    if (!startDateStr || !endDateStr) {
      warnings.push(`Skipped goal ${goal.id}: missing date range`);
      continue;
    }

    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      warnings.push(`Skipped goal ${goal.id}: invalid date range`);
      continue;
    }

    const periodType = detectPeriodType(startDate, endDate);
    const periodLabel = generatePeriodLabel(startDate, periodType);

    goals.push({
      rep_name: owner.name,
      rep_email: owner.email,
      quota_amount: targetAmount,
      period_start: formatDate(startDate),
      period_end: formatDate(endDate),
      period_label: periodLabel,
      period_type: periodType,
      hubspot_goal_id: goal.id,
    });
  }

  return {
    goals,
    warnings,
    raw_count: rawGoals.length,
  };
}

export async function storeGoalsPreview(workspaceId: string, preview: any): Promise<void> {
  await query(
    `INSERT INTO context_layer (workspace_id, definitions)
     VALUES ($1, jsonb_build_object('pending_goals_preview', $2::jsonb))
     ON CONFLICT (workspace_id)
     DO UPDATE SET
       definitions = COALESCE(context_layer.definitions, '{}'::jsonb) || jsonb_build_object('pending_goals_preview', $2::jsonb),
       updated_at = NOW()`,
    [workspaceId, JSON.stringify(preview)]
  );
}

export async function getPendingGoalsPreview(workspaceId: string): Promise<any | null> {
  const result = await query<{ preview: any }>(
    `SELECT definitions->'pending_goals_preview' as preview
     FROM context_layer
     WHERE workspace_id = $1`,
    [workspaceId]
  );

  if (result.rows.length === 0) return null;
  return result.rows[0].preview || null;
}

export async function clearPendingGoalsPreview(workspaceId: string): Promise<void> {
  await query(
    `UPDATE context_layer
     SET definitions = COALESCE(definitions, '{}'::jsonb) - 'pending_goals_preview',
         updated_at = NOW()
     WHERE workspace_id = $1`,
    [workspaceId]
  );
}
