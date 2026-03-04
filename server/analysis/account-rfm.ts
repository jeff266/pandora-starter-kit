import { query } from '../db.js';

export interface AccountRFMResult {
  r: 'High' | 'Low';
  f: 'High' | 'Low';
  m: 'High' | 'Low';
  recencyDays: number;
  uniqueContacts: number;
  openDealValue: number;
  segment: string;
  action: string;
  signals: string;
  playbook: string;
  icon: string;
  priority: number;
  colorKey: string;
}

type Band = 'High' | 'Low';
type SegmentKey = `${Band}-${Band}-${Band}`;

interface SegmentDef {
  segment: string;
  action: string;
  signals: string;
  playbook: string;
  icon: string;
  priority: number;
  colorKey: string;
}

const SEGMENT_MAP: Record<SegmentKey, SegmentDef> = {
  'High-High-High': {
    segment: 'Champions',
    action: 'Protect & Expand',
    signals: 'Multiple stakeholders active across departments, strong usage, large current spend with room to grow.',
    playbook: 'Executive sponsorship, strategic QBRs, co-development opportunities, case study candidates, proactive expansion plays.',
    icon: '🏆',
    priority: 1,
    colorKey: 'green',
  },
  'Low-High-High': {
    segment: 'Going Dark',
    action: 'Rescue Immediately',
    signals: 'Historically strong account with broad engagement that has recently gone quiet. Highest churn risk segment.',
    playbook: 'Executive-to-executive outreach, emergency QBR, voice-of-customer interviews, proactive renewal discussion, competitive displacement defense.',
    icon: '🚨',
    priority: 2,
    colorKey: 'red',
  },
  'High-High-Low': {
    segment: 'Underleveraged',
    action: 'Expand Wallet',
    signals: 'Highly engaged, multi-threaded, but spending well below addressable wallet share.',
    playbook: 'Whitespace analysis, cross-sell campaigns, executive business reviews focused on ROI of expansion, land-and-expand into new departments.',
    icon: '📈',
    priority: 3,
    colorKey: 'blue',
  },
  'Low-Low-High': {
    segment: 'Sleeping Giant',
    action: 'Re-Engage Urgently',
    signals: 'High-value contract but no meaningful engagement. Renewal at serious risk — likely evaluating alternatives.',
    playbook: 'C-suite intervention, new value proposition, reactivation campaign with business case refresh, consider strategic concessions to re-engage.',
    icon: '💤',
    priority: 3,
    colorKey: 'rose',
  },
  'High-Low-High': {
    segment: 'Single-Threaded Risk',
    action: 'Multi-Thread Now',
    signals: 'Big account, recent activity, but only 1–2 contacts engaged. Champion dependency = churn risk.',
    playbook: 'Urgent multi-threading campaign, executive alignment meetings, expand user base across departments, map the full buying committee.',
    icon: '⚠️',
    priority: 4,
    colorKey: 'orange',
  },
  'High-Low-Low': {
    segment: 'Early Stage',
    action: 'Qualify or Disqualify',
    signals: 'Recent engagement but narrow and small. Could be early pipeline or a tire kicker.',
    playbook: 'Discovery calls, ICP validation, POC or pilot offer, set clear next steps with timelines to test seriousness.',
    icon: '🔍',
    priority: 5,
    colorKey: 'purple',
  },
  'Low-High-Low': {
    segment: 'Fading Interest',
    action: 'Nurture or Deprioritize',
    signals: 'Was broadly engaged but recency dropped and spend is low. Interest may have peaked without converting.',
    playbook: 'Automated nurture sequence, targeted content based on past engagement patterns, periodic check-ins but don\'t over-invest.',
    icon: '📉',
    priority: 6,
    colorKey: 'yellow',
  },
  'Low-Low-Low': {
    segment: 'Dead Zone',
    action: 'Archive & Reallocate',
    signals: 'No engagement, no multi-threading, low value. Not your ICP or a lost cause.',
    playbook: 'Move to automated-only nurture, free up AE/CSM capacity for higher-value segments, revisit quarterly with light-touch outreach only.',
    icon: '🪦',
    priority: 8,
    colorKey: 'stone',
  },
};

const RECENCY_THRESHOLD_DAYS = 30;
const FREQUENCY_THRESHOLD_CONTACTS = 3;

const workspaceMedianCache = new Map<string, { median: number; cachedAt: number }>();
const MEDIAN_TTL_MS = 60 * 60 * 1000;

async function getWorkspaceMedianDealValue(workspaceId: string): Promise<number> {
  const cached = workspaceMedianCache.get(workspaceId);
  if (cached && Date.now() - cached.cachedAt < MEDIAN_TTL_MS) {
    return cached.median;
  }
  try {
    const res = await query<{ median: string }>(
      `SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY amount) AS median
       FROM deals
       WHERE workspace_id = $1
         AND amount > 0
         AND stage NOT IN ('closed_won','closed_lost','Closed Won','Closed Lost')`,
      [workspaceId]
    );
    const median = parseFloat(res.rows[0]?.median ?? '0') || 0;
    workspaceMedianCache.set(workspaceId, { median, cachedAt: Date.now() });
    return median;
  } catch {
    return 0;
  }
}

export async function computeAccountRFM(
  workspaceId: string,
  accountId: string
): Promise<AccountRFMResult> {
  const [recencyRes, frequencyRes, monetaryRes, medianDeal] = await Promise.all([
    query<{ last_engaged: string | null }>(
      `SELECT MAX(ts) AS last_engaged FROM (
         SELECT MAX(a.created_at) AS ts
           FROM activities a
           WHERE a.workspace_id = $1 AND a.account_id = $2
         UNION ALL
         SELECT MAX(c.created_at) AS ts
           FROM conversations c
           WHERE c.workspace_id = $1 AND c.account_id = $2
       ) sub`,
      [workspaceId, accountId]
    ),
    query<{ unique_contacts: string }>(
      `SELECT COUNT(DISTINCT a.contact_id) AS unique_contacts
       FROM activities a
       JOIN contacts con ON con.id = a.contact_id AND con.workspace_id = a.workspace_id
       WHERE con.account_id = $1
         AND a.workspace_id = $2
         AND a.created_at >= NOW() - INTERVAL '90 days'
         AND a.contact_id IS NOT NULL`,
      [accountId, workspaceId]
    ),
    query<{ open_value: string }>(
      `SELECT COALESCE(SUM(amount), 0) AS open_value
       FROM deals
       WHERE account_id = $1
         AND workspace_id = $2
         AND stage NOT IN ('closed_won','closed_lost','Closed Won','Closed Lost')`,
      [accountId, workspaceId]
    ),
    getWorkspaceMedianDealValue(workspaceId),
  ]);

  const lastEngaged = recencyRes.rows[0]?.last_engaged
    ? new Date(recencyRes.rows[0].last_engaged)
    : null;
  const recencyDays = lastEngaged
    ? Math.floor((Date.now() - lastEngaged.getTime()) / 86_400_000)
    : 9999;

  const uniqueContacts = parseInt(frequencyRes.rows[0]?.unique_contacts ?? '0');
  const openDealValue = parseFloat(monetaryRes.rows[0]?.open_value ?? '0');

  const r: Band = recencyDays <= RECENCY_THRESHOLD_DAYS ? 'High' : 'Low';
  const f: Band = uniqueContacts >= FREQUENCY_THRESHOLD_CONTACTS ? 'High' : 'Low';
  const monetaryFloor = medianDeal > 0 ? medianDeal : 1;
  const m: Band = openDealValue >= monetaryFloor ? 'High' : 'Low';

  const key: SegmentKey = `${r}-${f}-${m}`;
  const def = SEGMENT_MAP[key];

  return {
    r, f, m,
    recencyDays,
    uniqueContacts,
    openDealValue,
    ...def,
  };
}

export async function computeAccountRFMBatch(
  workspaceId: string,
  accountIds: string[]
): Promise<Map<string, AccountRFMResult>> {
  const results = new Map<string, AccountRFMResult>();
  await Promise.all(
    accountIds.map(async (id) => {
      try {
        const rfm = await computeAccountRFM(workspaceId, id);
        results.set(id, rfm);
      } catch (err) {
        console.error(`[account-rfm] Failed for account ${id}:`, err);
      }
    })
  );
  return results;
}

export async function persistAccountRFM(
  workspaceId: string,
  accountId: string,
  rfm: AccountRFMResult
): Promise<void> {
  await query(
    `UPDATE account_scores
     SET rfm_segment          = $3,
         rfm_r                = $4,
         rfm_f                = $5,
         rfm_m                = $6,
         rfm_recency_days     = $7,
         rfm_unique_contacts  = $8,
         rfm_open_deal_value  = $9,
         rfm_computed_at      = NOW()
     WHERE workspace_id = $1 AND account_id = $2`,
    [
      workspaceId, accountId,
      rfm.segment, rfm.r, rfm.f, rfm.m,
      rfm.recencyDays, rfm.uniqueContacts, rfm.openDealValue,
    ]
  );
}
