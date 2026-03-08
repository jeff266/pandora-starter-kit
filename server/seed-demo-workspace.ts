/**
 * Demo Workspace Seeder
 *
 * Creates a pre-populated "TechScale Demo" workspace illustrating the value
 * of Pandora's stage normalization. The New Business pipeline uses standard
 * HubSpot camelCase stage keys with stage_normalized filled in (already mapped).
 * The Customer Expansion pipeline uses custom numeric stage IDs with
 * stage_normalized = NULL — the "changes that still need to be normalized."
 */

import { query } from './db.js';

const WS_ID   = '00000000-0000-0000-0000-000000000002';
const WS_NAME = 'TechScale Demo';
const WS_SLUG = 'demo';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 24 * 60 * 60 * 1000);
}

// Collision-proof deterministic IDs for demo rows (stable across re-seeds)
// Format: 00010000-NNNN-0000-0000-000000000000  (accounts)
//         00020000-NNNN-0000-0000-000000000000  (deals)
//         00030000-DDDD-SSSS-0000-000000000000  (stage history: D=dealN, S=stageIdx)
const acctId = (n: number)                    => `00010000-${n.toString(16).padStart(4,'0')}-0000-0000-000000000000`;
const dealId = (n: number)                    => `00020000-${n.toString(16).padStart(4,'0')}-0000-0000-000000000000`;
const histId = (dealN: number, idx: number)   => `00030000-${dealN.toString(16).padStart(4,'0')}-${idx.toString(16).padStart(4,'0')}-0000-000000000000`;

// ─── Stage normalization maps ──────────────────────────────────────────────────

// New Business pipeline: standard HubSpot camelCase keys — all normalized
const NB_NORM: Record<string, string> = {
  appointmentscheduled:  'qualification',
  qualifiedtobuy:        'qualification',
  presentationscheduled: 'evaluation',
  decisionmakerboughtin: 'decision',
  contractsent:          'negotiation',
  closedwon:             'closed_won',
  closedlost:            'closed_lost',
};

// Customer Expansion pipeline: numeric IDs from a custom HubSpot pipeline.
// stage_normalized is intentionally NOT set — these need normalization.
const EXP_STAGES = ['2110000001', '2110000002', '2110000003', '2110000004', 'closedwon', 'closedlost'];
const EXP_NORM: Record<string, string | null> = {
  '2110000001': null,   // Health Check — not yet normalized
  '2110000002': null,   // Expansion Identified — not yet normalized
  '2110000003': null,   // Proposal Reviewed — not yet normalized
  '2110000004': null,   // Contract Negotiation — not yet normalized
  closedwon:    'closed_won',
  closedlost:   'closed_lost',
};

// ─── Accounts ─────────────────────────────────────────────────────────────────

const ACCOUNTS = [
  { n: 1, name: 'Apex Financial Group',    domain: 'apexfinancial.com',  industry: 'Financial Services', employees: 820,  arr: 95_000_000,  owner: 'Sarah Chen'   },
  { n: 2, name: 'BlueSky Analytics',       domain: 'blueskyanalytics.io', industry: 'Data & Analytics',  employees: 340,  arr: 42_000_000,  owner: 'Marcus Webb'  },
  { n: 3, name: 'CloudBridge Systems',     domain: 'cloudbridgesys.com', industry: 'Cloud Infrastructure', employees: 510, arr: 78_000_000, owner: 'Priya Patel'  },
  { n: 4, name: 'Dynamo Retail',           domain: 'dynamoretail.com',   industry: 'E-Commerce',         employees: 1200, arr: 210_000_000, owner: 'Tom Reyes'    },
  { n: 5, name: 'Echo Health Partners',    domain: 'echohealth.org',     industry: 'Healthcare',         employees: 430,  arr: 38_000_000,  owner: 'Sarah Chen'   },
  { n: 6, name: 'Granite Technologies',    domain: 'granitetech.com',    industry: 'IT Services',        employees: 290,  arr: 55_000_000,  owner: 'Marcus Webb'  },
];

// ─── Deals + stage journeys ────────────────────────────────────────────────────
//
// Each deal specifies:
//   acctN      — which account (by ACCOUNTS[].n)
//   name       — deal name
//   amount     — ACV in dollars
//   pipeline   — 'New Business' | 'Customer Expansion'
//   owner      — rep name
//   startDaysAgo — when the deal first entered the pipeline
//   journey    — ordered array of stage keys with duration in days each
//                Last entry = current stage (exited_at = null)
//
// New Business: stage keys are camelCase HubSpot; stage_normalized filled in
// Customer Expansion: stage keys are numeric; stage_normalized = null

interface JourneyStage { stage: string; days: number }

interface DealSpec {
  n: number;
  acctN: number;
  name: string;
  amount: number;
  pipeline: 'New Business' | 'Customer Expansion';
  owner: string;
  startDaysAgo: number;
  journey: JourneyStage[];
}

const DEALS: DealSpec[] = [
  // ── New Business — Closed Won ───────────────────────────────────────────────
  {
    n: 1, acctN: 1, name: 'Apex Financial — Enterprise Suite',
    amount: 85_000, pipeline: 'New Business', owner: 'Sarah Chen', startDaysAgo: 280,
    journey: [
      { stage: 'appointmentscheduled',  days: 8  },
      { stage: 'qualifiedtobuy',        days: 12 },
      { stage: 'presentationscheduled', days: 18 },
      { stage: 'decisionmakerboughtin', days: 22 },
      { stage: 'contractsent',          days: 10 },
      { stage: 'closedwon',             days: 0  },
    ],
  },
  {
    n: 2, acctN: 3, name: 'CloudBridge — Security Suite',
    amount: 62_000, pipeline: 'New Business', owner: 'Priya Patel', startDaysAgo: 240,
    journey: [
      { stage: 'appointmentscheduled',  days: 6  },
      { stage: 'qualifiedtobuy',        days: 14 },
      { stage: 'presentationscheduled', days: 20 },
      { stage: 'decisionmakerboughtin', days: 28 },
      { stage: 'contractsent',          days: 14 },
      { stage: 'closedwon',             days: 0  },
    ],
  },
  {
    n: 3, acctN: 5, name: 'Echo Health — EMR Integration',
    amount: 78_000, pipeline: 'New Business', owner: 'Sarah Chen', startDaysAgo: 220,
    journey: [
      { stage: 'appointmentscheduled',  days: 10 },
      { stage: 'qualifiedtobuy',        days: 16 },
      { stage: 'presentationscheduled', days: 22 },
      { stage: 'decisionmakerboughtin', days: 18 },
      { stage: 'contractsent',          days: 12 },
      { stage: 'closedwon',             days: 0  },
    ],
  },
  {
    n: 4, acctN: 2, name: 'BlueSky — Data Platform',
    amount: 120_000, pipeline: 'New Business', owner: 'Marcus Webb', startDaysAgo: 310,
    journey: [
      { stage: 'appointmentscheduled',  days: 5  },
      { stage: 'qualifiedtobuy',        days: 10 },
      { stage: 'presentationscheduled', days: 14 },
      { stage: 'decisionmakerboughtin', days: 30 },
      { stage: 'contractsent',          days: 18 },
      { stage: 'closedwon',             days: 0  },
    ],
  },

  // ── New Business — Closed Lost ──────────────────────────────────────────────
  {
    n: 5, acctN: 1, name: 'Apex Financial — Compliance Module',
    amount: 42_000, pipeline: 'New Business', owner: 'Marcus Webb', startDaysAgo: 200,
    journey: [
      { stage: 'appointmentscheduled',  days: 9  },
      { stage: 'qualifiedtobuy',        days: 15 },
      { stage: 'presentationscheduled', days: 25 },
      { stage: 'decisionmakerboughtin', days: 32 },
      { stage: 'closedlost',            days: 0  },
    ],
  },
  {
    n: 6, acctN: 3, name: 'CloudBridge — Infrastructure Suite',
    amount: 95_000, pipeline: 'New Business', owner: 'Priya Patel', startDaysAgo: 180,
    journey: [
      { stage: 'appointmentscheduled',  days: 7  },
      { stage: 'qualifiedtobuy',        days: 12 },
      { stage: 'presentationscheduled', days: 19 },
      { stage: 'contractsent',          days: 20 },
      { stage: 'closedlost',            days: 0  },
    ],
  },
  {
    n: 7, acctN: 6, name: 'Granite — Workforce Automation',
    amount: 38_000, pipeline: 'New Business', owner: 'Tom Reyes', startDaysAgo: 160,
    journey: [
      { stage: 'appointmentscheduled',  days: 11 },
      { stage: 'qualifiedtobuy',        days: 18 },
      { stage: 'presentationscheduled', days: 24 },
      { stage: 'closedlost',            days: 0  },
    ],
  },
  {
    n: 8, acctN: 4, name: 'Dynamo — Analytics Add-on',
    amount: 28_000, pipeline: 'New Business', owner: 'Tom Reyes', startDaysAgo: 150,
    journey: [
      { stage: 'appointmentscheduled',  days: 6  },
      { stage: 'qualifiedtobuy',        days: 14 },
      { stage: 'closedlost',            days: 0  },
    ],
  },

  // ── New Business — Active (open) ────────────────────────────────────────────
  {
    n: 9, acctN: 4, name: 'Dynamo — Commerce Platform',
    amount: 110_000, pipeline: 'New Business', owner: 'Priya Patel', startDaysAgo: 72,
    journey: [
      { stage: 'appointmentscheduled',  days: 8  },
      { stage: 'qualifiedtobuy',        days: 12 },
      { stage: 'presentationscheduled', days: 14 },
      { stage: 'decisionmakerboughtin', days: 18 },
      { stage: 'contractsent',          days: 20 },  // current — still open
    ],
  },
  {
    n: 10, acctN: 2, name: 'BlueSky — API Access Tier',
    amount: 32_000, pipeline: 'New Business', owner: 'Marcus Webb', startDaysAgo: 55,
    journey: [
      { stage: 'appointmentscheduled',  days: 7  },
      { stage: 'qualifiedtobuy',        days: 11 },
      { stage: 'presentationscheduled', days: 17 },
      { stage: 'decisionmakerboughtin', days: 20 },  // current
    ],
  },
  {
    n: 11, acctN: 6, name: 'Granite — IT Automation Suite',
    amount: 88_000, pipeline: 'New Business', owner: 'Marcus Webb', startDaysAgo: 48,
    journey: [
      { stage: 'appointmentscheduled',  days: 9  },
      { stage: 'qualifiedtobuy',        days: 13 },
      { stage: 'presentationscheduled', days: 26 },  // current
    ],
  },
  {
    n: 12, acctN: 5, name: 'Echo Health — Provider Portal',
    amount: 55_000, pipeline: 'New Business', owner: 'Sarah Chen', startDaysAgo: 28,
    journey: [
      { stage: 'appointmentscheduled',  days: 8  },
      { stage: 'qualifiedtobuy',        days: 20 },  // current
    ],
  },

  // ── Customer Expansion — numeric IDs, stage_normalized = NULL ───────────────
  {
    n: 13, acctN: 1, name: 'Apex Financial — Seat Expansion',
    amount: 35_000, pipeline: 'Customer Expansion', owner: 'Sarah Chen', startDaysAgo: 55,
    journey: [
      { stage: '2110000001', days: 12 },
      { stage: '2110000002', days: 14 },
      { stage: '2110000003', days: 29 },   // current
    ],
  },
  {
    n: 14, acctN: 2, name: 'BlueSky — Premium Tier Upgrade',
    amount: 48_000, pipeline: 'Customer Expansion', owner: 'Marcus Webb', startDaysAgo: 46,
    journey: [
      { stage: '2110000001', days: 10 },
      { stage: '2110000002', days: 12 },
      { stage: '2110000003', days: 10 },
      { stage: '2110000004', days: 14 },   // current
    ],
  },
  {
    n: 15, acctN: 3, name: 'CloudBridge — Growth Package',
    amount: 30_000, pipeline: 'Customer Expansion', owner: 'Priya Patel', startDaysAgo: 22,
    journey: [
      { stage: '2110000001', days: 15 },
      { stage: '2110000002', days: 7  },   // current
    ],
  },
  {
    n: 16, acctN: 6, name: 'Granite — License Expansion',
    amount: 40_000, pipeline: 'Customer Expansion', owner: 'Tom Reyes', startDaysAgo: 32,
    journey: [
      { stage: '2110000001', days: 14 },
      { stage: '2110000002', days: 18 },   // current
    ],
  },
  {
    n: 17, acctN: 5, name: 'Echo Health — Module Add-on',
    amount: 52_000, pipeline: 'Customer Expansion', owner: 'Sarah Chen', startDaysAgo: 120,
    journey: [
      { stage: '2110000001', days: 10 },
      { stage: '2110000002', days: 12 },
      { stage: '2110000003', days: 14 },
      { stage: '2110000004', days: 16 },
      { stage: 'closedwon',  days: 0  },
    ],
  },
  {
    n: 18, acctN: 4, name: 'Dynamo — Enterprise Upgrade',
    amount: 65_000, pipeline: 'Customer Expansion', owner: 'Tom Reyes', startDaysAgo: 95,
    journey: [
      { stage: '2110000001', days: 12 },
      { stage: '2110000002', days: 18 },
      { stage: '2110000003', days: 22 },
      { stage: 'closedlost', days: 0  },
    ],
  },
];

// ─── Stage configs ─────────────────────────────────────────────────────────────

const STAGE_CONFIGS = [
  // New Business
  { pipeline: 'New Business', stage_id: 'appointmentscheduled',  stage_name: 'Demo Scheduled',      order: 0 },
  { pipeline: 'New Business', stage_id: 'qualifiedtobuy',        stage_name: 'Qualified to Buy',    order: 1 },
  { pipeline: 'New Business', stage_id: 'presentationscheduled', stage_name: 'Proposal Sent',       order: 2 },
  { pipeline: 'New Business', stage_id: 'decisionmakerboughtin', stage_name: 'Champion Identified', order: 3 },
  { pipeline: 'New Business', stage_id: 'contractsent',          stage_name: 'Contract Sent',       order: 4 },
  { pipeline: 'New Business', stage_id: 'closedwon',             stage_name: 'Closed Won',          order: 5 },
  { pipeline: 'New Business', stage_id: 'closedlost',            stage_name: 'Closed Lost',         order: 6 },
  // Customer Expansion (numeric IDs — stage_configs has display names; normalization mapping absent)
  { pipeline: 'Customer Expansion', stage_id: '2110000001', stage_name: 'Health Check',          order: 0 },
  { pipeline: 'Customer Expansion', stage_id: '2110000002', stage_name: 'Expansion Identified',  order: 1 },
  { pipeline: 'Customer Expansion', stage_id: '2110000003', stage_name: 'Proposal Reviewed',     order: 2 },
  { pipeline: 'Customer Expansion', stage_id: '2110000004', stage_name: 'Contract Negotiation',  order: 3 },
  { pipeline: 'Customer Expansion', stage_id: 'closedwon',  stage_name: 'Expansion Closed',      order: 4 },
  { pipeline: 'Customer Expansion', stage_id: 'closedlost', stage_name: 'No Expansion',          order: 5 },
];

// ─── Main seeder ───────────────────────────────────────────────────────────────

export async function seedDemoWorkspace(): Promise<void> {
  const existing = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM workspaces WHERE id = $1`,
    [WS_ID]
  );
  if (existing.rows[0].count > 0) return;

  console.log('[DemoSeed] Seeding demo workspace...');

  // 1. Workspace
  await query(
    `INSERT INTO workspaces (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
    [WS_ID, WS_NAME, WS_SLUG]
  );

  // 2. Grant all existing users access
  const allUsers = await query<{ id: string }>(`SELECT id FROM users`);
  for (const u of allUsers.rows) {
    await query(
      `INSERT INTO user_workspaces (user_id, workspace_id, role) VALUES ($1, $2, 'admin') ON CONFLICT DO NOTHING`,
      [u.id, WS_ID]
    );
  }

  // 3. Accounts
  for (const acct of ACCOUNTS) {
    await query(
      `INSERT INTO accounts (id, workspace_id, source, source_id, name, domain, industry, employee_count, annual_revenue, owner, created_at)
       VALUES ($1,$2,'demo',$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
      [acctId(acct.n), WS_ID, `demo-acct-${acct.n}`, acct.name, acct.domain, acct.industry, acct.employees, acct.arr, acct.owner, daysAgo(400)]
    );
  }

  // 4. Stage configs
  for (const sc of STAGE_CONFIGS) {
    await query(
      `INSERT INTO stage_configs (workspace_id, pipeline_name, stage_id, stage_name, display_order, is_active)
       VALUES ($1,$2,$3,$4,$5,true) ON CONFLICT DO NOTHING`,
      [WS_ID, sc.pipeline, sc.stage_id, sc.stage_name, sc.order]
    );
  }

  // 5. Deals + stage history
  for (const deal of DEALS) {
    const dId     = dealId(deal.n);
    const aId     = acctId(deal.acctN);
    const isNB    = deal.pipeline === 'New Business';
    const normMap = isNB ? NB_NORM : EXP_NORM;

    // Build stage timeline
    let cursor = daysAgo(deal.startDaysAgo);
    const timeline: Array<{ stage: string; enteredAt: Date; exitedAt: Date | null; durationDays: number }> = [];
    for (let i = 0; i < deal.journey.length; i++) {
      const { stage, days } = deal.journey[i];
      const isLast = i === deal.journey.length - 1;
      const enteredAt = new Date(cursor);
      const exitedAt  = isLast ? null : addDays(cursor, days);
      timeline.push({ stage, enteredAt, exitedAt, durationDays: isLast ? 0 : days });
      if (!isLast) cursor = exitedAt!;
    }

    // Current stage = last in journey
    const currentStage = deal.journey[deal.journey.length - 1].stage;
    const stageNorm    = normMap[currentStage] ?? null;
    const isClosed     = currentStage === 'closedwon' || currentStage === 'closedlost';
    const closeDate    = isClosed ? cursor : addDays(new Date(), 45);

    await query(
      `INSERT INTO deals (id, workspace_id, source, source_id, name, amount, stage, stage_normalized,
         close_date, owner, pipeline, created_at, updated_at, account_id)
       VALUES ($1,$2,'demo',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO NOTHING`,
      [dId, WS_ID, `demo-deal-${deal.n}`, deal.name, deal.amount,
       currentStage, stageNorm, closeDate, deal.owner, deal.pipeline,
       daysAgo(deal.startDaysAgo), new Date(), aId]
    );

    // Stage history rows
    for (let i = 0; i < timeline.length; i++) {
      const entry    = timeline[i];
      const histNorm = normMap[entry.stage] ?? null;
      await query(
        `INSERT INTO deal_stage_history (id, workspace_id, deal_id, stage, stage_normalized,
           entered_at, exited_at, duration_days, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'demo') ON CONFLICT (id) DO NOTHING`,
        [histId(deal.n, i), WS_ID, dId, entry.stage, histNorm,
         entry.enteredAt, entry.exitedAt, entry.durationDays]
      );
    }
  }

  console.log(`[DemoSeed] Seeded workspace "${WS_NAME}": ${ACCOUNTS.length} accounts, ${DEALS.length} deals`);
}
