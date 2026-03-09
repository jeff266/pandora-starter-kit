/**
 * Demo Workspace Seeder
 *
 * Creates a pre-populated "TechScale Demo" workspace illustrating the value
 * of Pandora's stage normalization. The New Business pipeline uses standard
 * HubSpot camelCase stage keys with stage_normalized filled in (already mapped).
 * The Customer Expansion pipeline uses custom numeric stage IDs with
 * stage_normalized = NULL — the "changes that still need to be normalized."
 *
 * Also seeds: contacts, deal_contacts, conversations, conversation_signals,
 * email activities, and deal_insights (MEDDPIC qualification history).
 * Includes imaginary competitors: Vantora, Nexlify, Meridian Analytics,
 * Clausepoint, Synaptix — for competitive intelligence skill coverage.
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
const acctId    = (n: number)                    => `00010000-${n.toString(16).padStart(4,'0')}-0000-0000-000000000000`;
const dealId    = (n: number)                    => `00020000-${n.toString(16).padStart(4,'0')}-0000-0000-000000000000`;
const histId    = (dealN: number, idx: number)   => `00030000-${dealN.toString(16).padStart(4,'0')}-${idx.toString(16).padStart(4,'0')}-0000-000000000000`;
const contactId = (n: number)                    => `00040000-${n.toString(16).padStart(4,'0')}-0000-0000-000000000000`;
const dcId      = (dealN: number, cN: number)    => `00050000-${dealN.toString(16).padStart(4,'0')}-${cN.toString(16).padStart(4,'0')}-0000-000000000000`;
const convId    = (n: number)                    => `00060000-${n.toString(16).padStart(4,'0')}-0000-0000-000000000000`;
const actId     = (n: number)                    => `00070000-${n.toString(16).padStart(4,'0')}-0000-0000-000000000000`;
const sigId     = (n: number)                    => `00080000-${n.toString(16).padStart(4,'0')}-0000-0000-000000000000`;
const insightId = (n: number)                    => `00090000-${n.toString(16).padStart(4,'0')}-0000-0000-000000000000`;

// Rep email helper
function repEmail(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '.') + '@techscale.io';
}

// ─── Stage normalization maps ──────────────────────────────────────────────────

const NB_NORM: Record<string, string> = {
  appointmentscheduled:  'qualification',
  qualifiedtobuy:        'qualification',
  presentationscheduled: 'evaluation',
  decisionmakerboughtin: 'decision',
  contractsent:          'negotiation',
  closedwon:             'closed_won',
  closedlost:            'closed_lost',
};

const EXP_STAGES = ['2110000001', '2110000002', '2110000003', '2110000004', 'closedwon', 'closedlost'];
const EXP_NORM: Record<string, string | null> = {
  '2110000001': null,
  '2110000002': null,
  '2110000003': null,
  '2110000004': null,
  closedwon:    'closed_won',
  closedlost:   'closed_lost',
};

// ─── Accounts ─────────────────────────────────────────────────────────────────

const ACCOUNTS = [
  { n: 1, name: 'Apex Financial Group',    domain: 'apexfinancial.com',  industry: 'Financial Services',   employees: 820,  arr: 95_000_000,  owner: 'Sarah Chen'   },
  { n: 2, name: 'BlueSky Analytics',       domain: 'blueskyanalytics.io', industry: 'Data & Analytics',    employees: 340,  arr: 42_000_000,  owner: 'Marcus Webb'  },
  { n: 3, name: 'CloudBridge Systems',     domain: 'cloudbridgesys.com', industry: 'Cloud Infrastructure', employees: 510,  arr: 78_000_000,  owner: 'Priya Patel'  },
  { n: 4, name: 'Dynamo Retail',           domain: 'dynamoretail.com',   industry: 'E-Commerce',           employees: 1200, arr: 210_000_000, owner: 'Tom Reyes'    },
  { n: 5, name: 'Echo Health Partners',    domain: 'echohealth.org',     industry: 'Healthcare',            employees: 430,  arr: 38_000_000,  owner: 'Sarah Chen'   },
  { n: 6, name: 'Granite Technologies',    domain: 'granitetech.com',    industry: 'IT Services',           employees: 290,  arr: 55_000_000,  owner: 'Marcus Webb'  },
];

// ─── Contacts ──────────────────────────────────────────────────────────────────

interface ContactSpec {
  n: number;
  acctN: number;
  first: string;
  last: string;
  title: string;
  seniority: string;
  department: string;
  role: 'champion' | 'economic_buyer' | 'influencer';
}

const CONTACTS: ContactSpec[] = [
  // Apex Financial (acct 1)
  { n: 1,  acctN: 1, first: 'James',  last: 'Whitmore', title: 'CFO',                 seniority: 'C-Suite',  department: 'Finance',       role: 'economic_buyer' },
  { n: 2,  acctN: 1, first: 'Rachel', last: 'Torres',   title: 'VP Finance',          seniority: 'VP',       department: 'Finance',       role: 'champion'       },
  // BlueSky Analytics (acct 2)
  { n: 3,  acctN: 2, first: 'David',  last: 'Kim',      title: 'CTO',                 seniority: 'C-Suite',  department: 'Engineering',   role: 'champion'       },
  { n: 4,  acctN: 2, first: 'Priya',  last: 'Nair',     title: 'Head of Data',        seniority: 'Director', department: 'Data',          role: 'influencer'     },
  // CloudBridge (acct 3)
  { n: 5,  acctN: 3, first: 'Omar',   last: 'Hassan',   title: 'VP Engineering',      seniority: 'VP',       department: 'Engineering',   role: 'champion'       },
  { n: 6,  acctN: 3, first: 'Lisa',   last: 'Chen',     title: 'CISO',                seniority: 'C-Suite',  department: 'Security',      role: 'economic_buyer' },
  // Dynamo Retail (acct 4)
  { n: 7,  acctN: 4, first: 'Carlos', last: 'Rivera',   title: 'SVP Technology',      seniority: 'SVP',      department: 'Technology',    role: 'economic_buyer' },
  { n: 8,  acctN: 4, first: 'Mei',    last: 'Zhang',    title: 'Head of E-Commerce',  seniority: 'Director', department: 'E-Commerce',    role: 'champion'       },
  { n: 9,  acctN: 4, first: 'Tom',    last: 'Walsh',    title: 'IT Director',         seniority: 'Director', department: 'IT',            role: 'influencer'     },
  // Echo Health (acct 5)
  { n: 10, acctN: 5, first: 'Susan',  last: 'Park',     title: 'CMO',                 seniority: 'C-Suite',  department: 'Marketing',     role: 'economic_buyer' },
  { n: 11, acctN: 5, first: 'Kevin',  last: 'Grant',    title: 'Director of IT',      seniority: 'Director', department: 'IT',            role: 'champion'       },
  // Granite Technologies (acct 6)
  { n: 12, acctN: 6, first: 'Steve',  last: 'Olsen',    title: 'VP IT',               seniority: 'VP',       department: 'IT',            role: 'champion'       },
  { n: 13, acctN: 6, first: 'Alicia', last: 'Fonseca',  title: 'CFO',                 seniority: 'C-Suite',  department: 'Finance',       role: 'economic_buyer' },
  { n: 14, acctN: 6, first: 'Raj',    last: 'Mehta',    title: 'IT Manager',          seniority: 'Manager',  department: 'IT',            role: 'influencer'     },
  // Extra contact for Apex for multi-threading
  { n: 15, acctN: 1, first: 'Claire', last: 'Donnelly', title: 'Director of Compliance', seniority: 'Director', department: 'Compliance', role: 'influencer'   },
];

// ─── Deals + stage journeys ────────────────────────────────────────────────────

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
      { stage: 'contractsent',          days: 20 },
    ],
  },
  {
    n: 10, acctN: 2, name: 'BlueSky — API Access Tier',
    amount: 32_000, pipeline: 'New Business', owner: 'Marcus Webb', startDaysAgo: 55,
    journey: [
      { stage: 'appointmentscheduled',  days: 7  },
      { stage: 'qualifiedtobuy',        days: 11 },
      { stage: 'presentationscheduled', days: 17 },
      { stage: 'decisionmakerboughtin', days: 20 },
    ],
  },
  {
    n: 11, acctN: 6, name: 'Granite — IT Automation Suite',
    amount: 88_000, pipeline: 'New Business', owner: 'Marcus Webb', startDaysAgo: 48,
    journey: [
      { stage: 'appointmentscheduled',  days: 9  },
      { stage: 'qualifiedtobuy',        days: 13 },
      { stage: 'presentationscheduled', days: 26 },
    ],
  },
  {
    n: 12, acctN: 5, name: 'Echo Health — Provider Portal',
    amount: 55_000, pipeline: 'New Business', owner: 'Sarah Chen', startDaysAgo: 28,
    journey: [
      { stage: 'appointmentscheduled',  days: 8  },
      { stage: 'qualifiedtobuy',        days: 20 },
    ],
  },

  // ── Customer Expansion — numeric IDs, stage_normalized = NULL ───────────────
  {
    n: 13, acctN: 1, name: 'Apex Financial — Seat Expansion',
    amount: 35_000, pipeline: 'Customer Expansion', owner: 'Sarah Chen', startDaysAgo: 55,
    journey: [
      { stage: '2110000001', days: 12 },
      { stage: '2110000002', days: 14 },
      { stage: '2110000003', days: 29 },
    ],
  },
  {
    n: 14, acctN: 2, name: 'BlueSky — Premium Tier Upgrade',
    amount: 48_000, pipeline: 'Customer Expansion', owner: 'Marcus Webb', startDaysAgo: 46,
    journey: [
      { stage: '2110000001', days: 10 },
      { stage: '2110000002', days: 12 },
      { stage: '2110000003', days: 10 },
      { stage: '2110000004', days: 14 },
    ],
  },
  {
    n: 15, acctN: 3, name: 'CloudBridge — Growth Package',
    amount: 30_000, pipeline: 'Customer Expansion', owner: 'Priya Patel', startDaysAgo: 22,
    journey: [
      { stage: '2110000001', days: 15 },
      { stage: '2110000002', days: 7  },
    ],
  },
  {
    n: 16, acctN: 6, name: 'Granite — License Expansion',
    amount: 40_000, pipeline: 'Customer Expansion', owner: 'Tom Reyes', startDaysAgo: 32,
    journey: [
      { stage: '2110000001', days: 14 },
      { stage: '2110000002', days: 18 },
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
  // Customer Expansion (numeric IDs)
  { pipeline: 'Customer Expansion', stage_id: '2110000001', stage_name: 'Health Check',          order: 0 },
  { pipeline: 'Customer Expansion', stage_id: '2110000002', stage_name: 'Expansion Identified',  order: 1 },
  { pipeline: 'Customer Expansion', stage_id: '2110000003', stage_name: 'Proposal Reviewed',     order: 2 },
  { pipeline: 'Customer Expansion', stage_id: '2110000004', stage_name: 'Contract Negotiation',  order: 3 },
  { pipeline: 'Customer Expansion', stage_id: 'closedwon',  stage_name: 'Expansion Closed',      order: 4 },
  { pipeline: 'Customer Expansion', stage_id: 'closedlost', stage_name: 'No Expansion',          order: 5 },
];

// ─── Competitor mapping per deal (for open deals 9-16) ─────────────────────────
// Vantora: enterprise incumbent (Financial Services / BlueSky)
// Nexlify: price-fighter challenger
// Meridian Analytics: best-of-breed analytics (BlueSky / Granite)
// Clausepoint: compliance focus (Apex Financial)
// Synaptix: integration platform (Granite / CloudBridge)

interface CompetitorSpec {
  name: string;
  quote: string;
  outcome: 'win' | 'loss' | 'open';
}

const DEAL_COMPETITORS: Record<number, CompetitorSpec[]> = {
  9:  [{ name: 'Vantora',    quote: 'Prospect mentioned Vantora is their current platform for the commerce stack; evaluating on integration depth.', outcome: 'open' },
       { name: 'Clausepoint', quote: 'Dynamo compliance team is piloting Clausepoint for contract workflows; overlap with our platform noted.',     outcome: 'open' }],
  10: [{ name: 'Vantora',           quote: 'BlueSky is an existing Vantora shop but CTO David Kim is pushing for best-of-breed on the API layer.', outcome: 'open' },
       { name: 'Meridian Analytics', quote: 'Meridian Analytics was demoed last week; prospect liked the dashboarding but flagged integration gaps.', outcome: 'open' }],
  11: [{ name: 'Vantora',           quote: 'Granite ran a full Vantora POC six months ago that stalled; we are re-engaging with a new champion.', outcome: 'open' },
       { name: 'Meridian Analytics', quote: 'Meridian is being evaluated side-by-side; Steve Olsen prefers our support model.', outcome: 'open' }],
  12: [{ name: 'Nexlify',   quote: 'Nexlify pitched Echo Health last month at 30% lower price; prospect is weighing cost vs feature completeness.', outcome: 'open' }],
  13: [{ name: 'Clausepoint', quote: 'Apex compliance team prefers Clausepoint for audit workflows; Rachel Torres is our internal champion pushing back.', outcome: 'open' }],
  14: [{ name: 'Vantora',   quote: 'BlueSky is comparing our Premium tier against Vantora Enterprise; decision criteria centers on data lineage depth.', outcome: 'open' }],
  15: [{ name: 'Nexlify',   quote: 'Nexlify offered CloudBridge a bundled expansion rate; we need to emphasize migration risk and support SLA.', outcome: 'open' }],
  16: [{ name: 'Synaptix',  quote: 'Synaptix is positioned as a platform-layer alternative; Granite IT team is familiar with them from a prior project.', outcome: 'open' }],
  // Closed deals that had competitors — for win/loss rate signal
  1:  [{ name: 'Vantora',   quote: 'Won against Vantora — champion Rachel Torres drove internal alignment on integration depth advantage.', outcome: 'win' }],
  2:  [{ name: 'Synaptix',  quote: 'Won against Synaptix — CloudBridge selected us on security compliance posture and faster onboarding.', outcome: 'win' }],
  5:  [{ name: 'Nexlify',   quote: 'Lost to Nexlify — Apex compliance module replaced by lower-cost Nexlify offering after procurement push.', outcome: 'loss' }],
  6:  [{ name: 'Vantora',   quote: 'Lost to Vantora — CloudBridge Infrastructure went with Vantora enterprise bundle after 6-month evaluation.', outcome: 'loss' }],
  7:  [{ name: 'Nexlify',   quote: 'Lost to Nexlify on price — Granite procurement mandated cost reduction; Nexlify undercut by 40%.', outcome: 'loss' }],
};

// ─── Conversation data for active deals ───────────────────────────────────────

interface ConvSpec {
  n: number;
  dealN: number;
  acctN: number;
  daysAgoN: number;
  durationSeconds: number;
  summary: string;
  actionItems: string[];
  sentimentScore: number;
  participantContactNs: number[];
}

const CONVERSATIONS: ConvSpec[] = [
  // Deal 9 — Dynamo Commerce Platform
  {
    n: 1, dealN: 9, acctN: 4, daysAgoN: 28, durationSeconds: 2700,
    summary: 'Initial discovery call with Carlos Rivera and Mei Zhang. Prospect confirmed Vantora is the current incumbent and highlighted integration pain points with their existing commerce stack. TechScale demoed the API layer; both contacts showed strong interest.',
    actionItems: ['Send integration architecture doc by Friday', 'Schedule technical deep-dive with Dynamo engineering team', 'Share Vantora migration case study'],
    sentimentScore: 0.78,
    participantContactNs: [7, 8],
  },
  {
    n: 2, dealN: 9, acctN: 4, daysAgoN: 7, durationSeconds: 3600,
    summary: 'Contract negotiation call with SVP Technology Carlos Rivera. Discussed redline on SLA terms and Clausepoint overlap for contract workflows. Carlos confirmed internal buy-in and target go-live of next quarter.',
    actionItems: ['Return redlined MSA within 48 hours', 'Confirm Clausepoint integration roadmap', 'Loop in Dynamo legal team for sign-off'],
    sentimentScore: 0.85,
    participantContactNs: [7, 9],
  },
  // Deal 10 — BlueSky API Access Tier
  {
    n: 3, dealN: 10, acctN: 2, daysAgoN: 22, durationSeconds: 2400,
    summary: 'Demo call with David Kim (CTO) and Priya Nair. David pushed back on Vantora lock-in and expressed interest in best-of-breed API tier. Meridian Analytics was mentioned as a competing evaluation; we highlighted our superior connector library.',
    actionItems: ['Send connector library comparison vs Meridian', 'Provide customer reference in fintech vertical', 'Follow up on timeline for Q2 budget approval'],
    sentimentScore: 0.72,
    participantContactNs: [3, 4],
  },
  {
    n: 4, dealN: 10, acctN: 2, daysAgoN: 5, durationSeconds: 1800,
    summary: 'Evaluation check-in with Priya Nair. She confirmed the Meridian Analytics POC ended without a strong outcome on data lineage. TechScale is now the frontrunner; decision criteria narrowed to pricing and onboarding speed.',
    actionItems: ['Submit revised pricing proposal by EOD', 'Schedule onboarding overview with BlueSky data team', 'Send NPS references from similar-size accounts'],
    sentimentScore: 0.81,
    participantContactNs: [4],
  },
  // Deal 11 — Granite IT Automation Suite
  {
    n: 5, dealN: 11, acctN: 6, daysAgoN: 30, durationSeconds: 3000,
    summary: 'Re-engagement call with Steve Olsen (VP IT). Granite ran a failed Vantora POC six months ago; Steve is now the internal champion for switching. Meridian Analytics was evaluated briefly but dropped due to lack of IT automation modules.',
    actionItems: ['Share IT automation feature roadmap', 'Arrange reference call with similar IT services customer', 'Submit POC scope document'],
    sentimentScore: 0.74,
    participantContactNs: [12, 14],
  },
  {
    n: 6, dealN: 11, acctN: 6, daysAgoN: 8, durationSeconds: 2400,
    summary: 'Proposal review with Steve Olsen and Alicia Fonseca (CFO). Alicia raised budget constraint; Steve advocated for the full suite. We agreed on a phased rollout starting with core IT automation. Vantora was not in active consideration.',
    actionItems: ['Prepare phased implementation pricing', 'Send CFO-level ROI deck', 'Confirm procurement timeline for Q2 close'],
    sentimentScore: 0.80,
    participantContactNs: [12, 13],
  },
  // Deal 12 — Echo Health Provider Portal
  {
    n: 7, dealN: 12, acctN: 5, daysAgoN: 18, durationSeconds: 2100,
    summary: 'Discovery call with Kevin Grant (Director of IT). Nexlify pitched Echo Health last month with a 30% price reduction; Kevin is cautious but values our HIPAA compliance depth and existing EMR integration. Dr. Susan Park has budget authority.',
    actionItems: ['Send HIPAA compliance documentation', 'Arrange call with Dr. Susan Park on ROI', 'Prepare competitive pricing analysis vs Nexlify'],
    sentimentScore: 0.65,
    participantContactNs: [11],
  },
  {
    n: 8, dealN: 12, acctN: 5, daysAgoN: 4, durationSeconds: 1800,
    summary: 'Follow-up with Kevin Grant and Dr. Susan Park. Dr. Park acknowledged Nexlify is cheaper but expressed concern about their healthcare compliance track record. TechScale positioned on total cost of ownership and reduced compliance risk.',
    actionItems: ['Send Nexlify compliance gap analysis', 'Provide reference from healthcare customer', 'Follow up with proposal by end of week'],
    sentimentScore: 0.70,
    participantContactNs: [11, 10],
  },
  // Deal 13 — Apex Financial Seat Expansion
  {
    n: 9, dealN: 13, acctN: 1, daysAgoN: 40, durationSeconds: 2400,
    summary: 'Expansion planning call with Rachel Torres (VP Finance). Apex wants to add 50 seats to the Enterprise Suite. Clausepoint is being evaluated by the compliance team for an adjacent workflow; Rachel confirmed TechScale is preferred for the core expansion.',
    actionItems: ['Submit seat expansion quote', 'Clarify Clausepoint integration scope with Apex IT', 'Schedule executive sponsor call with James Whitmore'],
    sentimentScore: 0.79,
    participantContactNs: [2, 15],
  },
  {
    n: 10, dealN: 13, acctN: 1, daysAgoN: 10, durationSeconds: 2700,
    summary: 'Negotiation call with James Whitmore (CFO) and Rachel Torres. James approved the expansion budget but requested a multi-year pricing option. Claire Donnelly flagged a Clausepoint pilot but confirmed it is separate from the seat expansion decision.',
    actionItems: ['Prepare 2- and 3-year pricing options', 'Confirm multi-year discount framework with finance', 'Send updated order form'],
    sentimentScore: 0.83,
    participantContactNs: [1, 2],
  },
  // Deal 14 — BlueSky Premium Tier Upgrade
  {
    n: 11, dealN: 14, acctN: 2, daysAgoN: 35, durationSeconds: 2700,
    summary: 'Upgrade evaluation call with David Kim. BlueSky is comparing our Premium tier against Vantora Enterprise on data lineage depth. David prefers TechScale connector breadth but wants proof on lineage tracing for regulated datasets.',
    actionItems: ['Provide lineage tracing deep-dive documentation', 'Set up sandboxed POC environment', 'Share fintech data lineage case study'],
    sentimentScore: 0.71,
    participantContactNs: [3, 4],
  },
  {
    n: 12, dealN: 14, acctN: 2, daysAgoN: 9, durationSeconds: 3000,
    summary: 'POC results review with David Kim and Priya Nair. The lineage POC exceeded expectations. Vantora was unable to match the connector depth. David confirmed he is recommending TechScale to the board; Priya is coordinating procurement.',
    actionItems: ['Prepare executive summary of POC results', 'Draft order form for Premium tier', 'Coordinate with Priya on procurement process'],
    sentimentScore: 0.88,
    participantContactNs: [3, 4],
  },
  // Deal 15 — CloudBridge Growth Package
  {
    n: 13, dealN: 15, acctN: 3, daysAgoN: 14, durationSeconds: 2100,
    summary: 'Growth package discovery with Omar Hassan (VP Engineering). Nexlify offered CloudBridge a bundled expansion rate that is 25% cheaper. Omar is price-sensitive but highlighted concerns about Nexlify migration complexity and lack of dedicated support.',
    actionItems: ['Prepare migration risk analysis vs Nexlify', 'Quantify dedicated support SLA value', 'Offer a competitive retention discount'],
    sentimentScore: 0.62,
    participantContactNs: [5, 6],
  },
  {
    n: 14, dealN: 15, acctN: 3, daysAgoN: 3, durationSeconds: 1800,
    summary: 'Retention call with Lisa Chen (CISO) and Omar Hassan. Lisa flagged that Nexlify has no SOC 2 Type II certification, which is a blocker for CloudBridge. TechScale is now strongly favored; Lisa is coordinating with procurement for fast close.',
    actionItems: ['Share SOC 2 Type II certification documentation', 'Submit final pricing with retention discount', 'Request PO by end of next week'],
    sentimentScore: 0.76,
    participantContactNs: [5, 6],
  },
  // Deal 16 — Granite License Expansion
  {
    n: 15, dealN: 16, acctN: 6, daysAgoN: 25, durationSeconds: 2400,
    summary: 'License expansion scoping call with Steve Olsen and Raj Mehta (IT Manager). Synaptix is positioned as a platform-layer alternative by the Granite IT team; Raj is familiar with them from a prior integration project. Steve prefers TechScale for support consistency.',
    actionItems: ['Document integration platform comparison vs Synaptix', 'Share support case resolution SLA data', 'Prepare license expansion options'],
    sentimentScore: 0.68,
    participantContactNs: [12, 14],
  },
  {
    n: 16, dealN: 16, acctN: 6, daysAgoN: 6, durationSeconds: 2700,
    summary: 'Proposal call with Alicia Fonseca (CFO) and Steve Olsen. Alicia asked for a cost-benefit analysis vs Synaptix. Steve confirmed Synaptix lacks dedicated account management; TechScale white-glove support model is a differentiator for Granite.',
    actionItems: ['Send Synaptix comparison one-pager', 'Prepare CFO-level ROI breakdown', 'Follow up with final proposal by Monday'],
    sentimentScore: 0.74,
    participantContactNs: [12, 13],
  },
];

// ─── Main seeder ───────────────────────────────────────────────────────────────

export async function seedDemoWorkspace(): Promise<void> {
  // Check if workspace exists first — if not, create it and seed base data
  const wsCheck = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM workspaces WHERE id = $1`,
    [WS_ID]
  );
  const workspaceExists = wsCheck.rows[0].count > 0;

  // Check if contacts already exist (guard for back-fill runs)
  const contactCheck = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM contacts WHERE workspace_id = $1`,
    [WS_ID]
  );
  const contactsExist = contactCheck.rows[0].count > 0;

  if (workspaceExists && contactsExist) {
    console.log('[DemoSeed] Demo workspace already fully seeded — skipping.');
    return;
  }

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

  if (!workspaceExists) {
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
  }

  // ── 6. Contacts ────────────────────────────────────────────────────────────

  for (const c of CONTACTS) {
    await query(
      `INSERT INTO contacts (id, workspace_id, source, source_id, email, first_name, last_name,
         title, seniority, department, account_id, lifecycle_stage, created_at, updated_at)
       VALUES ($1,$2,'demo',$3,$4,$5,$6,$7,$8,$9,$10,'customer',$11,$12)
       ON CONFLICT (workspace_id, source, source_id) DO NOTHING`,
      [
        contactId(c.n), WS_ID, `demo-contact-${c.n}`,
        `${c.first.toLowerCase()}.${c.last.toLowerCase()}@${ACCOUNTS[c.acctN - 1].domain}`,
        c.first, c.last, c.title, c.seniority, c.department, acctId(c.acctN),
        daysAgo(365), new Date(),
      ]
    );
  }

  // ── 7. deal_contacts (champion + economic_buyer for each active deal) ───────

  // Map acctN → contacts for quick lookup
  const acctContacts: Record<number, ContactSpec[]> = {};
  for (const c of CONTACTS) {
    if (!acctContacts[c.acctN]) acctContacts[c.acctN] = [];
    acctContacts[c.acctN].push(c);
  }

  // Active deals: 9-16
  for (const deal of DEALS.filter(d => d.n >= 9)) {
    const contactsForAcct = acctContacts[deal.acctN] || [];
    const champion       = contactsForAcct.find(c => c.role === 'champion');
    const econBuyer      = contactsForAcct.find(c => c.role === 'economic_buyer');
    const influencer     = contactsForAcct.find(c => c.role === 'influencer');

    for (const [contact, role, isPrimary] of [
      [champion,   'champion',       true ],
      [econBuyer,  'economic_buyer', false],
      [influencer, 'influencer',     false],
    ] as [ContactSpec | undefined, string, boolean][]) {
      if (!contact) continue;
      await query(
        `INSERT INTO deal_contacts (id, workspace_id, deal_id, contact_id, role, is_primary, source)
         VALUES ($1,$2,$3,$4,$5,$6,'demo') ON CONFLICT DO NOTHING`,
        [dcId(deal.n, contact.n), WS_ID, dealId(deal.n), contactId(contact.n), role, isPrimary]
      );
    }
  }

  // ── 8. Conversations ───────────────────────────────────────────────────────

  for (const conv of CONVERSATIONS) {
    const deal = DEALS.find(d => d.n === conv.dealN)!;
    const participants = [
      { name: deal.owner, email: repEmail(deal.owner), affiliation: 'Internal' },
      ...conv.participantContactNs.map(cn => {
        const c = CONTACTS.find(x => x.n === cn)!;
        return {
          name: `${c.first} ${c.last}`,
          email: `${c.first.toLowerCase()}.${c.last.toLowerCase()}@${ACCOUNTS[c.acctN - 1].domain}`,
          affiliation: 'External',
        };
      }),
    ];

    // Competitor mentions for this conversation
    const dealComps = DEAL_COMPETITORS[conv.dealN] || [];
    const convIndex = CONVERSATIONS.filter(c => c.dealN === conv.dealN).indexOf(conv);
    const compMentions = dealComps.map(dc => dc.name);

    await query(
      `INSERT INTO conversations (id, workspace_id, source, source_id, call_date, duration_seconds,
         deal_id, account_id, summary, action_items, sentiment_score, participants, competitor_mentions,
         created_at, updated_at)
       VALUES ($1,$2,'demo',$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb,$12::jsonb,$13,$14)
       ON CONFLICT (workspace_id, source, source_id) DO NOTHING`,
      [
        convId(conv.n), WS_ID, `demo-conv-${conv.n}`,
        daysAgo(conv.daysAgoN), conv.durationSeconds,
        dealId(conv.dealN), acctId(conv.acctN),
        conv.summary,
        JSON.stringify(conv.actionItems),
        conv.sentimentScore,
        JSON.stringify(participants),
        JSON.stringify(compMentions),
        daysAgo(conv.daysAgoN), new Date(),
      ]
    );
  }

  // ── 9. conversation_signals ────────────────────────────────────────────────

  let sigCounter = 1;

  // Helper to insert a signal
  const insertSignal = async (
    convN: number, dealN: number, acctN: number, repOwner: string,
    signalType: string, signalValue: string, confidence: number, quote: string, sentiment?: string
  ) => {
    await query(
      `INSERT INTO conversation_signals (id, workspace_id, conversation_id, signal_type, signal_value,
         confidence, source_quote, sentiment, deal_id, account_id, rep_email, extraction_method)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'manual')
       ON CONFLICT DO NOTHING`,
      [
        sigId(sigCounter++), WS_ID, convId(convN),
        signalType, signalValue, confidence, quote,
        sentiment || 'neutral',
        dealId(dealN), acctId(acctN), repEmail(repOwner),
      ]
    );
  };

  // Signals per conversation
  // Conv 1 (Deal 9, Dynamo Commerce Platform — discovery)
  await insertSignal(1, 9, 4, 'Priya Patel', 'competitor_mention', 'Vantora', 0.95,
    'Prospect confirmed Vantora is the current incumbent and highlighted integration pain points.', 'negative');
  await insertSignal(1, 9, 4, 'Priya Patel', 'competitor_mention', 'Clausepoint', 0.88,
    'Dynamo compliance team is piloting Clausepoint for contract workflows; overlap with our platform noted.', 'neutral');
  await insertSignal(1, 9, 4, 'Priya Patel', 'risk_flag', 'Integration depth with commerce stack', 0.90,
    'Prospect highlighted integration pain points with their existing commerce stack.');
  await insertSignal(1, 9, 4, 'Priya Patel', 'buying_signal', 'Strong interest in API demo', 0.85,
    'Both contacts showed strong interest after the API layer demo.', 'positive');

  // Conv 2 (Deal 9 — negotiation)
  await insertSignal(2, 9, 4, 'Priya Patel', 'next_steps', 'Return redlined MSA within 48 hours', 0.98,
    'Carlos confirmed internal buy-in and target go-live of next quarter.', 'positive');
  await insertSignal(2, 9, 4, 'Priya Patel', 'timeline_mentioned', 'Target go-live next quarter', 0.95,
    'Carlos confirmed internal buy-in and target go-live of next quarter.', 'positive');
  await insertSignal(2, 9, 4, 'Priya Patel', 'decision_criteria', 'SLA terms and Clausepoint integration', 0.88,
    'Discussed redline on SLA terms and Clausepoint overlap for contract workflows.');

  // Conv 3 (Deal 10, BlueSky API — demo)
  await insertSignal(3, 10, 2, 'Marcus Webb', 'competitor_mention', 'Vantora', 0.92,
    'David pushed back on Vantora lock-in and expressed interest in best-of-breed API tier.', 'negative');
  await insertSignal(3, 10, 2, 'Marcus Webb', 'competitor_mention', 'Meridian Analytics', 0.90,
    'Meridian Analytics was mentioned as a competing evaluation; we highlighted our superior connector library.', 'neutral');
  await insertSignal(3, 10, 2, 'Marcus Webb', 'objection', 'Vantora lock-in concern', 0.88,
    'David pushed back on Vantora lock-in.', 'negative');
  await insertSignal(3, 10, 2, 'Marcus Webb', 'buying_signal', 'Interest in connector library breadth', 0.82,
    'We highlighted our superior connector library and prospect responded positively.', 'positive');

  // Conv 4 (Deal 10 — evaluation follow-up)
  await insertSignal(4, 10, 2, 'Marcus Webb', 'next_steps', 'Submit revised pricing proposal by EOD', 0.95,
    'Decision criteria narrowed to pricing and onboarding speed.', 'positive');
  await insertSignal(4, 10, 2, 'Marcus Webb', 'decision_criteria', 'Pricing and onboarding speed', 0.92,
    'Decision criteria narrowed to pricing and onboarding speed.');
  await insertSignal(4, 10, 2, 'Marcus Webb', 'buying_signal', 'TechScale is now frontrunner', 0.90,
    'TechScale is now the frontrunner after Meridian POC underperformed.', 'positive');

  // Conv 5 (Deal 11, Granite IT — re-engagement)
  await insertSignal(5, 11, 6, 'Marcus Webb', 'competitor_mention', 'Vantora', 0.93,
    'Granite ran a failed Vantora POC six months ago; Steve is now the internal champion for switching.', 'negative');
  await insertSignal(5, 11, 6, 'Marcus Webb', 'competitor_mention', 'Meridian Analytics', 0.85,
    'Meridian Analytics was evaluated briefly but dropped due to lack of IT automation modules.', 'neutral');
  await insertSignal(5, 11, 6, 'Marcus Webb', 'champion_signal', 'Steve Olsen is internal champion', 0.90,
    'Steve is now the internal champion for switching from Vantora.', 'positive');
  await insertSignal(5, 11, 6, 'Marcus Webb', 'risk_flag', 'Failed prior Vantora POC', 0.88,
    'Granite ran a failed Vantora POC six months ago.');

  // Conv 6 (Deal 11 — proposal)
  await insertSignal(6, 11, 6, 'Marcus Webb', 'objection', 'Budget constraint from CFO', 0.90,
    'Alicia raised budget constraint; Steve advocated for the full suite.', 'negative');
  await insertSignal(6, 11, 6, 'Marcus Webb', 'next_steps', 'Prepare phased implementation pricing', 0.95,
    'We agreed on a phased rollout starting with core IT automation.', 'positive');
  await insertSignal(6, 11, 6, 'Marcus Webb', 'decision_criteria', 'Phased rollout feasibility and ROI', 0.88,
    'Agreed on a phased rollout starting with core IT automation.');

  // Conv 7 (Deal 12, Echo Health — discovery)
  await insertSignal(7, 12, 5, 'Sarah Chen', 'competitor_mention', 'Nexlify', 0.95,
    'Nexlify pitched Echo Health last month with a 30% price reduction; Kevin is cautious.', 'negative');
  await insertSignal(7, 12, 5, 'Sarah Chen', 'objection', 'Nexlify price advantage (30% cheaper)', 0.92,
    'Nexlify pitched Echo Health last month at 30% lower price.', 'negative');
  await insertSignal(7, 12, 5, 'Sarah Chen', 'decision_criteria', 'HIPAA compliance depth', 0.90,
    'Kevin values our HIPAA compliance depth and existing EMR integration.');
  await insertSignal(7, 12, 5, 'Sarah Chen', 'risk_flag', 'Price sensitivity — Nexlify competing on cost', 0.88,
    'Kevin is cautious but values our HIPAA compliance depth.');

  // Conv 8 (Deal 12 — follow-up)
  await insertSignal(8, 12, 5, 'Sarah Chen', 'buying_signal', 'Nexlify compliance concern raised by Dr. Park', 0.88,
    'Dr. Park acknowledged Nexlify is cheaper but expressed concern about healthcare compliance.', 'positive');
  await insertSignal(8, 12, 5, 'Sarah Chen', 'decision_criteria', 'Total cost of ownership and compliance risk', 0.90,
    'TechScale positioned on total cost of ownership and reduced compliance risk.');
  await insertSignal(8, 12, 5, 'Sarah Chen', 'next_steps', 'Send Nexlify compliance gap analysis', 0.95,
    'Send Nexlify compliance gap analysis and healthcare reference.', 'positive');

  // Conv 9 (Deal 13, Apex Expansion — planning)
  await insertSignal(9, 13, 1, 'Sarah Chen', 'competitor_mention', 'Clausepoint', 0.90,
    'Clausepoint is being evaluated by the compliance team for an adjacent workflow.', 'neutral');
  await insertSignal(9, 13, 1, 'Sarah Chen', 'champion_signal', 'Rachel Torres advocating for TechScale expansion', 0.92,
    'Rachel confirmed TechScale is preferred for the core expansion.', 'positive');
  await insertSignal(9, 13, 1, 'Sarah Chen', 'next_steps', 'Submit seat expansion quote', 0.95,
    'Rachel requested seat expansion quote and exec sponsor call.', 'positive');

  // Conv 10 (Deal 13 — negotiation)
  await insertSignal(10, 13, 1, 'Sarah Chen', 'budget_mentioned', 'Multi-year pricing requested by CFO', 0.92,
    'James approved the expansion budget but requested a multi-year pricing option.', 'positive');
  await insertSignal(10, 13, 1, 'Sarah Chen', 'decision_criteria', 'Multi-year discount framework', 0.90,
    'James approved the expansion budget but requested a multi-year pricing option.');
  await insertSignal(10, 13, 1, 'Sarah Chen', 'next_steps', 'Prepare 2- and 3-year pricing options', 0.95,
    'Prepare 2- and 3-year pricing options and send updated order form.', 'positive');

  // Conv 11 (Deal 14, BlueSky Premium — evaluation)
  await insertSignal(11, 14, 2, 'Marcus Webb', 'competitor_mention', 'Vantora', 0.93,
    'BlueSky is comparing our Premium tier against Vantora Enterprise on data lineage depth.', 'neutral');
  await insertSignal(11, 14, 2, 'Marcus Webb', 'decision_criteria', 'Data lineage depth for regulated datasets', 0.90,
    'David prefers TechScale connector breadth but wants proof on lineage tracing.');
  await insertSignal(11, 14, 2, 'Marcus Webb', 'next_steps', 'Set up sandboxed POC environment', 0.95,
    'Set up sandboxed POC environment for lineage tracing validation.');

  // Conv 12 (Deal 14 — POC results)
  await insertSignal(12, 14, 2, 'Marcus Webb', 'buying_signal', 'David recommending TechScale to board', 0.95,
    'David confirmed he is recommending TechScale to the board.', 'positive');
  await insertSignal(12, 14, 2, 'Marcus Webb', 'next_steps', 'Draft order form for Premium tier', 0.95,
    'Coordinate with Priya on procurement process and draft order form.', 'positive');

  // Conv 13 (Deal 15, CloudBridge Growth — discovery)
  await insertSignal(13, 15, 3, 'Priya Patel', 'competitor_mention', 'Nexlify', 0.95,
    'Nexlify offered CloudBridge a bundled expansion rate that is 25% cheaper.', 'negative');
  await insertSignal(13, 15, 3, 'Priya Patel', 'objection', 'Nexlify 25% cheaper bundled rate', 0.92,
    'Nexlify offered CloudBridge a bundled expansion rate that is 25% cheaper.', 'negative');
  await insertSignal(13, 15, 3, 'Priya Patel', 'risk_flag', 'Price competition risk from Nexlify', 0.90,
    'Omar is price-sensitive and Nexlify has made a competitive offer.');

  // Conv 14 (Deal 15 — retention)
  await insertSignal(14, 15, 3, 'Priya Patel', 'buying_signal', 'Lisa flagged Nexlify SOC 2 blocker', 0.92,
    'Lisa flagged that Nexlify has no SOC 2 Type II certification, which is a blocker.', 'positive');
  await insertSignal(14, 15, 3, 'Priya Patel', 'next_steps', 'Submit final pricing with retention discount', 0.95,
    'Submit final pricing with retention discount and request PO.', 'positive');

  // Conv 15 (Deal 16, Granite License — scoping)
  await insertSignal(15, 16, 6, 'Tom Reyes', 'competitor_mention', 'Synaptix', 0.92,
    'Synaptix is positioned as a platform-layer alternative; Raj is familiar with them from a prior integration project.', 'neutral');
  await insertSignal(15, 16, 6, 'Tom Reyes', 'champion_signal', 'Steve Olsen prefers TechScale for support consistency', 0.88,
    'Steve prefers TechScale for support consistency.', 'positive');
  await insertSignal(15, 16, 6, 'Tom Reyes', 'objection', 'Synaptix familiarity from prior project', 0.85,
    'Raj is familiar with Synaptix from a prior integration project.', 'neutral');

  // Conv 16 (Deal 16 — proposal)
  await insertSignal(16, 16, 6, 'Tom Reyes', 'next_steps', 'Send Synaptix comparison one-pager', 0.95,
    'Alicia asked for a cost-benefit analysis vs Synaptix.', 'positive');
  await insertSignal(16, 16, 6, 'Tom Reyes', 'decision_criteria', 'Dedicated account management and support SLA', 0.90,
    'TechScale white-glove support model is a differentiator for Granite.');
  await insertSignal(16, 16, 6, 'Tom Reyes', 'buying_signal', 'Steve confirmed Synaptix lacks dedicated account mgmt', 0.88,
    'Steve confirmed Synaptix lacks dedicated account management.', 'positive');

  // ── 10. Email activities ───────────────────────────────────────────────────

  let actCounter = 1;

  interface EmailSpec {
    dealN: number;
    daysAgoN: number;
    direction: 'outbound' | 'inbound';
    subject: string;
    body: string;
    contactN?: number;
  }

  const EMAILS: EmailSpec[] = [
    // Deal 1 (Apex — Closed Won — historical)
    { dealN: 1, daysAgoN: 272, direction: 'outbound', subject: 'TechScale intro and Enterprise Suite overview', body: 'Hi Rachel, great connecting at the FinServ Summit. I wanted to follow up with our Enterprise Suite overview deck and a quick intro to how we help financial services firms like Apex. Happy to set up a call this week.', contactN: 2 },
    { dealN: 1, daysAgoN: 265, direction: 'inbound',  subject: 'RE: TechScale intro and Enterprise Suite overview', body: 'Thanks Sarah, the deck looks relevant. James (our CFO) has asked me to evaluate 2-3 options. Can you send over a competitive comparison? We are also looking at Vantora.', contactN: 2 },
    { dealN: 1, daysAgoN: 258, direction: 'outbound', subject: 'TechScale vs Vantora — integration depth comparison', body: 'Hi Rachel, attached is our point-by-point comparison with Vantora on integration depth, compliance certifications, and support SLA. We win on all three for financial services use cases. Happy to walk through this on a call.', contactN: 2 },
    // Deal 2 (CloudBridge — Closed Won)
    { dealN: 2, daysAgoN: 233, direction: 'outbound', subject: 'Security Suite proposal for CloudBridge', body: 'Hi Omar, following up on our call last week. Attached is the Security Suite proposal covering SOC 2 Type II compliance, encryption at rest, and our incident response SLA. Let me know if you have questions.', contactN: 5 },
    { dealN: 2, daysAgoN: 225, direction: 'outbound', subject: 'CloudBridge — contract redline and next steps', body: 'Hi Omar and Lisa, the legal team has returned the MSA with minor redlines on the liability cap. Please review and let us know if the terms work. We are targeting a close by end of month.', contactN: 5 },
    { dealN: 2, daysAgoN: 220, direction: 'inbound',  subject: 'RE: CloudBridge — contract redline and next steps', body: 'Terms look good. Lisa has signed off on the security addendum. We are ready to execute — please send the final order form.', contactN: 5 },
    // Deal 3 (Echo Health — Closed Won)
    { dealN: 3, daysAgoN: 212, direction: 'outbound', subject: 'Echo Health — EMR Integration proposal', body: 'Hi Kevin, attached is our EMR Integration proposal with HL7 FHIR compliance details, HIPAA BAA terms, and provider portal configuration options. Looking forward to your feedback.', contactN: 11 },
    { dealN: 3, daysAgoN: 205, direction: 'outbound', subject: 'Following up — any questions on the EMR proposal?', body: 'Hi Kevin, just checking in on the EMR proposal. I know Susan (CMO) has budget authority — happy to set up a three-way call to walk through the ROI model for the provider portal.', contactN: 11 },
    { dealN: 3, daysAgoN: 198, direction: 'inbound',  subject: 'RE: Following up — EMR proposal', body: 'Susan has approved the budget. We want to move forward. Can you send the final contract with the HIPAA BAA included? We need to complete procurement by end of this month.', contactN: 11 },
    // Deal 4 (BlueSky — Closed Won)
    { dealN: 4, daysAgoN: 302, direction: 'outbound', subject: 'BlueSky Data Platform — kickoff and proposal', body: 'Hi David, great meeting last week. Attached is the Data Platform proposal with connector library details and pricing. We have also prepared a Vantora migration guide given your current stack.', contactN: 3 },
    { dealN: 4, daysAgoN: 295, direction: 'outbound', subject: 'BlueSky — data lineage deep dive materials', body: 'Hi David and Priya, as promised, here are the data lineage deep-dive docs covering our audit trail, lineage tracing API, and BI tool integrations. Let me know if you would like a sandbox environment.', contactN: 4 },
    { dealN: 4, daysAgoN: 288, direction: 'inbound',  subject: 'RE: BlueSky data lineage — POC request', body: 'The lineage documentation is impressive. We would like to run a 2-week POC on our fintech dataset. Can you provision a sandbox environment by next Monday?', contactN: 3 },
    // Deal 5 (Apex — Closed Lost — Nexlify)
    { dealN: 5, daysAgoN: 195, direction: 'outbound', subject: 'Compliance Module proposal for Apex Financial', body: 'Hi James, attached is the Compliance Module proposal covering audit trail automation, regulatory reporting, and our SOX-compliant workflow engine. Priced at $42k ACV for the Enterprise tier.', contactN: 1 },
    { dealN: 5, daysAgoN: 185, direction: 'inbound',  subject: 'RE: Compliance Module — pricing concern', body: 'James here. Procurement has flagged that Nexlify offers a comparable compliance module at $28k. We are required to take the lower bid unless you can match the price. Can you revisit the proposal?', contactN: 1 },
    { dealN: 5, daysAgoN: 180, direction: 'outbound', subject: 'Apex — responding to Nexlify comparison', body: 'Hi James, I understand the budget pressure. While we cannot match Nexlify on price, I wanted to highlight three areas where we exceed them on compliance depth: real-time audit trails, automated regulatory filings, and dedicated compliance advisor support. Happy to schedule a 30-min call to walk through the comparison.', contactN: 1 },
    // Deal 6 (CloudBridge — Closed Lost — Vantora)
    { dealN: 6, daysAgoN: 173, direction: 'outbound', subject: 'Infrastructure Suite proposal for CloudBridge', body: 'Hi Omar, following up on our infrastructure discussion. Attached is the Infrastructure Suite proposal with multi-cloud orchestration, FinOps dashboards, and our 99.99% uptime SLA. Let me know if you have any questions.', contactN: 5 },
    { dealN: 6, daysAgoN: 165, direction: 'inbound',  subject: 'RE: Infrastructure Suite — we went with Vantora', body: 'Priya, thank you for the proposal. After a 6-month evaluation, our executive team has decided to go with Vantora enterprise bundle. Their existing relationship with our parent company was the deciding factor. We hope to work with TechScale in the future.', contactN: 5 },
    { dealN: 6, daysAgoN: 163, direction: 'outbound', subject: 'CloudBridge — thank you and next time', body: 'Omar, thank you for letting us know. We are disappointed but respect the decision. If the Vantora relationship does not meet expectations, please reach out — we would love to be your backup option.', contactN: 5 },
    // Deal 7 (Granite — Closed Lost — Nexlify)
    { dealN: 7, daysAgoN: 152, direction: 'outbound', subject: 'Granite — Workforce Automation demo summary', body: 'Hi Steve, great call today. As discussed, attached is the Workforce Automation demo summary with pricing for 290 seats. The IT automation module would save your team ~12 hrs/week based on our time-in-ticket benchmarks.', contactN: 12 },
    { dealN: 7, daysAgoN: 145, direction: 'inbound',  subject: 'RE: Workforce Automation — budget decision', body: 'Steve here. Unfortunately procurement mandated a cost-reduction target this quarter. Nexlify came in 40% lower and met our minimum feature requirements. We had to go with them. Apologies for the outcome.', contactN: 12 },
    // Deal 8 (Dynamo — Closed Lost)
    { dealN: 8, daysAgoN: 143, direction: 'outbound', subject: 'Dynamo Analytics Add-on proposal', body: 'Hi Carlos, following up on the analytics add-on conversation. The proposal is attached — $28k ACV for 12-month access to our full analytics module with pre-built e-commerce dashboards.', contactN: 7 },
    { dealN: 8, daysAgoN: 138, direction: 'inbound',  subject: 'RE: Analytics Add-on — not moving forward', body: 'Carlos here. We have decided to build the analytics layer in-house with our data team. The ROI calculation did not pencil out for the current quarter. We may revisit next FY.', contactN: 7 },
    // Deal 9 (Dynamo Commerce — Active, 5 emails)
    { dealN: 9, daysAgoN: 68, direction: 'outbound', subject: 'Dynamo Commerce Platform — intro and capabilities overview', body: 'Hi Carlos, thank you for connecting at ShopTech Summit. Attached is our Commerce Platform overview highlighting API-first architecture, real-time inventory sync, and our Vantora migration accelerator toolkit.', contactN: 7 },
    { dealN: 9, daysAgoN: 58, direction: 'outbound', subject: 'Commerce Platform proposal for Dynamo Retail', body: 'Hi Carlos and Mei, following up on the demo. Attached is the Commerce Platform proposal at $110k ACV with a phased onboarding plan and 90-day migration guarantee from Vantora.', contactN: 8 },
    { dealN: 9, daysAgoN: 45, direction: 'inbound',  subject: 'RE: Commerce Platform — comparison question', body: 'Mei here. Can you send us a comparison vs Clausepoint? Our compliance team is evaluating Clausepoint for contract workflows and wants to know if there is overlap with TechScale.', contactN: 8 },
    { dealN: 9, daysAgoN: 38, direction: 'outbound', subject: 'TechScale vs Clausepoint — overlap and integration options', body: 'Hi Mei, attached is our comparison with Clausepoint. Short answer: our platforms are complementary — TechScale handles the commerce layer while Clausepoint handles contract workflows. We also have a native integration available.', contactN: 8 },
    { dealN: 9, daysAgoN: 10, direction: 'outbound', subject: 'Dynamo — MSA redline and close timeline', body: 'Hi Carlos, the legal team has returned the MSA with minimal redlines. We are targeting a signature by end of the month to hit your Q1 go-live. Can you confirm the procurement timeline?', contactN: 7 },
    // Deal 10 (BlueSky API — Active, 5 emails)
    { dealN: 10, daysAgoN: 52, direction: 'outbound', subject: 'BlueSky API Access Tier — proposal', body: 'Hi David, following up on our connector library discussion. Attached is the API Access Tier proposal at $32k ACV with unlimited API calls, dedicated connector support, and a 30-day onboarding SLA.', contactN: 3 },
    { dealN: 10, daysAgoN: 42, direction: 'outbound', subject: 'BlueSky — Meridian Analytics comparison', body: 'Hi Priya, as requested, here is our side-by-side comparison with Meridian Analytics on connector breadth, data lineage, and enterprise support. We exceed them on all three dimensions for data analytics use cases.', contactN: 4 },
    { dealN: 10, daysAgoN: 32, direction: 'inbound',  subject: 'RE: Meridian POC results — moving forward with TechScale', body: 'David here. The Meridian POC was underwhelming on data lineage tracing. TechScale is now our preferred option. Can you send a revised pricing proposal and onboarding timeline?', contactN: 3 },
    { dealN: 10, daysAgoN: 18, direction: 'outbound', subject: 'BlueSky — revised pricing and onboarding plan', body: 'Hi David, attached is the revised API Access Tier pricing with a 10% discount for a 2-year commitment and a detailed onboarding plan. Happy to connect this week to finalize.', contactN: 3 },
    { dealN: 10, daysAgoN: 6,  direction: 'outbound', subject: 'BlueSky — following up on final proposal', body: 'Hi Priya, just checking in on the proposal. I know procurement timelines can be tight. Let me know if there is anything we can do to expedite the process on our end.', contactN: 4 },
    // Deal 11 (Granite IT Automation — Active, 5 emails)
    { dealN: 11, daysAgoN: 45, direction: 'outbound', subject: 'Granite — IT Automation Suite re-engagement', body: 'Hi Steve, great to reconnect. I understand the Vantora POC did not go as planned six months ago. Our IT Automation Suite has significantly expanded since then — I would love to show you what is new.', contactN: 12 },
    { dealN: 11, daysAgoN: 38, direction: 'outbound', subject: 'Granite — IT automation feature roadmap', body: 'Hi Steve and Raj, as discussed, here is our IT automation feature roadmap for H1 and H2. Key additions include AI-driven ticket routing, automated compliance reporting, and our new ITSM integration module.', contactN: 12 },
    { dealN: 11, daysAgoN: 28, direction: 'inbound',  subject: 'RE: IT Automation — phased rollout question', body: 'Steve here. Alicia (CFO) has flagged that the full suite is over budget this quarter. Can you prepare a phased option starting with just the core IT automation module? That might get us to approval faster.', contactN: 12 },
    { dealN: 11, daysAgoN: 18, direction: 'outbound', subject: 'Granite — phased IT automation pricing', body: 'Hi Steve and Alicia, attached is the phased pricing with Phase 1 covering core IT automation at $52k ACV, with an expansion path to the full suite in Q3. The ROI model shows break-even at 4 months.', contactN: 13 },
    { dealN: 11, daysAgoN: 9,  direction: 'outbound', subject: 'Granite — ROI deck and final proposal', body: 'Hi Alicia, I wanted to share our CFO-level ROI deck tailored for Granite. The phased model reduces upfront risk while delivering measurable savings from day one. Happy to walk through on a call.', contactN: 13 },
    // Deal 12 (Echo Health Provider Portal — Active, 5 emails)
    { dealN: 12, daysAgoN: 25, direction: 'outbound', subject: 'Echo Health — Provider Portal and HIPAA compliance overview', body: 'Hi Kevin, thank you for your interest in our Provider Portal. Attached is our HIPAA compliance documentation including BAA terms, SOC 2 Type II certification, and HL7 FHIR integration specs.', contactN: 11 },
    { dealN: 12, daysAgoN: 18, direction: 'outbound', subject: 'Echo Health — Nexlify compliance comparison', body: 'Hi Kevin, I understand Nexlify has pitched you with a lower price. Attached is our compliance gap analysis showing that Nexlify does not hold a SOC 2 Type II certification — a critical requirement for HIPAA-regulated environments.', contactN: 11 },
    { dealN: 12, daysAgoN: 12, direction: 'inbound',  subject: 'RE: Compliance comparison — Dr. Park has questions', body: 'Kevin here. Dr. Park reviewed the compliance gap analysis and has questions about the HIPAA BAA terms and breach notification SLA. Can you arrange a call with her this week?', contactN: 11 },
    { dealN: 12, daysAgoN: 7,  direction: 'outbound', subject: 'Echo Health — call summary and proposal', body: 'Hi Dr. Park and Kevin, thank you for the call today. As discussed, attached is the Provider Portal proposal with updated HIPAA BAA terms, breach notification SLA of 24 hours, and a healthcare reference from a comparable provider network.', contactN: 10 },
    { dealN: 12, daysAgoN: 3,  direction: 'outbound', subject: 'Echo Health — following up on proposal', body: 'Hi Kevin, just checking in on the Provider Portal proposal. We are ready to move quickly on procurement if you give us the green light. Happy to connect for any final questions.', contactN: 11 },
    // Deal 13 (Apex Seat Expansion — Active, 4 emails)
    { dealN: 13, daysAgoN: 50, direction: 'outbound', subject: 'Apex Financial — seat expansion options', body: 'Hi Rachel, following up on our discussion about expanding the Enterprise Suite to your new compliance team. Attached are seat expansion options at 25, 50, and 100 additional seats with volume pricing.', contactN: 2 },
    { dealN: 13, daysAgoN: 40, direction: 'inbound',  subject: 'RE: Seat expansion — James wants multi-year pricing', body: 'Rachel here. James (CFO) has approved the 50-seat expansion budget but wants to explore multi-year pricing. Can you put together 2- and 3-year options? We also need clarity on the Clausepoint integration scope.', contactN: 2 },
    { dealN: 13, daysAgoN: 30, direction: 'outbound', subject: 'Apex — multi-year pricing and Clausepoint integration brief', body: 'Hi James and Rachel, attached are the 2- and 3-year pricing options with the respective discount tiers. I have also included a one-pager on our native Clausepoint integration for the compliance workflow overlap.', contactN: 1 },
    { dealN: 13, daysAgoN: 12, direction: 'outbound', subject: 'Apex — updated order form for multi-year expansion', body: 'Hi Rachel, attached is the updated order form for the 50-seat, 2-year expansion. Please route to your procurement team; we are targeting a signature by end of month.', contactN: 2 },
    // Deal 14 (BlueSky Premium Upgrade — Active, 4 emails)
    { dealN: 14, daysAgoN: 42, direction: 'outbound', subject: 'BlueSky — Premium Tier upgrade overview', body: 'Hi David, as you consider upgrading from API Access to Premium, attached is an overview of the additional features: advanced data lineage, automated regulatory filing connectors, and dedicated data architect support.', contactN: 3 },
    { dealN: 14, daysAgoN: 32, direction: 'outbound', subject: 'BlueSky — data lineage POC setup', body: 'Hi Priya, the sandboxed POC environment is ready. Login details are attached. Please run your fintech lineage scenarios and let me know how it performs vs your Vantora baseline.', contactN: 4 },
    { dealN: 14, daysAgoN: 18, direction: 'inbound',  subject: 'RE: POC results — TechScale wins on lineage', body: 'David here. The POC results exceeded our expectations. TechScale outperformed Vantora on lineage depth and connector coverage. I am recommending Premium tier to our board next week. Can you send the order form?', contactN: 3 },
    { dealN: 14, daysAgoN: 10, direction: 'outbound', subject: 'BlueSky — Premium Tier order form', body: 'Hi David, congratulations on the board recommendation! Attached is the Premium Tier order form at $48k ACV with the upgraded connector pack and dedicated data architect. Let us know when procurement is ready to sign.', contactN: 3 },
    // Deal 15 (CloudBridge Growth — Active, 4 emails)
    { dealN: 15, daysAgoN: 19, direction: 'outbound', subject: 'CloudBridge — Growth Package options', body: 'Hi Omar, following up on the Growth Package discussion. Attached are three options ranging from core expansion (add-on modules) to full growth package with FinOps and dedicated support. Pricing starts at $22k ACV.', contactN: 5 },
    { dealN: 15, daysAgoN: 14, direction: 'outbound', subject: 'CloudBridge — Nexlify migration risk analysis', body: 'Hi Lisa, I understand Nexlify has made a competitive offer. Attached is our migration risk analysis covering three key areas where Nexlify falls short for CloudBridge: SOC 2 Type II gap, lack of dedicated support, and migration complexity from your current stack.', contactN: 6 },
    { dealN: 15, daysAgoN: 8,  direction: 'inbound',  subject: 'RE: Nexlify SOC 2 gap — this is a blocker', body: 'Lisa here. The SOC 2 Type II gap you flagged is a showstopper for us — our security policy requires it for all cloud vendors. We are proceeding with TechScale. Can you send a final pricing proposal with a retention discount?', contactN: 6 },
    { dealN: 15, daysAgoN: 4,  direction: 'outbound', subject: 'CloudBridge — final Growth Package pricing', body: 'Hi Lisa and Omar, attached is the final Growth Package pricing with a 12% retention discount applied. We are also including a dedicated security architect for the first 90 days at no charge. Please send the PO when ready.', contactN: 6 },
    // Deal 16 (Granite License Expansion — Active, 4 emails)
    { dealN: 16, daysAgoN: 29, direction: 'outbound', subject: 'Granite — License Expansion proposal', body: 'Hi Steve and Raj, following up on the license expansion discussion. Attached is the proposal for 50 additional seats with a volume pricing discount and expanded IT automation module access.', contactN: 12 },
    { dealN: 16, daysAgoN: 22, direction: 'outbound', subject: 'Granite — Synaptix integration comparison', body: 'Hi Raj, as requested, here is our comparison with Synaptix as an integration platform. We cover the same integration layer use cases with the added benefit of dedicated account management and our proven ITSM connector library.', contactN: 14 },
    { dealN: 16, daysAgoN: 10, direction: 'inbound',  subject: 'RE: License Expansion — CFO review needed', body: 'Steve here. Alicia wants a CFO-level ROI breakdown before approving the expansion. Can you prepare something that shows the cost savings from our support SLA and automation gains? She is also curious how we compare to Synaptix on total cost.', contactN: 12 },
    { dealN: 16, daysAgoN: 5,  direction: 'outbound', subject: 'Granite — CFO ROI deck and Synaptix comparison', body: 'Hi Alicia and Steve, attached is the CFO ROI deck showing 18-month payback on the license expansion and a one-page Synaptix comparison on total cost of ownership. Happy to walk through on a call before the close target.', contactN: 13 },
  ];

  for (const email of EMAILS) {
    const deal = DEALS.find(d => d.n === email.dealN)!;
    const actor = email.direction === 'outbound' ? repEmail(deal.owner) : (
      email.contactN
        ? (() => {
            const c = CONTACTS.find(x => x.n === email.contactN)!;
            return `${c.first.toLowerCase()}.${c.last.toLowerCase()}@${ACCOUNTS[c.acctN - 1].domain}`;
          })()
        : 'contact@demo.com'
    );
    await query(
      `INSERT INTO activities (id, workspace_id, source, source_id, activity_type, timestamp,
         actor, subject, body, direction, deal_id, account_id, contact_id, created_at, updated_at)
       VALUES ($1,$2,'demo',$3,'email',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (workspace_id, source, source_id) DO NOTHING`,
      [
        actId(actCounter++), WS_ID, `demo-act-${actCounter - 1}`,
        daysAgo(email.daysAgoN), actor, email.subject, email.body, email.direction,
        dealId(email.dealN), acctId(deal.acctN),
        email.contactN ? contactId(email.contactN) : null,
        daysAgo(email.daysAgoN), new Date(),
      ]
    );
  }

  // ── 11. deal_insights (MEDDPIC qualification for active deals 9-16) ──────────

  let insightCounter = 1;

  interface InsightSpec {
    dealN: number;
    convN: number;
    insightType: string;
    insightKey: string;
    value: string;
    confidence: number;
  }

  const INSIGHTS: InsightSpec[] = [
    // Deal 9 — Dynamo Commerce Platform
    { dealN: 9, convN: 1, insightType: 'champion',         insightKey: 'Champion',          value: 'Mei Zhang (Head of E-Commerce) is the internal champion driving the evaluation. She has presented the integration benefits to Carlos Rivera (SVP Technology) and has full buy-in from the commerce team.', confidence: 0.90 },
    { dealN: 9, convN: 1, insightType: 'economic_buyer',   insightKey: 'Economic Buyer',     value: 'Carlos Rivera (SVP Technology) holds budget authority for the commerce platform investment. He approved the Q1 go-live timeline in the negotiation call.', confidence: 0.92 },
    { dealN: 9, convN: 1, insightType: 'competition',      insightKey: 'Competition',        value: 'Vantora is the current incumbent for the commerce stack. Clausepoint is being evaluated for adjacent contract workflows but is not a direct competitor for this deal. TechScale has differentiated on integration depth and migration accelerator.', confidence: 0.93 },
    { dealN: 9, convN: 2, insightType: 'decision_criteria', insightKey: 'Decision Criteria', value: 'Integration depth with existing commerce stack, SLA terms (99.9% uptime), and compatibility with Clausepoint contract workflows are the primary evaluation criteria. Go-live by Q1 is a hard deadline.', confidence: 0.90 },
    // Deal 10 — BlueSky API Access Tier
    { dealN: 10, convN: 3, insightType: 'champion',        insightKey: 'Champion',           value: 'Priya Nair (Head of Data) is coordinating the evaluation and is aligned with TechScale after the Meridian POC underperformed. David Kim (CTO) is the final decision-maker.', confidence: 0.88 },
    { dealN: 10, convN: 3, insightType: 'competition',     insightKey: 'Competition',        value: 'Meridian Analytics was evaluated side-by-side and has now been eliminated due to weak data lineage tracing. Vantora is the incumbent but David Kim is pushing for best-of-breed on the API layer. TechScale is now the frontrunner.', confidence: 0.92 },
    { dealN: 10, convN: 4, insightType: 'decision_criteria', insightKey: 'Decision Criteria', value: 'Connector breadth, data lineage depth for regulated fintech datasets, onboarding speed, and pricing are the key criteria. Priya Nair is coordinating procurement.', confidence: 0.90 },
    { dealN: 10, convN: 4, insightType: 'pain_point',      insightKey: 'Pain',               value: 'Vantora lock-in is creating integration friction for BlueSky\'s growing API layer. Meridian Analytics lacked the data lineage depth required for regulated fintech data workflows.', confidence: 0.88 },
    // Deal 11 — Granite IT Automation Suite
    { dealN: 11, convN: 5, insightType: 'champion',        insightKey: 'Champion',           value: 'Steve Olsen (VP IT) is the internal champion after a failed Vantora POC. He has built internal credibility by leading the re-evaluation and is advocating for TechScale\'s IT automation capabilities.', confidence: 0.90 },
    { dealN: 11, convN: 5, insightType: 'competition',     insightKey: 'Competition',        value: 'Vantora ran a failed POC six months ago and is no longer in consideration. Meridian Analytics was briefly evaluated and dropped due to missing IT automation modules. TechScale has a clear field.', confidence: 0.91 },
    { dealN: 11, convN: 6, insightType: 'economic_buyer',  insightKey: 'Economic Buyer',     value: 'Alicia Fonseca (CFO) has budget authority and approved the phased rollout approach. She is focused on ROI and payback period, requesting the CFO-level deck before final sign-off.', confidence: 0.90 },
    { dealN: 11, convN: 6, insightType: 'decision_criteria', insightKey: 'Decision Criteria', value: 'Phased implementation feasibility, ROI payback period (target: under 12 months), and IT automation module completeness are the primary criteria. CFO approval is the final gate.', confidence: 0.88 },
    // Deal 12 — Echo Health Provider Portal
    { dealN: 12, convN: 7, insightType: 'champion',        insightKey: 'Champion',           value: 'Kevin Grant (Director of IT) is managing the evaluation and is aligned with TechScale on HIPAA compliance depth. He has limited budget authority and needs Dr. Susan Park\'s approval.', confidence: 0.85 },
    { dealN: 12, convN: 7, insightType: 'economic_buyer',  insightKey: 'Economic Buyer',     value: 'Dr. Susan Park (CMO) holds budget authority. She initially had concerns about Nexlify\'s lower price but has since flagged their HIPAA compliance gap as a blocker.', confidence: 0.88 },
    { dealN: 12, convN: 7, insightType: 'competition',     insightKey: 'Competition',        value: 'Nexlify pitched at 30% lower price. However, they do not hold SOC 2 Type II certification, which is a policy requirement for Echo Health cloud vendors. TechScale has used this as a key differentiator.', confidence: 0.94 },
    { dealN: 12, convN: 8, insightType: 'decision_criteria', insightKey: 'Decision Criteria', value: 'HIPAA compliance depth (including SOC 2 Type II), breach notification SLA (24-hour target), and total cost of ownership vs Nexlify are the primary evaluation criteria.', confidence: 0.90 },
    // Deal 13 — Apex Seat Expansion
    { dealN: 13, convN: 9, insightType: 'champion',        insightKey: 'Champion',           value: 'Rachel Torres (VP Finance) is the internal champion driving the seat expansion. She has full buy-in from the compliance team and is coordinating with James Whitmore on budget approval.', confidence: 0.90 },
    { dealN: 13, convN: 9, insightType: 'economic_buyer',  insightKey: 'Economic Buyer',     value: 'James Whitmore (CFO) approved the 50-seat expansion budget and is requesting multi-year pricing. His primary concern is total contract value and discount structure.', confidence: 0.92 },
    { dealN: 13, convN: 9, insightType: 'competition',     insightKey: 'Competition',        value: 'Clausepoint is being evaluated for adjacent compliance workflows but is not competing directly for this seat expansion. Rachel Torres has confirmed TechScale is the preferred platform for the core expansion.', confidence: 0.88 },
    { dealN: 13, convN: 10, insightType: 'decision_criteria', insightKey: 'Decision Criteria', value: 'Multi-year pricing (2- or 3-year options), volume discount for 50 seats, and clarity on Clausepoint integration scope are the key criteria before procurement sign-off.', confidence: 0.90 },
    // Deal 14 — BlueSky Premium Upgrade
    { dealN: 14, convN: 11, insightType: 'champion',       insightKey: 'Champion',           value: 'David Kim (CTO) is recommending TechScale Premium tier to the BlueSky board after the successful lineage POC. Priya Nair is coordinating procurement.', confidence: 0.92 },
    { dealN: 14, convN: 11, insightType: 'competition',    insightKey: 'Competition',        value: 'Vantora Enterprise was the primary comparison on data lineage depth. TechScale outperformed Vantora in the POC on connector coverage and lineage tracing for regulated fintech datasets. Vantora is no longer in active consideration.', confidence: 0.93 },
    { dealN: 14, convN: 12, insightType: 'decision_criteria', insightKey: 'Decision Criteria', value: 'Data lineage depth for regulated datasets, connector breadth vs Vantora, and dedicated data architect support are the primary criteria. Board approval required for the contract.', confidence: 0.90 },
    // Deal 15 — CloudBridge Growth Package
    { dealN: 15, convN: 13, insightType: 'champion',       insightKey: 'Champion',           value: 'Omar Hassan (VP Engineering) is evaluating the growth package and prefers TechScale on support consistency. Lisa Chen (CISO) has become the key influencer after flagging Nexlify\'s SOC 2 gap.', confidence: 0.88 },
    { dealN: 15, convN: 13, insightType: 'competition',    insightKey: 'Competition',        value: 'Nexlify offered a bundled expansion rate at 25% below TechScale. However, Nexlify lacks SOC 2 Type II certification, which is a CloudBridge security policy requirement — creating a decisive compliance advantage for TechScale.', confidence: 0.95 },
    { dealN: 15, convN: 14, insightType: 'decision_criteria', insightKey: 'Decision Criteria', value: 'SOC 2 Type II compliance, dedicated support SLA, and total migration risk from the existing platform are the primary evaluation criteria. Lisa Chen (CISO) has fast-track authority given the compliance blocker on Nexlify.', confidence: 0.90 },
    // Deal 16 — Granite License Expansion
    { dealN: 16, convN: 15, insightType: 'champion',       insightKey: 'Champion',           value: 'Steve Olsen (VP IT) prefers TechScale for support consistency and is advocating for the expansion. Alicia Fonseca (CFO) has budget authority and needs an ROI breakdown before approval.', confidence: 0.88 },
    { dealN: 16, convN: 15, insightType: 'competition',    insightKey: 'Competition',        value: 'Synaptix is positioned as a platform-layer alternative by Raj Mehta (IT Manager), who used them in a prior project. Steve Olsen has confirmed Synaptix lacks dedicated account management — a key differentiator for TechScale.', confidence: 0.90 },
    { dealN: 16, convN: 16, insightType: 'economic_buyer', insightKey: 'Economic Buyer',     value: 'Alicia Fonseca (CFO) holds budget authority for the license expansion. She is requesting a CFO-level ROI breakdown and Synaptix total cost comparison before giving approval.', confidence: 0.90 },
    { dealN: 16, convN: 16, insightType: 'decision_criteria', insightKey: 'Decision Criteria', value: 'Total cost of ownership vs Synaptix, ROI payback period, and dedicated account management quality are the primary criteria. CFO approval is the final gate.', confidence: 0.88 },
  ];

  for (const ins of INSIGHTS) {
    await query(
      `INSERT INTO deal_insights (id, workspace_id, deal_id, insight_type, insight_key, value,
         confidence, source_conversation_id, is_current, extracted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9)
       ON CONFLICT DO NOTHING`,
      [
        insightId(insightCounter++), WS_ID, dealId(ins.dealN),
        ins.insightType, ins.insightKey, ins.value, ins.confidence,
        convId(ins.convN), daysAgo(7),
      ]
    );
  }

  console.log(
    `[DemoSeed] Seeded workspace "${WS_NAME}":\n` +
    `  ${ACCOUNTS.length} accounts\n` +
    `  ${DEALS.length} deals + stage history\n` +
    `  ${CONTACTS.length} contacts\n` +
    `  ${CONVERSATIONS.length} conversations\n` +
    `  ${sigCounter - 1} conversation signals (incl. competitor mentions: Vantora, Nexlify, Meridian Analytics, Clausepoint, Synaptix)\n` +
    `  ${actCounter - 1} email activities\n` +
    `  ${insightCounter - 1} deal insights (MEDDPIC qualification)`
  );
}
