import dotenv from 'dotenv';
dotenv.config();

import { query } from '../db.js';
import {
  queryDeals, getDeal, getDealsByStage, getStaleDeals, getPipelineSummary,
} from '../tools/deal-query.js';
import {
  queryContacts, getStakeholderMap,
} from '../tools/contact-query.js';
import {
  queryAccounts, getAccount, getAccountHealth,
} from '../tools/account-query.js';
import {
  queryActivities, getActivityTimeline, getActivitySummary,
} from '../tools/activity-query.js';
import {
  queryConversations,
} from '../tools/conversation-query.js';
import {
  queryTasks, getOverdueTasks, getTaskSummary,
} from '../tools/task-query.js';
import {
  queryDocuments,
} from '../tools/document-query.js';
import { computeFields } from '../computed-fields/engine.js';
import { generatePipelineSnapshot } from '../analysis/pipeline-snapshot.js';

interface TestResult {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
}

const results: TestResult[] = [];

function assert(name: string, passed: boolean, expected: string, actual: string) {
  results.push({ name, passed, expected, actual });
}

async function createWorkspace(): Promise<string> {
  await query(`DELETE FROM workspaces WHERE slug = $1`, ['smoke-test']);
  const res = await query<{ id: string }>(
    `INSERT INTO workspaces (name, slug) VALUES ($1, $2) RETURNING id`,
    ['Smoke Test', 'smoke-test'],
  );
  return res.rows[0].id;
}

async function insertAccounts(workspaceId: string): Promise<string[]> {
  const industries = ['Technology', 'Healthcare', 'Finance', 'Manufacturing', 'Retail'];
  const names = ['Acme Corp', 'MedTech Inc', 'Capital Partners', 'BuildRight Ltd', 'ShopSmart'];
  const domains = ['acme.com', 'medtech.io', 'capitalpartners.com', 'buildright.co', 'shopsmart.com'];
  const ids: string[] = [];

  for (let i = 0; i < 5; i++) {
    const res = await query<{ id: string }>(
      `INSERT INTO accounts (workspace_id, source, source_id, source_data, name, domain, industry, employee_count, annual_revenue, owner, custom_fields)
       VALUES ($1, $2, $3, '{}'::jsonb, $4, $5, $6, $7, $8, $9, '{}'::jsonb)
       RETURNING id`,
      [workspaceId, 'smoke-test', `account-${i + 1}`, names[i], domains[i], industries[i],
       (i + 1) * 100, (i + 1) * 1000000, 'rep@company.com'],
    );
    ids.push(res.rows[0].id);
  }
  return ids;
}

async function insertDeals(workspaceId: string, accountIds: string[]): Promise<string[]> {
  const now = new Date();
  const daysAgo = (d: number) => {
    const dt = new Date(now);
    dt.setDate(dt.getDate() - d);
    return dt;
  };
  const daysFromNow = (d: number) => {
    const dt = new Date(now);
    dt.setDate(dt.getDate() + d);
    return dt;
  };

  const deals = [
    { name: 'Enterprise Platform Deal', amount: 250000, stage: 'Qualification', stageNorm: 'qualification', closeDate: daysFromNow(30), owner: 'alice@co.com', accountIdx: 0, probability: 30, forecast: 'pipeline', pipeline: 'Enterprise', daysInStage: 5, lastActivity: daysAgo(2) },
    { name: 'Healthcare SaaS', amount: 150000, stage: 'Evaluation', stageNorm: 'evaluation', closeDate: daysFromNow(45), owner: 'bob@co.com', accountIdx: 1, probability: 50, forecast: 'best_case', pipeline: 'Enterprise', daysInStage: 10, lastActivity: daysAgo(1) },
    { name: 'Finance Analytics', amount: 500000, stage: 'Decision', stageNorm: 'decision', closeDate: daysFromNow(15), owner: 'alice@co.com', accountIdx: 2, probability: 70, forecast: 'commit', pipeline: 'Enterprise', daysInStage: 8, lastActivity: daysAgo(3) },
    { name: 'Manufacturing IoT', amount: 75000, stage: 'Negotiation', stageNorm: 'negotiation', closeDate: daysFromNow(7), owner: 'carol@co.com', accountIdx: 3, probability: 80, forecast: 'commit', pipeline: 'Mid-Market', daysInStage: 3, lastActivity: daysAgo(1) },
    { name: 'Retail Expansion', amount: 45000, stage: 'Awareness', stageNorm: 'awareness', closeDate: daysFromNow(90), owner: 'dave@co.com', accountIdx: 4, probability: 10, forecast: 'pipeline', pipeline: 'Mid-Market', daysInStage: 2, lastActivity: daysAgo(5) },
    { name: 'Won Deal Alpha', amount: 120000, stage: 'Closed Won', stageNorm: 'closed_won', closeDate: daysAgo(10), owner: 'alice@co.com', accountIdx: 0, probability: 100, forecast: 'closed', pipeline: 'Enterprise', daysInStage: 0, lastActivity: daysAgo(10) },
    { name: 'Lost Deal Beta', amount: 80000, stage: 'Closed Lost', stageNorm: 'closed_lost', closeDate: daysAgo(5), owner: 'bob@co.com', accountIdx: 1, probability: 0, forecast: 'omitted', pipeline: 'Mid-Market', daysInStage: 0, lastActivity: daysAgo(5) },
    { name: 'Stale Opportunity', amount: 200000, stage: 'Qualification', stageNorm: 'qualification', closeDate: daysAgo(20), owner: 'carol@co.com', accountIdx: 2, probability: 20, forecast: 'pipeline', pipeline: 'Enterprise', daysInStage: 45, lastActivity: daysAgo(30) },
    { name: 'Null Amount Deal', amount: null, stage: 'Evaluation', stageNorm: 'evaluation', closeDate: daysFromNow(60), owner: 'dave@co.com', accountIdx: 3, probability: 40, forecast: 'best_case', pipeline: 'Mid-Market', daysInStage: 7, lastActivity: daysAgo(4) },
    { name: 'Quick Win', amount: 25000, stage: 'Qualification', stageNorm: 'qualification', closeDate: daysFromNow(14), owner: 'alice@co.com', accountIdx: 4, probability: 60, forecast: 'best_case', pipeline: 'SMB', daysInStage: 4, lastActivity: daysAgo(1) },
  ];

  const ids: string[] = [];
  for (let i = 0; i < deals.length; i++) {
    const d = deals[i];
    const res = await query<{ id: string }>(
      `INSERT INTO deals (workspace_id, source, source_id, source_data, name, amount, stage, stage_normalized, close_date, owner, account_id, probability, forecast_category, pipeline, days_in_stage, last_activity_date, custom_fields)
       VALUES ($1, $2, $3, '{}'::jsonb, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, '{}'::jsonb)
       RETURNING id`,
      [workspaceId, 'smoke-test', `deal-${i + 1}`, d.name, d.amount, d.stage, d.stageNorm, d.closeDate.toISOString().slice(0, 10), d.owner, accountIds[d.accountIdx], d.probability, d.forecast, d.pipeline, d.daysInStage, d.lastActivity],
    );
    ids.push(res.rows[0].id);
  }
  return ids;
}

async function insertContacts(workspaceId: string, accountIds: string[]): Promise<string[]> {
  const contacts = [
    { first: 'Jane', last: 'Smith', email: 'jane.smith@acme.com', title: 'VP of Sales', seniority: 'VP', dept: 'Sales', acctIdx: 0 },
    { first: 'John', last: 'Doe', email: 'john.doe@acme.com', title: 'Director of Engineering', seniority: 'Director', dept: 'Engineering', acctIdx: 0 },
    { first: 'Sarah', last: 'Chen', email: 'sarah.chen@medtech.io', title: 'VP of Product', seniority: 'VP', dept: 'Product', acctIdx: 1 },
    { first: 'Mike', last: 'Johnson', email: 'mike.j@medtech.io', title: 'Engineering Manager', seniority: 'Manager', dept: 'Engineering', acctIdx: 1 },
    { first: 'Lisa', last: 'Wang', email: 'lisa.wang@capitalpartners.com', title: 'Director of Operations', seniority: 'Director', dept: 'Operations', acctIdx: 2 },
    { first: 'Tom', last: 'Brown', email: 'tom.b@capitalpartners.com', title: 'Senior Analyst', seniority: 'IC', dept: 'Finance', acctIdx: 2 },
    { first: 'Emily', last: 'Davis', email: 'emily.d@buildright.co', title: 'VP of Engineering', seniority: 'VP', dept: 'Engineering', acctIdx: 3 },
    { first: 'Chris', last: 'Wilson', email: 'chris.w@buildright.co', title: 'Product Manager', seniority: 'Manager', dept: 'Product', acctIdx: 3 },
    { first: 'Amy', last: 'Lee', email: 'amy.l@buildright.co', title: 'Software Engineer', seniority: 'IC', dept: 'Engineering', acctIdx: 3 },
    { first: 'David', last: 'Kim', email: 'david.k@shopsmart.com', title: 'Director of IT', seniority: 'Director', dept: 'IT', acctIdx: 4 },
    { first: 'Rachel', last: 'Green', email: 'rachel.g@shopsmart.com', title: 'Marketing Manager', seniority: 'Manager', dept: 'Marketing', acctIdx: 4 },
    { first: 'Steve', last: 'Rogers', email: 'steve.r@shopsmart.com', title: 'CTO', seniority: 'VP', dept: 'Engineering', acctIdx: 4 },
    { first: 'Natasha', last: 'Romanov', email: null, title: 'Security Lead', seniority: 'Manager', dept: 'Security', acctIdx: 0 },
    { first: 'Bruce', last: 'Banner', email: 'bruce.b@acme.com', title: 'Data Scientist', seniority: 'IC', dept: 'Data', acctIdx: 0 },
    { first: 'Peter', last: 'Parker', email: 'peter.p@medtech.io', title: 'Junior Developer', seniority: 'IC', dept: 'Engineering', acctIdx: 1 },
  ];

  const ids: string[] = [];
  for (let i = 0; i < contacts.length; i++) {
    const c = contacts[i];
    const res = await query<{ id: string }>(
      `INSERT INTO contacts (workspace_id, source, source_id, source_data, email, first_name, last_name, title, seniority, department, account_id, lifecycle_stage, custom_fields)
       VALUES ($1, $2, $3, '{}'::jsonb, $4, $5, $6, $7, $8, $9, $10, $11, '{}'::jsonb)
       RETURNING id`,
      [workspaceId, 'smoke-test', `contact-${i + 1}`, c.email, c.first, c.last, c.title, c.seniority, c.dept, accountIds[c.acctIdx], 'customer'],
    );
    ids.push(res.rows[0].id);
  }
  return ids;
}

async function insertActivities(workspaceId: string, dealIds: string[], contactIds: string[], accountIds: string[]): Promise<void> {
  const now = new Date();
  const daysAgo = (d: number) => {
    const dt = new Date(now);
    dt.setDate(dt.getDate() - d);
    return dt;
  };

  const types = ['email', 'call', 'meeting'];
  const directions = ['inbound', 'outbound'];
  const actors = ['alice@co.com', 'bob@co.com', 'carol@co.com', 'dave@co.com'];

  for (let i = 0; i < 20; i++) {
    const actType = types[i % 3];
    const dealIdx = i % dealIds.length;
    const contactIdx = i % contactIds.length;
    const accountIdx = i % accountIds.length;
    const day = Math.floor((i / 20) * 30);

    await query(
      `INSERT INTO activities (workspace_id, source, source_id, source_data, activity_type, timestamp, actor, subject, body, deal_id, contact_id, account_id, direction, duration_seconds, custom_fields)
       VALUES ($1, $2, $3, '{}'::jsonb, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, '{}'::jsonb)`,
      [workspaceId, 'smoke-test', `activity-${i + 1}`, actType, daysAgo(day), actors[i % actors.length],
       `${actType} about deal progress #${i + 1}`, `Body of ${actType} activity ${i + 1}`,
       dealIds[dealIdx], contactIds[contactIdx], accountIds[accountIdx],
       directions[i % 2], actType === 'call' ? 300 + i * 60 : null],
    );
  }
}

async function insertConversations(workspaceId: string, dealIds: string[], accountIds: string[]): Promise<void> {
  const conversations = [
    { title: 'Discovery Call with Acme', summary: 'Initial discovery call discussing platform needs', source: 'gong', dealIdx: 0, acctIdx: 0, duration: 1800, sentiment: 0.75 },
    { title: 'Technical Deep Dive MedTech', summary: 'Technical review of integration requirements', source: 'gong', dealIdx: 1, acctIdx: 1, duration: 2700, sentiment: 0.82 },
    { title: 'Pricing Discussion Capital Partners', summary: 'Reviewed pricing tiers and contract terms', source: 'fireflies', dealIdx: 2, acctIdx: 2, duration: 3600, sentiment: 0.60 },
    { title: 'Demo Walkthrough BuildRight', summary: 'Full product demo with engineering team', source: 'fireflies', dealIdx: 3, acctIdx: 3, duration: 2400, sentiment: 0.90 },
    { title: 'Follow-up ShopSmart Retail', summary: 'Follow-up on expansion requirements', source: 'gong', dealIdx: 4, acctIdx: 4, duration: 1200, sentiment: 0.68 },
  ];

  const now = new Date();
  for (let i = 0; i < conversations.length; i++) {
    const c = conversations[i];
    const callDate = new Date(now);
    callDate.setDate(callDate.getDate() - (i + 1) * 3);

    await query(
      `INSERT INTO conversations (workspace_id, source, source_id, source_data, title, call_date, duration_seconds, participants, deal_id, account_id, transcript_text, summary, action_items, objections, sentiment_score, talk_listen_ratio, topics, competitor_mentions, custom_fields)
       VALUES ($1, $2, $3, '{}'::jsonb, $4, $5, $6, '[]'::jsonb, $7, $8, $9, $10, '[]'::jsonb, '[]'::jsonb, $11, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb)`,
      [workspaceId, c.source, `conversation-${i + 1}`, c.title, callDate, c.duration,
       dealIds[c.dealIdx], accountIds[c.acctIdx],
       `Transcript of ${c.title}`, c.summary, c.sentiment],
    );
  }
}

async function insertTasks(workspaceId: string, dealIds: string[], accountIds: string[]): Promise<void> {
  const now = new Date();
  const daysAgo = (d: number) => { const dt = new Date(now); dt.setDate(dt.getDate() - d); return dt; };
  const daysFromNow = (d: number) => { const dt = new Date(now); dt.setDate(dt.getDate() + d); return dt; };

  const tasks = [
    { title: 'Send proposal to Acme', status: 'open', assignee: 'alice@co.com', dueDate: daysAgo(5), priority: 'high', dealIdx: 0, acctIdx: 0 },
    { title: 'Schedule demo with MedTech', status: 'in_progress', assignee: 'bob@co.com', dueDate: daysFromNow(3), priority: 'medium', dealIdx: 1, acctIdx: 1 },
    { title: 'Contract review Finance deal', status: 'completed', assignee: 'carol@co.com', dueDate: daysFromNow(10), priority: 'low', dealIdx: 2, acctIdx: 2 },
  ];

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    await query(
      `INSERT INTO tasks (workspace_id, source, source_id, source_data, title, description, status, assignee, due_date, created_date, completed_date, priority, project, deal_id, account_id, custom_fields)
       VALUES ($1, $2, $3, '{}'::jsonb, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, '{}'::jsonb)`,
      [workspaceId, 'smoke-test', `task-${i + 1}`, t.title, `Description for ${t.title}`, t.status, t.assignee,
       t.dueDate.toISOString().slice(0, 10), daysAgo(15),
       t.status === 'completed' ? now : null,
       t.priority, 'Smoke Test Project', dealIds[t.dealIdx], accountIds[t.acctIdx]],
    );
  }
}

async function insertDocuments(workspaceId: string, dealIds: string[], accountIds: string[]): Promise<void> {
  const docs = [
    { title: 'Technical Requirements Document', docType: 'requirements', content: 'Detailed technical requirements for the enterprise platform integration.', mime: 'application/pdf', author: 'alice@co.com', dealIdx: 0, acctIdx: 0 },
    { title: 'Sales Proposal Q1', docType: 'proposal', content: 'Comprehensive sales proposal for Q1 engagement with pricing details.', mime: 'application/pdf', author: 'bob@co.com', dealIdx: 2, acctIdx: 2 },
  ];

  const now = new Date();
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    await query(
      `INSERT INTO documents (workspace_id, source, source_id, source_data, title, doc_type, content_text, summary, mime_type, url, deal_id, account_id, author, last_modified_at, custom_fields)
       VALUES ($1, $2, $3, '{}'::jsonb, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, '{}'::jsonb)`,
      [workspaceId, 'smoke-test', `document-${i + 1}`, d.title, d.docType, d.content,
       `Summary of ${d.title}`, d.mime, `https://docs.example.com/${i + 1}`,
       dealIds[d.dealIdx], accountIds[d.acctIdx], d.author, now],
    );
  }
}

async function runTests(workspaceId: string, dealIds: string[], contactIds: string[], accountIds: string[]) {
  {
    const res = await queryDeals(workspaceId, {});
    assert('queryDeals: all deals', res.total === 10, '10 deals', `${res.total} deals`);
  }

  {
    const res = await queryDeals(workspaceId, { stageNormalized: 'qualification' });
    assert('queryDeals: qualification filter', res.total >= 1, '>= 1 qualification deals', `${res.total} deals`);
  }

  {
    const res = await queryDeals(workspaceId, { amountMin: 50000 });
    assert('queryDeals: amountMin filter', res.total >= 1 && res.total < 10, 'filtered count between 1-9', `${res.total} deals`);
  }

  {
    const res = await getDealsByStage(workspaceId);
    const uniqueNorm = new Set(res.stages.map(s => s.stage_normalized));
    assert('getDealsByStage: multiple stages', uniqueNorm.size >= 5, '>= 5 stage_normalized values', `${uniqueNorm.size} values`);
  }

  {
    const res = await getPipelineSummary(workspaceId);
    assert('getPipelineSummary: totalPipeline > 0', res.totalPipeline > 0, 'totalPipeline > 0', `${res.totalPipeline}`);
    assert('getPipelineSummary: dealCount = 10', res.dealCount === 10, '10 deals', `${res.dealCount} deals`);
  }

  {
    const res = await getStaleDeals(workspaceId, 14);
    assert('getStaleDeals: at least 1', res.length >= 1, '>= 1 stale deals', `${res.length} stale deals`);
  }

  {
    const res = await queryContacts(workspaceId, {});
    assert('queryContacts: all contacts', res.total === 15, '15 contacts', `${res.total} contacts`);
  }

  {
    const res = await queryContacts(workspaceId, { seniority: 'VP' });
    assert('queryContacts: VP filter', res.total >= 1, '>= 1 VP contacts', `${res.total} contacts`);
  }

  {
    const res = await getStakeholderMap(workspaceId, accountIds[0]);
    assert('getStakeholderMap: returns stakeholders', res.stakeholders.length >= 1, '>= 1 seniority groups', `${res.stakeholders.length} groups`);
  }

  {
    const res = await getAccount(workspaceId, accountIds[0]);
    assert('getAccount: returns account', res !== null, 'account found', res ? `${res.name}` : 'null');
  }

  {
    const res = await getAccountHealth(workspaceId, accountIds[0]);
    assert('getAccountHealth: returns data', res.account.id === accountIds[0], 'account matches', `id=${res.account.id}`);
  }

  {
    const res = await queryActivities(workspaceId, {});
    assert('queryActivities: all activities', res.total === 20, '20 activities', `${res.total} activities`);
  }

  {
    const res = await getActivityTimeline(workspaceId, dealIds[0]);
    const sorted = res.every((a, i) => i === 0 || new Date(a.timestamp) >= new Date(res[i - 1].timestamp));
    assert('getActivityTimeline: chronological', res.length >= 1 && sorted, 'chronological order', `${res.length} activities, sorted=${sorted}`);
  }

  {
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - 60);
    const dateTo = new Date();
    const res = await getActivitySummary(workspaceId, dateFrom, dateTo);
    assert('getActivitySummary: counts by type', res.totalActivities >= 1, '>= 1 activities', `${res.totalActivities} total`);
  }

  {
    const res = await queryConversations(workspaceId, {});
    assert('queryConversations: all', res.total === 5, '5 conversations', `${res.total} conversations`);
  }

  {
    const res = await queryConversations(workspaceId, { search: 'Discovery Call' });
    assert('queryConversations: search by title', res.total >= 1, '>= 1 matching', `${res.total} matching`);
  }

  {
    const res = await getOverdueTasks(workspaceId);
    assert('getOverdueTasks: at least 1', res.length >= 1, '>= 1 overdue', `${res.length} overdue`);
  }

  {
    const res = await getTaskSummary(workspaceId);
    const totalByStatus = res.byStatus.reduce((s, r) => s + r.count, 0);
    assert('getTaskSummary: counts', totalByStatus === 3, '3 total tasks', `${totalByStatus} tasks`);
  }

  {
    const res = await queryDocuments(workspaceId, {});
    assert('queryDocuments: all', res.total === 2, '2 documents', `${res.total} documents`);
  }

  {
    const res = await computeFields(workspaceId);
    const totalProcessed = res.deals.processed + res.contacts.processed + res.accounts.processed;
    assert('computeFields: processed > 0', totalProcessed > 0, '> 0 processed', `${totalProcessed} processed`);
  }

  {
    const openDealId = dealIds[0];
    const deal = await getDeal(workspaceId, openDealId);
    assert('computeFields: health_score populated', deal !== null && deal.health_score !== null, 'health_score set', deal ? `health_score=${deal.health_score}` : 'deal not found');
  }

  {
    const res = await generatePipelineSnapshot(workspaceId);
    assert('pipelineSnapshot: totalPipeline > 0', res.totalPipeline > 0, 'totalPipeline > 0', `${res.totalPipeline}`);
    assert('pipelineSnapshot: dealCount > 0', res.dealCount > 0, 'dealCount > 0', `${res.dealCount}`);
  }
}

async function cleanup(workspaceId: string) {
  await query(`DELETE FROM workspaces WHERE id = $1`, [workspaceId]);
}

async function main() {
  const keepData = process.argv.includes('--keep');

  console.log('🔥 Pandora Smoke Test\n');

  let workspaceId = '';
  try {
    console.log('▸ Creating workspace...');
    workspaceId = await createWorkspace();
    console.log(`  workspace_id = ${workspaceId}\n`);

    console.log('▸ Inserting test data...');
    const accountIds = await insertAccounts(workspaceId);
    console.log(`  ${accountIds.length} accounts`);
    const dealIds = await insertDeals(workspaceId, accountIds);
    console.log(`  ${dealIds.length} deals`);
    const contactIds = await insertContacts(workspaceId, accountIds);
    console.log(`  ${contactIds.length} contacts`);
    await insertActivities(workspaceId, dealIds, contactIds, accountIds);
    console.log('  20 activities');
    await insertConversations(workspaceId, dealIds, accountIds);
    console.log('  5 conversations');
    await insertTasks(workspaceId, dealIds, accountIds);
    console.log('  3 tasks');
    await insertDocuments(workspaceId, dealIds, accountIds);
    console.log('  2 documents\n');

    console.log('▸ Running tests...\n');
    await runTests(workspaceId, dealIds, contactIds, accountIds);

    let passed = 0;
    let failed = 0;
    for (const r of results) {
      if (r.passed) {
        console.log(`✅ ${r.name}: ${r.actual}`);
        passed++;
      } else {
        console.log(`❌ ${r.name}: expected ${r.expected}, got ${r.actual}`);
        failed++;
      }
    }

    console.log(`\n${passed} passed, ${failed} failed out of ${results.length} tests`);

    if (!keepData && workspaceId) {
      console.log('\n▸ Cleaning up...');
      await cleanup(workspaceId);
      console.log('  Done.');
    } else if (keepData) {
      console.log(`\n▸ Keeping data (workspace_id = ${workspaceId})`);
    }

    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('\n💥 Fatal error:', err);
    if (workspaceId && !keepData) {
      try {
        await cleanup(workspaceId);
      } catch { /* ignore */ }
    }
    process.exit(1);
  }
}

main();
